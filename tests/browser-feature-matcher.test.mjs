import assert from "node:assert/strict";
import test from "node:test";

import { matchFeaturePatterns, matchTargetFeatures } from "../docs/assets/feature-matcher.js";

const target = {
  id: "z-1",
  shape: "round opening",
  equivalent_diameter_mm: 4.8,
  minimum_equivalent_diameter_mm: 4.8,
  maximum_equivalent_diameter_mm: 4.8,
  minimum_width_mm: 4.7,
  maximum_width_mm: 4.7,
  minimum_length_mm: 4.7,
  maximum_length_mm: 4.7,
  width_mm: 4.7,
  length_mm: 4.7,
  circularity: 0.94,
  aspect_ratio: 1.02,
  sample_support: 5,
  confidence: "high",
};

function profile(partId, diameter, overrides = {}) {
  return {
    part_id: partId,
    description: "Synthetic test part " + partId,
    source_filename: "parts/" + partId + ".dat",
    dimensions_mm: [16, 8, 8],
    features: [{
      id: "opening-1",
      axis: "y",
      shape: "round opening",
      equivalent_diameter_mm: diameter,
      minimum_equivalent_diameter_mm: diameter,
      maximum_equivalent_diameter_mm: diameter,
      minimum_width_mm: diameter,
      maximum_width_mm: diameter,
      minimum_length_mm: diameter,
      maximum_length_mm: diameter,
      width_mm: diameter,
      length_mm: diameter,
      circularity: 0.94,
      aspect_ratio: 1.02,
      sample_support: 5,
      confidence: "high",
      ...overrides,
    }],
  };
}

test("feature matcher ranks a dimensionally exact opening ahead of a near match", () => {
  const results = matchTargetFeatures([target], [
    profile("beam-near", 5.3),
    profile("beam-exact", 4.8),
    profile("beam-too-large", 8),
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0].matches.length, 2);
  assert.equal(results[0].matches[0].part_id, "beam-exact");
  assert.equal(results[0].matches[0].score, 1);
  assert.equal(results[0].matches[1].part_id, "beam-near");
  assert.equal(results[0].matches[0].local_axis, "y");
});

test("feature matcher rejects incompatible shapes and out-of-tolerance dimensions", () => {
  const results = matchTargetFeatures([target], [
    profile("slot", 4.8, { shape: "elongated slot/opening" }),
    profile("far", 9),
    profile("poor-circularity", 4.8, { circularity: 0.2 }),
  ]);
  assert.deepEqual(results[0].matches, []);
});

test("feature matcher validates its search limits", () => {
  assert.throws(() => matchTargetFeatures([target], [], { limit: 0 }), /limits and tolerances/);
  assert.throws(() => matchTargetFeatures({}, []), /must be arrays/);
});

test("feature matcher compares tapered opening limits rather than only average diameter", () => {
  const taperedTarget = {
    ...target,
    equivalent_diameter_mm: 6.8,
    minimum_equivalent_diameter_mm: 4.3,
    maximum_equivalent_diameter_mm: 7.7,
  };
  const matchingTaper = profile("countersunk-match", 6.8, {
    minimum_equivalent_diameter_mm: 4.3,
    maximum_equivalent_diameter_mm: 7.7,
  });
  const straightHole = profile("straight-hole", 6.8, {
    minimum_equivalent_diameter_mm: 6.8,
    maximum_equivalent_diameter_mm: 6.8,
  });
  const result = matchTargetFeatures([taperedTarget], [straightHole, matchingTaper]);
  assert.equal(result[0].matches.length, 1);
  assert.equal(result[0].matches[0].part_id, "countersunk-match");
});

test("feature matcher remains compatible with legacy profiles without size ranges", () => {
  const legacy = profile("legacy-beam", 4.8);
  delete legacy.features[0].minimum_equivalent_diameter_mm;
  delete legacy.features[0].maximum_equivalent_diameter_mm;
  delete legacy.features[0].minimum_width_mm;
  delete legacy.features[0].maximum_width_mm;
  delete legacy.features[0].minimum_length_mm;
  delete legacy.features[0].maximum_length_mm;
  const results = matchTargetFeatures([target], [legacy]);
  assert.equal(results[0].matches.length, 1);
  assert.equal(results[0].matches[0].part_id, "legacy-beam");
});

function patternHole(id, centre, axis = "z") {
  const diameter = 4.8;
  return {
    id,
    axis,
    axis_index: { x: 0, y: 1, z: 2 }[axis],
    shape: "round opening",
    center_mm: centre,
    bounds_mm: [centre.map((value) => value - 2.4), centre.map((value) => value + 2.4)],
    observed_span_mm: 4,
    width_mm: diameter,
    length_mm: diameter,
    area_mm2: 18.1,
    perimeter_mm: 15.1,
    equivalent_diameter_mm: diameter,
    minimum_equivalent_diameter_mm: diameter,
    maximum_equivalent_diameter_mm: diameter,
    minimum_width_mm: diameter,
    maximum_width_mm: diameter,
    minimum_length_mm: diameter,
    maximum_length_mm: diameter,
    minimum_area_mm2: 18.1,
    maximum_area_mm2: 18.1,
    circularity: 1,
    aspect_ratio: 1,
    sample_support: 5,
    confidence: "high",
  };
}

test("feature pattern matcher assigns unique openings and tolerates rigid rotation and translation", () => {
  const targetFeatures = [
    patternHole("t1", [0, 0, 2]),
    patternHole("t2", [20, 0, 2]),
    patternHole("t3", [0, 30, 2]),
  ];
  const candidate = {
    part_id: "pattern-beam",
    description: "Three-hole test beam",
    dimensions_mm: [40, 8, 24],
    features: [
      patternHole("p3", [10, 1, 5], "y"),
      patternHole("p1", [40, 1, 5], "y"),
      patternHole("p2", [40, 1, 25], "y"),
    ],
  };
  const results = matchFeaturePatterns(targetFeatures, [candidate]);
  assert.equal(results.length, 1);
  assert.equal(results[0].matched_feature_count, 3);
  assert.equal(results[0].score, 1);
  assert.equal(new Set(results[0].assignments.map((entry) => entry.candidate_feature_id)).size, 3);
  assert.equal(results[0].placement_resolved, true);
  assert.ok(results[0].rms_residual_mm < 1e-8);
  assert.ok(results[0].axis_alignment_rms_deg < 1e-6);
  assert.ok(Array.isArray(results[0].rotation_matrix_3x3));
  assert.ok(Array.isArray(results[0].translation_mm));
});

test("feature pattern matcher rejects matching hole sizes with incompatible spacing", () => {
  const targetFeatures = [
    patternHole("t1", [0, 0, 2]),
    patternHole("t2", [20, 0, 2]),
    patternHole("t3", [0, 30, 2]),
  ];
  const candidate = {
    part_id: "wrong-spacing",
    features: [
      patternHole("p1", [40, 1, 5], "y"),
      patternHole("p2", [40, 1, 35], "y"),
      patternHole("p3", [10, 1, 5], "y"),
    ],
  };
  assert.deepEqual(matchFeaturePatterns(targetFeatures, [candidate]), []);
});

test("feature pattern matcher requires enough unique candidate openings", () => {
  const targetFeatures = [
    patternHole("t1", [0, 0, 2]),
    patternHole("t2", [20, 0, 2]),
    patternHole("t3", [0, 30, 2]),
  ];
  const candidate = {
    part_id: "two-hole-part",
    features: [
      patternHole("p1", [40, 1, 5], "y"),
      patternHole("p2", [40, 1, 25], "y"),
    ],
  };
  assert.deepEqual(matchFeaturePatterns(targetFeatures, [candidate]), []);
});
