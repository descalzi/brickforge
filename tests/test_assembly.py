from __future__ import annotations

import json
from pathlib import Path

import pytest

from brickforge.assembly.demo import build_stacked_brick_demo
from brickforge.assembly.model import AssemblyError, PlacedPart, build_assembly
from brickforge.parts.connections import load_connection_profiles

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
    assert (
        examples / "stacked-3001.assembly.json"
    ).read_text(encoding="utf-8") == assembly.to_json()
    assert (examples / "stacked-3001.bom.json").read_text(encoding="utf-8") == (
        assembly.bom_json()
    )


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
