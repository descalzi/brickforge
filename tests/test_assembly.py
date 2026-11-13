from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from brickforge.assembly.demo import build_stacked_brick_demo
from brickforge.assembly.model import AssemblyError, PlacedPart, build_assembly
from brickforge.construction.demo import build_interlocked_block_demo
from brickforge.construction.footprint import build_footprint_block
from brickforge.construction.rectangular import ROTATE_Y_90, build_rectangular_block
from brickforge.parts.connections import load_connection_profiles
from brickforge.parts.ldraw_geometry import parse_ldraw_text

ROOT = Path(__file__).resolve().parents[1]
CATALOGUE = ROOT / "data" / "connection-profiles" / "basic-bricks.json"
PROFILES = load_connection_profiles(CATALOGUE)


def test_two_brick_stack_builds_connected_graph_with_eight_mating_pairs() -> None:
    assembly = build_stacked_brick_demo()

    assert len(assembly.parts) == 2
    assert len(assembly.connections) == 1
    assert assembly.total_mating_pairs == 8
    assert assembly.connections[0].instance_a == "lower-brick"
    assert assembly.connections[0].instance_b == "upper-brick"
    assert all(
        pair.position_error_ldu == pytest.approx(0.0)
        and pair.axis_dot == pytest.approx(-1.0)
        for pair in assembly.connections[0].mating_pairs
    )


def test_ldraw_export_uses_same_two_placements_and_colours() -> None:
    ldraw = build_stacked_brick_demo().to_ldraw()

    assert "1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat" in ldraw
    assert "1 1 0 -24 0 1 0 0 0 1 0 0 0 1 3001.dat" in ldraw
    assert ldraw.endswith("\n")


def test_ldraw_export_reparses_to_the_same_part_placements() -> None:
    assembly = build_stacked_brick_demo()
    document = parse_ldraw_text(assembly.to_ldraw())

    assert len(document.references) == 2
    assert [reference.filename for reference in document.references] == [
        "3001.dat",
        "3001.dat",
    ]
    assert [reference.colour_code for reference in document.references] == [4, 1]
    assert [reference.position for reference in document.references] == [
        (0.0, 0.0, 0.0),
        (0.0, -24.0, 0.0),
    ]
    assert all(
        reference.matrix == assembly.parts[index].matrix
        for index, reference in enumerate(document.references)
    )


def test_bom_aggregates_part_and_colour_from_graph() -> None:
    assembly = build_stacked_brick_demo()

    assert assembly.bom_dict() == {
        "schema_version": 1,
        "model_name": "stacked-3001",
        "total_parts": 2,
        "items": [
            {"part_id": "3001", "colour_code": 1, "quantity": 1},
            {"part_id": "3001", "colour_code": 4, "quantity": 1},
        ],
    }


def test_graph_json_contains_parts_and_explicit_connection_features() -> None:
    payload = json.loads(build_stacked_brick_demo().to_json())

    assert payload["schema_version"] == 1
    assert payload["coordinate_system"] == "LDraw"
    assert payload["length_unit"] == "LDU"
    assert len(payload["parts"]) == 2
    assert len(payload["connections"]) == 1
    assert len(payload["connections"][0]["mating_pairs"]) == 8


def test_generated_example_files_match_canonical_assembly() -> None:
    assembly = build_stacked_brick_demo()
    examples = ROOT / "examples"

    assert (examples / "stacked-3001.ldr").read_text(encoding="utf-8") == (
        assembly.to_ldraw()
    )
    graph_payload = json.loads(
        (examples / "stacked-3001.assembly.json").read_text(encoding="utf-8")
    )
    bom_payload = json.loads(
        (examples / "stacked-3001.bom.json").read_text(encoding="utf-8")
    )
    assert graph_payload == assembly.to_dict()
    assert bom_payload == assembly.bom_dict()


def test_installed_demo_command_writes_all_three_exports(tmp_path: Path) -> None:
    result = subprocess.run(
        ["brickforge-demo-assembly", "--output-dir", str(tmp_path)],
        check=True,
        capture_output=True,
        text=True,
    )

    assert "8 nominal mating pairs" in result.stdout
    assert (tmp_path / "stacked-3001.ldr").is_file()
    assert (tmp_path / "stacked-3001.assembly.json").is_file()
    assert (tmp_path / "stacked-3001.bom.json").is_file()


def test_rectangular_block_builder_interlocks_alternating_courses() -> None:
    assembly = build_interlocked_block_demo()

    assert len(assembly.parts) == 4
    assert len(assembly.connections) == 4
    assert [len(edge.mating_pairs) for edge in assembly.connections] == [4, 4, 4, 4]
    assert assembly.total_mating_pairs == 16
    assert assembly.bom_dict()["total_parts"] == 4
    assert assembly.bom_dict()["items"] == [
        {"part_id": "3001", "colour_code": 1, "quantity": 2},
        {"part_id": "3001", "colour_code": 4, "quantity": 2},
    ]


def test_wide_rectangular_block_staggers_courses_to_bridge_column_seams() -> None:
    assembly = build_rectangular_block(12, 4, 2, PROFILES)

    assert len(assembly.parts) == 15
    assert sum(part.part_id == "3001" for part in assembly.parts) == 11
    assert sum(part.part_id == "3004" for part in assembly.parts) == 4
    assert len(assembly.connections) > 6
    assert assembly.total_mating_pairs >= 48
    assert assembly.bom_dict()["total_parts"] == 15
    assert assembly.bom_dict()["items"] == [
        {"part_id": "3001", "colour_code": 1, "quantity": 5},
        {"part_id": "3001", "colour_code": 4, "quantity": 6},
        {"part_id": "3004", "colour_code": 1, "quantity": 4},
    ]
    assert all(
        part.translation_ldu[1] == -24.0
        for part in assembly.parts
        if part.instance_id.startswith("layer-01-")
    )


def test_wide_rectangular_block_bridges_width_and_depth_seams() -> None:
    assembly = build_rectangular_block(12, 8, 2, PROFILES)

    assert len(assembly.parts) == 42
    assert len(assembly.connections) == 48
    assert assembly.total_mating_pairs == 96
    assert assembly.bom_dict()["total_parts"] == 42
    assert assembly.bom_dict()["items"] == [
        {"part_id": "3001", "colour_code": 1, "quantity": 6},
        {"part_id": "3001", "colour_code": 4, "quantity": 12},
        {"part_id": "3004", "colour_code": 1, "quantity": 24},
    ]
    assert len({part.instance_id for part in assembly.parts}) == 42
    assert sum(
        part.part_id == "3004" for part in assembly.parts
    ) == 24


def test_four_by_eight_block_bridges_depth_seam() -> None:
    assembly = build_rectangular_block(4, 8, 2, PROFILES)

    assert len(assembly.parts) == 11
    assert len(assembly.connections) >= 7
    assert assembly.bom_dict()["total_parts"] == 11
    assert sum(part.part_id == "3004" for part in assembly.parts) == 4


@pytest.mark.parametrize("width_studs", range(4, 24, 4))
@pytest.mark.parametrize("depth_studs", range(4, 24, 4))
def test_rectangular_block_dimension_matrix_is_connected_and_collision_free(
    width_studs: int, depth_studs: int
) -> None:
    # The canonical builder rejects disconnected graphs and overlapping
    # nominal body bounds, so a successful build passes both checks.
    assembly = build_rectangular_block(width_studs, depth_studs, 2, PROFILES)

    assert assembly.parts
    assert len({part.instance_id for part in assembly.parts}) == len(assembly.parts)
    assert assembly.connections
    assert assembly.total_mating_pairs > 0


@pytest.mark.parametrize("height_bricks", (3, 4))
@pytest.mark.parametrize("width_studs", (4, 8, 12))
@pytest.mark.parametrize("depth_studs", (4, 8, 12))
def test_rectangular_block_repeated_courses_remain_connected(
    width_studs: int, depth_studs: int, height_bricks: int
) -> None:
    assembly = build_rectangular_block(
        width_studs, depth_studs, height_bricks, PROFILES
    )

    assert assembly.parts
    assert assembly.connections
    assert assembly.total_mating_pairs > 0
    assert len({part.instance_id for part in assembly.parts}) == len(assembly.parts)



def test_browser_and_python_engines_produce_identical_placements() -> None:
    cases = [
        (width, depth, 2)
        for width in range(4, 24, 4)
        for depth in range(4, 24, 4)
    ] + [
        (width, depth, height)
        for width in (4, 8, 12)
        for depth in (4, 8, 12)
        for height in (3, 4)
    ]
    node_script = """
import { readFileSync } from "node:fs";
import { buildRectangularBlock } from "./docs/assets/construction-engine.js";

const catalogue = JSON.parse(
  readFileSync("data/connection-profiles/basic-bricks.json", "utf8"),
);
const cases = JSON.parse(readFileSync(0, "utf8"));
const results = cases.map(([width, depth, height]) => {
  const assembly = buildRectangularBlock(width, depth, height, catalogue);
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
    browser_result = subprocess.run(
        ["node", "--input-type=module", "-e", node_script],
        input=json.dumps(cases),
        check=True,
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    browser_placements = json.loads(browser_result.stdout)

    assert len(browser_placements) == len(cases)
    for (width, depth, height), browser_parts in zip(
        cases, browser_placements, strict=True
    ):
        python_assembly = build_rectangular_block(width, depth, height, PROFILES)
        python_parts = [
            {
                "instance_id": part.instance_id,
                "part_id": part.part_id,
                "colour_code": part.colour_code,
                "translation_ldu": list(part.translation_ldu),
                "matrix": list(part.matrix),
            }
            for part in python_assembly.parts
        ]
        assert browser_parts == python_parts, (
            f"browser and Python placements differ for {width}x{depth}x{height}"
        )


def test_rectangular_block_alternates_course_transforms() -> None:
    assembly = build_interlocked_block_demo()

    assert [part.translation_ldu for part in assembly.parts] == [
        (0.0, 0.0, -20.0),
        (0.0, 0.0, 20.0),
        (-20.0, -24.0, 0.0),
        (20.0, -24.0, 0.0),
    ]
    assert assembly.parts[0].matrix != ROTATE_Y_90
    assert assembly.parts[2].matrix == ROTATE_Y_90
    assert assembly.parts[3].matrix == ROTATE_Y_90


def test_rectangular_block_rejects_dimensions_not_tileable_by_both_courses() -> None:
    with pytest.raises(ValueError, match="cannot be tiled"):
        build_rectangular_block(4, 2, 2, PROFILES)


def test_block_exports_match_canonical_assembly_graph_and_bom() -> None:
    assembly = build_interlocked_block_demo()
    examples = ROOT / "examples"

    assert (examples / "block-4x4x2.ldr").read_text(encoding="utf-8") == (
        assembly.to_ldraw()
    )
    graph_payload = json.loads(
        (examples / "block-4x4x2.assembly.json").read_text(encoding="utf-8")
    )
    bom_payload = json.loads(
        (examples / "block-4x4x2.bom.json").read_text(encoding="utf-8")
    )
    assert graph_payload == assembly.to_dict()
    assert bom_payload == assembly.bom_dict()


def test_block_ldraw_export_reparses_to_same_placements() -> None:
    assembly = build_interlocked_block_demo()
    document = parse_ldraw_text(assembly.to_ldraw())

    assert len(document.references) == 4
    assert [reference.filename for reference in document.references] == [
        "3001.dat",
        "3001.dat",
        "3001.dat",
        "3001.dat",
    ]
    assert [reference.position for reference in document.references] == [
        part.translation_ldu for part in assembly.parts
    ]
    assert [reference.matrix for reference in document.references] == [
        part.matrix for part in assembly.parts
    ]
    assert [reference.colour_code for reference in document.references] == [
        part.colour_code for part in assembly.parts
    ]


def test_single_course_is_rejected_with_a_clear_minimum_height_error() -> None:
    with pytest.raises(ValueError, match="at least two courses"):
        build_rectangular_block(4, 4, 1, PROFILES)


def test_block_demo_command_writes_all_three_exports(tmp_path: Path) -> None:
    result = subprocess.run(
        ["brickforge-demo-block", "--output-dir", str(tmp_path)],
        check=True,
        capture_output=True,
        text=True,
    )

    assert "4 parts" in result.stdout
    assert "16 nominal mating pairs" in result.stdout
    assert (tmp_path / "block-4x4x2.ldr").is_file()
    assert (tmp_path / "block-4x4x2.assembly.json").is_file()
    assert (tmp_path / "block-4x4x2.bom.json").is_file()


def test_overlapping_nominal_body_bounds_are_rejected() -> None:
    placements = (
        PlacedPart("lower", "3001", 4),
        PlacedPart("upper", "3001", 1, translation_ldu=(0.0, -12.0, 0.0)),
    )

    with pytest.raises(AssemblyError, match="body bounds overlap"):
        build_assembly(placements, PROFILES)


def test_disconnected_parts_are_rejected() -> None:
    placements = (
        PlacedPart("left", "3001", 4),
        PlacedPart("right", "3001", 1, translation_ldu=(100.0, 0.0, 0.0)),
    )

    with pytest.raises(AssemblyError, match="disconnected"):
        build_assembly(placements, PROFILES)


def test_duplicate_instance_ids_are_rejected() -> None:
    placements = (
        PlacedPart("same", "3001", 4),
        PlacedPart("same", "3001", 1, translation_ldu=(0.0, -24.0, 0.0)),
    )

    with pytest.raises(AssemblyError, match="must be unique"):
        build_assembly(placements, PROFILES)


def test_missing_connection_profile_is_rejected() -> None:
    with pytest.raises(AssemblyError, match="no connection profile"):
        build_assembly((PlacedPart("unknown", "9999", 4),), PROFILES)


def test_non_orthonormal_placement_matrix_is_rejected() -> None:
    with pytest.raises(ValueError, match="orthonormal"):
        PlacedPart(
            "bad-rotation",
            "3001",
            4,
            matrix=(2.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0),
        )


def test_empty_assembly_is_rejected() -> None:
    with pytest.raises(AssemblyError, match="at least one"):
        build_assembly((), PROFILES)



def test_footprint_builder_constructs_an_interlocked_l_shape() -> None:
    cells = [
        (10, -4), (11, -4), (12, -4),
        (10, -3), (11, -3), (12, -3),
        (10, -2), (11, -2),
    ]
    assembly = build_footprint_block(cells, 2, PROFILES)

    assert len(assembly.parts) >= 4
    assert {part.part_id for part in assembly.parts} <= {"3001", "3002", "3003", "3004", "3005", "3009", "3010", "3622"}
    assert len(assembly.connections) >= 5
    assert assembly.total_mating_pairs > 0
    assert assembly.model_name == "footprint-3x3-8cells-x2"


def test_footprint_builder_alternates_tilings_for_three_courses() -> None:
    cells = [(0, 0), (1, 0), (2, 0)]
    assembly = build_footprint_block(cells, 3, PROFILES)

    assert len(assembly.parts) >= 3
    assert {part.translation_ldu[1] for part in assembly.parts} == {
        0.0, -24.0, -48.0
    }
    assert assembly.connections
    assert assembly.total_mating_pairs > 0


def test_footprint_builder_repeats_three_layout_cycle_for_taller_stack() -> None:
    cells = [
        (0, 0), (1, 0), (2, 0), (3, 0), (4, 0),
        (2, 1), (2, 2),
    ]
    assembly = build_footprint_block(cells, 4, PROFILES)

    assert {part.translation_ldu[1] for part in assembly.parts} == {
        0.0, -24.0, -48.0, -72.0
    }
    assert assembly.connections
    assert assembly.total_mating_pairs > 0


def test_footprint_builder_rejects_disconnected_footprints() -> None:
    with pytest.raises(ValueError, match="orthogonally connected"):
        build_footprint_block([(0, 0), (2, 0)], 2, PROFILES)


def test_footprint_builder_rejects_duplicate_cells() -> None:
    with pytest.raises(ValueError, match="duplicate"):
        build_footprint_block([(0, 0), (0, 0)], 2, PROFILES)



def test_footprint_builder_supports_a_stepped_u_shape() -> None:
    cells = [
        (x, z)
        for x in range(4)
        for z in range(4)
        if x in (0, 3) or z == 0
    ]
    assembly = build_footprint_block(cells, 2, PROFILES)

    assert len(assembly.parts) >= 10
    assert assembly.connections
    assert assembly.total_mating_pairs > 0


def test_browser_and_python_footprint_engines_produce_identical_placements() -> None:
    cases = [
        (
            [
                [10, -4], [11, -4], [12, -4],
                [10, -3], [11, -3], [12, -3],
                [10, -2], [11, -2],
            ],
            2,
        ),
        ([[0, 0], [1, 0], [2, 0]], 3),
        ([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [2, 1], [2, 2]], 2),
        ([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [2, 1], [2, 2]], 3),
        ([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [2, 1], [2, 2]], 4),
        (
            [
                [x, z]
                for x in range(4)
                for z in range(4)
                if x in (0, 3) or z == 0
            ],
            2,
        ),
        *[
            (
                [
                    [x, z]
                    for z, row in enumerate(rows)
                    for x, character in enumerate(row)
                    if character == "#"
                ],
                2,
            )
            for rows in (
                ("#####", "##.##", "##.##", "#####"),
                ("#####", "##.##", "##.##", "#####", "#####"),
                ("######", "##..##", "##..##", "##..##", "##..##", "######"),
                ("######", "######", "##..##", "##..##", "######", "######"),
                ("######", "######", "##..##", "######", "######"),
                (".##..#", ".##..#", ".#####"),
            )
        ],
    ]
    node_script = """
import { readFileSync } from "node:fs";
import { buildFootprintBlock } from "./docs/assets/construction-engine.js";

const catalogue = JSON.parse(
  readFileSync("data/connection-profiles/basic-bricks.json", "utf8"),
);
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
    browser_result = subprocess.run(
        ["node", "--input-type=module", "-e", node_script],
        input=json.dumps(cases),
        check=True,
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    browser_placements = json.loads(browser_result.stdout)

    assert len(browser_placements) == len(cases)
    for (cells, height), browser_parts in zip(
        cases, browser_placements, strict=True
    ):
        python_assembly = build_footprint_block(cells, height, PROFILES)
        python_parts = [
            {
                "instance_id": part.instance_id,
                "part_id": part.part_id,
                "colour_code": part.colour_code,
                "translation_ldu": list(part.translation_ldu),
                "matrix": list(part.matrix),
            }
            for part in python_assembly.parts
        ]
        assert browser_parts == python_parts, (
            f"browser and Python footprint placements differ for {len(cells)} cells"
        )




def test_footprint_builder_supports_a_t_shape_with_two_courses() -> None:
    cells = [
        (0, 0), (1, 0), (2, 0), (3, 0), (4, 0),
        (2, 1), (2, 2),
    ]
    assembly = build_footprint_block(cells, 2, PROFILES)

    assert assembly.parts
    assert {part.translation_ldu[1] for part in assembly.parts} == {0.0, -24.0}
    assert assembly.connections
    assert assembly.total_mating_pairs > 0


def test_footprint_builder_supports_a_t_shape_with_three_courses() -> None:
    cells = [
        (0, 0), (1, 0), (2, 0), (3, 0), (4, 0),
        (2, 1), (2, 2),
    ]
    assembly = build_footprint_block(cells, 3, PROFILES)

    assert assembly.parts
    assert len({part.translation_ldu[1] for part in assembly.parts}) == 3
    assert assembly.connections
    assert assembly.total_mating_pairs > 0



@pytest.mark.parametrize(
    "grid",
    (
        (
            "#####",
            "##.##",
            "##.##",
            "#####",
        ),
        (
            "#####",
            "##.##",
            "##.##",
            "#####",
            "#####",
        ),
        (
            "######",
            "##..##",
            "##..##",
            "##..##",
            "##..##",
            "######",
        ),
        (
            "######",
            "######",
            "##..##",
            "##..##",
            "######",
            "######",
        ),
        (
            "######",
            "######",
            "##..##",
            "######",
            "######",
        ),
        (
            ".##..#",
            ".##..#",
            ".#####",
        ),
    ),
)
def test_footprint_builder_supports_enclosed_ring_footprints(grid: tuple[str, ...]) -> None:
    cells = [
        (x, z)
        for z, row in enumerate(grid)
        for x, character in enumerate(row)
        if character == "#"
    ]
    assembly = build_footprint_block(cells, 2, PROFILES)

    assert assembly.parts
    assert assembly.connections
    assert assembly.total_mating_pairs > 0
