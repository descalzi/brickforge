"""Initial mesh inspection utilities.

This module provides unit-aware input diagnostics before solid voxelisation.
Self-intersection detection is deliberately reported as not assessed: watertight
edge incidence and consistent winding do not prove that triangles do not cross.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import trimesh


@dataclass(frozen=True, slots=True)
class MeshReport:
    """Machine-readable summary of an imported triangle mesh."""

    source: str
    vertex_count: int
    face_count: int
    bounds_min_mm: tuple[float, float, float]
    bounds_max_mm: tuple[float, float, float]
    dimensions_mm: tuple[float, float, float]
    is_watertight: bool
    is_winding_consistent: bool
    is_volume: bool
    connected_component_count: int
    euler_characteristic: int
    degenerate_face_count: int
    duplicate_face_count: int
    validation_status: str
    warnings: tuple[str, ...]

    def to_dict(self) -> dict[str, object]:
        """Return a JSON-serialisable representation."""
        return asdict(self)


def inspect_mesh(path: str | Path, *, units: str) -> MeshReport:
    """Load and inspect a mesh, requiring explicit source units.

    Supported units are millimetres, centimetres, and metres. Requiring units
    avoids silently treating an STL's unitless coordinates as millimetres.
    The report does not claim to detect self-intersecting triangle surfaces.
    """
    unit_to_mm = {"mm": 1.0, "cm": 10.0, "m": 1000.0}
    if units not in unit_to_mm:
        raise ValueError("units must be one of: 'mm', 'cm', or 'm'")

    source = Path(path)
    # Preserve faces during import so degeneracy and duplicate diagnostics are meaningful.
    loaded = trimesh.load(source, force="scene", process=False)
    if isinstance(loaded, trimesh.Scene):
        if not loaded.geometry:
            raise ValueError(f"Mesh contains no geometry: {source}")
        mesh = trimesh.util.concatenate(tuple(loaded.geometry.values()))
    else:
        mesh = loaded

    if not isinstance(mesh, trimesh.Trimesh):
        raise TypeError(f"Expected triangle mesh, got {type(mesh).__name__}")
    if len(mesh.vertices) == 0 or len(mesh.faces) == 0:
        raise ValueError("Mesh must contain vertices and faces")

    # STL commonly stores three independent vertices per triangle. Weld exact
    # duplicates to recover shared-edge topology without changing coordinates.
    mesh.merge_vertices()
    vertices = np.asarray(mesh.vertices, dtype=float) * unit_to_mm[units]
    faces = np.asarray(mesh.faces, dtype=np.int64)
    if not np.isfinite(vertices).all():
        raise ValueError("Mesh contains non-finite vertex coordinates")
    if faces.ndim != 2 or faces.shape[1] != 3 or faces.size == 0:
        raise ValueError("Mesh must contain triangular faces")

    bounds = np.vstack((vertices.min(axis=0), vertices.max(axis=0)))
    dimensions = bounds[1] - bounds[0]
    triangles = vertices[faces]
    cross = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
    double_areas = np.linalg.norm(cross, axis=1)
    diagonal = float(np.linalg.norm(dimensions))
    area_epsilon = max(1e-12, diagonal * diagonal * 1e-12)
    degenerate_count = int(np.count_nonzero(~np.isfinite(double_areas) | (double_areas <= area_epsilon)))
    canonical_faces = np.sort(faces, axis=1)
    duplicate_count = int(len(canonical_faces) - len(np.unique(canonical_faces, axis=0)))

    # Trimesh's topology routines operate on the welded vertex representation.
    mesh.vertices = vertices
    components = mesh.split(only_watertight=False)
    component_count = len(components)
    watertight = bool(mesh.is_watertight)
    winding_consistent = bool(mesh.is_winding_consistent)
    is_volume = bool(mesh.is_volume)
    euler_characteristic = int(mesh.euler_number)

    warnings: list[str] = []
    if not watertight:
        warnings.append("Mesh is open or has non-manifold edges; solid voxelisation is not supported.")
    if not winding_consistent:
        warnings.append("Face winding is inconsistent; inside/outside classification is unreliable.")
    if degenerate_count:
        warnings.append(f"Mesh contains {degenerate_count} degenerate triangle(s).")
    if duplicate_count:
        warnings.append(f"Mesh contains {duplicate_count} duplicate triangle(s).")
    if component_count > 1:
        warnings.append(
            f"Mesh contains {component_count} disconnected surface component(s); "
            "inspect whether these are intended separate solids."
        )
    if not is_volume:
        warnings.append("Mesh does not satisfy Trimesh's closed positive-volume solid checks.")
    warnings.append(
        "Self-intersections are not assessed. Watertight edges and consistent winding "
        "do not prove that triangle surfaces do not intersect."
    )

    ready = watertight and winding_consistent and is_volume and not degenerate_count and not duplicate_count
    return MeshReport(
        source=str(source),
        vertex_count=len(vertices),
        face_count=len(faces),
        bounds_min_mm=tuple(float(value) for value in bounds[0]),
        bounds_max_mm=tuple(float(value) for value in bounds[1]),
        dimensions_mm=tuple(float(value) for value in dimensions),
        is_watertight=watertight,
        is_winding_consistent=winding_consistent,
        is_volume=is_volume,
        connected_component_count=component_count,
        euler_characteristic=euler_characteristic,
        degenerate_face_count=degenerate_count,
        duplicate_face_count=duplicate_count,
        validation_status="closed_solid_checks_passed" if ready else "needs_review",
        warnings=tuple(warnings),
    )
