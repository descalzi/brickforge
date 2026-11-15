"""Regression checks for the published synthetic STL validation corpus."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "docs" / "fixtures"
CATALOGUE = ROOT / "docs" / "data" / "validation-fixtures.json"


def test_validation_fixture_catalogue_matches_published_stl_files() -> None:
    """Every catalogue entry resolves to a parseable, closed STL mesh."""
    catalogue = json.loads(CATALOGUE.read_text(encoding="utf-8"))
    assert catalogue["schema_version"] == 1
    assert catalogue["units"] == "mm"
    fixtures = catalogue["fixtures"]
    assert len(fixtures) >= 8
    assert len({fixture["id"] for fixture in fixtures}) == len(fixtures)

    for fixture in fixtures:
        path = FIXTURE_DIR / fixture["file"]
        assert path.is_file(), fixture["id"]
        mesh = trimesh.load(path, force="mesh", process=True)
        assert isinstance(mesh, trimesh.Trimesh), fixture["id"]
        assert len(mesh.faces) > 100, fixture["id"]
        assert np.isfinite(mesh.vertices).all(), fixture["id"]
        assert mesh.is_watertight, fixture["id"]
        assert mesh.is_winding_consistent, fixture["id"]
        assert mesh.is_volume, fixture["id"]
        assert np.allclose(mesh.extents, fixture["dimensions_mm"], atol=1e-6), fixture["id"]


def test_simple_fixture_topology_is_known() -> None:
    """Baseline and basic opening fixtures retain their intended genus."""
    expected_euler = {
        "block-solid.stl": 2,
        "block-through-hole.stl": 0,
        "block-three-hole-pattern.stl": -4,
        "block-blind-pocket.stl": 2,
    }
    for filename, expected in expected_euler.items():
        mesh = trimesh.load(FIXTURE_DIR / filename, force="mesh", process=True)
        assert isinstance(mesh, trimesh.Trimesh)
        assert mesh.euler_number == expected, filename


def test_fixture_corpus_covers_the_required_challenge_families() -> None:
    """Keep the regression corpus broad as new mesh features are developed."""
    catalogue = json.loads(CATALOGUE.read_text(encoding="utf-8"))
    ids = {fixture["id"] for fixture in catalogue["fixtures"]}
    assert {
        "block-solid",
        "block-through-hole",
        "block-three-hole-pattern",
        "block-blind-pocket",
        "block-oblique-bore",
        "block-curved-tunnel",
        "block-branching-tunnel",
        "car-simple",
    } <= ids
