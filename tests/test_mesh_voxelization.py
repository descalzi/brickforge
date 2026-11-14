from __future__ import annotations

import numpy as np
import pytest
import trimesh

from brickforge.geometry import CellClass, voxelize_mesh


def make_grid_aligned_box() -> trimesh.Trimesh:
    mesh = trimesh.creation.box(extents=(24.0, 28.8, 24.0))
    mesh.apply_translation((12.0, 14.4, 12.0))
    return mesh


def test_voxelize_mesh_classifies_interior_and_surface_cells() -> None:
    grid = voxelize_mesh(make_grid_aligned_box(), units="mm")

    assert grid.spec.dimensions == (3, 3, 3)
    assert grid.spec.origin_mm == (0.0, 0.0, 0.0)
    assert grid.occupied_cell_count == 27
    assert grid.boundary_cell_count == 26
    assert grid.classification[1, 1, 1] == CellClass.INTERIOR
    assert grid.surface_coverage[1, 1, 1] == 1.0
    assert grid.classification[0, 0, 0] == CellClass.BOUNDARY
    assert 0.0 < grid.surface_coverage[0, 0, 0] < 1.0
    assert grid.layer_footprint(1) == tuple(
        (x, z) for z in range(3) for x in range(3)
    )
    assert grid.source_bounds_mm == ((0.0, 0.0, 0.0), (24.0, 28.8, 24.0))
    assert any("sampling approximation" in warning for warning in grid.warnings)


def test_voxelize_mesh_scales_declared_units_to_millimetres() -> None:
    mesh = trimesh.creation.box(extents=(2.4, 2.88, 2.4))
    mesh.apply_translation((1.2, 1.44, 1.2))

    grid = voxelize_mesh(mesh, units="cm")

    assert grid.spec.dimensions == (3, 3, 3)
    assert grid.source_bounds_mm == ((0.0, 0.0, 0.0), (24.0, 28.8, 24.0))


def test_voxelize_mesh_uses_custom_anisotropic_pitch() -> None:
    grid = voxelize_mesh(
        make_grid_aligned_box(),
        units="mm",
        pitch_mm=(12.0, 14.4, 12.0),
    )

    assert grid.spec.dimensions == (2, 2, 2)
    assert grid.spec.pitch_mm == (12.0, 14.4, 12.0)


def test_voxelize_mesh_rejects_non_watertight_mesh() -> None:
    mesh = make_grid_aligned_box()
    mesh.update_faces(np.arange(len(mesh.faces) - 1))

    with pytest.raises(ValueError, match="watertight"):
        voxelize_mesh(mesh, units="mm")


def test_voxelize_mesh_rejects_invalid_units_and_resource_limits() -> None:
    mesh = make_grid_aligned_box()

    with pytest.raises(ValueError, match="units"):
        voxelize_mesh(mesh, units="inch")
    with pytest.raises(ValueError, match="exceeding"):
        voxelize_mesh(mesh, units="mm", max_cells=10)
    with pytest.raises(ValueError, match="batch_cells"):
        voxelize_mesh(mesh, units="mm", batch_cells=0)


def test_voxelize_mesh_rejects_non_finite_and_degenerate_geometry() -> None:
    non_finite = make_grid_aligned_box()
    non_finite.vertices[0, 0] = np.nan
    with pytest.raises(ValueError, match="non-finite"):
        voxelize_mesh(non_finite, units="mm")

    degenerate = make_grid_aligned_box()
    degenerate.faces = np.vstack((degenerate.faces, (0, 0, 0)))
    with pytest.raises(ValueError, match="degenerate"):
        voxelize_mesh(degenerate, units="mm")
