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


def test_inspect_mesh_converts_centimetres_to_millimetres(tmp_path) -> None:
    mesh = trimesh.creation.box(extents=(2, 1, 0.5))
    path = tmp_path / "box_cm.stl"
    mesh.export(path)

    report = inspect_mesh(path, units="cm")

    assert report.dimensions_mm == (20.0, 10.0, 5.0)


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
