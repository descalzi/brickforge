import assert from "node:assert/strict";
import test from "node:test";

import { transformPartPreviewPositions } from "../docs/assets/part-preview.js";

test("candidate part preview applies translation and model-centre offset", () => {
  const positions = transformPartPreviewPositions(
    [1, 2, 3, -1, 0, 2],
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [10, 20, 30],
    [4, 5, 6],
  );
  assert.deepEqual(Array.from(positions), [7, 17, 27, 5, 15, 26]);
});

test("candidate part preview applies a rigid quarter-turn", () => {
  const positions = transformPartPreviewPositions(
    [2, 0, 0],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  );
  assert.deepEqual(Array.from(positions), [0, 2, 0]);
});

test("candidate part preview rejects malformed geometry and non-rigid transforms", () => {
  assert.throws(() => transformPartPreviewPositions([0, 1]), /XYZ triples/);
  assert.throws(() => transformPartPreviewPositions([0, 1, NaN]), /finite XYZ triples/);
  assert.throws(() => transformPartPreviewPositions([0, 1, 2], [[2, 0, 0], [0, 1, 0], [0, 0, 1]]), /orthonormal/);
  assert.throws(() => transformPartPreviewPositions([0, 1, 2], undefined, [0, 0]), /three finite numbers/);
});
