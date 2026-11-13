import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildRectangularBlock,
  findMatingPairs,
} from "../docs/assets/construction-engine.js";

const catalogue = JSON.parse(
  await readFile(new URL("../data/connection-profiles/basic-bricks.json", import.meta.url), "utf8"),
);

test("browser engine builds the 4x4 two-course interlocked block", () => {
  const result = buildRectangularBlock(4, 4, 2, catalogue);

  assert.equal(result.parts.length, 4);
  assert.equal(result.connections.length, 4);
  assert.deepEqual(
    result.connections.map((edge) => edge.mating_pairs.length),
    [4, 4, 4, 4],
  );
  assert.equal(result.total_mating_pairs, 16);
  assert.deepEqual(result.bom.items, [
    { part_id: "3001", colour_code: 1, quantity: 2 },
    { part_id: "3001", colour_code: 4, quantity: 2 },
  ]);
});

test("browser engine uses the same part placements as the Python demonstrator", () => {
  const result = buildRectangularBlock(4, 4, 2, catalogue);

  assert.deepEqual(
    result.parts.map((part) => part.translation_ldu),
    [
      [0, 0, -20],
      [0, 0, 20],
      [-20, -24, 0],
      [20, -24, 0],
    ],
  );
  assert.deepEqual(result.parts[0].matrix, [
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ]);
  assert.deepEqual(result.parts[2].matrix, [
    0, 0, 1,
    0, 1, 0,
    -1, 0, 0,
  ]);
});

test("browser graph, BOM and LDraw match the committed model examples", async () => {
  const result = buildRectangularBlock(4, 4, 2, catalogue);
  const [graphText, bomText, ldrawText] = await Promise.all([
    readFile(new URL("../examples/block-4x4x2.assembly.json", import.meta.url), "utf8"),
    readFile(new URL("../examples/block-4x4x2.bom.json", import.meta.url), "utf8"),
    readFile(new URL("../examples/block-4x4x2.ldr", import.meta.url), "utf8"),
  ]);

  assert.deepEqual(result.assembly_graph, JSON.parse(graphText));
  assert.deepEqual(result.bom, JSON.parse(bomText));
  assert.equal(result.ldraw, ldrawText);
});

test("browser engine reports the nominal block dimensions in millimetres", () => {
  const result = buildRectangularBlock(4, 4, 2, catalogue);
  assert.deepEqual(result.dimensions_mm, {
    width: 32,
    depth: 32,
    height: 19.200000000000003,
  });
});

test("feature matcher finds eight candidate pairs for a stacked 2x4 pair", () => {
  const profile = catalogue.profiles.find((item) => item.part_id === "3001");
  const lower = {
    translation_ldu: [0, 0, 0],
    matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  };
  const upper = {
    translation_ldu: [0, -24, 0],
    matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  };

  assert.equal(findMatingPairs(profile, lower, profile, upper).length, 8);
});

test("browser engine rejects dimensions that cannot tile every course", () => {
  assert.throws(
    () => buildRectangularBlock(4, 2, 2, catalogue),
    /cannot be tiled by the rotated/,
  );
});

test("browser engine rejects an unconnected single course containing multiple parts", () => {
  assert.throws(
    () => buildRectangularBlock(4, 4, 1, catalogue),
    /disconnected parts/,
  );
});

test("browser engine enforces a practical client-side part limit", () => {
  assert.throws(
    () => buildRectangularBlock(20, 20, 10, catalogue),
    /limited to 200 parts/,
  );
});

test("browser engine alternates colours by course", () => {
  const result = buildRectangularBlock(4, 4, 3, catalogue, {
    colourCodes: [14, 2],
  });
  assert.deepEqual(
    [...new Set(result.parts.map((part) => part.colour_code))].sort((a, b) => a - b),
    [2, 14],
  );
});
