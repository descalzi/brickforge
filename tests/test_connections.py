from __future__ import annotations

import json
from pathlib import Path

import pytest

from brickforge.parts.connections import find_mating_pairs, load_connection_profiles

CATALOGUE = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "connection-profiles"
    / "basic-bricks.json"
)


def test_catalogue_contains_supported_brick_and_plate_profiles() -> None:
    profiles = load_connection_profiles(CATALOGUE)

    assert set(profiles) == {
        "3001", "3002", "3003", "3004", "3005", "3006", "3007", "3008",
        "3009", "3010", "3020", "3021", "3622"
    }
    assert len(profiles["3001"].studs) == 8
    assert len(profiles["3001"].receivers) == 8
    assert len(profiles["3005"].studs) == 1
    assert len(profiles["3002"].studs) == 6
    assert len(profiles["3622"].studs) == 3
    assert len(profiles["3009"].receivers) == 6
    assert len(profiles["3006"].studs) == 20
    assert len(profiles["3007"].receivers) == 16
    assert len(profiles["3008"].studs) == 8
    assert len(profiles["3021"].receivers) == 6
    assert profiles["3001"].body_height_ldu == 24
    assert profiles["3020"].body_height_ldu == 8


def test_brick_2x4_can_align_with_identical_upper_brick() -> None:
    profiles = load_connection_profiles(CATALOGUE)
    matches = find_mating_pairs(
        profiles["3001"], profiles["3001"], translation_b=(0.0, -24.0, 0.0)
    )
    assert len(matches) == 8
    assert all(match.position_error_ldu == pytest.approx(0.0) for match in matches)
    assert all(match.axis_dot == pytest.approx(-1.0) for match in matches)


def test_plate_stacking_uses_plate_body_height() -> None:
    profiles = load_connection_profiles(CATALOGUE)
    matches = find_mating_pairs(
        profiles["3020"], profiles["3020"], translation_b=(0.0, -8.0, 0.0)
    )
    assert len(matches) == 8


def test_single_stud_has_only_one_mating_datum() -> None:
    profiles = load_connection_profiles(CATALOGUE)
    matches = find_mating_pairs(
        profiles["3005"], profiles["3005"], translation_b=(0.0, -24.0, 0.0)
    )
    assert len(matches) == 1
    assert matches[0].feature_a.startswith("top-stud")
    assert matches[0].feature_b.startswith("underside-receiver")


def test_unaligned_vertical_position_does_not_match() -> None:
    profiles = load_connection_profiles(CATALOGUE)
    matches = find_mating_pairs(
        profiles["3001"], profiles["3001"], translation_b=(0.0, -23.0, 0.0)
    )
    assert matches == ()


def test_rotated_footprint_still_matches_when_axes_are_opposed() -> None:
    profiles = load_connection_profiles(CATALOGUE)
    rotation_y_180 = (
        -1.0, 0.0, 0.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, -1.0,
    )
    matches = find_mating_pairs(
        profiles["3001"],
        profiles["3001"],
        matrix_b=rotation_y_180,
        translation_b=(0.0, -24.0, 0.0),
    )
    assert len(matches) == 8


def test_catalogue_rejects_unknown_connector_type(tmp_path: Path) -> None:
    payload = json.loads(CATALOGUE.read_text(encoding="utf-8"))
    payload["profiles"][0]["features"][0]["kind"] = "magnet"
    path = tmp_path / "invalid.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="unsupported connector kind"):
        load_connection_profiles(path)


def test_catalogue_rejects_duplicate_feature_ids(tmp_path: Path) -> None:
    payload = json.loads(CATALOGUE.read_text(encoding="utf-8"))
    features = payload["profiles"][0]["features"]
    features[1]["feature_id"] = features[0]["feature_id"]
    path = tmp_path / "invalid.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="duplicate feature_id"):
        load_connection_profiles(path)


def test_zero_length_axis_is_rejected(tmp_path: Path) -> None:
    payload = json.loads(CATALOGUE.read_text(encoding="utf-8"))
    payload["profiles"][0]["features"][0]["axis"] = [0, 0, 0]
    path = tmp_path / "invalid.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="zero vector"):
        load_connection_profiles(path)


def test_wrong_axis_direction_is_rejected(tmp_path: Path) -> None:
    payload = json.loads(CATALOGUE.read_text(encoding="utf-8"))
    payload["profiles"][0]["features"][-1]["axis"] = [0, -1, 0]
    path = tmp_path / "invalid.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="axis does not match"):
        load_connection_profiles(path)


def test_zero_position_tolerance_requires_exact_alignment() -> None:
    profiles = load_connection_profiles(CATALOGUE)
    matches = find_mating_pairs(
        profiles["3005"],
        profiles["3005"],
        translation_b=(0.0, -24.1, 0.0),
        position_tolerance_ldu=0.0,
    )
    assert matches == ()



def test_different_footprints_can_align_on_a_half_pitch_offset() -> None:
    profiles = load_connection_profiles(CATALOGUE)
    matches = find_mating_pairs(
        profiles["3001"],
        profiles["3021"],
        translation_b=(10.0, -8.0, 0.0),
    )
    assert len(matches) == 6



def test_github_pages_catalogue_copy_matches_canonical_catalogue() -> None:
    published = (
        Path(__file__).resolve().parents[1]
        / "docs"
        / "data"
        / "connection-profiles"
        / "basic-bricks.json"
    )
    assert published.read_bytes() == CATALOGUE.read_bytes()
