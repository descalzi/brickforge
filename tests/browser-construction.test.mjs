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

test_graph_json_contains_parts_and_explicit_connection_features() -> None:
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


def test_single_course_with_multiple_unconnected_bricks_is_rejected() -> None:
    with pytest.raises(AssemblyError, match="disconnected"):
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
