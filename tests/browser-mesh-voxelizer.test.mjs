import assert from "node:assert/strict";
import test from "node:test";

import { CellClass } from "../docs/assets/target-grid.js";
import { voxelizeMesh } from "../docs/assets/mesh-voxelizer.js";

function boxMesh(size, centre = size.map((value) => value / 2)) {
  const [sx, sy, sz] = size;
  const [cx, cy, cz] = centre;
  const vertices = [
    cx - sx / 2, cy - sy / 2, cz - sz / 2,
    cx + sx / 2, cy - sy / 2, cz - sz / 2,
    cx + sx / 2, cy + sy / 2, cz - sz / 2,
    cx - sx / 2, cy + sy / 2, cz - sz / 2,
    cx - sx / 2, cy - sy / 2, cz + sz / 2,
    cx + sx / 2, cy - sy / 2, cz + sz / 2,
    cx + sx / 2, cy + sy / 2, cz + sz / 2,
    cx - sx / 2, cy + sy / 2, cz + sz / 2,
  ];
  const indices = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
  ];
  return { vertices: new Float64Array(vertices), indices: new Uint32Array(indices) };
}

test("browser voxeliser classifies an aligned solid and interior core", () => {
  const mesh = boxMesh([24, 28.8, 24]);
  const grid = voxelizeMesh({ ...mesh, units: "mm" });
  assert.deepEqual(grid.dimensions, [3, 3, 3]);
  assert.deepEqual(grid.origin_mm, [0, 0, 0]);
  assert.equal(grid.classification.length, 27);
  assert.equal(grid.classification[1 + 3 * (1 + 3 * 1)], CellClass.INTERIOR);
  assert.equal(grid.surface_coverage[1 + 3 * (1 + 3 * 1)], 1);
  assert.equal(grid.classification[0], CellClass.BOUNDARY);
  assert.ok(grid.surface_coverage[0] > 0);
  assert.equal(grid.classification.reduce((n, value) => n + (value !== CellClass.EXTERIOR ? 1 : 0), 0), 27);
});

test("browser voxeliser converts declared centimetres into millimetres", () => {
  const mesh = boxMesh([2.4, 2.88, 2.4]);
  const grid = voxelizeMesh({ ...mesh, units: "cm" });
  assert.deepEqual(grid.dimensions, [3, 3, 3]);
  assert.deepEqual(grid.source_bounds_mm[1], [24, 28.8, 24]);
});

test("browser voxeliser supports custom anisotropic pitch", () => {
  const mesh = boxMesh([24, 28.8, 24]);
  const grid = voxelizeMesh({ ...mesh, units: "mm", pitchMm: [12, 14.4, 12] });
  assert.deepEqual(grid.dimensions, [2, 2, 2]);
  assert.deepEqual(grid.pitch_mm, [12, 14.4, 12]);
});

test("browser voxeliser retains a sub-grid thin feature by nearest-surface distance", () => {
  const mesh = boxMesh([0.5, 0.5, 0.5], [4, 4.8, 4]);
  const grid = voxelizeMesh({ ...mesh, units: "mm" });
  assert.deepEqual(grid.dimensions, [1, 1, 1]);
  assert.equal(grid.classification[0], CellClass.BOUNDARY);
});

test("browser voxeliser rejects open, degenerate, non-finite and oversized inputs", () => {
  const mesh = boxMesh([8, 9.6, 8]);
  assert.throws(() => voxelizeMesh({
    ...mesh, indices: mesh.indices.slice(0, mesh.indices.length - 3), units: "mm",
  }), /watertight/);
  const degenerate = { ...mesh, indices: new Uint32Array([...mesh.indices, 0, 0, 0]) };
  assert.throws(() => voxelizeMesh({ ...degenerate, units: "mm" }), /degenerate/);
  const nonFinite = { ...mesh, vertices: new Float64Array(mesh.vertices) };
  nonFinite.vertices[0] = NaN;
  assert.throws(() => voxelizeMesh({ ...nonFinite, units: "mm" }), /non-finite/);
  assert.throws(() => voxelizeMesh({ ...mesh, units: "mm", maxCells: 0 }), /maxCells/);
  assert.throws(() => voxelizeMesh({ ...mesh, units: "inch" }), /units/);
});
