import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildFootprintBlock } from "../docs/assets/construction-engine.js";

const catalogue = JSON.parse(
  await readFile(new URL("../data/connection-profiles/basic-bricks.json", import.meta.url), "utf8"),
);

const shapes = {
  L: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2]],
  T: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [2, 1], [2, 2]],
  U: Array.from({ length: 4 }, (_, z) =>
    Array.from({ length: 4 }, (_, x) => [x, z]).filter(([x]) => x === 0 || x === 3 || z === 0),
  ).flat(),
  ring: ["#####", "##.##", "##.##", "#####"].flatMap((row, z) =>
    [...row].flatMap((character, x) => character === "#" ? [[x, z]] : []),
  ),
  "stepped-ring": ["######", "######", "##..##", "######", "######"].flatMap((row, z) =>
    [...row].flatMap((character, x) => character === "#" ? [[x, z]] : []),
  ),
};

function transform(cells, rotate, mirror) {
  const points = cells.map(([sourceX, sourceZ]) => {
    let x = mirror ? -sourceX : sourceX;
    let z = sourceZ;
    if (rotate) [x, z] = [-z, x];
    return [x, z];
  });
  const minX = Math.min(...points.map(([x]) => x));
  const minZ = Math.min(...points.map(([, z]) => z));
  return points
    .map(([x, z]) => [x - minX, z - minZ])
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

const cases = Object.values(shapes).flatMap((cells) =>
  [[false, false], [true, false], [false, true]].map(([rotate, mirror]) =>
    [transform(cells, rotate, mirror), 2],
  ),
);
cases.push([transform(shapes.T, false, false), 3], [transform(shapes.T, false, false), 4]);

test("browser engine builds branching, concave and cavity-containing shape corpus", () => {
  for (const [cells, height] of cases) {
    const result = buildFootprintBlock(cells, height, catalogue);
    assert.ok(result.parts.length > 0);
    assert.ok(result.connections.length > 0);
    assert.ok(result.total_mating_pairs > 0);
  }
});
