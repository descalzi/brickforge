function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function subtract(left, right) {
  return left.map((value, axis) => value - right[axis]);
}

function triangleIntersects(first, second, epsilon) {
  const firstEdges = [
    subtract(first.b, first.a),
    subtract(first.c, first.b),
    subtract(first.a, first.c),
  ];
  const secondEdges = [
    subtract(second.b, second.a),
    subtract(second.c, second.b),
    subtract(second.a, second.c),
  ];
  const firstNormal = cross(firstEdges[0], firstEdges[1]);
  const secondNormal = cross(secondEdges[0], secondEdges[1]);
  const axes = [firstNormal, secondNormal];
  for (const left of firstEdges) {
    for (const right of secondEdges) axes.push(cross(left, right));
  }
  for (const edge of firstEdges) axes.push(cross(firstNormal, edge));
  for (const edge of secondEdges) axes.push(cross(secondNormal, edge));

  for (const axis of axes) {
    const length = Math.hypot(...axis);
    if (length <= epsilon) continue;
    const unit = axis.map((value) => value / length);
    const firstProjection = [first.a, first.b, first.c].map((point) =>
      point[0] * unit[0] + point[1] * unit[1] + point[2] * unit[2]);
    const secondProjection = [second.a, second.b, second.c].map((point) =>
      point[0] * unit[0] + point[1] * unit[1] + point[2] * unit[2]);
    if (Math.max(...firstProjection) < Math.min(...secondProjection) - epsilon
        || Math.max(...secondProjection) < Math.min(...firstProjection) - epsilon) return false;
  }
  return true;
}

function pointKey(point, tolerance) {
  return point.map((value) => Math.round(value / tolerance)).join(",");
}

export function diagnoseTriangleIntersections(triangles, { maxCandidatePairs = 500000 } = {}) {
  if (!Array.isArray(triangles) || !Number.isSafeInteger(maxCandidatePairs) || maxCandidatePairs < 0) {
    throw new TypeError("A triangle array and non-negative candidate-pair limit are required.");
  }
  if (!triangles.length) return { status: "none_detected", intersection_pair_count: 0, candidate_pair_count: 0 };
  const bounds = triangles.map((triangle) => {
    const points = [triangle.a, triangle.b, triangle.c];
    return {
      minimum: [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis]))),
      maximum: [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis]))),
      keys: new Set(points.map((point) => pointKey(point, 1e-7))),
    };
  });
  const globalMinimum = [Infinity, Infinity, Infinity];
  const globalMaximum = [-Infinity, -Infinity, -Infinity];
  for (const entry of bounds) {
    for (let axis = 0; axis < 3; axis += 1) {
      globalMinimum[axis] = Math.min(globalMinimum[axis], entry.minimum[axis]);
      globalMaximum[axis] = Math.max(globalMaximum[axis], entry.maximum[axis]);
    }
  }
  const scale = Math.max(1, Math.hypot(...globalMaximum.map((value, axis) => value - globalMinimum[axis])));
  const epsilon = scale * 1e-9;
  const order = bounds.map((_, index) => index)
    .sort((left, right) => bounds[left].minimum[0] - bounds[right].minimum[0]);
  let candidatePairs = 0;
  let intersectionPairs = 0;
  for (let orderIndex = 0; orderIndex < order.length; orderIndex += 1) {
    const firstIndex = order[orderIndex];
    const firstBounds = bounds[firstIndex];
    for (let next = orderIndex + 1; next < order.length; next += 1) {
      const secondIndex = order[next];
      const secondBounds = bounds[secondIndex];
      if (secondBounds.minimum[0] > firstBounds.maximum[0] + epsilon) break;
      if (firstBounds.keys.size && [...firstBounds.keys].some((key) => secondBounds.keys.has(key))) continue;
      let separated = false;
      for (let axis = 1; axis < 3; axis += 1) {
        if (firstBounds.maximum[axis] < secondBounds.minimum[axis] - epsilon
            || secondBounds.maximum[axis] < firstBounds.minimum[axis] - epsilon) {
          separated = true;
          break;
        }
      }
      if (separated) continue;
      candidatePairs += 1;
      if (candidatePairs > maxCandidatePairs) {
        return {
          status: "not_assessed_pair_limit",
          intersection_pair_count: intersectionPairs,
          candidate_pair_count: candidatePairs,
        };
      }
      if (triangleIntersects(triangles[firstIndex], triangles[secondIndex], epsilon)) intersectionPairs += 1;
    }
  }
  return {
    status: intersectionPairs ? "intersections_detected" : "none_detected",
    intersection_pair_count: intersectionPairs,
    candidate_pair_count: candidatePairs,
  };
}
