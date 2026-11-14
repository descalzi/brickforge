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
