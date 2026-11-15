const DEFAULT_TOLERANCE_MM = 1.5;
const DEFAULT_MAX_DISTANCE_MM = 24;
const DEFAULT_CELL_SIZE_MM = 12;
const MAX_TARGET_TRIANGLES = 100_000;
const MAX_CANDIDATE_TRIANGLES = 4_000;

function validateTrianglePositions(value, label, maximumTriangles) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value))
      || value.length < 9 || value.length % 9 !== 0
      || !Array.from(value).every(Number.isFinite)) {
    throw new TypeError(label + " must contain finite triangle-soup XYZ triples.");
  }
  if (value.length / 9 > maximumTriangles) {
    throw new RangeError(label + " exceeds the " + maximumTriangles + "-triangle limit.");
  }
}

function cellKey(x, y, z) {
  return x + "," + y + "," + z;
}

function closestPointDistanceSquared(point, a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const ap = [point[0] - a[0], point[1] - a[1], point[2] - a[2]];
  const dot = (left, right) => left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  let closest;
  if (d1 <= 0 && d2 <= 0) closest = a;
  else {
    const bp = [point[0] - b[0], point[1] - b[1], point[2] - b[2]];
    const d3 = dot(ab, bp);
    const d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) closest = b;
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        closest = a.map((value, axis) => value + v * ab[axis]);
      } else {
        const cp = [point[0] - c[0], point[1] - c[1], point[2] - c[2]];
        const d5 = dot(ab, cp);
        const d6 = dot(ac, cp);
        if (d6 >= 0 && d5 <= d6) closest = c;
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6);
            closest = a.map((value, axis) => value + w * ac[axis]);
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
              closest = b.map((value, axis) => value + w * (c[axis] - b[axis]));
            } else {
              const denominator = 1 / (va + vb + vc);
              const v = vb * denominator;
              const w = vc * denominator;
              closest = a.map((value, axis) => value + ab[axis] * v + ac[axis] * w);
            }
          }
        }
      }
    }
  }
  const dx = point[0] - closest[0];
  const dy = point[1] - closest[1];
  const dz = point[2] - closest[2];
  return dx * dx + dy * dy + dz * dz;
}

function buildTriangleIndex(positions, cellSize) {
  const cells = new Map();
  const oversized = [];
  const triangles = [];
  for (let offset = 0; offset < positions.length; offset += 9) {
    const triangle = [
      [positions[offset], positions[offset + 1], positions[offset + 2]],
      [positions[offset + 3], positions[offset + 4], positions[offset + 5]],
      [positions[offset + 6], positions[offset + 7], positions[offset + 8]],
    ];
    const minimum = [0, 1, 2].map((axis) => Math.min(...triangle.map((point) => point[axis])));
    const maximum = [0, 1, 2].map((axis) => Math.max(...triangle.map((point) => point[axis])));
    const low = minimum.map((value) => Math.floor(value / cellSize));
    const high = maximum.map((value) => Math.floor(value / cellSize));
    const cellCount = (high[0] - low[0] + 1) * (high[1] - low[1] + 1) * (high[2] - low[2] + 1);
    const index = triangles.length;
    triangles.push(triangle);
    if (cellCount > 128) {
      oversized.push(index);
      continue;
    }
    for (let x = low[0]; x <= high[0]; x += 1) {
      for (let y = low[1]; y <= high[1]; y += 1) {
        for (let z = low[2]; z <= high[2]; z += 1) {
          const key = cellKey(x, y, z);
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(index);
        }
      }
    }
  }
  return { cells, oversized, triangles, cellSize };
}

function sampleTriangle(triangle, samples) {
  const [a, b, c] = triangle;
  samples.push(a, b, c, [
    (a[0] + b[0] + c[0]) / 3,
    (a[1] + b[1] + c[1]) / 3,
    (a[2] + b[2] + c[2]) / 3,
  ]);
}

function nearestDistance(point, index, maxDistanceSquared) {
  const { cells, oversized, triangles, cellSize } = index;
  const radius = Math.ceil(Math.sqrt(maxDistanceSquared) / cellSize);
  const centre = point.map((value) => Math.floor(value / cellSize));
  const candidates = new Set(oversized);
  for (let x = centre[0] - radius; x <= centre[0] + radius; x += 1) {
    for (let y = centre[1] - radius; y <= centre[1] + radius; y += 1) {
      for (let z = centre[2] - radius; z <= centre[2] + radius; z += 1) {
        for (const triangleIndex of cells.get(cellKey(x, y, z)) || []) candidates.add(triangleIndex);
      }
    }
  }
  let minimum = maxDistanceSquared;
  for (const triangleIndex of candidates) {
    const triangle = triangles[triangleIndex];
    minimum = Math.min(minimum, closestPointDistanceSquared(point, ...triangle));
    if (minimum <= 1e-12) break;
  }
  return Math.sqrt(minimum);
}

/**
 * Compare a placed candidate part's actual triangle surface against the target mesh surface.
 * This is a geometric proximity score only: it does not test containment, collisions, clutch,
 * stability, assembly access, or whether the candidate belongs in the final connected model.
 */
export function scoreSurfaceFit(candidatePositions, targetPositions, options = {}) {
  validateTrianglePositions(candidatePositions, "Candidate geometry", MAX_CANDIDATE_TRIANGLES);
  validateTrianglePositions(targetPositions, "Target geometry", MAX_TARGET_TRIANGLES);
  const tolerance = options.toleranceMm ?? DEFAULT_TOLERANCE_MM;
  const maxDistance = options.maxDistanceMm ?? DEFAULT_MAX_DISTANCE_MM;
  const cellSize = options.cellSizeMm ?? DEFAULT_CELL_SIZE_MM;
  if (![tolerance, maxDistance, cellSize].every(Number.isFinite)
      || tolerance <= 0 || maxDistance < tolerance || cellSize <= 0) {
    throw new RangeError("Surface-fit tolerances and cell size must be positive finite values; max distance must be at least the tolerance.");
  }

  const index = buildTriangleIndex(targetPositions, cellSize);
  const samples = [];
  for (let offset = 0; offset < candidatePositions.length; offset += 9) {
    sampleTriangle([
      [candidatePositions[offset], candidatePositions[offset + 1], candidatePositions[offset + 2]],
      [candidatePositions[offset + 3], candidatePositions[offset + 4], candidatePositions[offset + 5]],
      [candidatePositions[offset + 6], candidatePositions[offset + 7], candidatePositions[offset + 8]],
    ], samples);
  }
  const maxDistanceSquared = maxDistance * maxDistance;
  const distances = samples.map((point) => nearestDistance(point, index, maxDistanceSquared));
  const sorted = distances.slice().sort((a, b) => a - b);
  const meanDistanceMm = distances.reduce((sum, value) => sum + value, 0) / distances.length;
  const rmsDistanceMm = Math.sqrt(distances.reduce((sum, value) => sum + value * value, 0) / distances.length);
  const percentile95DistanceMm = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  const withinTolerance = distances.filter((value) => value <= tolerance).length;
  const coverage = withinTolerance / distances.length;
  return {
    schema_version: 1,
    method: "candidate-surface-to-target-surface-nearest-triangle-distance",
    sample_count: distances.length,
    candidate_triangle_count: candidatePositions.length / 9,
    target_triangle_count: targetPositions.length / 9,
    tolerance_mm: tolerance,
    search_distance_cap_mm: maxDistance,
    mean_distance_mm: meanDistanceMm,
    rms_distance_mm: rmsDistanceMm,
    percentile_95_distance_mm: percentile95DistanceMm,
    within_tolerance_fraction: coverage,
    score: Math.max(0, Math.min(1, coverage * Math.exp(-meanDistanceMm / (tolerance * 2)))),
    status: coverage >= 0.95 && percentile95DistanceMm <= tolerance * 1.5
      ? "close_surface_alignment"
      : coverage >= 0.5 ? "partial_surface_alignment" : "poor_surface_alignment",
    limitations: [
      "Only candidate surface samples are measured against the nearest target surface; reverse coverage is not measured.",
      "Distances are capped at the configured search distance.",
      "A geometric surface match does not establish material containment, collision-free placement, physical connection, stability or assembly accessibility.",
    ],
  };
}
