import { BRICK_GRID_PITCH_MM, CellClass } from "./target-grid.js";

const UNIT_TO_MM = Object.freeze({ mm: 1, cm: 10, m: 1000, in: 25.4 });
const SAMPLE_OFFSETS = Object.freeze([0.25, 0.5, 0.75]);
const MAX_TRIANGLES = 100_000;
const MAX_CELLS = 100_000;
const MAX_RAY_TRIANGLE_TESTS = 30_000_000;
const MAX_CELL_TRIANGLE_TESTS = 50_000_000;
const EDGE_QUANTISATION = 100_000;

function assertVector(value, label, positive = false) {
  if (!value || value.length !== 3
      || !Array.from(value).every((n) => Number.isFinite(n) && (!positive || n > 0))) {
    throw new TypeError(label + " must contain three " + (positive ? "positive " : "") + "finite numbers");
  }
}

function pointKey(x, y, z) {
  return [
    Math.round(x * EDGE_QUANTISATION),
    Math.round(y * EDGE_QUANTISATION),
    Math.round(z * EDGE_QUANTISATION),
  ].join(",");
}

function validateClosedMesh(vertices, indices) {
  const edges = new Map();
  for (let face = 0; face < indices.length; face += 3) {
    const ids = [indices[face], indices[face + 1], indices[face + 2]];
    const keys = ids.map((index) => {
      const offset = index * 3;
      return pointKey(vertices[offset], vertices[offset + 1], vertices[offset + 2]);
    });
    if (new Set(keys).size !== 3) throw new Error("Mesh contains a degenerate triangle.");
    for (let edge = 0; edge < 3; edge += 1) {
      const a = keys[edge];
      const b = keys[(edge + 1) % 3];
      const forward = a < b;
      const key = forward ? a + "|" + b : b + "|" + a;
      const record = edges.get(key) || { count: 0, winding: 0 };
      record.count += 1;
      record.winding += forward ? 1 : -1;
      edges.set(key, record);
    }
  }
  for (const edge of edges.values()) {
    if (edge.count !== 2) {
      throw new Error("Solid voxelisation requires a watertight mesh (every edge must belong to exactly two faces).");
    }
    if (edge.winding !== 0) {
      throw new Error("Solid voxelisation requires consistent face winding.");
    }
  }
}

function triangleFrom(vertices, aIndex, bIndex, cIndex, id) {
  const aOffset = aIndex * 3;
  const bOffset = bIndex * 3;
  const cOffset = cIndex * 3;
  const a = [vertices[aOffset], vertices[aOffset + 1], vertices[aOffset + 2]];
  const b = [vertices[bOffset], vertices[bOffset + 1], vertices[bOffset + 2]];
  const c = [vertices[cOffset], vertices[cOffset + 1], vertices[cOffset + 2]];
  const ab = b.map((value, axis) => value - a[axis]);
  const ac = c.map((value, axis) => value - a[axis]);
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const areaSquared = cross.reduce((sum, value) => sum + value * value, 0);
  if (!Number.isFinite(areaSquared) || areaSquared <= 1e-20) {
    throw new Error("Mesh contains a degenerate or non-finite triangle.");
  }
  const min = [0, 1, 2].map((axis) => Math.min(a[axis], b[axis], c[axis]));
  const max = [0, 1, 2].map((axis) => Math.max(a[axis], b[axis], c[axis]));
  return {
    a, b, c, min, max,
    centroid: min.map((value, axis) => (value + max[axis]) * 0.5),
    id,
  };
}

function buildBvh(triangles) {
  if (triangles.length === 0) throw new Error("Mesh contains no triangles.");
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const triangle of triangles) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], triangle.min[axis]);
      max[axis] = Math.max(max[axis], triangle.max[axis]);
    }
  }
  if (triangles.length <= 8) return { min, max, triangles };
  const spans = [0, 1, 2].map((axis) => max[axis] - min[axis]);
  const axis = spans.indexOf(Math.max(...spans));
  triangles.sort((left, right) => left.centroid[axis] - right.centroid[axis] || left.id - right.id);
  const middle = Math.floor(triangles.length / 2);
  return {
    min,
    max,
    left: buildBvh(triangles.slice(0, middle)),
    right: buildBvh(triangles.slice(middle)),
  };
}

function rayNodeContainsYZ(node, y, z, minX) {
  return y >= node.min[1] - 1e-9 && y <= node.max[1] + 1e-9
    && z >= node.min[2] - 1e-9 && z <= node.max[2] + 1e-9
    && node.max[0] >= minX - 1e-9;
}

function intersectTriangleYZ(triangle, y, z) {
  const [ay, az] = [triangle.a[1], triangle.a[2]];
  const [by, bz] = [triangle.b[1], triangle.b[2]];
  const [cy, cz] = [triangle.c[1], triangle.c[2]];
  const denominator = (bz - cz) * (ay - cy) + (cy - by) * (az - cz);
  if (Math.abs(denominator) <= 1e-14) return null;
  const u = ((bz - cz) * (y - cy) + (cy - by) * (z - cz)) / denominator;
  const v = ((cz - az) * (y - cy) + (ay - cy) * (z - cz)) / denominator;
  const w = 1 - u - v;
  if (u < -1e-9 || v < -1e-9 || w < -1e-9) return null;
  return u * triangle.a[0] + v * triangle.b[0] + w * triangle.c[0];
}

function intersectionsAtYZ(root, y, z, minX, budget) {
  const hits = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!rayNodeContainsYZ(node, y, z, minX)) continue;
    if (node.triangles) {
      for (const triangle of node.triangles) {
        budget.tests += 1;
        if (budget.tests > MAX_RAY_TRIANGLE_TESTS) {
          throw new Error("Mesh is too complex for the browser voxelisation budget. Try a lower-detail mesh.");
        }
        const x = intersectTriangleYZ(triangle, y, z);
        if (x !== null && x >= minX - 1e-9) hits.push(x);
      }
    } else {
      stack.push(node.left, node.right);
    }
  }
  hits.sort((a, b) => a - b);
  const unique = [];
  for (const hit of hits) {
    if (!unique.length || Math.abs(hit - unique[unique.length - 1]) > 1e-6) unique.push(hit);
  }
  return unique;
}

function pointInsideFromHits(x, hits) {
  let crossings = 0;
  for (const hit of hits) {
    if (hit > x + 1e-8) crossings += 1;
  }
  return crossings % 2 === 1;
}

function boundsOverlap(aMin, aMax, bMin, bMax) {
  return aMin[0] <= bMax[0] + 1e-9 && aMax[0] >= bMin[0] - 1e-9
    && aMin[1] <= bMax[1] + 1e-9 && aMax[1] >= bMin[1] - 1e-9
    && aMin[2] <= bMax[2] + 1e-9 && aMax[2] >= bMin[2] - 1e-9;
}

function triangleIntersectsBox(triangle, boxMin, boxMax) {
  const centre = boxMin.map((value, axis) => (value + boxMax[axis]) * 0.5);
  const half = boxMin.map((value, axis) => (boxMax[axis] - value) * 0.5);
  const vertices = [triangle.a, triangle.b, triangle.c].map((point) =>
    point.map((value, axis) => value - centre[axis]));
  for (let axis = 0; axis < 3; axis += 1) {
    const minimum = Math.min(vertices[0][axis], vertices[1][axis], vertices[2][axis]);
    const maximum = Math.max(vertices[0][axis], vertices[1][axis], vertices[2][axis]);
    if (minimum > half[axis] + 1e-9 || maximum < -half[axis] - 1e-9) return false;
  }

  const edges = [
    vertices[1].map((value, axis) => value - vertices[0][axis]),
    vertices[2].map((value, axis) => value - vertices[1][axis]),
    vertices[0].map((value, axis) => value - vertices[2][axis]),
  ];
  const axes = [];
  for (const edge of edges) {
    axes.push(
      [0, edge[2], -edge[1]],
      [-edge[2], 0, edge[0]],
      [edge[1], -edge[0], 0],
    );
  }
  const normal = [
    edges[0][1] * edges[1][2] - edges[0][2] * edges[1][1],
    edges[0][2] * edges[1][0] - edges[0][0] * edges[1][2],
    edges[0][0] * edges[1][1] - edges[0][1] * edges[1][0],
  ];
  axes.push(normal);
  for (const axis of axes) {
    const lengthSquared = axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2;
    if (lengthSquared <= 1e-24) continue;
    const projections = vertices.map((point) =>
      point[0] * axis[0] + point[1] * axis[1] + point[2] * axis[2]);
    const minimum = Math.min(...projections);
    const maximum = Math.max(...projections);
    const radius = half[0] * Math.abs(axis[0])
      + half[1] * Math.abs(axis[1])
      + half[2] * Math.abs(axis[2]);
    if (minimum > radius + 1e-9 || maximum < -radius - 1e-9) return false;
  }
  return true;
}

function cellIntersectsSurface(root, boxMin, boxMax, budget) {
  let nodeTests = 0;
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    nodeTests += 1;
    if (!boundsOverlap(node.min, node.max, boxMin, boxMax)) continue;
    if (node.triangles) {
      for (const triangle of node.triangles) {
        budget.tests += 1;
        if (budget.tests > MAX_NEAREST_TRIANGLE_TESTS) {
          throw new Error("Mesh is too complex for the browser surface-intersection budget. Try a lower-detail mesh.");
        }
        if (boundsOverlap(triangle.min, triangle.max, boxMin, boxMax)
            && triangleIntersectsBox(triangle, boxMin, boxMax)) return true;
      }
    } else {
      stack.push(node.left, node.right);
    }
  }
  return false;
}

export function voxelizeMesh({
  vertices,
  indices,
  units,
  pitchMm = BRICK_GRID_PITCH_MM,
  maxCells = MAX_CELLS,
  onProgress = () => {},
}) {
  if (!Object.hasOwn(UNIT_TO_MM, units)) throw new TypeError("units must be 'mm', 'cm', 'm' or 'in'");
  assertVector(pitchMm, "pitchMm", true);
  if (!Number.isSafeInteger(maxCells) || maxCells < 1 || maxCells > MAX_CELLS) {
    throw new RangeError("maxCells must be an integer between 1 and " + MAX_CELLS);
  }
  if (!vertices || vertices.length < 9 || vertices.length % 3 !== 0
      || !indices || indices.length < 3 || indices.length % 3 !== 0) {
    throw new TypeError("Mesh vertices and triangle indices are missing or malformed.");
  }
  const vertexCount = vertices.length / 3;
  const faceCount = indices.length / 3;
  if (faceCount > MAX_TRIANGLES) {
    throw new RangeError("Mesh exceeds the browser limit of " + MAX_TRIANGLES.toLocaleString() + " triangles.");
  }
  const scale = UNIT_TO_MM[units];
  const scaledVertices = new Float64Array(vertices.length);
  for (let i = 0; i < vertices.length; i += 1) {
    if (!Number.isFinite(vertices[i])) throw new Error("Mesh contains non-finite coordinates.");
    scaledVertices[i] = vertices[i] * scale;
  }
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
      throw new RangeError("Mesh contains an invalid triangle index.");
    }
  }
  validateClosedMesh(scaledVertices, indices);

  const triangles = [];
  const boundsMin = [Infinity, Infinity, Infinity];
  const boundsMax = [-Infinity, -Infinity, -Infinity];
  for (let face = 0; face < indices.length; face += 3) {
    const triangle = triangleFrom(scaledVertices, indices[face], indices[face + 1], indices[face + 2], face / 3);
    triangles.push(triangle);
    for (let axis = 0; axis < 3; axis += 1) {
      boundsMin[axis] = Math.min(boundsMin[axis], triangle.min[axis]);
      boundsMax[axis] = Math.max(boundsMax[axis], triangle.max[axis]);
    }
  }

  const origin = boundsMin.map((value, axis) =>
    Math.floor(value / pitchMm[axis]) * pitchMm[axis]);
  const dimensions = boundsMin.map((value, axis) =>
    Math.max(1, Math.ceil((boundsMax[axis] - origin[axis]) / pitchMm[axis] - 1e-12)));
  const cellCount = dimensions[0] * dimensions[1] * dimensions[2];
  if (!Number.isSafeInteger(cellCount) || cellCount > maxCells) {
    throw new RangeError("Target grid requires " + cellCount.toLocaleString()
      + " cells, exceeding the browser limit of " + maxCells.toLocaleString() + ".");
  }

  const root = buildBvh(triangles);
  const [width, height, depth] = dimensions;
  const classification = new Uint8Array(cellCount);
  const coverage = new Float32Array(cellCount);
  const halfDiagonal = Math.hypot(pitchMm[0] * 0.5, pitchMm[1] * 0.5, pitchMm[2] * 0.5);
  const rayBudget = { tests: 0 };
  const cellBudget = { tests: 0 };
  let completedColumns = 0;
  const totalColumns = height * depth;

  for (let y = 0; y < height; y += 1) {
    for (let z = 0; z < depth; z += 1) {
      const sampleHits = [];
      for (const oy of SAMPLE_OFFSETS) {
        for (const oz of SAMPLE_OFFSETS) {
          const sampleY = origin[1] + (y + oy) * pitchMm[1];
          const sampleZ = origin[2] + (z + oz) * pitchMm[2];
          sampleHits.push(intersectionsAtYZ(root, sampleY, sampleZ, origin[0], rayBudget));
        }
      }
      for (let x = 0; x < width; x += 1) {
        const flat = x + width * (z + depth * y);
        let insideSamples = 0;
        let sample = 0;
        for (const oy of SAMPLE_OFFSETS) {
          for (const oz of SAMPLE_OFFSETS) {
            const hits = sampleHits[sample];
            for (const ox of SAMPLE_OFFSETS) {
              const sampleX = origin[0] + (x + ox) * pitchMm[0];
              if (pointInsideFromHits(sampleX, hits)) insideSamples += 1;
            }
            sample += 1;
          }
        }
        const cellMin = [
          origin[0] + x * pitchMm[0],
          origin[1] + y * pitchMm[1],
          origin[2] + z * pitchMm[2],
        ];
        const cellMax = cellMin.map((value, axis) => value + pitchMm[axis]);
        const intersectsSurface = cellIntersectsSurface(root, cellMin, cellMax, cellBudget);
        const fraction = insideSamples / 27;
        coverage[flat] = fraction;
        classification[flat] = intersectsSurface || (fraction > 0 && fraction < 1)
          ? CellClass.BOUNDARY
          : fraction >= 1 ? CellClass.INTERIOR : CellClass.EXTERIOR;
      }
      completedColumns += 1;
    }
    onProgress({ completed: completedColumns, total: totalColumns });
  }

  return {
    dimensions,
    origin_mm: origin,
    pitch_mm: Array.from(pitchMm),
    classification,
    surface_coverage: coverage,
    source_units: units,
    source_bounds_mm: [boundsMin, boundsMax],
    warnings: [
      "Browser voxelisation uses 3x3x3 interior sampling and triangle-box SAT for boundary-cell detection. Interior coverage remains a sampling approximation; exact surface-cell overlap is tested geometrically.",
      "The source must be a closed, consistently wound mesh; open-surface shell mode is not supported.",
    ],
    triangle_count: faceCount,
    ray_triangle_tests: rayBudget.tests,
    cell_triangle_tests: cellBudget.tests,
  };
}
