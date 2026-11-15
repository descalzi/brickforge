"""Export canonical LDraw assemblies as meshes from resolved source geometry.

STL has no unit metadata. The exporter therefore writes a JSON sidecar containing
units, coordinate convention, source assembly hash and geometry diagnostics.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np
import trimesh

from brickforge.assembly.model import Assembly
from brickforge.parts.ldraw_geometry import LDU_TO_MM
from brickforge.parts.ldraw_resolver import LDrawLibrary


def assembly_to_mesh(
    assembly: Assembly,
    library: LDrawLibrary,
) -> trimesh.Trimesh:
    """Resolve every placed part and combine its actual LDraw triangles/quads.

    Type-2 lines and type-5 conditional lines are intentionally omitted. Quads
    are split along one diagonal. Part shells are concatenated, not boolean
    unioned; touching or overlapping shells are disclosed by the manifest.
    Coordinates are exported in millimetres while retaining the LDraw axes.
    """
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int]] = []

    for part in assembly.parts:
        primitives = library.resolve_part_geometry(
            f"{part.part_id}.dat",
            colour_code=part.colour_code,
        )
        determinant = (
            part.matrix[0] * (part.matrix[4] * part.matrix[8] - part.matrix[5] * part.matrix[7])
            - part.matrix[1] * (part.matrix[3] * part.matrix[8] - part.matrix[5] * part.matrix[6])
            + part.matrix[2] * (part.matrix[3] * part.matrix[7] - part.matrix[4] * part.matrix[6])
        )
        for primitive in primitives:
            if primitive.line_type not in (3, 4):
                continue
            base = len(vertices)
            for point in primitive.points:
                x, y, z = point
                transformed = (
                    part.matrix[0] * x + part.matrix[1] * y + part.matrix[2] * z
                    + part.translation_ldu[0],
                    part.matrix[3] * x + part.matrix[4] * y + part.matrix[5] * z
                    + part.translation_ldu[1],
                    part.matrix[6] * x + part.matrix[7] * y + part.matrix[8] * z
                    + part.translation_ldu[2],
                )
                vertices.append(tuple(value * LDU_TO_MM for value in transformed))
            local_faces = [(base, base + 1, base + 2)]
            if primitive.line_type == 4:
                local_faces.append((base, base + 2, base + 3))
            if determinant < 0:
                local_faces = [(a, c, b) for a, b, c in local_faces]
            faces.extend(local_faces)

    if not vertices or not faces:
        raise ValueError("The assembly contains no resolved triangle or quad geometry.")

    mesh = trimesh.Trimesh(
        vertices=np.asarray(vertices, dtype=np.float64),
        faces=np.asarray(faces, dtype=np.int64),
        process=False,
    )
    mesh.merge_vertices(digits_vertex=8)
    return mesh


def _repair_face_winding(mesh: trimesh.Trimesh) -> int:
    """Orient adjacent triangles consistently without optional NetworkX.

    Returns the number of contradictory adjacency constraints. Non-orientable
    or non-manifold conflicts remain visible to the caller and are not hidden.
    """
    faces = np.asarray(mesh.faces, dtype=np.int64).copy()
    adjacency: list[list[tuple[int, int]]] = [[] for _ in range(len(faces))]
    shared_edges = np.asarray(mesh.face_adjacency_edges, dtype=np.int64)
    adjacent_faces = np.asarray(mesh.face_adjacency, dtype=np.int64)

    def edge_direction(face: np.ndarray, edge: np.ndarray) -> tuple[int, int]:
        left, right = int(edge[0]), int(edge[1])
        for index in range(3):
            start = int(face[index])
            end = int(face[(index + 1) % 3])
            if (start == left and end == right) or (start == right and end == left):
                return start, end
        raise ValueError("Face adjacency references an edge absent from its triangle.")

    for pair, edge in zip(adjacent_faces, shared_edges, strict=True):
        first, second = int(pair[0]), int(pair[1])
        direction_a = edge_direction(faces[first], edge)
        direction_b = edge_direction(faces[second], edge)
        toggle = int(direction_a == direction_b)
        adjacency[first].append((second, toggle))
        adjacency[second].append((first, toggle))

    flips: list[int | None] = [None] * len(faces)
    conflicts = 0
    for root in range(len(faces)):
        if flips[root] is not None:
            continue
        flips[root] = 0
        pending = [root]
        while pending:
            current = pending.pop()
            current_flip = flips[current]
            assert current_flip is not None
            for neighbour, toggle in adjacency[current]:
                expected = current_flip ^ toggle
                if flips[neighbour] is None:
                    flips[neighbour] = expected
                    pending.append(neighbour)
                elif flips[neighbour] != expected:
                    conflicts += 1

    flip_indices = np.fromiter(
        (index for index, value in enumerate(flips) if value == 1),
        dtype=np.int64,
    )
    if len(flip_indices):
        faces[flip_indices] = faces[flip_indices][:, [0, 2, 1]]
        mesh.faces = faces
    return conflicts


def export_assembly_stl(
    assembly: Assembly,
    library: LDrawLibrary,
    destination: str | Path,
) -> dict[str, Any]:
    """Write a geometry-derived STL and its mandatory units/provenance sidecar."""
    path = Path(destination)
    if path.suffix.casefold() != ".stl":
        raise ValueError("assembly mesh destination must use the .stl extension")
    path.parent.mkdir(parents=True, exist_ok=True)
    mesh = assembly_to_mesh(assembly, library)
    raw_winding_consistent = bool(mesh.is_winding_consistent)
    winding_conflicts = _repair_face_winding(mesh)
    payload = mesh.export(file_type="stl")
    if not isinstance(payload, bytes):
        raise TypeError("Trimesh did not return binary STL data")
    path.write_bytes(payload)

    assembly_json = assembly.to_json()
    manifest: dict[str, Any] = {
        "schema_version": 1,
        "mesh_file": path.name,
        "mesh_sha256": hashlib.sha256(payload).hexdigest(),
        "mesh_format": "STL",
        "units": "mm",
        "coordinate_system": "LDraw",
        "source_assembly_sha256": hashlib.sha256(
            assembly_json.encode("utf-8")
        ).hexdigest(),
        "source_model_name": assembly.model_name,
        "source_part_count": len(assembly.parts),
        "source_bom": assembly.bom_dict(),
        "bounds_mm": mesh.bounds.tolist(),
        "vertex_count": len(mesh.vertices),
        "triangle_count": len(mesh.faces),
        "is_watertight": bool(mesh.is_watertight),
        "raw_is_winding_consistent": raw_winding_consistent,
        "winding_repair_attempted": True,
        "winding_repair_conflict_count": winding_conflicts,
        "is_winding_consistent": bool(mesh.is_winding_consistent),
        "shell_policy": "part shells concatenated; no boolean union performed",
        "limitations": [
            "STL does not store units; use this sidecar to interpret coordinates.",
            "Part shells are concatenated, not boolean-unioned.",
            "Colour/material data is retained in the BOM sidecar, not in STL.",
            "Nominal assembly connectivity does not prove physical clutch or stability.",
        ],
    }
    sidecar = path.with_suffix(".stl.json")
    sidecar.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return manifest
