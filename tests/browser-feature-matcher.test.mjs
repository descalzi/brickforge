import assert from "node:assert/strict";
import test from "node:test";

import { matchTargetFeatures } from "../docs/assets/feature-matcher.js";

const target = {
  id: "z-1",
  shape: "round opening",
  equivalent_diameter_mm: 4.8,
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
