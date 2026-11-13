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

test("published builder page contains every control required by its module", async () => {
  const [html, script, css] = await Promise.all([
    readFile(new URL("../docs/builder.html", import.meta.url), "utf8"),
    readFile(new URL("../docs/assets/builder.js", import.meta.url), "utf8"),
    readFile(new URL("../docs/assets/builder.css", import.meta.url), "utf8"),
  ]);
  const requiredIds = [...script.matchAll(/querySelector\("#([^"]+)"\)/g)]
    .map((match) => match[1]);

  assert.ok(requiredIds.length > 0);
  for (const id of requiredIds) {
    assert.match(html, new RegExp('id="' + id + '"'), "Builder page is missing #" + id);
  }
  assert.match(html, /type="module" src="\.\/assets\/builder\.js"/);
  assert.match(html, /id="download-ldraw"/);
  assert.match(html, /id="download-graph"/);
  assert.match(html, /id="download-bom"/);
  assert.match(html, /runs in your browser/i);
  assert.match(css, /\.builder-empty\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.match(css, /\.dimension-fields\s*>\s*div:last-child\s*\{\s*grid-column:\s*1\s*\/\s*-1;/);
});

