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
    self_intersection_status: str
    self_intersecting_triangle_pair_count: int
    self_intersection_candidate_pair_count: int
    validation_status: str
    warnings: tuple[str, ...]

    def to_dict(self) -> dict[str, object]:
        """Return a JSON-serialisable representation."""
        return asdict(self)


def _triangle_pair_intersects(first: np.ndarray, second: np.ndarray, epsilon: float) -> bool:
    """Separating-axis test, including coplanar separation axes."""
    first_edges = (first[1] - first[0], first[2] - first[1], first[0] - first[2])
    second_edges = (second[1] - second[0], second[2] - second[1], second[0] - second[2])
    first_normal = np.cross(first_edges[0], first_edges[1])
    second_normal = np.cross(second_edges[0], second_edges[1])
    axes = [first_normal, second_normal]
    axes.extend(np.cross(left, right) for left in first_edges for right in second_edges)
    axes.extend(np.cross(first_normal, edge) for edge in first_edges)
    axes.extend(np.cross(second_normal, edge) for edge in second_edges)
    for axis in axes:
        magnitude = float(np.linalg.norm(axis))
        if magnitude <= epsilon:
            continue
        unit_axis = axis / magnitude
        first_projection = first @ unit_axis
        second_projection = second @ unit_axis
        if (float(first_projection.max()) < float(second_projection.min()) - epsilon
                or float(second_projection.max()) < float(first_projection.min()) - epsilon):
            return False
    return True


def _self_intersection_diagnostics(
    vertices: np.ndarray, faces: np.ndarray, *, max_candidate_pairs: int = 2_000_000
) -> tuple[str, int, int]:
    """Sweep-and-prune triangle test with a hard candidate-pair budget."""
    triangles = vertices[faces]
    bounds_min = triangles.min(axis=1)
    bounds_max = triangles.max(axis=1)
    scale = max(1.0, float(np.linalg.norm(vertices.max(axis=0) - vertices.min(axis=0))))
    epsilon = scale * 1e-9
    order = np.argsort(bounds_min[:, 0], kind="stable")
    intersections = 0
    candidates = 0
    for order_index, face_index in enumerate(order):
        possible = order[order_index + 1:]
        if not len(possible):
            break
        stop = int(np.searchsorted(bounds_min[possible, 0], bounds_max[face_index, 0] + epsilon, side="right"))
        for other_index in possible[:stop]:
            if np.intersect1d(faces[face_index], faces[other_index]).size:
                continue
            if np.any(bounds_max[face_index, 1:] < bounds_min[other_index, 1:] - epsilon):
                continue
            if np.any(bounds_max[other_index, 1:] < bounds_min[face_index, 1:] - epsilon):
                continue
            candidates += 1
            if candidates > max_candidate_pairs:
                return "not_assessed_pair_limit", intersections, candidates
            if _triangle_pair_intersects(triangles[face_index], triangles[other_index], epsilon):
                intersections += 1
    return ("intersections_detected" if intersections else "none_detected"), intersections, candidates


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
    degenerate_mask = ~np.isfinite(double_areas) | (double_areas <= area_epsilon)
    degenerate_count = int(np.count_nonzero(degenerate_mask))
    canonical_faces = np.sort(faces, axis=1)
    duplicate_count = int(len(canonical_faces) - len(np.unique(canonical_faces, axis=0)))

    # Count face-connected components directly; avoid Trimesh's optional NetworkX
    # dependency so inspection remains available in the minimal package install.
    parents = list(range(len(vertices)))

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def union(left: int, right: int) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parents[right_root] = left_root

    for face in faces:
        union(int(face[0]), int(face[1]))
        union(int(face[1]), int(face[2]))
    component_count = len({find(int(index)) for index in np.unique(faces)})

    # Topology properties are evaluated on the welded, unit-scaled geometry.
    mesh.vertices = vertices
    watertight = bool(mesh.is_watertight)
    winding_consistent = bool(mesh.is_winding_consistent)
    is_volume = bool(mesh.is_volume)
    euler_characteristic = int(mesh.euler_number)
    intersection_status, intersection_pairs, intersection_candidates = _self_intersection_diagnostics(vertices, faces)

    warnings: list[str] = []
    if not watertight:
        warnings.append(
            "Mesh is open or has non-manifold edges; solid voxelisation is not supported."
        )
    if not winding_consistent:
        warnings.append(
            "Face winding is inconsistent; inside/outside classification is unreliable."
        )
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
    if intersection_status == "intersections_detected":
        warnings.append(f"Detected {intersection_pairs} intersecting non-adjacent triangle pair(s).")
    elif intersection_status == "not_assessed_pair_limit":
        warnings.append("Self-intersection scan reached its candidate-pair limit; mesh is not certified clear.")

    ready = (
        watertight and winding_consistent and is_volume
        and not degenerate_count and not duplicate_count
        and intersection_status == "none_detected"
    )
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
        self_intersection_status=intersection_status,
        self_intersecting_triangle_pair_count=intersection_pairs,
        self_intersection_candidate_pair_count=intersection_candidates,
        validation_status="closed_solid_checks_passed" if ready else "needs_review",
        warnings=tuple(warnings),
    )
