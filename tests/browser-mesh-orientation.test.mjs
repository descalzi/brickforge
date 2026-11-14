import assert from "node:assert/strict";
import test from "node:test";

import { orientationMatrixToYUp, orientPointToYUp } from "../docs/assets/mesh-orientation.js";

test("Y-up orientation leaves source coordinates unchanged", () => {
  assert.deepEqual(orientPointToYUp([3, 4, 5], "y"), [3, 4, 5]);
});

test("Z-up orientation maps source Z to construction Y without reflection", () => {
  assert.deepEqual(orientPointToYUp([0, 0, 1], "z"), [0, 1, 0]);
  assert.deepEqual(orientPointToYUp([0, 1, 0], "z"), [0, 0, -1]);
  const matrix = orientationMatrixToYUp("z");
  const determinant = matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1])
    - matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0])
    + matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
  assert.equal(determinant, 1);
});

test("X-up orientation maps source X to construction Y", () => {
  assert.deepEqual(orientPointToYUp([1, 0, 0], "x"), [0, 1, 0]);
  assert.deepEqual(orientPointToYUp([0, 1, 0], "x"), [-1, 0, 0]);
});

test("orientation helper rejects invalid axes and coordinates", () => {
  assert.throws(() => orientationMatrixToYUp("w"), /x, y or z/);
  assert.throws(() => orientPointToYUp([1, 2], "y"), /three finite coordinates/);
  assert.throws(() => orientPointToYUp([1, NaN, 3], "y"), /three finite coordinates/);
});


test("Z-up alignment turns a thin XY plate into a two-course Y-up target", () => {
  const sourceCorners = [];
  for (const x of [-24, 24]) {
    for (const y of [-32.49, 32.49]) {
      for (const z of [0, 10.6]) sourceCorners.push([x, y, z]);
    }
  }
  const transformed = sourceCorners.map((point) => orientPointToYUp(point, "z"));
  const extents = [0, 1, 2].map((axis) =>
    Math.max(...transformed.map((point) => point[axis]))
    - Math.min(...transformed.map((point) => point[axis])));
  assert.ok(Math.abs(extents[0] - 48) < 1e-9);
  assert.ok(Math.abs(extents[1] - 10.6) < 1e-9);
  assert.ok(Math.abs(extents[2] - 64.98) < 1e-9);
});
