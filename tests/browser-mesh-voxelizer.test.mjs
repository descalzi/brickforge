import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PLATE_GRID_PITCH_MM, CellClass, GridSpec, TargetGrid } from "../docs/assets/target-grid.js";
import { buildLayeredFootprintBlock } from "../docs/assets/construction-engine.js";
import { voxelizeMesh } from "../docs/assets/mesh-voxelizer.js";
import { analyzeMeshFeatures } from "../docs/assets/mesh-feature-analysis.js";

const connectionCatalogue = JSON.parse(
  await readFile(new URL("../data/connection-profiles/basic-bricks.json", import.meta.url), "utf8"),
);

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


function perforatedPlateTriangles({ totalHeight = 6, plateThickness = 6, addBoss = true, addWalls = false, wallThickness = 4 } = {}) {
  const width = 48;
  const height = 65;
  const occupied = new Set();
  const key = (x, y, z) => x + "," + y + "," + z;
  for (let z = 0; z < plateThickness; z += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const px = x + 0.5;
        const py = y + 0.5;
        const roundHoles = [[15, 19], [33, 19], [15, 45], [33, 45]];
        const inRoundHole = roundHoles.some(([cx, cy]) =>
          (px - cx) ** 2 + (py - cy) ** 2 < 2.2 ** 2);
        const inSlot = Math.abs(px - 15) < 5.4 && Math.abs(py - 32) < 3.3;
        if (!inRoundHole && !inSlot) occupied.add(key(x, y, z));
      }
    }
  }
  // A raised solid boss or U-shaped rim increases the overall height
  // without extending the five bores, modelling a shallow mounting tray.
  for (let z = plateThickness; z < totalHeight; z += 1) {
    if (addWalls) {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (x < wallThickness || x >= width - wallThickness || y >= height - wallThickness) {
            occupied.add(key(x, y, z));
          }
        }
      }
    } else if (addBoss) {
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) occupied.add(key(x, y, z));
      }
    }
  }

  const vertices = [];
  const indices = [];
  const vertexIds = new Map();
  const vertexId = (point) => {
    const pointKey = point.join(",");
    if (!vertexIds.has(pointKey)) {
      vertexIds.set(pointKey, vertices.length / 3);
      vertices.push(...point);
    }
    return vertexIds.get(pointKey);
  };
  const quads = [
    { delta: [-1, 0, 0], points: (x, y, z) => [[x, y, z], [x, y, z + 1], [x, y + 1, z + 1], [x, y + 1, z]] },
    { delta: [1, 0, 0], points: (x, y, z) => [[x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x + 1, y, z + 1]] },
    { delta: [0, -1, 0], points: (x, y, z) => [[x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1]] },
    { delta: [0, 1, 0], points: (x, y, z) => [[x, y + 1, z], [x, y + 1, z + 1], [x + 1, y + 1, z + 1], [x + 1, y + 1, z]] },
    { delta: [0, 0, -1], points: (x, y, z) => [[x, y, z], [x, y + 1, z], [x + 1, y + 1, z], [x + 1, y, z]] },
    { delta: [0, 0, 1], points: (x, y, z) => [[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]] },
  ];
  for (const cell of occupied) {
    const [x, y, z] = cell.split(",").map(Number);
    for (const face of quads) {
      if (occupied.has(key(x + face.delta[0], y + face.delta[1], z + face.delta[2]))) continue;
      const ids = face.points(x, y, z).map(vertexId);
      indices.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
    }
  }
  const flatVertices = new Float64Array(vertices);
  const flatIndices = new Uint32Array(indices);
  const triangles = [];
  for (let index = 0; index < flatIndices.length; index += 3) {
    const point = (vertex) => [
      flatVertices[vertex * 3],
      flatVertices[vertex * 3 + 1],
      flatVertices[vertex * 3 + 2],
    ];
    triangles.push({
      a: point(flatIndices[index]),
      b: point(flatIndices[index + 1]),
      c: point(flatIndices[index + 2]),
    });
  }
  return { triangles, vertices: flatVertices, indices: flatIndices,
    boundsMin: [0, 0, 0], boundsMax: [width, height, totalHeight] };
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
  assert.ok(result.warnings.some((warning) => warning.includes("topological tunnel/handle feature")));
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].axis, "z");
  assert.equal(result.features[0].shape, "round opening");
  assert.ok(result.features[0].equivalent_diameter_mm > 4);
  assert.ok(result.features[0].minimum_equivalent_diameter_mm < result.features[0].maximum_equivalent_diameter_mm);
  assert.ok(result.features[0].minimum_area_mm2 < result.features[0].maximum_area_mm2);
  assert.ok(result.features[0].sample_support >= 2);
  assert.equal(result.feature_keepouts.length, 1);
  assert.equal(result.feature_keepouts[0].preserved, true);
});

test("cross-section analysis locates four round openings and an elongated slot below grid pitch", () => {
  const mesh = perforatedPlateTriangles();
  const features = analyzeMeshFeatures(mesh.triangles, mesh.boundsMin, mesh.boundsMax);
  assert.equal(features.length, 5);
  assert.equal(features.filter((feature) => feature.shape === "round opening").length, 4);
  assert.equal(features.filter((feature) => feature.shape === "elongated slot/opening").length, 1);
  assert.ok(features.every((feature) => feature.axis === "z" && feature.sample_support >= 2));
  assert.ok(features.every((feature) => feature.center_mm[2] > 0 && feature.center_mm[2] < 6));
});


test("browser voxeliser preserves sub-grid openings local to one section of a taller connected model", () => {
  const mesh = perforatedPlateTriangles({ totalHeight: 12 });
  const result = voxelizeMesh({ vertices: mesh.vertices, indices: mesh.indices, units: "mm" });
  assert.equal(result.topology.handle_count, 5);
  assert.equal(result.features.length, 5);
  assert.equal(result.feature_keepouts.length, 5);
  assert.ok(result.features.every((feature) => feature.observed_span_mm < 12 * 0.55));
  assert.ok(result.feature_keepouts.every((item) => item.preserved && item.cell_count > 0));
  assert.ok(result.feature_keepouts.every((item) => item.method === "conservative grid-cell clearance"));
  assert.ok(result.feature_keepouts.every((item) => item.local_axial_bounds_mm[1] > item.local_axial_bounds_mm[0]));
  assert.ok(result.feature_keepouts.every((item) => item.support_slices >= 3));
  assert.ok(result.feature_keepouts.every((item) => item.axial_cell_count === 1));
  assert.ok(result.warnings.some((warning) => warning.includes("conservative grid-cell clearance tunnels")));
});


test("Z-up mesh openings flow through target grid into a connected layered construction", () => {
  const source = perforatedPlateTriangles({ totalHeight: 12, plateThickness: 6, addBoss: false, addWalls: true });
  const vertices = new Float64Array(source.vertices.length);
  for (let index = 0; index < source.vertices.length; index += 3) {
    const x = source.vertices[index];
    const y = source.vertices[index + 1];
    const z = source.vertices[index + 2];
    // Same proper rotation as the Inspector's Z-up -> Y-up selection.
    vertices[index] = x;
    vertices[index + 1] = z;
    vertices[index + 2] = -y;
  }
  const result = voxelizeMesh({
    vertices,
    indices: source.indices,
    units: "mm",
    pitchMm: [...PLATE_GRID_PITCH_MM],
  });
  assert.equal(result.topology.handle_count, 5);
  assert.equal(result.features.length, 5);
  assert.ok(result.feature_keepouts.every((item) => item.preserved));
  assert.ok(result.feature_keepouts.every((item) => item.axis === "y"));
  assert.ok(result.feature_keepouts.every((item) => item.axial_cell_count === 2));

  const grid = new TargetGrid({
    spec: new GridSpec({
      dimensions: result.dimensions,
      origin_mm: result.origin_mm,
      pitch_mm: result.pitch_mm,
    }),
    classification: result.classification,
    surface_coverage: result.surface_coverage,
    source_units: result.source_units,
    source_bounds_mm: result.source_bounds_mm,
    warnings: result.warnings,
    topology: result.topology,
    features: result.features,
    feature_keepouts: result.feature_keepouts,
  });
  assert.equal(grid.spec.dimensions[1], 4);
  const footprints = Array.from(
    { length: grid.spec.dimensions[1] },
    (_, course) => grid.layer_footprint(course),
  );
  assert.ok(footprints.every((footprint) => footprint.length > 0));

  const construction = buildLayeredFootprintBlock(footprints, connectionCatalogue, { maxParts: 200, courseType: "plate" });
  assert.ok(construction.parts.length > 0);
  assert.ok(construction.connections.length > 0);
  assert.ok(construction.parts.every((part) => ["3020", "3021", "3022", "3023", "3024"].includes(part.part_id)));
  assert.equal(construction.search.candidate_search_limited, true);
});
