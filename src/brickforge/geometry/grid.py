"""Scale-aware target occupancy grids for mesh-to-construction workflows.

This module defines the shared grid contract. Mesh voxelisation is deliberately
kept separate so import/classification strategies can evolve without changing
the representation consumed by construction algorithms.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum
from math import isfinite

import numpy as np
import numpy.typing as npt

Vector3 = tuple[float, float, float]
GridDimensions = tuple[int, int, int]
GridArray = npt.NDArray[np.uint8]
CoverageArray = npt.NDArray[np.float32]

BRICK_GRID_PITCH_MM: Vector3 = (8.0, 9.6, 8.0)
TARGET_GRID_VERSION = 1


class CellClass(IntEnum):
    """Classification of one target-grid cell."""

    EXTERIOR = 0
    INTERIOR = 1
    BOUNDARY = 2


@dataclass(frozen=True, slots=True)
class GridSpec:
    """Physical mapping between integer grid cells and world-space millimetres.

    Dimensions are ordered X, Y, Z. Arrays use Y, Z, X order so X is the
    contiguous/fastest-changing axis. Y is the vertical course axis.
    """

    dimensions: GridDimensions
    origin_mm: Vector3
    pitch_mm: Vector3 = BRICK_GRID_PITCH_MM

    def __post_init__(self) -> None:
        if len(self.dimensions) != 3 or any(
            isinstance(value, bool) or not isinstance(value, int) or value < 1
            for value in self.dimensions
        ):
            raise ValueError("grid dimensions must be three positive integers")
        if len(self.origin_mm) != 3 or not all(isfinite(value) for value in self.origin_mm):
            raise ValueError("grid origin must contain three finite coordinates")
        if len(self.pitch_mm) != 3 or not all(
            isfinite(value) and value > 0 for value in self.pitch_mm
        ):
            raise ValueError("grid pitch must contain three positive finite values")

    @property
    def cell_count(self) -> int:
        """Return the total number of cells without allocating the grid."""
        width, height, depth = self.dimensions
        return width * height * depth

    @property
    def array_shape(self) -> tuple[int, int, int]:
        """Return the backing-array shape in Y, Z, X order."""
        width, height, depth = self.dimensions
        return (height, depth, width)

    def contains(self, x: int, y: int, z: int) -> bool:
        """Return whether an integer cell coordinate is inside the grid."""
        width, height, depth = self.dimensions
        return 0 <= x < width and 0 <= y < height and 0 <= z < depth

    def flat_index(self, x: int, y: int, z: int) -> int:
        """Return the deterministic flattened index, with X changing fastest."""
        if not self.contains(x, y, z):
            raise IndexError(f"grid cell is outside dimensions: {(x, y, z)}")
        width, _, depth = self.dimensions
        return x + width * (z + depth * y)

    def cell_center_mm(self, x: int, y: int, z: int) -> Vector3:
        """Return the centre of a cell in canonical world-space millimetres."""
        if not self.contains(x, y, z):
            raise IndexError(f"grid cell is outside dimensions: {(x, y, z)}")
        return tuple(
            self.origin_mm[axis] + (index + 0.5) * self.pitch_mm[axis]
            for axis, index in enumerate((x, y, z))
        )  # type: ignore[return-value]

    def cell_bounds_mm(
        self, x: int, y: int, z: int
    ) -> tuple[Vector3, Vector3]:
        """Return the minimum and maximum world-space corners of a cell."""
        if not self.contains(x, y, z):
            raise IndexError(f"grid cell is outside dimensions: {(x, y, z)}")
        indices = (x, y, z)
        minimum = tuple(
            self.origin_mm[axis] + indices[axis] * self.pitch_mm[axis]
            for axis in range(3)
        )
        maximum = tuple(
            minimum[axis] + self.pitch_mm[axis] for axis in range(3)
        )
        return minimum, maximum  # type: ignore[return-value]


@dataclass(frozen=True, slots=True)
class TargetGrid:
    """Immutable classified target volume and its source/grid provenance."""

    spec: GridSpec
    classification: GridArray
    surface_coverage: CoverageArray
    source_units: str
    source_bounds_mm: tuple[Vector3, Vector3]
    warnings: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.source_units not in {"mm", "cm", "m"}:
            raise ValueError("source_units must be 'mm', 'cm', or 'm'")
        if len(self.source_bounds_mm) != 2 or any(
            len(point) != 3
            or not all(isfinite(value) for value in point)
            for point in self.source_bounds_mm
        ):
            raise ValueError("source bounds must contain two finite 3D points")
        if any(
            self.source_bounds_mm[1][axis] < self.source_bounds_mm[0][axis]
            for axis in range(3)
        ):
            raise ValueError("source maximum bounds must not be below minimum bounds")

        raw_classification = np.asarray(self.classification)
        if not np.issubdtype(raw_classification.dtype, np.integer):
            raise ValueError("cell classification must use integer values")
        if raw_classification.shape != self.spec.array_shape:
            raise ValueError(
                f"classification shape must be {self.spec.array_shape}, "
                f"got {raw_classification.shape}"
            )
        if not np.isin(
            raw_classification,
            [int(value) for value in CellClass],
        ).all():
            raise ValueError("classification contains an unknown cell class")

        classification = raw_classification.astype(np.uint8, copy=True)
        coverage = np.asarray(self.surface_coverage, dtype=np.float32)
        if coverage.shape != self.spec.array_shape:
            raise ValueError(
                f"surface coverage shape must be {self.spec.array_shape}, "
                f"got {coverage.shape}"
            )
        if not np.isfinite(coverage).all() or np.any(coverage < 0) or np.any(coverage > 1):
            raise ValueError("surface coverage values must be finite and between 0 and 1")

        classification.setflags(write=False)
        coverage = coverage.copy()
        coverage.setflags(write=False)
        object.__setattr__(self, "classification", classification)
        object.__setattr__(self, "surface_coverage", coverage)

    @property
    def occupied_cell_count(self) -> int:
        """Count interior and boundary cells."""
        return int(np.count_nonzero(self.classification != CellClass.EXTERIOR))

    @property
    def boundary_cell_count(self) -> int:
        """Count cells classified as intersecting the target surface."""
        return int(np.count_nonzero(self.classification == CellClass.BOUNDARY))

    def layer_footprint(self, y: int) -> tuple[tuple[int, int], ...]:
        """Return occupied (X, Z) cells for one vertical course, sorted."""
        _, height, _ = self.spec.dimensions
        if not 0 <= y < height:
            raise IndexError(f"grid layer is outside height: {y}")
        layer = self.classification[y]
        z_indices, x_indices = np.nonzero(layer != CellClass.EXTERIOR)
        return tuple(
            sorted(
                (int(x), int(z))
                for x, z in zip(x_indices, z_indices, strict=True)
            )
        )

    def summary(self) -> dict[str, object]:
        """Return compact JSON-compatible metadata without serialising arrays."""
        return {
            "representation_version": TARGET_GRID_VERSION,
            "dimensions": list(self.spec.dimensions),
            "origin_mm": list(self.spec.origin_mm),
            "pitch_mm": list(self.spec.pitch_mm),
            "source_units": self.source_units,
            "source_bounds_mm": [
                list(self.source_bounds_mm[0]),
                list(self.source_bounds_mm[1]),
            ],
            "occupied_cell_count": self.occupied_cell_count,
            "boundary_cell_count": self.boundary_cell_count,
            "warnings": list(self.warnings),
        }
