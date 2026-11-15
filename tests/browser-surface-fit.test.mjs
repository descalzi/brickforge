import assert from "node:assert/strict";
import test from "node:test";

import { refineSurfaceFitTranslation, scoreSurfaceFit } from "../docs/assets/surface-fit.js";

const triangle = (z) => [0, 0, z, 10, 0, z, 0, 10, z];

test("surface fit scores coincident triangles as close alignment", () => {
  const result = scoreSurfaceFit(triangle(0), triangle(0));
  assert.equal(result.status, "close_surface_alignment");
  assert.equal(result.within_tolerance_fraction, 1);
  assert.ok(result.mean_distance_mm < 1e-12);
  assert.ok(result.score > 0.999999);
});

test("surface fit reports a consistent offset and partial alignment", () => {
  const result = scoreSurfaceFit(triangle(0), triangle(2));
  assert.equal(result.mean_distance_mm, 2);
  assert.equal(result.within_tolerance_fraction, 0);
  assert.equal(result.status, "poor_surface_alignment");
  assert.ok(result.score >= 0 && result.score <= 1);
});

test("surface fit uses triangle surfaces rather than only target vertices", () => {
  const candidate = [2, 2, 1, 4, 2, 1, 2, 4, 1];
  const target = [0, 0, 0, 10, 0, 0, 0, 10, 0];
  const result = scoreSurfaceFit(candidate, target);
  assert.ok(result.mean_distance_mm < 1.01);
});

test("surface fit validates geometry and bounded options", () => {
  assert.throws(() => scoreSurfaceFit([0, 1, 2], triangle(0)), /triangle-soup/);
  assert.throws(() => scoreSurfaceFit(triangle(0), [0, 1, NaN, 0, 0, 0, 0, 0, 0]), /finite/);
  assert.throws(() => scoreSurfaceFit(triangle(0), triangle(0), { toleranceMm: 0 }), /positive finite/);
  assert.throws(() => scoreSurfaceFit(triangle(0), triangle(0), { maxDistanceMm: 1, toleranceMm: 2 }), /max distance/);
});

test("surface fit exposes its one-way coverage and physical-buildability limitations", () => {
  const result = scoreSurfaceFit(triangle(0), triangle(0));
  assert.equal(result.method, "candidate-surface-to-target-surface-nearest-triangle-distance");
  assert.ok(result.limitations.some((entry) => entry.includes("reverse coverage")));
  assert.ok(result.limitations.some((entry) => entry.includes("physical connection")));
});

test("surface refinement finds a bounded translation that improves alignment", () => {
  const candidate = [0, 0, 2, 10, 0, 2, 0, 10, 2];
  const target = [0, 0, 0, 10, 0, 0, 0, 10, 0];
  const result = refineSurfaceFitTranslation(candidate, target, { radiusMm: 2 });
  assert.equal(result.method, "bounded-seven-position-translation-refinement");
  assert.deepEqual(result.offset_mm, [0, 0, -2]);
  assert.equal(result.improved, true);
  assert.ok(result.best.mean_distance_mm < result.baseline.mean_distance_mm);
  assert.equal(result.evaluations, 7);
});

test("surface refinement preserves the original placement when no candidate improves", () => {
  const triangle = [0, 0, 0, 10, 0, 0, 0, 10, 0];
  const result = refineSurfaceFitTranslation(triangle, triangle);
  assert.deepEqual(result.offset_mm, [0, 0, 0]);
  assert.equal(result.improved, false);
});

test("surface refinement enforces a small bounded search radius", () => {
  assert.throws(() => refineSurfaceFitTranslation(triangle(0), triangle(0), { radiusMm: 4 }), /no larger than 3 mm/);
});
