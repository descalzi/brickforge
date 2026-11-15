function sizeTolerance(value, absoluteTolerance, relativeTolerance) {
  return Math.max(absoluteTolerance, Math.abs(value) * relativeTolerance);
}

function compareFeatureDimensions(target, candidate, options) {
  if (target.shape !== candidate.shape) return null;
  if (target.shape === "round opening") {
    const targetRange = [
      Number.isFinite(target.minimum_equivalent_diameter_mm) ? target.minimum_equivalent_diameter_mm : target.equivalent_diameter_mm,
      Number.isFinite(target.maximum_equivalent_diameter_mm) ? target.maximum_equivalent_diameter_mm : target.equivalent_diameter_mm,
    ];
    const candidateRange = [
      Number.isFinite(candidate.minimum_equivalent_diameter_mm) ? candidate.minimum_equivalent_diameter_mm : candidate.equivalent_diameter_mm,
      Number.isFinite(candidate.maximum_equivalent_diameter_mm) ? candidate.maximum_equivalent_diameter_mm : candidate.equivalent_diameter_mm,
    ];
    const errors = targetRange.map((value, index) => {
      const difference = Math.abs(value - candidateRange[index]);
      return { difference, tolerance: sizeTolerance(value, options.absoluteToleranceMm, options.relativeTolerance) };
    });
    if (errors.some((entry) => entry.difference > entry.tolerance)) return null;
    return {
      normalisedError: errors.reduce((sum, entry) => sum + entry.difference / entry.tolerance, 0) / errors.length,
      maximumError: Math.max(...errors.map((entry) => entry.difference)),
    };
  }
  const targetDimensions = [
    [target.minimum_width_mm ?? target.width_mm, target.maximum_width_mm ?? target.width_mm],
    [target.minimum_length_mm ?? target.length_mm, target.maximum_length_mm ?? target.length_mm],
  ];
  const candidateDimensions = [
    [candidate.minimum_width_mm ?? candidate.width_mm, candidate.maximum_width_mm ?? candidate.width_mm],
    [candidate.minimum_length_mm ?? candidate.length_mm, candidate.maximum_length_mm ?? candidate.length_mm],
  ];
  const errors = targetDimensions.flatMap((range, index) => range.map((value, endpoint) => {
    const difference = Math.abs(value - candidateDimensions[index][endpoint]);
    return {
      difference,
      tolerance: sizeTolerance(value, options.absoluteToleranceMm, options.relativeTolerance),
    };
  }));
  if (errors.some((entry) => entry.difference > entry.tolerance)) return null;
  return {
    normalisedError: errors.reduce((sum, entry) => sum + entry.difference / entry.tolerance, 0) / errors.length,
    maximumError: Math.max(...errors.map((entry) => entry.difference)),
  };
}

function validMeasuredFeature(feature) {
  if (!feature || typeof feature !== "object") return false;
  const rangePairs = [
    ["minimum_equivalent_diameter_mm", "maximum_equivalent_diameter_mm"],
    ["minimum_width_mm", "maximum_width_mm"],
    ["minimum_length_mm", "maximum_length_mm"],
  ];
  const rangesValid = rangePairs.every(([minimum, maximum]) => {
    if (feature[minimum] === undefined && feature[maximum] === undefined) return true;
    return Number.isFinite(feature[minimum]) && feature[minimum] > 0
      && Number.isFinite(feature[maximum]) && feature[maximum] >= feature[minimum];
  });
  return rangesValid
    && typeof feature.id === "string"
    && ["round opening", "elongated slot/opening", "irregular opening"].includes(feature.shape)
    && Number.isFinite(feature.width_mm) && feature.width_mm > 0
    && Number.isFinite(feature.length_mm) && feature.length_mm > 0
    && Number.isFinite(feature.circularity)
    && Number.isFinite(feature.aspect_ratio)
    && Number.isInteger(feature.sample_support) && feature.sample_support >= 2
    && (feature.shape !== "round opening"
      || (Number.isFinite(feature.equivalent_diameter_mm) && feature.equivalent_diameter_mm > 0));
}


function scoreFeaturePair(targetFeature, candidateFeature, options) {
  if (!validMeasuredFeature(targetFeature) || !validMeasuredFeature(candidateFeature)) return null;
  const dimensionComparison = compareFeatureDimensions(targetFeature, candidateFeature, options);
  if (!dimensionComparison) return null;
  const circularityTolerance = 0.3;
  const circularityError = Math.abs(targetFeature.circularity - candidateFeature.circularity);
  if (circularityError > circularityTolerance) return null;
  const aspectTolerance = Math.max(0.35, targetFeature.aspect_ratio * 0.2);
  const aspectError = Math.abs(targetFeature.aspect_ratio - candidateFeature.aspect_ratio);
  if (aspectError > aspectTolerance) return null;
  return {
    score: Math.max(0, 1 - (
      dimensionComparison.normalisedError * 0.7
      + (circularityError / circularityTolerance) * 0.15
      + (aspectError / aspectTolerance) * 0.15
    )),
    sizeErrorMm: dimensionComparison.maximumError,
  };
}

function featureAxisVector(feature) {
  if (Array.isArray(feature.axis_vector_world) && feature.axis_vector_world.length === 3
      && feature.axis_vector_world.every(Number.isFinite)) {
    return vectorNormalise(feature.axis_vector_world);
  }
  const index = Number.isInteger(feature.axis_index)
    ? feature.axis_index : ["x", "y", "z"].indexOf(feature.axis);
  if (index < 0 || index > 2) return null;
  return [0, 1, 2].map((axis) => axis === index ? 1 : 0);
}

function axesParallel(left, right, tolerance = 0.96) {
  const first = featureAxisVector(left);
  const second = featureAxisVector(right);
  return Boolean(first && second && Math.abs(vectorDot(first, second)) >= tolerance);
}

function spatialFeature(feature) {
  return validMeasuredFeature(feature)
    && Boolean(featureAxisVector(feature))
    && Array.isArray(feature.center_mm)
    && feature.center_mm.length === 3
    && feature.center_mm.every(Number.isFinite);
}

function axisIndex(feature) {
  return Number.isInteger(feature.axis_index) ? feature.axis_index : ["x", "y", "z"].indexOf(feature.axis);
}

function distance3d(left, right) {
  return Math.hypot(
    left.center_mm[0] - right.center_mm[0],
    left.center_mm[1] - right.center_mm[1],
    left.center_mm[2] - right.center_mm[2],
  );
}

export function matchTargetFeatures(targetFeatures, partProfiles, {
  limit = 5,
  absoluteToleranceMm = 0.75,
  relativeTolerance = 0.12,
} = {}) {
  if (!Array.isArray(targetFeatures) || !Array.isArray(partProfiles)) {
    throw new TypeError("targetFeatures and partProfiles must be arrays");
  }
  if (!Number.isSafeInteger(limit) || limit < 1
      || !Number.isFinite(absoluteToleranceMm) || absoluteToleranceMm <= 0
      || !Number.isFinite(relativeTolerance) || relativeTolerance <= 0 || relativeTolerance > 1) {
    throw new RangeError("feature matching limits and tolerances are invalid");
  }
  const options = { absoluteToleranceMm, relativeTolerance };
  return targetFeatures.map((targetFeature) => {
    if (!validMeasuredFeature(targetFeature)) {
      return { target_feature_id: targetFeature?.id || null, matches: [] };
    }
    const bestByPart = new Map();
    for (const profile of partProfiles) {
      if (!profile || typeof profile.part_id !== "string" || !Array.isArray(profile.features)) continue;
      for (const candidate of profile.features) {
        if (!validMeasuredFeature(candidate)) continue;
        const pairScore = scoreFeaturePair(targetFeature, candidate, options);
        if (!pairScore) continue;
        const match = {
          part_id: profile.part_id,
          description: profile.description || profile.part_id,
          source_filename: profile.source_filename || "",
          candidate_feature_id: candidate.id,
          candidate_shape: candidate.shape,
          local_axis: candidate.axis,
          score: pairScore.score,
          size_error_mm: pairScore.sizeErrorMm,
          confidence: targetFeature.confidence === "high" && candidate.confidence === "high" ? "high" : "medium",
          part_dimensions_mm: Array.isArray(profile.dimensions_mm) ? profile.dimensions_mm.slice() : null,
        };
        const previous = bestByPart.get(profile.part_id);
        if (!previous || match.score > previous.score) bestByPart.set(profile.part_id, match);
      }
    }
    const matches = [...bestByPart.values()]
      .sort((left, right) => right.score - left.score || left.part_id.localeCompare(right.part_id))
      .slice(0, limit);
    return { target_feature_id: targetFeature.id, matches };
  });
}


function vectorSubtract(left, right) {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function vectorDot(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function vectorCross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function vectorNormalise(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  return length > 1e-8 ? vector.map((value) => value / length) : null;
}

function makeOrthonormalBasis(origin, first, second) {
  const firstAxis = vectorNormalise(vectorSubtract(first, origin));
  if (!firstAxis) return null;
  const secondVector = vectorSubtract(second, origin);
  const projected = vectorDot(secondVector, firstAxis);
  const perpendicular = secondVector.map((value, axis) => value - projected * firstAxis[axis]);
  const secondAxis = vectorNormalise(perpendicular);
  if (!secondAxis) return null;
  const thirdAxis = vectorNormalise(vectorCross(firstAxis, secondAxis));
  if (!thirdAxis) return null;
  return [
    [firstAxis[0], secondAxis[0], thirdAxis[0]],
    [firstAxis[1], secondAxis[1], thirdAxis[1]],
    [firstAxis[2], secondAxis[2], thirdAxis[2]],
  ];
}

function matrixMultiply(left, right) {
  return left.map((row) => right[0].map((_, column) =>
    row.reduce((sum, value, index) => sum + value * right[index][column], 0)));
}

function matrixTranspose(matrix) {
  return matrix[0].map((_, column) => matrix.map((row) => row[column]));
}

function matrixVector(matrix, vector) {
  return matrix.map((row) => vectorDot(row, vector));
}

function estimateRigidPlacement(assignments, targetFeatures, candidateFeatures) {
  if (assignments.length < 3) {
    return {
      placement_resolved: false,
      rotation_matrix_3x3: null,
      translation_mm: null,
      rms_residual_mm: null,
      axis_alignment_rms_deg: null,
      placement_tolerance_mm: null,
    };
  }
  let selectedTriplet = null;
  let selectedArea = 0;
  for (let first = 0; first < assignments.length; first += 1) {
    for (let second = first + 1; second < assignments.length; second += 1) {
      for (let third = second + 1; third < assignments.length; third += 1) {
        const targetPoints = [first, second, third].map((index) =>
          targetFeatures[assignments[index].target_index].center_mm);
        const candidatePoints = [first, second, third].map((index) =>
          candidateFeatures[assignments[index].candidate_index].center_mm);
        const targetArea = Math.hypot(...vectorCross(
          vectorSubtract(targetPoints[1], targetPoints[0]),
          vectorSubtract(targetPoints[2], targetPoints[0]),
        ));
        const candidateArea = Math.hypot(...vectorCross(
          vectorSubtract(candidatePoints[1], candidatePoints[0]),
          vectorSubtract(candidatePoints[2], candidatePoints[0]),
        ));
        const area = Math.min(targetArea, candidateArea);
        if (area > selectedArea) {
          selectedArea = area;
          selectedTriplet = { targetPoints, candidatePoints };
        }
      }
    }
  }
  if (!selectedTriplet || selectedArea < 1e-6) {
    return {
      placement_resolved: false,
      rotation_matrix_3x3: null,
      translation_mm: null,
      rms_residual_mm: null,
      axis_alignment_rms_deg: null,
      placement_tolerance_mm: null,
    };
  }
  const targetBasis = makeOrthonormalBasis(...selectedTriplet.targetPoints);
  const candidateBasis = makeOrthonormalBasis(...selectedTriplet.candidatePoints);
  if (!targetBasis || !candidateBasis) {
    return {
      placement_resolved: false,
      rotation_matrix_3x3: null,
      translation_mm: null,
      rms_residual_mm: null,
      axis_alignment_rms_deg: null,
      placement_tolerance_mm: null,
    };
  }
  const rotation = matrixMultiply(targetBasis, matrixTranspose(candidateBasis));
  const targetOrigin = selectedTriplet.targetPoints[0];
  const candidateOrigin = selectedTriplet.candidatePoints[0];
  const rotatedOrigin = matrixVector(rotation, candidateOrigin);
  const translation = targetOrigin.map((value, axis) => value - rotatedOrigin[axis]);
  let residualSquareTotal = 0;
  let axisErrorSquareTotal = 0;

  for (const assignment of assignments) {
    const targetFeature = targetFeatures[assignment.target_index];
    const candidateFeature = candidateFeatures[assignment.candidate_index];
    const transformed = matrixVector(rotation, candidateFeature.center_mm)
      .map((value, axis) => value + translation[axis]);
    const residual = Math.hypot(...vectorSubtract(transformed, targetFeature.center_mm));
    residualSquareTotal += residual * residual;
    const localAxis = featureAxisVector(candidateFeature);
    const targetAxis = featureAxisVector(targetFeature);
    const transformedAxis = localAxis ? vectorNormalise(matrixVector(rotation, localAxis)) : null;
    const dot = Math.min(1, Math.abs(vectorDot(transformedAxis || [0, 1, 0], targetAxis || [0, 1, 0])));
    const angle = Math.acos(dot);
    axisErrorSquareTotal += angle * angle;
  }
  const rmsResidual = Math.sqrt(residualSquareTotal / assignments.length);
  const axisAlignmentRms = Math.sqrt(axisErrorSquareTotal / assignments.length) * (180 / Math.PI);
  const maximumTargetSpan = Math.max(...targetFeatures.flatMap((feature, index) =>
    targetFeatures.slice(index + 1).map((other) => distance3d(feature, other))
  ));
  const placementTolerance = Math.max(1.5, maximumTargetSpan * 0.05);
  const resolved = rmsResidual <= placementTolerance && axisAlignmentRms <= 5;
  return {
    placement_resolved: resolved,
    rotation_matrix_3x3: resolved ? rotation : null,
    translation_mm: resolved ? translation : null,
    rms_residual_mm: rmsResidual,
    axis_alignment_rms_deg: axisAlignmentRms,
    placement_tolerance_mm: placementTolerance,
  };
}


function transformedBounds(bounds, rotation, translation) {
  if (!Array.isArray(bounds) || bounds.length !== 2
      || !bounds.every((vector) => Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite))) {
    return null;
  }
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let mask = 0; mask < 8; mask += 1) {
    const corner = [0, 1, 2].map((axis) => bounds[(mask >> axis) & 1][axis]);
    const transformed = matrixVector(rotation, corner).map((value, axis) => value + translation[axis]);
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], transformed[axis]);
      maximum[axis] = Math.max(maximum[axis], transformed[axis]);
    }
  }
  return [minimum, maximum];
}

function comparePartEnvelope(partBounds, targetBounds, rotation, translation, toleranceMm = 2) {
  const transformed = transformedBounds(partBounds, rotation, translation);
  if (!transformed || !Array.isArray(targetBounds) || targetBounds.length !== 2
      || !targetBounds.every((vector) => Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite))) {
    return {
      envelope_contained: null,
      envelope_outside_mm: null,
      transformed_part_bounds_mm: transformed,
    };
  }
  let maximumOutside = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    maximumOutside = Math.max(
      maximumOutside,
      targetBounds[0][axis] - transformed[0][axis],
      transformed[1][axis] - targetBounds[1][axis],
      0,
    );
  }
  return {
    envelope_contained: maximumOutside <= toleranceMm,
    envelope_outside_mm: maximumOutside,
    transformed_part_bounds_mm: transformed,
  };
}

export function matchFeaturePatterns(targetFeatures, partProfiles, {
  limit = 5,
  absoluteToleranceMm = 0.75,
  relativeTolerance = 0.12,
  patternToleranceMm = 2,
  relativePatternTolerance = 0.05,
  maxSearchStates = 100000,
  targetBoundsMm = null,
} = {}) {
  if (!Array.isArray(targetFeatures) || !Array.isArray(partProfiles)) {
    throw new TypeError("targetFeatures and partProfiles must be arrays");
  }
  if (!Number.isSafeInteger(limit) || limit < 1
      || !Number.isFinite(absoluteToleranceMm) || absoluteToleranceMm <= 0
      || !Number.isFinite(relativeTolerance) || relativeTolerance <= 0 || relativeTolerance > 1
      || !Number.isFinite(patternToleranceMm) || patternToleranceMm <= 0
      || !Number.isFinite(relativePatternTolerance) || relativePatternTolerance <= 0 || relativePatternTolerance > 1
      || !Number.isSafeInteger(maxSearchStates) || maxSearchStates < 1) {
    throw new RangeError("feature pattern limits and tolerances are invalid");
  }
  if (targetFeatures.length < 2 || targetFeatures.length > 10
      || !targetFeatures.every(spatialFeature)) return [];
  const options = { absoluteToleranceMm, relativeTolerance };
  const results = [];

  for (const profile of partProfiles) {
    if (!profile || typeof profile.part_id !== "string" || !Array.isArray(profile.features)
        || profile.features.length < targetFeatures.length || profile.features.length > 24
        || !profile.features.every(spatialFeature)) continue;

    const choices = targetFeatures.map((targetFeature, targetIndex) =>
      profile.features.map((candidate, candidateIndex) => {
        const score = scoreFeaturePair(targetFeature, candidate, options);
        return score ? { targetIndex, candidateIndex, ...score } : null;
      }).filter(Boolean).sort((left, right) => right.score - left.score || left.candidateIndex - right.candidateIndex));
    if (choices.some((items) => items.length === 0)) continue;

    const order = targetFeatures.map((_, index) => index)
      .sort((left, right) => choices[left].length - choices[right].length || left - right);
    const assignment = new Array(targetFeatures.length);
    const usedCandidates = new Set();
    let searchStates = 0;
    let best = null;

    const visit = (depth, featureScoreTotal, pairErrorTotal, pairErrorSquareTotal, pairCount) => {
      searchStates += 1;
      if (searchStates > maxSearchStates) return;
      if (depth === order.length) {
        const meanFeatureScore = featureScoreTotal / targetFeatures.length;
        const meanPairError = pairCount ? pairErrorTotal / pairCount : 0;
        const patternScore = Math.max(0, meanFeatureScore * (1 - 0.35 * meanPairError));
        const patternError = pairCount ? Math.sqrt(pairErrorSquareTotal / pairCount) : 0;
        if (!best || patternScore > best.score) {
          best = {
            score: patternScore,
            patternErrorMm: patternError,
            assignments: assignment.map((entry, targetIndex) => ({
              target_feature_id: targetFeatures[targetIndex].id,
              candidate_feature_id: profile.features[entry.candidateIndex].id,
              target_index: targetIndex,
              candidate_index: entry.candidateIndex,
              local_axis: profile.features[entry.candidateIndex].axis,
              feature_score: entry.score,
              size_error_mm: entry.sizeErrorMm,
            })),
          };
        }
        return;
      }

      const targetIndex = order[depth];
      const targetFeature = targetFeatures[targetIndex];
      for (const choice of choices[targetIndex]) {
        if (usedCandidates.has(choice.candidateIndex)) continue;
        const candidateFeature = profile.features[choice.candidateIndex];
        let addedError = 0;
        let addedErrorSquare = 0;
        let addedPairs = 0;
        let compatible = true;

        for (let otherIndex = 0; otherIndex < assignment.length; otherIndex += 1) {
          const other = assignment[otherIndex];
          if (!other) continue;
          const otherTarget = targetFeatures[otherIndex];
          const otherCandidate = profile.features[other.candidateIndex];
          const targetAxesParallel = axesParallel(targetFeature, otherTarget);
          const candidateAxesParallel = axesParallel(candidateFeature, otherCandidate);
          if (targetAxesParallel !== candidateAxesParallel) {
            compatible = false;
            break;
          }
          const targetDistance = distance3d(targetFeature, otherTarget);
          const candidateDistance = distance3d(candidateFeature, otherCandidate);
          const error = Math.abs(targetDistance - candidateDistance);
          const tolerance = Math.max(patternToleranceMm, targetDistance * relativePatternTolerance);
          if (error > tolerance) {
            compatible = false;
            break;
          }
          addedError += error / tolerance;
          addedErrorSquare += error * error;
          addedPairs += 1;
        }
        if (!compatible) continue;

        assignment[targetIndex] = choice;
        usedCandidates.add(choice.candidateIndex);
        visit(
          depth + 1,
          featureScoreTotal + choice.score,
          pairErrorTotal + addedError,
          pairErrorSquareTotal + addedErrorSquare,
          pairCount + addedPairs,
        );
        usedCandidates.delete(choice.candidateIndex);
        assignment[targetIndex] = undefined;
        if (searchStates > maxSearchStates) return;
      }
    };

    visit(0, 0, 0, 0, 0);
    if (!best) continue;
    const placement = estimateRigidPlacement(best.assignments, targetFeatures, profile.features);
    const envelope = placement.placement_resolved && targetBoundsMm
      ? comparePartEnvelope(profile.bounds_mm, targetBoundsMm, placement.rotation_matrix_3x3, placement.translation_mm)
      : { envelope_contained: null, envelope_outside_mm: null, transformed_part_bounds_mm: null };
    results.push({
      ...placement,
      ...envelope,
      part_id: profile.part_id,
      description: profile.description || profile.part_id,
      source_filename: profile.source_filename || "",
      score: best.score,
      pattern_error_mm: best.patternErrorMm,
      matched_feature_count: best.assignments.length,
      target_feature_count: targetFeatures.length,
      profile_feature_count: profile.features.length,
      profile_coverage: best.assignments.length / profile.features.length,
      search_states: Math.min(searchStates, maxSearchStates),
      part_dimensions_mm: Array.isArray(profile.dimensions_mm) ? profile.dimensions_mm.slice() : null,
      assignments: best.assignments,
    });
  }
  return results
    .sort((left, right) => right.score - left.score || left.part_id.localeCompare(right.part_id))
    .slice(0, limit);
}
