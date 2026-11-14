import assert from "node:assert/strict";
import test from "node:test";

import { CellClass, GridSpec, TargetGrid } from "../docs/assets/target-grid.js";

test("grid maps cells to world coordinates and deterministic flat indices", () => {
  const spec = new GridSpec({
    dimensions: [2, 1, 3],
    origin_mm: [-8, 2, 4],
  });

  assert.deepEqual(spec.array_shape, [1, 3, 2]);
  assert.equal(spec.cell_count, 6);
  assert.equal(spec.flat_index(1, 0, 2), 5);
  assert.deepEqual(spec.cell_center_mm(1, 0, 2), [4, 6.8, 24]);
  assert.deepEqual(spec.cell_bounds_mm(0, 0, 0), [[-8, 2, 4], [0, 11.6, 12]]);
  assert.equal(spec.contains(1, 0, 2), true);
  assert.equal(spec.contains(2, 0, 2), false);
});

test("grid rejects invalid dimensions, origin, pitch and cell queries", () => {
  assert.throws(() => new GridSpec({ dimensions: [2, 0, 3], origin_mm: [0, 0, 0] }), /positive integers/);
  assert.throws(() => new GridSpec({ dimensions: [2, 1.5, 3], origin_mm: [0, 0, 0] }), /positive integers/);
  assert.throws(() => new GridSpec({ dimensions: [1, 1, 1], origin_mm: [0, NaN, 0] }), /finite numbers/);
  assert.throws(() => new GridSpec({ dimensions: [1, 1, 1], origin_mm: [0, 0, 0], pitch_mm: [8, 0, 8] }), /positive finite numbers/);
  const spec = new GridSpec({ dimensions: [1, 1, 1], origin_mm: [0, 0, 0] });
  assert.throws(() => spec.flat_index(1, 0, 0), /outside dimensions/);
  assert.throws(() => spec.cell_center_mm(0, 1, 0), /outside dimensions/);
});

test("target grid counts occupancy and extracts sorted per-course footprints", () => {
  const spec = new GridSpec({ dimensions: [2, 1, 3], origin_mm: [0, 0, 0] });
  const grid = new TargetGrid({
    spec,
    classification: [
      CellClass.EXTERIOR, CellClass.INTERIOR,
      CellClass.BOUNDARY, CellClass.EXTERIOR,
      CellClass.INTERIOR, CellClass.EXTERIOR,
    ],
    surface_coverage: [0, 0, 0.75, 0, 0, 0],
    source_units: "mm",
    source_bounds_mm: [[0, 0, 0], [16, 9.6, 24]],
    warnings: ["Synthetic test target"],
    topology: { component_count: 1, vertex_count: 8, edge_count: 18, face_count: 12, euler_characteristic: 2, handle_count: 0 },
    features: [{
      id: "z-1", axis: "z", axis_index: 2, shape: "round opening",
      center_mm: [4, 4, 2], bounds_mm: [[2, 2, 1], [6, 6, 3]],
      observed_span_mm: 2, width_mm: 4, length_mm: 4, area_mm2: 12.56,
      perimeter_mm: 12.57, equivalent_diameter_mm: 4,
      minimum_equivalent_diameter_mm: 4, maximum_equivalent_diameter_mm: 4,
      minimum_width_mm: 4, maximum_width_mm: 4, minimum_length_mm: 4, maximum_length_mm: 4,
      minimum_area_mm2: 12.56, maximum_area_mm2: 12.56,
      circularity: 1, aspect_ratio: 1, sample_support: 3, confidence: "medium",
    }],
  });

  assert.equal(grid.occupied_cell_count, 3);
  assert.equal(grid.boundary_cell_count, 1);
  assert.equal(grid.features.length, 1);
  assert.equal(grid.features[0].center_mm[2], 2);
  assert.deepEqual(grid.layer_footprint(0), [[0, 1], [0, 2], [1, 0]]);
  assert.deepEqual(grid.summary(), {
    representation_version: 3,
    dimensions: [2, 1, 3],
    origin_mm: [0, 0, 0],
    pitch_mm: [8, 9.6, 8],
    source_units: "mm",
    source_bounds_mm: [[0, 0, 0], [16, 9.6, 24]],
    occupied_cell_count: 3,
    boundary_cell_count: 1,
    topology: { component_count: 1, vertex_count: 8, edge_count: 18, face_count: 12, euler_characteristic: 2, handle_count: 0 },
    features: [{
      id: "z-1", axis: "z", axis_index: 2, shape: "round opening",
      center_mm: [4, 4, 2], bounds_mm: [[2, 2, 1], [6, 6, 3]],
      observed_span_mm: 2, width_mm: 4, length_mm: 4, area_mm2: 12.56,
      perimeter_mm: 12.57, equivalent_diameter_mm: 4,
      minimum_equivalent_diameter_mm: 4, maximum_equivalent_diameter_mm: 4,
      minimum_width_mm: 4, maximum_width_mm: 4, minimum_length_mm: 4, maximum_length_mm: 4,
      minimum_area_mm2: 12.56, maximum_area_mm2: 12.56,
      circularity: 1, aspect_ratio: 1, sample_support: 3, confidence: "medium",
    }],
    warnings: ["Synthetic test target"],
  });
});

test("target grid rejects malformed provenance and cell arrays", () => {
  const spec = new GridSpec({ dimensions: [1, 1, 1], origin_mm: [0, 0, 0] });
  const base = {
    spec,
    classification: [CellClass.EXTERIOR],
    surface_coverage: [0],
    source_units: "mm",
    source_bounds_mm: [[0, 0, 0], [8, 9.6, 8]],
  };
  assert.throws(() => new TargetGrid({ ...base, source_units: "inch" }), /source_units/);
  assert.throws(() => new TargetGrid({ ...base, classification: [9] }), /unknown cell class/);
  assert.throws(() => new TargetGrid({ ...base, surface_coverage: [1.5] }), /between 0 and 1/);
  assert.throws(() => new TargetGrid({ ...base, source_bounds_mm: [[2, 0, 0], [1, 1, 1]] }), /maximum bounds/);
  assert.throws(() => new TargetGrid({ ...base, classification: [] }), /match grid cell count/);
  assert.throws(() => new TargetGrid({ ...base, source_bounds_mm: [[0, 0], [1, 1]] }), /three finite/);
  assert.throws(() => new TargetGrid({ ...base, warnings: [3] }), /strings/);
  assert.throws(() => new TargetGrid({ ...base, topology: { component_count: 0 } }), /topology/);
  assert.throws(() => new TargetGrid({ ...base, features: [{ id: "bad" }] }), /feature 0/);
});
