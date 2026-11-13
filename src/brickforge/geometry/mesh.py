"""Initial mesh inspection utilities.

This module deliberately stops short of geometry-to-brick conversion. Its first
responsibility is to provide reliable, unit-aware input diagnostics.
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

    def to_dict(self) -> dict[str, object]:
        """Return a JSON-serialisable representation."""
        return asdict(self)


def inspect_mesh(path: str | Path, *, units: str) -> MeshReport:
    """Load and inspect a mesh, requiring explicit source units.

    Supported units are millimetres, centimetres, and metres. Requiring units
    avoids silently treating an STL's unitless coordinates as millimetres.
    """
    unit_to_mm = {"mm": 1.0, "cm": 10.0, "m": 1000.0}
    if units not in unit_to_mm:
        raise ValueError("units must be one of: 'mm', 'cm', or 'm'")

    source = Path(path)
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

    vertices = np.asarray(mesh.vertices, dtype=float) * unit_to_mm[units]
    if not np.isfinite(vertices).all():
        raise ValueError("Mesh contains non-finite vertex coordinates")

    bounds = np.vstack((vertices.min(axis=0), vertices.max(axis=0)))
    dimensions = bounds[1] - bounds[0]

    return MeshReport(
        source=str(source),
        vertex_count=len(mesh.vertices),
        face_count=len(mesh.faces),
        bounds_min_mm=tuple(float(v) for v in bounds[0]),
        bounds_max_mm=tuple(float(v) for v in bounds[1]),
        dimensions_mm=tuple(float(v) for v in dimensions),
        is_watertight=bool(mesh.is_watertight),
        is_winding_consistent=bool(mesh.is_winding_consistent),
    )
