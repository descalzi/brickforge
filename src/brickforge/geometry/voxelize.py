"""Sampling-based voxelisation of closed triangle meshes onto the target grid."""

from __future__ import annotations

from math import ceil, floor, isfinite
from typing import cast

import numpy as np
import trimesh

from brickforge.geometry.grid import (
    BRICK_GRID_PITCH_MM,
    CellClass,
    GridSpec,
    TargetGrid,
    Vector3,
)

_UNIT_TO_MM = {"mm": 1.0, "cm": 10.0, "m": 1000.0}
_SAMPLE_OFFSETS = np.array(
    [
        (x, y, z)
        for y in (0.0, 0.5, 1.0)
        for z in (0.0, 0.5, 1.0)
        for x in (0.0, 0.5, 1.0)
    ],
    dtype=np.float64,
)


def voxelize_mesh(
    mesh: trimesh.Trimesh,
    *,
    units: str,
    pitch_mm: Vector3 = BRICK_GRID_PITCH_MM,
    max_cells: int = 250_000,
    batch_cells: int = 2_048,
) -> TargetGrid:
    """Classify a closed mesh on a deterministic, axis-aligned target grid.

    Each cell is sampled at a 3x3x3 lattice including its centre and faces.
    Surface coverage is the fraction of sample points classified inside the
    mesh. This is a bounded approximation, not exact triangle-cell clipping.
    """
    if units not in _UNIT_TO_MM:
        raise ValueError("units must be one of: 'mm', 'cm', or 'm'")
    if isinstance(max_cells, bool) or not isinstance(max_cells, int) or max_cells < 1:
        raise ValueError("max_cells must be a positive integer")
    if isinstance(batch_cells, bool) or not isinstance(batch_cells, int) or batch_cells < 1:
        raise ValueError("batch_cells must be a positive integer")
    if len(pitch_mm) != 3 or not all(
        isfinite(value) and value > 0 for value in pitch_mm
    ):
        raise ValueError("pitch_mm must contain three positive finite values")
    if not isinstance(mesh, trimesh.Trimesh):
        raise TypeError("voxelize_mesh expects a trimesh.Trimesh instance")
    if len(mesh.vertices) == 0 or len(mesh.faces) == 0:
        raise ValueError("Mesh must contain vertices and faces")
    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    if not np.isfinite(vertices).all():
        raise ValueError("Mesh contains non-finite vertex coordinates")
    if not np.isfinite(mesh.area_faces).all() or np.any(mesh.area_faces <= 1e-12):
        raise ValueError("Mesh contains degenerate faces")
    if not mesh.is_watertight:
        raise ValueError("Solid voxelisation requires a watertight mesh")
    if not mesh.is_winding_consistent:
        raise ValueError("Solid voxelisation requires consistent face winding")

    scale = _UNIT_TO_MM[units]
    scaled_mesh = mesh.copy()
    scaled_mesh.apply_scale(scale)
    bounds = np.asarray(scaled_mesh.bounds, dtype=np.float64)
    origin = np.array(
        [
            floor(bounds[0, axis] / pitch_mm[axis]) * pitch_mm[axis]
            for axis in range(3)
        ],
        dtype=np.float64,
    )
    dimensions = tuple(
        max(
            1,
            int(
                ceil(
                    (bounds[1, axis] - origin[axis]) / pitch_mm[axis] - 1e-12
                )
            ),
        )
        for axis in range(3)
    )
    spec = GridSpec(
        dimensions=cast(tuple[int, int, int], dimensions),
        origin_mm=cast(Vector3, tuple(float(value) for value in origin)),
        pitch_mm=pitch_mm,
    )
    if spec.cell_count > max_cells:
        raise ValueError(
            f"Target grid requires {spec.cell_count:,} cells, exceeding "
            f"the configured limit of {max_cells:,}"
        )

    width, height, depth = spec.dimensions
    coverage_flat = np.zeros(spec.cell_count, dtype=np.float32)
    classification_flat = np.full(
        spec.cell_count, CellClass.EXTERIOR, dtype=np.uint8
    )
    offsets = _SAMPLE_OFFSETS * np.asarray(pitch_mm, dtype=np.float64)
    cell_count = spec.cell_count

    for start in range(0, cell_count, batch_cells):
        stop = min(start + batch_cells, cell_count)
        flat = np.arange(start, stop, dtype=np.int64)
        x = flat % width
        z = (flat // width) % depth
        y = flat // (width * depth)
        cell_minimum = origin + np.column_stack((x, y, z)) * pitch_mm
        sample_points = (
            cell_minimum[:, np.newaxis, :] + offsets[np.newaxis, :, :]
        ).reshape(-1, 3)
        inside = scaled_mesh.contains(sample_points).reshape(-1, len(_SAMPLE_OFFSETS))
        fractions = inside.mean(axis=1, dtype=np.float64).astype(np.float32)
        coverage_flat[start:stop] = fractions
        classification_flat[start:stop] = np.where(
            fractions <= 0.0,
            CellClass.EXTERIOR,
            np.where(fractions >= 1.0, CellClass.INTERIOR, CellClass.BOUNDARY),
        ).astype(np.uint8)

    return TargetGrid(
        spec=spec,
        classification=classification_flat.reshape(spec.array_shape),
        surface_coverage=coverage_flat.reshape(spec.array_shape),
        source_units=units,
        source_bounds_mm=(
            cast(Vector3, tuple(float(value) for value in bounds[0])),
            cast(Vector3, tuple(float(value) for value in bounds[1])),
        ),
        warnings=(
            "Occupancy uses a 3x3x3 point-sampling approximation; thin features "
            "and exact triangle-cell intersections may be missed.",
        ),
    )
