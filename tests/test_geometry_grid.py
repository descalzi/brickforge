from __future__ import annotations

import numpy as np
import pytest

from brickforge.geometry.grid import (
    BRICK_GRID_PITCH_MM,
    CellClass,
    GridSpec,
    TargetGrid,
)


def test_grid_spec_maps_cells_to_world_and_flat_indices() -> None:
    spec = GridSpec(dimensions=(2, 1, 3), origin_mm=(-8.0, 2.0, 4.0))

    assert spec.pitch_mm == BRICK_GRID_PITCH_MM
    assert spec.array_shape == (1, 3, 2)
    assert spec.cell_count == 6
    assert spec.flat_index(1, 0, 2) == 5
    assert spec.cell_center_mm(1, 0, 2) == pytest.approx((4.0, 6.8, 24.0))
    minimum, maximum = spec.cell_bounds_mm(0, 0, 0)
    assert minimum == (-8.0, 2.0, 4.0)
    assert maximum == (0.0, 11.6, 12.0)
    assert spec.contains(1, 0, 2)
    assert not spec.contains(2, 0, 2)


def test_grid_spec_rejects_invalid_dimensions_origin_and_pitch() -> None:
    with pytest.raises(ValueError, match="three positive integers"):
        GridSpec(dimensions=(2, 0, 3), origin_mm=(0.0, 0.0, 0.0))
    with pytest.raises(ValueError, match="three positive integers"):
        GridSpec(dimensions=(2, True, 3), origin_mm=(0.0, 0.0, 0.0))
    with pytest.raises(ValueError, match="finite coordinates"):
        GridSpec(dimensions=(1, 1, 1), origin_mm=(0.0, float("nan"), 0.0))
    with pytest.raises(ValueError, match="positive finite values"):
        GridSpec(
            dimensions=(1, 1, 1),
            origin_mm=(0.0, 0.0, 0.0),
            pitch_mm=(8.0, 0.0, 8.0),
        )


def test_grid_spec_rejects_out_of_range_cell_queries() -> None:
    spec = GridSpec(dimensions=(1, 1, 1), origin_mm=(0.0, 0.0, 0.0))

    with pytest.raises(IndexError, match="outside dimensions"):
        spec.flat_index(1, 0, 0)
    with pytest.raises(IndexError, match="outside dimensions"):
        spec.cell_center_mm(0, 1, 0)
    with pytest.raises(IndexError, match="outside dimensions"):
        spec.cell_bounds_mm(0, 0, -1)


def test_target_grid_counts_cells_extracts_layers_and_is_immutable() -> None:
    spec = GridSpec(dimensions=(2, 1, 3), origin_mm=(0.0, 0.0, 0.0))
    classification = np.array(
        [[[CellClass.EXTERIOR, CellClass.INTERIOR],
          [CellClass.BOUNDARY, CellClass.EXTERIOR],
          [CellClass.INTERIOR, CellClass.EXTERIOR]]],
        dtype=np.uint8,
    )
    coverage = np.array(
        [[[0.0, 0.0], [0.75, 0.0], [0.0, 0.0]]],
        dtype=np.float32,
    )
    grid = TargetGrid(
        spec=spec,
        classification=classification,
        surface_coverage=coverage,
        source_units="mm",
        source_bounds_mm=((0.0, 0.0, 0.0), (16.0, 9.6, 24.0)),
        warnings=("Synthetic test target",),
    )

    assert grid.occupied_cell_count == 3
    assert grid.boundary_cell_count == 1
    assert grid.layer_footprint(0) == ((0, 1), (0, 2), (1, 0))
    assert grid.summary() == {
        "representation_version": 1,
        "dimensions": [2, 1, 3],
        "origin_mm": [0.0, 0.0, 0.0],
        "pitch_mm": [8.0, 9.6, 8.0],
        "source_units": "mm",
        "source_bounds_mm": [[0.0, 0.0, 0.0], [16.0, 9.6, 24.0]],
        "occupied_cell_count": 3,
        "boundary_cell_count": 1,
        "warnings": ["Synthetic test target"],
    }
    assert not grid.classification.flags.writeable
    assert not grid.surface_coverage.flags.writeable
    with pytest.raises(ValueError):
        grid.classification[0, 0, 0] = CellClass.INTERIOR


def test_target_grid_rejects_invalid_shapes_classes_and_coverage() -> None:
    spec = GridSpec(dimensions=(1, 1, 1), origin_mm=(0.0, 0.0, 0.0))
    valid = np.zeros((1, 1, 1), dtype=np.uint8)
    bounds = ((0.0, 0.0, 0.0), (8.0, 9.6, 8.0))

    with pytest.raises(ValueError, match="classification shape"):
        TargetGrid(
            spec, np.zeros((1, 1, 2), dtype=np.uint8), valid, "mm", bounds
        )
    with pytest.raises(ValueError, match="integer values"):
        TargetGrid(spec, np.array([[[0.5]]]), valid, "mm", bounds)
    with pytest.raises(ValueError, match="unknown cell class"):
        TargetGrid(spec, np.array([[[9]]]), valid, "mm", bounds)
    with pytest.raises(ValueError, match="surface coverage values"):
        TargetGrid(spec, valid, np.array([[[1.5]]]), "mm", bounds)
    with pytest.raises(ValueError, match="source_units"):
        TargetGrid(spec, valid, valid, "inch", bounds)
    with pytest.raises(ValueError, match="maximum bounds"):
        TargetGrid(
            spec,
            valid,
            valid,
            "mm",
            ((2.0, 0.0, 0.0), (1.0, 1.0, 1.0)),
        )


def test_target_grid_rejects_out_of_range_layer() -> None:
    spec = GridSpec(dimensions=(1, 1, 1), origin_mm=(0.0, 0.0, 0.0))
    grid = TargetGrid(
        spec,
        np.zeros((1, 1, 1), dtype=np.uint8),
        np.zeros((1, 1, 1), dtype=np.float32),
        "mm",
        ((0.0, 0.0, 0.0), (8.0, 9.6, 8.0)),
    )

    with pytest.raises(IndexError, match="outside height"):
        grid.layer_footprint(1)


def test_target_grid_summary_and_layer_match_browser_implementation() -> None:
    spec = GridSpec(dimensions=(2, 1, 3), origin_mm=(0.0, 0.0, 0.0))
    classification = np.array(
        [[[CellClass.EXTERIOR, CellClass.INTERIOR],
          [CellClass.BOUNDARY, CellClass.EXTERIOR],
          [CellClass.INTERIOR, CellClass.EXTERIOR]]],
        dtype=np.uint8,
    )
    coverage = np.array(
        [[[0.0, 0.0], [0.75, 0.0], [0.0, 0.0]]],
        dtype=np.float32,
    )
    grid = TargetGrid(
        spec=spec,
        classification=classification,
        surface_coverage=coverage,
        source_units="mm",
        source_bounds_mm=((0.0, 0.0, 0.0), (16.0, 9.6, 24.0)),
        warnings=("Synthetic test target",),
    )
    script = """
import { readFileSync } from "node:fs";
import { GridSpec, TargetGrid, CellClass } from "./docs/assets/target-grid.js";
const input = JSON.parse(readFileSync(0, "utf8"));
const spec = new GridSpec(input.spec);
const grid = new TargetGrid({ ...input, spec });
process.stdout.write(JSON.stringify({
  summary: grid.summary(),
  footprint: grid.layer_footprint(0),
  centre: spec.cell_center_mm(1, 0, 2),
  bounds: spec.cell_bounds_mm(0, 0, 0),
}));
"""
    payload = {
        "spec": {
            "dimensions": list(spec.dimensions),
            "origin_mm": list(spec.origin_mm),
            "pitch_mm": list(spec.pitch_mm),
        },
        "classification": classification.reshape(-1).tolist(),
        "surface_coverage": coverage.reshape(-1).tolist(),
        "source_units": "mm",
        "source_bounds_mm": [
            [0.0, 0.0, 0.0],
            [16.0, 9.6, 24.0],
        ],
        "warnings": ["Synthetic test target"],
    }
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        input=json.dumps(payload),
        check=True,
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    browser = json.loads(result.stdout)
    assert browser["summary"] == grid.summary()
    assert browser["footprint"] == [list(cell) for cell in grid.layer_footprint(0)]
    assert browser["centre"] == pytest.approx(spec.cell_center_mm(1, 0, 2))
    assert browser["bounds"] == pytest.approx(spec.cell_bounds_mm(0, 0, 0))
