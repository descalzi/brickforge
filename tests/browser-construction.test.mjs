import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildFootprintBlock,
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

test("browser engine interlocks a wide 12x4 two-course block", () => {
  const result = buildRectangularBlock(12, 4, 2, catalogue);

  assert.equal(result.parts.length, 15);
  assert.equal(result.parts.filter((part) => part.part_id === "3001").length, 11);
  assert.equal(result.parts.filter((part) => part.part_id === "3004").length, 4);
  assert.ok(result.connections.length > 6);
  assert.ok(result.total_mating_pairs >= 48);
  assert.deepEqual(result.bom.items, [
    { part_id: "3001", colour_code: 1, quantity: 5 },
    { part_id: "3001", colour_code: 4, quantity: 6 },
    { part_id: "3004", colour_code: 1, quantity: 4 },
  ]);
});

test("browser engine interlocks a wide 12x8 block in both dimensions", () => {
  const result = buildRectangularBlock(12, 8, 2, catalogue);

  assert.equal(result.parts.length, 42);
  assert.equal(result.parts.filter((part) => part.part_id === "3001").length, 18);
  assert.equal(result.parts.filter((part) => part.part_id === "3004").length, 24);
  assert.equal(result.connections.length, 48);
  assert.equal(result.total_mating_pairs, 96);
  assert.deepEqual(result.bom.items, [
    { part_id: "3001", colour_code: 1, quantity: 6 },
    { part_id: "3001", colour_code: 4, quantity: 12 },
    { part_id: "3004", colour_code: 1, quantity: 24 },
  ]);
});

test("browser engine interlocks a 4x8 block along the depth axis", () => {
  const result = buildRectangularBlock(4, 8, 2, catalogue);

  assert.equal(result.parts.length, 11);
  assert.equal(result.parts.filter((part) => part.part_id === "3001").length, 7);
  assert.equal(result.parts.filter((part) => part.part_id === "3004").length, 4);
  assert.ok(result.connections.length >= 7);
  assert.ok(result.total_mating_pairs >= 16);
});

test("browser engine keeps three- and four-course stacks connected", () => {
  for (const height of [3, 4]) {
    for (const width of [4, 8, 12]) {
      for (const depth of [4, 8, 12]) {
        const result = buildRectangularBlock(width, depth, height, catalogue);
        assert.ok(result.parts.length > 0, `${width}x${depth}x${height} should contain parts`);
        assert.equal(
          new Set(result.parts.map((part) => part.instance_id)).size,
          result.parts.length,
          `${width}x${depth}x${height} should have unique part IDs`,
        );
        assert.ok(result.connections.length > 0, `${width}x${depth}x${height} should be connected`);
        assert.ok(result.total_mating_pairs > 0);
      }
    }
  }
});

test("browser engine validates a matrix of rectangular footprints", () => {
  for (let width = 4; width <= 20; width += 4) {
    for (let depth = 4; depth <= 20; depth += 4) {
      const result = buildRectangularBlock(width, depth, 2, catalogue);
      assert.ok(result.parts.length > 0, `${width}x${depth} should contain parts`);
      assert.equal(
        new Set(result.parts.map((part) => part.instance_id)).size,
        result.parts.length,
        `${width}x${depth} should have unique part IDs`,
      );
      assert.ok(result.connections.length > 0, `${width}x${depth} should be connected`);
      assert.ok(result.total_mating_pairs > 0, `${width}x${depth} should have mating pairs`);
    }
  }
});


test("browser engine requires at least two courses for an interlocked block", () => {
  assert.throws(
    () => buildRectangularBlock(4, 4, 1, catalogue),
    /at least 2 courses/,
  );
});


test("browser engine builds a connected irregular L-shaped footprint", () => {
  const result = buildFootprintBlock([
    [10, -4], [11, -4], [12, -4],
    [10, -3], [11, -3], [12, -3],
    [10, -2], [11, -2],
  ], 2, catalogue);

  assert.ok(result.parts.length >= 6);
  assert.equal(result.model_name, "footprint-3x3-8cells-x2");
  assert.ok(result.connections.length >= 5);
  assert.ok(result.total_mating_pairs > 0);
});

test("browser engine alternates footprint tilings across three courses", () => {
  const result = buildFootprintBlock([[0, 0], [1, 0], [2, 0]], 3, catalogue);

  assert.ok(result.parts.length >= 3);
  assert.deepEqual(
    [...new Set(result.parts.map((part) => part.translation_ldu[1]))],
    [0, -24, -48],
  );
  assert.ok(result.connections.length > 0);
});

test("browser engine connects a T-shaped footprint with three distinct courses", () => {
  const cells = [
    [0, 0], [1, 0], [2, 0], [3, 0], [4, 0],
    [2, 1], [2, 2],
  ];
  const result = buildFootprintBlock(cells, 3, catalogue);

  assert.ok(result.parts.length > 0);
  assert.equal(new Set(result.parts.map((part) => part.translation_ldu[1])).size, 3);
  assert.ok(result.connections.length > 0);
  assert.ok(result.total_mating_pairs > 0);
});

test("browser engine rejects disconnected and duplicate footprint cells", () => {
  assert.throws(
    () => buildFootprintBlock([[0, 0], [2, 0]], 2, catalogue),
    /orthogonally connected/,
  );
  assert.throws(
    () => buildFootprintBlock([[0, 0], [0, 0]], 2, catalogue),
    /duplicate/,
  );
});


test("browser engine builds enclosed O-shaped footprints", () => {
  for (const rows of [
    ["#####", "##.##", "##.##", "#####"],
    ["#####", "##.##", "##.##", "#####", "#####"],
    ["######", "##..##", "##..##", "##..##", "##..##", "######"],
    ["######", "######", "##..##", "##..##", "######", "######"],
    ["######", "######", "##..##", "######", "######"],
    [".##..#", ".##..#", ".#####"],
  ]) {
    const cells = [];
    rows.forEach((row, z) => {
      [...row].forEach((character, x) => {
        if (character === "#") cells.push([x, z]);
      });
    });
    let result;
    try {
      result = buildFootprintBlock(cells, 2, catalogue);
    } catch (error) {
      throw new Error("Failed footprint " + rows.join("/") + ": " + error.message);
    }
    assert.ok(result.parts.length > 0);
    assert.ok(result.connections.length > 0);
    assert.ok(result.total_mating_pairs > 0);
  }
});
