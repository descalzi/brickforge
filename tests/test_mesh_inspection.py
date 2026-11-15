import trimesh

from brickforge.geometry import inspect_mesh


def test_inspect_mesh_reports_dimensions_in_millimetres(tmp_path) -> None:
    mesh = trimesh.creation.box(extents=(20, 10, 5))
    path = tmp_path / "box.stl"
    mesh.export(path)

    report = inspect_mesh(path, units="mm")

    assert report.dimensions_mm == (20.0, 10.0, 5.0)
    assert report.vertex_count > 0
    assert report.face_count > 0
    assert report.is_watertight
    assert report.is_winding_consistent
    assert report.is_volume
    assert report.connected_component_count == 1
    assert report.validation_status == "closed_solid_checks_passed"
    assert any("Self-intersections are not assessed" in warning for warning in report.warnings)


def test_inspect_mesh_converts_centimetres_to_millimetres(tmp_path) -> None:
    mesh = trimesh.creation.box(extents=(2, 1, 0.5))
    path = tmp_path / "box_cm.stl"
    mesh.export(path)

    report = inspect_mesh(path, units="cm")

    assert report.dimensions_mm == (20.0, 10.0, 5.0)


def test_inspect_mesh_reports_open_surface_without_claiming_solid_validation(tmp_path) -> None:
    box = trimesh.creation.box()
    mesh = trimesh.Trimesh(vertices=box.vertices.copy(), faces=box.faces[:-2], process=False)
    path = tmp_path / "open.stl"
    mesh.export(path)

    report = inspect_mesh(path, units="mm")

    assert not report.is_watertight
    assert not report.is_volume
    assert report.validation_status == "needs_review"
    assert any("open or has non-manifold" in warning for warning in report.warnings)


def test_inspect_mesh_reports_disconnected_components(tmp_path) -> None:
    first = trimesh.creation.box(extents=(2, 2, 2))
    second = trimesh.creation.box(extents=(1, 1, 1))
    second.apply_translation((4, 0, 0))
    mesh = trimesh.util.concatenate((first, second))
    path = tmp_path / "components.stl"
    mesh.export(path)

    report = inspect_mesh(path, units="mm")

    assert report.connected_component_count == 2
    assert any("disconnected surface component" in warning for warning in report.warnings)


def test_inspect_mesh_requires_explicit_supported_units(tmp_path) -> None:
    mesh = trimesh.creation.box()
    path = tmp_path / "box.stl"
    mesh.export(path)

    try:
        inspect_mesh(path, units="in")
    except ValueError as exc:
        assert "units must be one of" in str(exc)
    else:
        raise AssertionError("Unsupported units should raise ValueError")
