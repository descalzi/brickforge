const SAMPLE_FRACTIONS = Object.freeze([0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]);
const AXIS_NAMES = Object.freeze(["x", "y", "z"]);
const MIN_FEATURE_AREA_MM2 = 0.5;
const MIN_FEATURE_SLICES = 2;

function pointKey(point, tolerance) {
  return Math.round(point[0] / tolerance) + "," + Math.round(point[1] / tolerance);
}

function polygonMetrics(points) {
  let twiceArea = 0;
  let centroidX = 0;
  let centroidY = 0;
  let perimeter = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross = current[0] * next[1] - next[0] * current[1];
    twiceArea += cross;
    centroidX += (current[0] + next[0]) * cross;
    centroidY += (current[1] + next[1]) * cross;
    perimeter += Math.hypot(next[0] - current[0], next[1] - current[1]);
    minX = Math.min(minX, current[0]);
    minY = Math.min(minY, current[1]);
    maxX = Math.max(maxX, current[0]);
    maxY = Math.max(maxY, current[1]);
  }
  const signedArea = twiceArea * 0.5;
  if (Math.abs(signedArea) <= 1e-8 || perimeter <= 1e-8) return null;
  return {
    area: Math.abs(signedArea),
    centroid: [centroidX / (6 * signedArea), centroidY / (6 * signedArea)],
    perimeter,
    extent: [maxX - minX, maxY - minY],
    minimum: [minX, minY],
    maximum: [maxX, maxY],
  };
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    if ((currentPoint[1] > point[1]) !== (previousPoint[1] > point[1])) {
      const crossingX = (previousPoint[0] - currentPoint[0])
        * (point[1] - currentPoint[1])
        / (previousPoint[1] - currentPoint[1]) + currentPoint[0];
      if (point[0] < crossingX) inside = !inside;
    }
  }
  return inside;
}

function sectionContours(triangles, axis, plane, tolerance) {
  const otherAxes = [0, 1, 2].filter((value) => value !== axis);
  const segments = [];
  const epsilon = Math.max(1e-9, tolerance * 0.01);

  for (const triangle of triangles) {
    const vertices = [triangle.a, triangle.b, triangle.c];
    const distances = vertices.map((point) => point[axis] - plane);
    const intersections = [];
    for (const [left, right] of [[0, 1], [1, 2], [2, 0]]) {
      const firstDistance = distances[left];
      const secondDistance = distances[right];
      const addPoint = (point) => {
        const projected = [point[otherAxes[0]], point[otherAxes[1]]];
        if (!intersections.some((existing) =>
          Math.hypot(existing[0] - projected[0], existing[1] - projected[1]) <= tolerance)) {
          intersections.push(projected);
        }
      };
      if (Math.abs(firstDistance) <= epsilon) addPoint(vertices[left]);
      if (Math.abs(secondDistance) <= epsilon) addPoint(vertices[right]);
      const crosses = (firstDistance < -epsilon && secondDistance > epsilon)
        || (firstDistance > epsilon && secondDistance < -epsilon);
      if (crosses) {
        const ratio = firstDistance / (firstDistance - secondDistance);
        addPoint([
          vertices[left][0] + ratio * (vertices[right][0] - vertices[left][0]),
          vertices[left][1] + ratio * (vertices[right][1] - vertices[left][1]),
          vertices[left][2] + ratio * (vertices[right][2] - vertices[left][2]),
        ]);
      }
    }
    if (intersections.length === 2
        && Math.hypot(intersections[0][0] - intersections[1][0], intersections[0][1] - intersections[1][1]) > tolerance) {
      segments.push({
        a: intersections[0],
        b: intersections[1],
        aKey: pointKey(intersections[0], tolerance),
        bKey: pointKey(intersections[1], tolerance),
      });
    }
  }

  const adjacency = new Map();
  const points = new Map();
  segments.forEach((segment, index) => {
    points.set(segment.aKey, segment.a);
    points.set(segment.bKey, segment.b);
    for (const key of [segment.aKey, segment.bKey]) {
      if (!adjacency.has(key)) adjacency.set(key, []);
      adjacency.get(key).push(index);
    }
  });

  const used = new Uint8Array(segments.length);
  const contours = [];
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    if (used[segmentIndex]) continue;
    const first = segments[segmentIndex];
    const startKey = first.aKey;
    let currentKey = first.bKey;
    const chain = [first.a, first.b];
    used[segmentIndex] = 1;
    let closed = false;

    for (let step = 0; step <= segments.length; step += 1) {
      if (currentKey === startKey) {
        closed = true;
        break;
      }
      const choices = (adjacency.get(currentKey) || []).filter((index) => !used[index]);
      if (choices.length === 0) break;
      let selected = choices[0];
      if (choices.length > 1 && chain.length >= 2) {
        const previous = chain[chain.length - 2];
        const current = chain[chain.length - 1];
        const incoming = [current[0] - previous[0], current[1] - previous[1]];
        const incomingLength = Math.hypot(incoming[0], incoming[1]) || 1;
        let bestScore = -Infinity;
        for (const candidate of choices) {
          const edge = segments[candidate];
          const nextKey = edge.aKey === currentKey ? edge.bKey : edge.aKey;
          const next = points.get(nextKey);
          const outgoing = [next[0] - current[0], next[1] - current[1]];
          const outgoingLength = Math.hypot(outgoing[0], outgoing[1]) || 1;
          const score = (incoming[0] * outgoing[0] + incoming[1] * outgoing[1])
            / (incomingLength * outgoingLength);
          if (score > bestScore) {
            bestScore = score;
            selected = candidate;
          }
        }
      }
      used[selected] = 1;
      const edge = segments[selected];
      currentKey = edge.aKey === currentKey ? edge.bKey : edge.aKey;
      chain.push(points.get(currentKey));
    }

    if (!closed || chain.length < 4) continue;
    const contourPoints = chain.slice(0, -1);
    const metrics = polygonMetrics(contourPoints);
    if (metrics) contours.push({ points: contourPoints, ...metrics });
  }
  return contours;
}

function findSectionOpenings(contours) {
  const openings = [];
  for (let index = 0; index < contours.length; index += 1) {
    const contour = contours[index];
    const containers = contours.filter((other, otherIndex) =>
      otherIndex !== index
      && other.area > contour.area
      && pointInPolygon(contour.points[0], other.points));
    if (containers.length % 2 === 1 && contour.area >= MIN_FEATURE_AREA_MM2) {
      openings.push(contour);
    }
  }
  return openings;
}

function clusterOpening(clusters, candidate, axis, sampleIndex) {
  const minimumExtent = Math.min(candidate.extent[0], candidate.extent[1]);
  const matchDistance = Math.max(2.5, minimumExtent * 0.45);
  let nearest = null;
  let nearestDistance = Infinity;
  for (const cluster of clusters) {
    if (cluster.axis !== axis || cluster.lastSampleIndex === sampleIndex) continue;
    const distance = Math.hypot(
      cluster.centroid[0] / cluster.samples.length - candidate.centroid[0],
      cluster.centroid[1] / cluster.samples.length - candidate.centroid[1],
    );
    if (distance <= matchDistance && distance < nearestDistance) {
      nearest = cluster;
      nearestDistance = distance;
    }
  }
  if (!nearest) {
    nearest = {
      axis,
      samples: [],
      centroid: [0, 0],
      lastSampleIndex: -1,
    };
    clusters.push(nearest);
  }
  nearest.samples.push({ ...candidate, sample_index: sampleIndex });
  nearest.centroid[0] += candidate.centroid[0];
  nearest.centroid[1] += candidate.centroid[1];
  nearest.lastSampleIndex = sampleIndex;
}

export function classifyCentrelinePath(samples, minimumWidthMm) {
  if (!Array.isArray(samples) || samples.length < 2
      || !Number.isFinite(minimumWidthMm) || minimumWidthMm <= 0) {
    return { centreline_deviation_mm: 0, path_class: "insufficient_samples" };
  }
  const ordered = [...samples].sort((left, right) => left.plane - right.plane);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const axialSpan = Math.max(1e-9, last.plane - first.plane);
  let deviation = 0;
  for (const sample of ordered) {
    const fraction = (sample.plane - first.plane) / axialSpan;
    const expected = first.centroid.map((value, axis) =>
      value + (last.centroid[axis] - value) * fraction);
    deviation = Math.max(deviation, Math.hypot(
      sample.centroid[0] - expected[0],
      sample.centroid[1] - expected[1],
    ));
  }
  return {
    centreline_deviation_mm: deviation,
    path_class: deviation > Math.max(0.5, minimumWidthMm * 0.12)
      ? "curved_candidate" : "straight_candidate",
  };
}

function summarizeCluster(cluster, featureIndex, boundsMin, boundsMax) {
  const samples = cluster.samples;
  const mean = (selector, axis = null) => samples.reduce((sum, sample) =>
    sum + (axis === null ? selector(sample) : selector(sample)[axis]), 0) / samples.length;
  const centre2d = [mean((sample) => sample.centroid[0]), mean((sample) => sample.centroid[1])];
  const extent = [mean((sample) => sample.extent[0]), mean((sample) => sample.extent[1])];
  const area = mean((sample) => sample.area);
  const perimeter = mean((sample) => sample.perimeter);
  const circularity = Math.min(1, (4 * Math.PI * area) / (perimeter * perimeter));
  const aspectRatio = Math.max(extent[0], extent[1]) / Math.max(1e-8, Math.min(extent[0], extent[1]));
  const equivalentDiameter = Math.sqrt((4 * area) / Math.PI);
  const sampleWidths = samples.map((sample) => Math.min(sample.extent[0], sample.extent[1]));
  const sampleLengths = samples.map((sample) => Math.max(sample.extent[0], sample.extent[1]));
  const sampleDiameters = samples.map((sample) => Math.sqrt((4 * sample.area) / Math.PI));
  const sampleAreas = samples.map((sample) => sample.area);
  const axis = cluster.axis;
  const otherAxes = [0, 1, 2].filter((value) => value !== axis);
  const planes = samples.map((sample) => sample.plane);
  const centre = [0, 0, 0];
  centre[axis] = planes.reduce((sum, value) => sum + value, 0) / planes.length;
  centre[otherAxes[0]] = centre2d[0];
  centre[otherAxes[1]] = centre2d[1];
  const minimum = [0, 0, 0];
  const maximum = [0, 0, 0];
  const firstSampleIndex = Math.min(...samples.map((sample) => sample.sample_index));
  const lastSampleIndex = Math.max(...samples.map((sample) => sample.sample_index));
  const previousFraction = firstSampleIndex === 0 ? 0 : SAMPLE_FRACTIONS[firstSampleIndex - 1];
  const nextFraction = lastSampleIndex === SAMPLE_FRACTIONS.length - 1
    ? 1 : SAMPLE_FRACTIONS[lastSampleIndex + 1];
  const lowerFraction = (previousFraction + SAMPLE_FRACTIONS[firstSampleIndex]) * 0.5;
  const upperFraction = (SAMPLE_FRACTIONS[lastSampleIndex] + nextFraction) * 0.5;
  const axisSpan = boundsMax[axis] - boundsMin[axis];
  minimum[axis] = boundsMin[axis] + axisSpan * lowerFraction;
  maximum[axis] = boundsMin[axis] + axisSpan * upperFraction;
  for (let dimension = 0; dimension < 2; dimension += 1) {
    const worldAxis = otherAxes[dimension];
    minimum[worldAxis] = Math.min(...samples.map((sample) => sample.minimum[dimension]));
    maximum[worldAxis] = Math.max(...samples.map((sample) => sample.maximum[dimension]));
  }
  const shape = circularity >= 0.68 && aspectRatio <= 1.4
    ? "round opening"
    : aspectRatio >= 1.55 ? "elongated slot/opening" : "irregular opening";
  const orderedSamples = [...samples].sort((left, right) => left.plane - right.plane);
  const centreline = classifyCentrelinePath(orderedSamples, Math.min(extent[0], extent[1]));
  const observedSpan = maximum[axis] - minimum[axis];
  const spanFraction = axisSpan > 1e-8 ? observedSpan / axisSpan : 0;
  return {
    id: AXIS_NAMES[axis] + "-" + featureIndex,
    axis: AXIS_NAMES[axis],
    axis_index: axis,
    shape,
    center_mm: centre,
    bounds_mm: [minimum, maximum],
    observed_span_mm: observedSpan,
    span_fraction: Math.min(1, spanFraction),
    extent_class: spanFraction < 0.72 ? "partial_or_blind_candidate" : "through_candidate",
    centreline_deviation_mm: centreline.centreline_deviation_mm,
    path_class: centreline.path_class,
    centreline_samples: orderedSamples.map((sample) => ({
      sample_index: sample.sample_index,
      axial_position_mm: sample.plane,
      centre_2d_mm: sample.centroid.slice(),
    })),
    width_mm: Math.min(extent[0], extent[1]),
    length_mm: Math.max(extent[0], extent[1]),
    area_mm2: area,
    perimeter_mm: perimeter,
    equivalent_diameter_mm: equivalentDiameter,
    minimum_equivalent_diameter_mm: Math.min(...sampleDiameters),
    maximum_equivalent_diameter_mm: Math.max(...sampleDiameters),
    minimum_width_mm: Math.min(...sampleWidths),
    maximum_width_mm: Math.max(...sampleWidths),
    minimum_length_mm: Math.min(...sampleLengths),
    maximum_length_mm: Math.max(...sampleLengths),
    minimum_area_mm2: Math.min(...sampleAreas),
    maximum_area_mm2: Math.max(...sampleAreas),
    circularity,
    aspect_ratio: aspectRatio,
    sample_support: samples.length,
    confidence: samples.length >= 4 ? "high" : "medium",
  };
}

export function analyzeMeshFeatures(triangles, boundsMin, boundsMax) {
  if (!Array.isArray(triangles) || triangles.length === 0) return [];
  const diagonal = Math.hypot(
    boundsMax[0] - boundsMin[0],
    boundsMax[1] - boundsMin[1],
    boundsMax[2] - boundsMin[2],
  );
  const tolerance = Math.max(1e-6, diagonal * 1e-8);
  const clusters = [];

  for (let axis = 0; axis < 3; axis += 1) {
    const span = boundsMax[axis] - boundsMin[axis];
    if (span <= tolerance) continue;
    for (let sampleIndex = 0; sampleIndex < SAMPLE_FRACTIONS.length; sampleIndex += 1) {
      const plane = boundsMin[axis] + span * SAMPLE_FRACTIONS[sampleIndex];
      const contours = sectionContours(triangles, axis, plane, tolerance);
      const openings = findSectionOpenings(contours);
      for (const opening of openings) {
        clusterOpening(clusters, { ...opening, plane }, axis, sampleIndex);
      }
    }
  }

  const features = [];
  for (const cluster of clusters) {
    if (cluster.samples.length >= MIN_FEATURE_SLICES) {
      features.push(summarizeCluster(cluster, features.length + 1, boundsMin, boundsMax));
    }
  }
  classifyBranchingFeatureGroups(features);
  return features.sort((left, right) =>
    left.axis_index - right.axis_index
    || left.center_mm[0] - right.center_mm[0]
    || left.center_mm[1] - right.center_mm[1]
    || left.center_mm[2] - right.center_mm[2])
    .map((feature, index) => ({ ...feature, id: feature.axis + "-" + (index + 1) }));
}


export function classifyBranchingFeatureGroups(features) {
  if (!Array.isArray(features)) throw new TypeError("features must be an array");
  let branchIndex = 0;
  for (let first = 0; first < features.length; first += 1) {
    for (let second = first + 1; second < features.length; second += 1) {
      const left = features[first];
      const right = features[second];
      if (left.axis !== right.axis || !Array.isArray(left.centreline_samples)
          || !Array.isArray(right.centreline_samples)) continue;
      const rightSamples = new Map(right.centreline_samples.map((sample) => [sample.sample_index, sample.centre_2d_mm]));
      const distances = left.centreline_samples
        .filter((sample) => rightSamples.has(sample.sample_index))
        .map((sample) => Math.hypot(...sample.centre_2d_mm.map((value, dimension) =>
          value - rightSamples.get(sample.sample_index)[dimension])));
      if (distances.length < 2) continue;
      const minimumDistance = Math.min(...distances);
      const maximumDistance = Math.max(...distances);
      const mergeThreshold = (left.width_mm + right.width_mm) * 0.65;
      if (minimumDistance < mergeThreshold && maximumDistance > minimumDistance * 1.6) {
        branchIndex += 1;
        left.branching_group_id = "branch-" + branchIndex;
        right.branching_group_id = "branch-" + branchIndex;
        left.path_class = "branching_candidate";
        right.path_class = "branching_candidate";
      }
    }
  }
  return features;
}

function normalise3(vector) {
  const length = Math.hypot(...vector);
  return length > 1e-9 ? vector.map((value) => value / length) : null;
}

function dot3(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross3(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function transformObliqueFeature(feature, basis, frameId) {
  const [u, v, normal] = basis;
  const localToWorld = (point) => [
    u[0] * point[0] + v[0] * point[1] + normal[0] * point[2],
    u[1] * point[0] + v[1] * point[1] + normal[1] * point[2],
    u[2] * point[0] + v[2] * point[1] + normal[2] * point[2],
  ];
  const localBounds = feature.bounds_mm;
  const corners = [];
  for (const x of [localBounds[0][0], localBounds[1][0]]) {
    for (const y of [localBounds[0][1], localBounds[1][1]]) {
      for (const z of [localBounds[0][2], localBounds[1][2]]) corners.push(localToWorld([x, y, z]));
    }
  }
  return {
    ...feature,
    id: "oblique-" + frameId + "-" + feature.id,
    axis: "oblique",
    axis_index: -1,
    axis_vector_world: normal,
    center_mm: localToWorld(feature.center_mm),
    centreline_samples: feature.centreline_samples.map((sample) => ({
      ...sample,
      centre_world_mm: localToWorld([sample.centre_2d_mm[0], sample.centre_2d_mm[1], sample.axial_position_mm]),
    })),
    bounds_mm: [
      [0, 1, 2].map((axis) => Math.min(...corners.map((point) => point[axis]))),
      [0, 1, 2].map((axis) => Math.max(...corners.map((point) => point[axis]))),
    ],
    analysis_method: "oblique_cross_section",
    analysis_frame_id: frameId,
  };
}

/**
 * Analyse principal and selected oblique cross-section directions. Curved axes are
 * approximated by multiple local section directions; this is not a medial-axis solver.
 */
export function analyzeMeshFeaturesExtended(triangles, boundsMin, boundsMax, {
  obliqueDirections = [
    [1, 1, 0], [1, -1, 0], [1, 0, 1], [1, 0, -1],
    [0, 1, 1], [0, 1, -1], [1, 1, 1], [1, -1, 1],
  ],
  maxObliqueDirections = 8,
} = {}) {
  const principal = analyzeMeshFeatures(triangles, boundsMin, boundsMax);
  if (!Array.isArray(triangles) || !triangles.length) return principal;
  if (!Number.isSafeInteger(maxObliqueDirections) || maxObliqueDirections < 0 || maxObliqueDirections > 16) {
    throw new RangeError("maxObliqueDirections must be an integer from 0 to 16");
  }
  const diagonal = Math.hypot(...boundsMax.map((value, axis) => value - boundsMin[axis]));
  const dedupeDistance = Math.max(1, diagonal * 0.025);
  const results = [...principal];
  const frames = obliqueDirections.slice(0, maxObliqueDirections);
  frames.forEach((direction, frameIndex) => {
    const normal = normalise3(direction);
    if (!normal) return;
    const reference = Math.abs(normal[1]) < 0.85 ? [0, 1, 0] : [1, 0, 0];
    const u = normalise3(cross3(reference, normal));
    if (!u) return;
    const v = normalise3(cross3(normal, u));
    const basis = [u, v, normal];
    const localMin = [Infinity, Infinity, Infinity];
    const localMax = [-Infinity, -Infinity, -Infinity];
    const project = (point) => {
      const local = [dot3(point, u), dot3(point, v), dot3(point, normal)];
      for (let axis = 0; axis < 3; axis += 1) {
        localMin[axis] = Math.min(localMin[axis], local[axis]);
        localMax[axis] = Math.max(localMax[axis], local[axis]);
      }
      return local;
    };
    const localTriangles = triangles.map((triangle) => ({
      a: project(triangle.a),
      b: project(triangle.b),
      c: project(triangle.c),
    }));
    const oblique = analyzeMeshFeatures(localTriangles, localMin, localMax)
      .filter((feature) => feature.axis === "z")
      .map((feature) => transformObliqueFeature(feature, basis, frameIndex + 1));
    for (const feature of oblique) {
      const duplicate = results.some((existing) => {
        const axis = existing.axis_vector_world || (
          existing.axis === "x" ? [1, 0, 0] : existing.axis === "y" ? [0, 1, 0] : [0, 0, 1]
        );
        const parallel = Math.abs(dot3(axis, feature.axis_vector_world)) >= 0.96;
        const close = Math.hypot(...existing.center_mm.map((value, index) => value - feature.center_mm[index])) <= dedupeDistance;
        return parallel && close && Math.abs(existing.area_mm2 - feature.area_mm2) <= Math.max(1, feature.area_mm2 * 0.25);
      });
      if (!duplicate) results.push(feature);
    }
  });
  return results.map((feature, index) => ({ ...feature, id: feature.id || "feature-" + (index + 1) }));
}
