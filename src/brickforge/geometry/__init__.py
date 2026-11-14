"""Mesh ingestion, target-grid representation, and geometry analysis."""

from brickforge.geometry.grid import CellClass, GridSpec, TargetGrid
from brickforge.geometry.mesh import MeshReport, inspect_mesh
from brickforge.geometry.voxelize import voxelize_mesh

__all__ = [
    "CellClass",
    "GridSpec",
    "MeshReport",
    "TargetGrid",
    "inspect_mesh",
    "voxelize_mesh",
]
