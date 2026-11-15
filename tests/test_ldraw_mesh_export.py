from __future__ import annotations

import json
from pathlib import Path

import pytest
import numpy as np
import trimesh

from brickforge.assembly.model import PlacedPart, build_assembly
from brickforge.geometry import (
    export_assembly_solid_reference_stl,
    solidify_surface_mesh,
    voxelize_mesh,
)
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
    imported = trimesh.load(destination, force="mesh", process=True)
    assert imported.bounds[1] - imported.bounds[0] == pytest.approx((32.0, 11.2, 16.0))
    assert imported.is_winding_consistent
    assert not imported.is_watertight
    assert manifest["is_watertight"] is False
    with pytest.raises(ValueError, match="watertight"):
        voxelize_mesh(imported, units="mm", pitch_mm=(4.0, 4.8, 4.0))



def test_voxel_solid_reference_preserves_two_through_openings() -> None:
    _, y, z = np.indices((32, 16, 16))
    occupied = np.ones((32, 16, 16), dtype=bool)
    for centre_z in (5.0, 11.0):
        occupied &= (y - 8.0) ** 2 + (z - centre_z) ** 2 >= 2.6**2
    source = trimesh.voxel.ops.matrix_to_marching_cubes(occupied, pitch=1.0)

    solid, report = solidify_surface_mesh(
        source, pitch_mm=1.0, expected_handle_count=2
    )

    assert solid.is_watertight
    assert solid.is_winding_consistent
    assert solid.is_volume
    assert report.handle_count == 2
    assert report.required_topology_preserved


def test_authored_ldraw_brick_can_export_a_watertight_reference(tmp_path: Path) -> None:
    assembly = _known_single_brick()
    destination = tmp_path / "golden-single-3001-solid.stl"
    manifest = export_assembly_solid_reference_stl(
        assembly, LDrawLibrary(FIXTURE_LIBRARY), destination, pitch_mm=0.8
    )

    assert destination.is_file()
    assert manifest["units"] == "mm"
    assert manifest["solid_reference"]["is_watertight"] is True
    assert manifest["solid_reference"]["is_volume"] is True
    imported = trimesh.load(destination, force="mesh", process=True)
    assert imported.is_watertight
    assert imported.is_volume
    assert imported.bounds[1] - imported.bounds[0] == pytest.approx(
        (32.0, 11.2, 16.0), abs=1.6
    )
    target_grid = voxelize_mesh(
        imported, units="mm", pitch_mm=(4.0, 5.6, 4.0)
    )
    assert target_grid.spec.cell_count > 0
    assert int(np.count_nonzero(target_grid.classification)) > 0
