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

function torusMesh(majorRadius = 4, minorRadius = 1, majorSegments = 16, minorSegments = 8) {
  const vertices = [];
  const indices = [];
  for (let major = 0; major < majorSegments; major += 1) {
    const u = major * Math.PI * 2 / majorSegments;
    for (let minor = 0; minor < minorSegments; minor += 1) {
      const v = minor * Math.PI * 2 / minorSegments;
      vertices.push(
        (majorRadius + minorRadius * Math.cos(v)) * Math.cos(u),
        (majorRadius + minorRadius * Math.cos(v)) * Math.sin(u),
        minorRadius * Math.sin(v),
      );
    }
  }
  for (let major = 0; major < majorSegments; major += 1) {
    for (let minor = 0; minor < minorSegments; minor += 1) {
      const a = major * minorSegments + minor;
      const b = ((major + 1) % majorSegments) * minorSegments + minor;
      const c = ((major + 1) % majorSegments) * minorSegments + (minor + 1) % minorSegments;
      const d = major * minorSegments + (minor + 1) % minorSegments;
      indices.push(a, b, d, b, c, d);
    }
  }
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
  assert.equal(grid.topology.handle_count, 0);
  assert.equal(grid.topology.component_count, 1);
  assert.ok(grid.surface_coverage[0] > 0);
  assert.equal(grid.classification.reduce((n, value) => n + (value !== CellClass.EXTERIOR ? 1 : 0), 0), 27);
});

test("browser voxeliser converts declared centimetres into millimetres", () => {
  const mesh = boxMesh([2.4, 2.88, 2.4]);
  const grid = voxelizeMesh({ ...mesh, units: "cm" });
  assert.deepEqual(grid.dimensions, [3, 3, 3]);
  assert.ok(Math.abs(grid.source_bounds_mm[1][0] - 24) < 1e-9);
  assert.ok(Math.abs(grid.source_bounds_mm[1][1] - 28.8) < 1e-9);
  assert.ok(Math.abs(grid.source_bounds_mm[1][2] - 24) < 1e-9);
});

test("browser voxeliser supports custom anisotropic pitch", () => {
  const mesh = boxMesh([24, 28.8, 24]);
  const grid = voxelizeMesh({ ...mesh, units: "mm", pitchMm: [12, 14.4, 12] });
  assert.deepEqual(grid.dimensions, [2, 2, 2]);
  assert.deepEqual(grid.pitch_mm, [12, 14.4, 12]);
});

test("browser voxeliser retains a sub-grid thin feature through triangle-cell intersection", () => {
  const mesh = boxMesh([0.5, 0.5, 0.5], [4, 4.8, 4]);
  const grid = voxelizeMesh({ ...mesh, units: "mm" });
  assert.deepEqual(grid.dimensions, [1, 1, 1]);
  assert.equal(grid.classification[0], CellClass.BOUNDARY);
});

test("browser voxeliser does not fill a clear gap between disconnected solids", () => {
  const left = boxMesh([4, 9.6, 8], [4, 4.8, 4]);
  const right = boxMesh([4, 9.6, 8], [36, 4.8, 4]);
  const vertices = new Float64Array([...left.vertices, ...right.vertices]);
  const indices = new Uint32Array([
    ...left.indices,
    ...Array.from(right.indices, (index) => index + left.vertices.length / 3),
  ]);
  const grid = voxelizeMesh({ vertices, indices, units: "mm" });
  assert.deepEqual(grid.dimensions, [5, 1, 1]);
  assert.equal(grid.classification[0], CellClass.BOUNDARY);
  assert.deepEqual(
    Array.from(grid.classification.slice(1, 4)),
    [CellClass.EXTERIOR, CellClass.EXTERIOR, CellClass.EXTERIOR],
  );
  assert.equal(grid.classification[4], CellClass.BOUNDARY);
});

test("browser voxeliser removes zero-area facets but rejects open, non-finite and oversized inputs", () => {
  const mesh = boxMesh([8, 9.6, 8]);
  assert.throws(() => voxelizeMesh({
    ...mesh, indices: mesh.indices.slice(0, mesh.indices.length - 3), units: "mm",
  }), /watertight/);
  const degenerate = { ...mesh, indices: new Uint32Array([...mesh.indices, 0, 0, 0]) };
  const cleanedGrid = voxelizeMesh({ ...degenerate, units: "mm" });
  assert.equal(cleanedGrid.removed_degenerate_triangle_count, 1);
  assert.equal(cleanedGrid.triangle_count, mesh.indices.length / 3);
  assert.match(cleanedGrid.warnings[0], /Removed 1/);
  const nonFinite = { ...mesh, vertices: new Float64Array(mesh.vertices) };
  nonFinite.vertices[0] = NaN;
  assert.throws(() => voxelizeMesh({ ...nonFinite, units: "mm" }), /non-finite/);
  assert.throws(() => voxelizeMesh({ ...mesh, units: "mm", maxCells: 0 }), /maxCells/);
  assert.throws(() => voxelizeMesh({ ...mesh, units: "inch" }), /units/);
  const inchMesh = boxMesh([24 / 25.4, 28.8 / 25.4, 24 / 25.4]);
  const inchGrid = voxelizeMesh({ ...inchMesh, units: "in" });
  assert.deepEqual(inchGrid.dimensions, [3, 3, 3]);
});


test("browser voxeliser removes a collinear zero-area triangle from an otherwise closed mesh", () => {
  const mesh = boxMesh([8, 9.6, 8]);
  const vertices = new Float64Array([...mesh.vertices, 2, 2, 2, 4, 4, 4, 6, 6, 6]);
  const indices = new Uint32Array([...mesh.indices, 8, 9, 10]);
  const result = voxelizeMesh({ vertices, indices, units: "mm" });
  assert.equal(result.removed_degenerate_triangle_count, 1);
  assert.equal(result.triangle_count, 12);
});

test("browser voxeliser detects a sub-grid topological tunnel instead of losing its feature metadata", () => {
  const mesh = torusMesh();
  const result = voxelizeMesh({ ...mesh, units: "mm" });
  assert.equal(result.topology.component_count, 1);
  assert.equal(result.topology.handle_count, 1);
  assert.equal(result.topology.euler_characteristic, 0);
  assert.ok(result.warnings.some((warning) => /topological tunnel\\/handle feature/.test(warning)));
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].axis, "z");
  assert.equal(result.features[0].shape, "round opening");
  assert.ok(result.features[0].equivalent_diameter_mm > 4);
  assert.ok(result.features[0].sample_support >= 2);
});
