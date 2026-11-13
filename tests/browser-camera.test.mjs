import test from "node:test";
import assert from "node:assert/strict";

import { recenterCameraPosition } from "../docs/assets/camera-utils.js";

function distance(a, b) {
  return Math.hypot(...a.map((value, index) => value - b[index]));
}

test("re-centres the model while preserving camera direction and zoom", () => {
  const camera = [12, 8, 16];
  const oldTarget = [2, 3, 4];
  const newTarget = [-20, 7, 31];
  const nextCamera = recenterCameraPosition(camera, oldTarget, newTarget);

  assert.deepEqual(nextCamera, [-10, 12, 43]);
  assert.ok(Math.abs(
    distance(camera, oldTarget) - distance(nextCamera, newTarget),
  ) < 1e-12);
  const oldDirection = camera.map((value, index) => value - oldTarget[index]);
  const newDirection = nextCamera.map((value, index) => value - newTarget[index]);
  assert.deepEqual(newDirection, oldDirection);
});

test("rejects malformed camera vectors", () => {
  assert.throws(
    () => recenterCameraPosition([1, 2], [0, 0, 0], [0, 0, 0]),
    /finite three-component arrays/,
  );
  assert.throws(
    () => recenterCameraPosition([1, 2, Infinity], [0, 0, 0], [0, 0, 0]),
    /finite three-component arrays/,
  );
});
