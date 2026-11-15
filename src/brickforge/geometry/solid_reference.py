"""Voxel-derived watertight reference solids for authored LDraw assemblies.

LDraw part files are render surfaces, not guaranteed closed solids. This module
makes that distinction explicit: it rasterises resolved triangles at a declared
physical pitch, fills only voxel regions not connected to the exterior, and
extracts a new solid boundary. Through-openings that remain connected to the
exterior are preserved when the chosen pitch resolves them.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, cast

import numpy as np
import trimesh
from scipy import ndimage  # type: ignore[import-untyped]

from brickforge.assembly.model import Assembly
from brickforge.parts.ldraw_mesh import assembly_to_mesh
from brickforge.parts.ldraw_resolver import LDrawLibrary


@dataclass(frozen=True, slots=True)
class SolidReferenceReport:
    """Diagnostics for a deliberately resolution-limited solid reference."""

    method: str
    pitch_mm: float
    source_bounds_mm: tuple[tuple[float, float, float], tuple[float, float, float]]
    solid_bounds_mm: tuple[tuple[float, float, float], tuple[float, float, float]]
    voxel_dimensions: tuple[int, int, int]
    occupied_voxels: int
    component_count: int
    handle_count: int
    euler_characteristic: int
    is_watertight: bool
    is_winding_consistent: bool
    is_volume: bool
    bounds_reconciliation_scale: tuple[float, float, float]
    expected_handle_count: int | None
    required_topology_preserved: bool
    warnings: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        """Return JSON-safe report data."""
        return asdict(self)


def solidify_surface_mesh(
    mesh: trimesh.Trimesh,
    *,
    pitch_mm: float = 0.5,
    max_voxels: int = 2_000_000,
    expected_handle_count: int | None = None,
) -> tuple[trimesh.Trimesh, SolidReferenceReport]:
    """Create a watertight solid reference from an arbitrary triangle surface.

    This is a documented voxel approximation, not a boolean reconstruction of
    the original part CAD. The surface is sampled at pitch_mm, enclosed regions
    are filled by exterior flood-fill, and marching cubes extracts the result.
    Narrow openings smaller than the resolution may close; callers can provide
    an expected handle count to make that a hard failure.
    """
    if not isinstance(mesh, trimesh.Trimesh) or not len(mesh.faces):
        raise ValueError("solid reference requires a non-empty triangle mesh")
    if not np.isfinite(mesh.vertices).all():
        raise ValueError("solid reference source contains non-finite vertices")
    if not np.isfinite(mesh.area_faces).all() or np.any(mesh.area_faces <= 1e-12):
        raise ValueError("solid reference source contains degenerate faces")
    if not np.isfinite(pitch_mm) or pitch_mm <= 0:
        raise ValueError("pitch_mm must be a positive finite number")
    if isinstance(max_voxels, bool) or not isinstance(max_voxels, int) or max_voxels < 1:
        raise ValueError("max_voxels must be a positive integer")
    if expected_handle_count is not None and (
        isinstance(expected_handle_count, bool)
        or not isinstance(expected_handle_count, int)
        or expected_handle_count < 0
    ):
        raise ValueError("expected_handle_count must be a non-negative integer")

    source_bounds = np.asarray(mesh.bounds, dtype=np.float64)
    estimated_dimensions = np.maximum(
        1, np.ceil((source_bounds[1] - source_bounds[0]) / pitch_mm).astype(np.int64) + 3
    )
    estimated_count = int(np.prod(estimated_dimensions, dtype=np.int64))
    if estimated_count > max_voxels:
        raise ValueError(
            f"solid reference requires approximately {estimated_count:,} voxels, "
            f"exceeding the configured limit of {max_voxels:,}"
        )

    # Subdivision rasterises actual triangles, rather than filling a proxy box.
    surface = mesh.voxelized(pitch=pitch_mm, method="subdivide")
    if int(np.prod(surface.shape, dtype=np.int64)) > max_voxels:
        raise ValueError("voxelised surface exceeds the configured voxel limit")
    filled = surface.fill()
    solid = filled.marching_cubes
    # Trimesh's VoxelGrid.marching_cubes returns vertices in voxel-index
    # coordinates; explicitly apply the grid transform to restore millimetres
    # and the original world-space origin.
    solid.apply_transform(filled.transform)
    solid.remove_unreferenced_vertices()
    solid.merge_vertices()
    # Marching cubes encloses the outermost voxel centres with a half-cell
    # margin. Reconcile that known rasterisation margin back to the measured
    # source bounds so a brick whose edge lies on a stud-grid boundary does
    # not spuriously acquire an extra stud row when re-imported.
    source_extents = source_bounds[1] - source_bounds[0]
    voxel_extents = np.asarray(solid.extents, dtype=np.float64)
    if np.any(voxel_extents <= 0):
        raise ValueError("voxel-derived reference has a zero-size axis")
    reconciliation_scale = source_extents / voxel_extents
    solid.apply_scale(reconciliation_scale)
    solid.apply_translation(source_bounds.mean(axis=0) - solid.bounds.mean(axis=0))
    if not solid.is_watertight or not solid.is_winding_consistent or not solid.is_volume:
        raise ValueError(
            "voxel-derived reference failed closed-solid validation; "
            "increase resolution or inspect the source surface"
        )

    matrix = np.asarray(filled.matrix, dtype=bool)
    structure = ndimage.generate_binary_structure(3, 1)
    _, component_count = ndimage.label(matrix, structure=structure)
    euler = int(solid.euler_number)
    numerator = 2 * int(component_count) - euler
    if numerator < 0 or numerator % 2:
        raise ValueError("solid reference has unsupported or inconsistent topology")
    handle_count = numerator // 2
    topology_preserved = (
        expected_handle_count is None or handle_count == expected_handle_count
    )
    warnings = [
        "This is a voxel-derived reference, not the original CAD boundary.",
        "Features narrower than the declared voxel pitch may be lost or enlarged.",
        "Exterior-connected cavities are preserved; enclosed cavities are filled.",
        "The report does not certify LEGO clutch strength, stability or buildability.",
    ]
    if not np.allclose(reconciliation_scale, 1.0, rtol=0.0, atol=1e-8):
        warnings.append(
            "A small axis-wise scale correction removes the marching-cubes half-voxel boundary margin; "
            f"factors are {tuple(float(v) for v in reconciliation_scale)}."
        )
    if not topology_preserved:
        warnings.append(
            f"Expected {expected_handle_count} through-opening handle(s), "
            f"but the solid reference contains {handle_count}; reduce pitch."
        )
    report = SolidReferenceReport(
        method="triangle voxelisation, exterior flood-fill and marching cubes",
        pitch_mm=float(pitch_mm),
        source_bounds_mm=tuple(tuple(float(v) for v in row) for row in source_bounds),  # type: ignore[arg-type]
        solid_bounds_mm=tuple(
            tuple(float(v) for v in row) for row in np.asarray(solid.bounds)
        ),  # type: ignore[arg-type]
        voxel_dimensions=cast(tuple[int, int, int], tuple(int(v) for v in matrix.shape)),
        occupied_voxels=int(np.count_nonzero(matrix)),
        component_count=int(component_count),
        handle_count=int(handle_count),
        euler_characteristic=euler,
        is_watertight=bool(solid.is_watertight),
        is_winding_consistent=bool(solid.is_winding_consistent),
        is_volume=bool(solid.is_volume),
        bounds_reconciliation_scale=cast(
            tuple[float, float, float], tuple(float(v) for v in reconciliation_scale)
        ),
        expected_handle_count=expected_handle_count,
        required_topology_preserved=topology_preserved,
        warnings=tuple(warnings),
    )
    return solid, report


def export_assembly_solid_reference_stl(
    assembly: Assembly,
    library: LDrawLibrary,
    destination: str | Path,
    *,
    pitch_mm: float = 0.25,
    max_voxels: int = 2_000_000,
    expected_handle_count: int | None = None,
) -> dict[str, Any]:
    """Export a watertight voxel-derived STL plus full provenance sidecar."""
    path = Path(destination)
    if path.suffix.casefold() != ".stl":
        raise ValueError("solid reference destination must use the .stl extension")
    path.parent.mkdir(parents=True, exist_ok=True)
    source_mesh = assembly_to_mesh(assembly, library)
    solid, report = solidify_surface_mesh(
        source_mesh,
        pitch_mm=pitch_mm,
        max_voxels=max_voxels,
        expected_handle_count=expected_handle_count,
    )
    if not report.required_topology_preserved:
        raise ValueError("; ".join(report.warnings))
    payload = solid.export(file_type="stl")
    if not isinstance(payload, bytes):
        raise TypeError("Trimesh did not return binary STL data")
    path.write_bytes(payload)
    manifest: dict[str, Any] = {
        "schema_version": 1,
        "mesh_file": path.name,
        "mesh_sha256": hashlib.sha256(payload).hexdigest(),
        "mesh_format": "STL",
        "units": "mm",
        "coordinate_system": "LDraw",
        "source_assembly_sha256": hashlib.sha256(
            assembly.to_json().encode("utf-8")
        ).hexdigest(),
        "source_model_name": assembly.model_name,
        "source_part_count": len(assembly.parts),
        "source_bom": assembly.bom_dict(),
        "solid_reference": report.to_dict(),
        "limitations": list(report.warnings),
    }
    path.with_suffix(".stl.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\\n",
        encoding="utf-8",
    )
    return manifest
