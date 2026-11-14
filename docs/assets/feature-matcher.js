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

function spatialFeature(feature) {
  return validMeasuredFeature(feature)
    && ["x", "y", "z"].includes(feature.axis)
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

export function matchFeaturePatterns(targetFeatures, partProfiles, {
  limit = 5,
  absoluteToleranceMm = 0.75,
  relativeTolerance = 0.12,
  patternToleranceMm = 2,
  relativePatternTolerance = 0.05,
  maxSearchStates = 100000,
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
          const targetAxesParallel = axisIndex(targetFeature) === axisIndex(otherTarget);
          const candidateAxesParallel = axisIndex(candidateFeature) === axisIndex(otherCandidate);
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
    results.push({
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
