import assert from "node:assert/strict";
import test from "node:test";

import { parseLDrawSurfaceText } from "../docs/assets/ldraw-surface-loader.js";

test("LDraw surface parser preserves type-1 transforms and triangle/quadrilateral surfaces", () => {
  const source = [
    "0 Test part",
    "1 16 10 20 30 1 0 0 0 1 0 0 0 1 subpart.dat",
    "3 16 0 0 0 10 0 0 0 10 0",
    "4 16 0 0 0 10 0 0 10 10 0 0 10 0",
    "2 24 0 0 0 10 10 10",
  ].join("\n");
  const parsed = parseLDrawSurfaceText(source, "parts/test.dat");
  assert.equal(parsed.records.length, 3);
  assert.equal(parsed.records[0].type, 1);
  assert.deepEqual(parsed.records[0].position, [10, 20, 30]);
  assert.deepEqual(parsed.records[0].matrix, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  assert.equal(parsed.records[1].type, 3);
  assert.equal(parsed.records[1].points.length, 3);
  assert.equal(parsed.records[2].type, 4);
  assert.equal(parsed.records[2].points.length, 4);
});

test("LDraw surface parser rejects malformed references and non-finite geometry", () => {
  assert.throws(() => parseLDrawSurfaceText("1 16 0 0 0 1 0 0 0 1 0 0 0 1", "bad.dat"), /malformed type-1/);
  assert.throws(() => parseLDrawSurfaceText("3 16 0 0 0 NaN 0 0 0 1 0", "bad.dat"), /non-finite/);
});
