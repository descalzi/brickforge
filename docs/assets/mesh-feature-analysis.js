const SAMPLE_FRACTIONS = Object.freeze([0.1, 0.2, 0.3, 0.4, 0.6, 0.8, 0.9]);
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
      const crosses = (firstDistance < -epsilon && secondDistance > epsilon)
        || (firstDistance > epsilon && secondDistance < -epsilon);
      if (!crosses) continue;
      const ratio = firstDistance / (firstDistance - secondDistance);
      const point = [
        vertices[left][otherAxes[0]] + ratio * (vertices[right][otherAxes[0]] - vertices[left][otherAxes[0]]),
        vertices[left][otherAxes[1]] + ratio * (vertices[right][otherAxes[1]] - vertices[left][otherAxes[1]]),
      ];
      if (!intersections.some((existing) => Math.hypot(existing[0] - point[0], existing[1] - point[1]) <= tolerance)) {
        intersections.push(point);
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
  nearest.samples.push(candidate);
  nearest.centroid[0] += candidate.centroid[0];
  nearest.centroid[1] += candidate.centroid[1];
  nearest.lastSampleIndex = sampleIndex;
}

function summarizeCluster(cluster, featureIndex) {
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
  const axis = cluster.axis;
  const otherAxes = [0, 1, 2].filter((value) => value !== axis);
  const planes = samples.map((sample) => sample.plane);
  const centre = [0, 0, 0];
  centre[axis] = planes.reduce((sum, value) => sum + value, 0) / planes.length;
  centre[otherAxes[0]] = centre2d[0];
  centre[otherAxes[1]] = centre2d[1];
  const minimum = [0, 0, 0];
  const maximum = [0, 0, 0];
  minimum[axis] = Math.min(...planes);
  maximum[axis] = Math.max(...planes);
  for (let dimension = 0; dimension < 2; dimension += 1) {
    const worldAxis = otherAxes[dimension];
    minimum[worldAxis] = Math.min(...samples.map((sample) => sample.minimum[dimension]));
    maximum[worldAxis] = Math.max(...samples.map((sample) => sample.maximum[dimension]));
  }
  const shape = circularity >= 0.68 && aspectRatio <= 1.4
    ? "round opening"
    : aspectRatio >= 1.55 ? "elongated slot/opening" : "irregular opening";
  return {
    id: AXIS_NAMES[axis] + "-" + featureIndex,
    axis: AXIS_NAMES[axis],
    axis_index: axis,
    shape,
    center_mm: centre,
    bounds_mm: [minimum, maximum],
    observed_span_mm: maximum[axis] - minimum[axis],
    width_mm: Math.min(extent[0], extent[1]),
    length_mm: Math.max(extent[0], extent[1]),
    area_mm2: area,
    perimeter_mm: perimeter,
    equivalent_diameter_mm: equivalentDiameter,
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
      features.push(summarizeCluster(cluster, features.length + 1));
    }
  }
  return features.sort((left, right) =>
    left.axis_index - right.axis_index
    || left.center_mm[0] - right.center_mm[0]
    || left.center_mm[1] - right.center_mm[1]
    || left.center_mm[2] - right.center_mm[2])
    .map((feature, index) => ({ ...feature, id: feature.axis + "-" + (index + 1) }));
}
