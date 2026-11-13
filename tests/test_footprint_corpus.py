from __future__ import annotations

import json
import subprocess
from pathlib import Path

from brickforge.construction.footprint import build_footprint_block
from brickforge.parts.connections import load_connection_profiles

ROOT = Path(__file__).resolve().parents[1]
PROFILES = load_connection_profiles(ROOT / "data" / "connection-profiles" / "basic-bricks.json")

SHAPES = {
    "L": {(0, 0), (1, 0), (2, 0), (0, 1), (1, 1), (2, 1), (0, 2), (1, 2)},
    "T": {(x, 0) for x in range(5)} | {(2, 1), (2, 2)},
    "U": {(x, z) for x in range(4) for z in range(4) if x in (0, 3) or z == 0},
    "ring": {
        (x, z)
        for z, row in enumerate(("#####", "##.##", "##.##", "#####"))
        for x, character in enumerate(row)
        if character == "#"
    },
    "stepped-ring": {
        (x, z)
        for z, row in enumerate(("######", "######", "##..##", "######", "######"))
        for x, character in enumerate(row)
        if character == "#"
    },
    "comb": {
        (x, z)
        for z, row in enumerate(("######", "#.#.#.", "######", ".#.#.#", "######"))
        for x, character in enumerate(row)
        if character == "#"
    },
    "cross": {
        (x, z)
        for z, row in enumerate(("..##..", "..##..", "######", "######", "..##..", "..##.."))
        for x, character in enumerate(row)
        if character == "#"
    },
    "staircase": {
        (x, z)
        for z, row in enumerate(("##....", "###...", ".###..", "..###.", "...###", "....##"))
        for x, character in enumerate(row)
        if character == "#"
    },
}


def _transform(cells: set[tuple[int, int]], rotate: bool, mirror: bool) -> list[list[int]]:
    points = []
    for x, z in cells:
        if mirror:
            x = -x
        if rotate:
            x, z = -z, x
        points.append((x, z))
    min_x = min(x for x, _ in points)
    min_z = min(z for _, z in points)
    return [[x - min_x, z - min_z] for x, z in sorted(points, key=lambda point: (point[1], point[0]))]


def _cases() -> list[tuple[list[list[int]], int]]:
    cases = []
    for cells in SHAPES.values():
        for rotate, mirror in ((False, False), (True, False), (False, True)):
            cases.append((_transform(cells, rotate, mirror), 2))
    t_shape = _transform(SHAPES["T"], False, False)
    cases.extend((t_shape, height) for height in (3, 4))
    return cases


def test_branching_concave_and_cavity_shape_corpus_builds() -> None:
    for cells, height in _cases():
        assembly = build_footprint_block(cells, height, PROFILES)
        assert assembly.parts
        assert assembly.connections
        assert assembly.total_mating_pairs > 0


def test_shape_corpus_has_identical_browser_and_python_placements() -> None:
    cases = _cases()
    script = """
import { readFileSync } from "node:fs";
import { buildFootprintBlock } from "./docs/assets/construction-engine.js";
const catalogue = JSON.parse(readFileSync("data/connection-profiles/basic-bricks.json", "utf8"));
const cases = JSON.parse(readFileSync(0, "utf8"));
const results = cases.map(([cells, height]) => {
  const assembly = buildFootprintBlock(cells, height, catalogue);
  return assembly.parts.map((part) => ({
    instance_id: part.instance_id,
    part_id: part.part_id,
    colour_code: part.colour_code,
    translation_ldu: part.translation_ldu,
    matrix: part.matrix,
  }));
});
process.stdout.write(JSON.stringify(results));
"""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        input=json.dumps(cases),
        check=True,
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    browser_placements = json.loads(result.stdout)
    assert len(browser_placements) == len(cases)
    for (cells, height), browser_parts in zip(cases, browser_placements, strict=True):
        assembly = build_footprint_block(cells, height, PROFILES)
        python_parts = [
            {
                "instance_id": part.instance_id,
                "part_id": part.part_id,
                "colour_code": part.colour_code,
                "translation_ldu": list(part.translation_ldu),
                "matrix": list(part.matrix),
            }
            for part in assembly.parts
        ]
        assert browser_parts == python_parts, f"placement mismatch for {len(cells)} cells at height {height}"
