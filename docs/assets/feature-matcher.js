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
        const dimensionComparison = compareFeatureDimensions(targetFeature, candidate, options);
        if (!dimensionComparison) continue;
        const circularityTolerance = 0.3;
        const circularityError = Math.abs(targetFeature.circularity - candidate.circularity);
        if (circularityError > circularityTolerance) continue;
        const aspectTolerance = Math.max(0.35, targetFeature.aspect_ratio * 0.2);
        const aspectError = Math.abs(targetFeature.aspect_ratio - candidate.aspect_ratio);
        if (aspectError > aspectTolerance) continue;
        const score = Math.max(0, 1 - (
          dimensionComparison.normalisedError * 0.7
          + (circularityError / circularityTolerance) * 0.15
          + (aspectError / aspectTolerance) * 0.15
        ));
        const match = {
          part_id: profile.part_id,
          description: profile.description || profile.part_id,
          source_filename: profile.source_filename || "",
          candidate_feature_id: candidate.id,
          candidate_shape: candidate.shape,
          local_axis: candidate.axis,
          score,
          size_error_mm: dimensionComparison.maximumError,
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
