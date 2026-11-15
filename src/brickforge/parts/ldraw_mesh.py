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


def assembly_to_mesh(\n    assembly: Assembly,\n    library: LDrawLibrary,\n    *,\n    repair_winding: bool = True,\n) -> trimesh.Trimesh:
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
