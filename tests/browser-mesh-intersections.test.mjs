import assert from "node:assert/strict";
import test from "node:test";

import { diagnoseTriangleIntersections } from "../docs/assets/mesh-intersections.js";

const horizontal = { a: [0, 0, 0], b: [10, 0, 0], c: [0, 10, 0] };
const crossing = { a: [5, -1, -1], b: [5, 5, 1], c: [5, 5, -1] };
const separated = { a: [20, 20, 0], b: [30, 20, 0], c: [20, 30, 0] };

test("triangle diagnostics detect a non-adjacent crossing pair", () => {
  const result = diagnoseTriangleIntersections([horizontal, crossing]);
  assert.equal(result.status, "intersections_detected");
  assert.equal(result.intersection_pair_count, 1);
  assert.equal(result.candidate_pair_count, 1);
});

test("triangle diagnostics leave separated and shared-boundary triangles clear", () => {
  const result = diagnoseTriangleIntersections([horizontal, separated]);
  assert.equal(result.status, "none_detected");
  assert.equal(result.intersection_pair_count, 0);
});

test("triangle diagnostics report an exhausted candidate budget as not assessed", () => {
  const result = diagnoseTriangleIntersections([horizontal, crossing], { maxCandidatePairs: 0 });
  assert.equal(result.status, "not_assessed_pair_limit");
  assert.equal(result.intersection_pair_count, 0);
  assert.equal(result.candidate_pair_count, 1);
});

test("triangle diagnostics ignore triangles sharing a geometric vertex", () => {
  const adjacent = { a: [0, 0, 0], b: [0, 10, 0], c: [0, 0, 10] };
  const result = diagnoseTriangleIntersections([horizontal, adjacent]);
  assert.equal(result.status, "none_detected");
});
