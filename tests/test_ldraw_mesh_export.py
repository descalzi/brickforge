from __future__ import annotations

import json
from pathlib import Path

import pytest
import trimesh

from brickforge.assembly.model import PlacedPart, build_assembly
from brickforge.geometry import voxelize_mesh
from brickforge.parts.connections import load_connection_profiles
from brickforge.parts.ldraw_mesh import assembly_to_mesh, export_assembly_stl
from brickforge.parts.ldraw_resolver import LDrawLibrary

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_LIBRARY = ROOT / "tests" / "fixtures" / "ldraw" / "brick-3001"
PROFILES = load_connection_profiles(ROOT / "data" / "connection-profiles" / "basic-bricks.json")


def _known_single_brick():
    placements = [PlacedPart("reference-brick", "3001", 4)]
    return build_assembly(placements, PROFILES, model_name="golden-single-3001")


def test_resolved_ldraw_mesh_uses_real_part_geometry_and_expected_scale() -> None:
    assembly = _known_single_brick()
    mesh = assembly_to_mesh(assembly, LDrawLibrary(FIXTURE_LIBRARY))

    assert isinstance(mesh, trimesh.Trimesh)
    assert len(mesh.faces) > 100
    assert mesh.bounds[1] - mesh.bounds[0] == pytest.approx((32.0, 11.2, 16.0))
    assert not mesh.is_winding_consistent  # Raw source winding is inconsistent.


def test_golden_stl_export_writes_units_provenance_and_reference_bom(tmp_path: Path) -> None:
    assembly = _known_single_brick()
    destination = tmp_path / "golden-single-3001.stl"
    manifest = export_assembly_stl(
        assembly,
        LDrawLibrary(FIXTURE_LIBRARY),
        destination,
    )

    assert destination.is_file()
    assert destination.stat().st_size > 84
    assert manifest["units"] == "mm"
    assert len(manifest["mesh_sha256"]) == 64
    assert manifest["coordinate_system"] == "LDraw"
    assert manifest["source_part_count"] == 1
    assert manifest["source_bom"]["total_parts"] == 1
    assert manifest["triangle_count"] > 100
    assert manifest["raw_is_winding_consistent"] is False
    assert manifest["winding_repair_attempted"] is True
    assert manifest["winding_repair_conflict_count"] == 0
    assert manifest["is_winding_consistent"] is True
    assert manifest["shell_policy"] == "part shells concatenated; no boolean union performed"

    sidecar = json.loads(destination.with_suffix(".stl.json").read_text(encoding="utf-8"))
    assert sidecar == manifest
    imported = trimesh.load(destination, force="mesh", process=False)
    assert imported.bounds[1] - imported.bounds[0] == pytest.approx((32.0, 11.2, 16.0))
    assert imported.is_watertight
    assert imported.is_winding_consistent
    grid = voxelize_mesh(imported, units="mm", pitch_mm=(4.0, 4.8, 4.0))
    assert grid.spec.dimensions == (8, 3, 4)
    assert grid.occupied_cell_count > 0
