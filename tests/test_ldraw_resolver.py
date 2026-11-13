from pathlib import Path

import pytest

from brickforge.parts.ldraw_resolver import LDrawLibrary, LDrawResolutionError


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_resolve_nested_subfiles_apply_transforms_and_inherit_colours(tmp_path: Path) -> None:
    _write(
        tmp_path / "parts" / "brick.dat",
        "0 Test root part\n"
        "1 4 20 0 0 0 -1 0 1 0 0 0 0 1 s/cap.dat\n",
    )
    _write(
        tmp_path / "parts" / "s" / "cap.dat",
        "0 Test child subpart\n"
        "3 16 0 0 0 1 0 0 0 1 0\n"
        "2 24 0 0 0 1 0 0\n",
    )

    library = LDrawLibrary(tmp_path)
    geometry = library.resolve_part_geometry("BRICK.DAT")

    assert len(geometry) == 2
    triangle, edge_line = geometry
    assert triangle.line_type == 3
    assert triangle.colour_code == 4
    assert triangle.points == ((20.0, 0.0, 0.0), (20.0, 1.0, 0.0), (19.0, 0.0, 0.0))
    assert edge_line.line_type == 2
    assert edge_line.colour_code == 24
    assert edge_line.edge_base_colour == 4
    assert edge_line.points == ((20.0, 0.0, 0.0), (20.0, 1.0, 0.0))


def test_nested_colour_16_inherits_parent_reference_colour(tmp_path: Path) -> None:
    _write(
        tmp_path / "parts" / "root.dat",
        "0 Root\n1 7 0 0 0 1 0 0 0 1 0 0 0 1 s/child.dat\n",
    )
    _write(
        tmp_path / "parts" / "s" / "child.dat",
        "0 Child\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 s/grandchild.dat\n",
    )
    _write(
        tmp_path / "parts" / "s" / "grandchild.dat",
        "0 Grandchild\n3 16 0 0 0 1 0 0 0 1 0\n",
    )

    geometry = LDrawLibrary(tmp_path).resolve_part_geometry("root.dat")

    assert len(geometry) == 1
    assert geometry[0].colour_code == 7


def test_resolve_primitive_from_p_directory_and_case_insensitive_name(tmp_path: Path) -> None:
    _write(
        tmp_path / "parts" / "root.dat",
        "0 Root\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 48/STUD.DAT\n",
    )
    _write(tmp_path / "p" / "48" / "stud.dat", "0 Primitive\n3 16 0 0 0 1 0 0 0 1 0\n")

    geometry = LDrawLibrary(tmp_path).resolve_part_geometry("parts/root.dat")

    assert len(geometry) == 1
    assert geometry[0].source_file.endswith("p/48/stud.dat")


def test_missing_reference_reports_file_and_line(tmp_path: Path) -> None:
    _write(
        tmp_path / "parts" / "root.dat",
        "0 Root\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 missing.dat\n",
    )

    with pytest.raises(LDrawResolutionError, match=r"could not resolve.*missing.dat"):
        LDrawLibrary(tmp_path).resolve_part_geometry("root.dat")


def test_cycles_are_rejected(tmp_path: Path) -> None:
    _write(
        tmp_path / "parts" / "root.dat",
        "0 Root\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 s/child.dat\n",
    )
    _write(
        tmp_path / "parts" / "s" / "child.dat",
        "0 Child\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 root.dat\n",
    )

    with pytest.raises(LDrawResolutionError, match="cyclic LDraw references"):
        LDrawLibrary(tmp_path).resolve_part_geometry("root.dat")


def test_absolute_references_outside_library_are_rejected(tmp_path: Path) -> None:
    library = LDrawLibrary(tmp_path)

    with pytest.raises(LDrawResolutionError, match="outside the LDraw library"):
        library.resolve(str(tmp_path.parent / "outside.dat"))



def test_resolve_verbatim_ldraw_3001_library_fixture() -> None:
    fixture_root = (
        Path(__file__).resolve().parent
        / "fixtures"
        / "ldraw"
        / "brick-3001"
    )
    library = LDrawLibrary(fixture_root)
    geometry = library.resolve_part_geometry("3001.dat", colour_code=4)

    assert len(geometry) > 100
    source_files = {
        Path(item.source_file).relative_to(fixture_root).as_posix()
        for item in geometry
    }
    assert len(source_files) == 8
    assert "parts/3001.dat" in source_files
    assert "parts/s/3001s01.dat" in source_files
    assert "p/4-4cyli.dat" in source_files
    assert (fixture_root / "p" / "stud.dat").is_file()
    assert (fixture_root / "p" / "stud4.dat").is_file()
    assert (fixture_root / "CAreadme.txt").is_file()
    assert (fixture_root / "CAlicense4.txt").is_file()
    assert any(item.colour_code == 24 and item.edge_base_colour == 4 for item in geometry)
    assert all(item.colour_code in {4, 24} for item in geometry)

    points = [point for item in geometry for point in item.points]
    bounds = [
        (min(point[axis] for point in points), max(point[axis] for point in points))
        for axis in range(3)
    ]
    assert bounds[0][1] - bounds[0][0] == pytest.approx(80.0)
    assert bounds[1][1] - bounds[1][0] == pytest.approx(28.0)
    assert bounds[2][1] - bounds[2][0] == pytest.approx(40.0)


def test_full_library_audit_reports_resolved_fixture_parts() -> None:
    from scripts.validate_ldraw_library import audit_library

    fixture_root = (
        Path(__file__).resolve().parent
        / "fixtures"
        / "ldraw"
        / "brick-3001"
    )

    report = audit_library(fixture_root)

    assert report["parts_scanned"] == 1
    assert report["parts_resolved"] == 1
    assert report["parts_failed"] == 0
    assert report["resolution_rate"] == 1.0
    assert report["expanded_primitive_records"] > 100
    assert report["unique_source_files_expanded"] == 8


def test_full_library_audit_can_limit_parts_and_rejects_zero_limit() -> None:
    from scripts.validate_ldraw_library import audit_library

    fixture_root = (
        Path(__file__).resolve().parent
        / "fixtures"
        / "ldraw"
        / "brick-3001"
    )

    report = audit_library(fixture_root, max_parts=1)

    assert report["parts_scanned"] == 1
    with pytest.raises(ValueError, match="max_parts must be at least 1"):
        audit_library(fixture_root, max_parts=0)


def test_bare_subpart_reference_prefers_primitive_folder_on_name_collision(tmp_path: Path) -> None:
    _write(
        tmp_path / "parts" / "root.dat",
        "0 Root\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 s/child.dat\n",
    )
    _write(
        tmp_path / "parts" / "s" / "child.dat",
        "0 Child subpart\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 stud.dat\n",
    )
    _write(
        tmp_path / "parts" / "stud.dat",
        "0 Conflicting top-level part\n3 16 0 0 0 1 0 0 0 1 0\n",
    )
    _write(
        tmp_path / "p" / "stud.dat",
        "0 Primitive stud\n3 16 0 0 0 1 0 0 0 1 0\n",
    )

    geometry = LDrawLibrary(tmp_path).resolve_part_geometry("root.dat")

    assert len(geometry) == 1
    assert geometry[0].source_file.endswith("p/stud.dat")



def test_missing_nested_reference_reports_complete_dependency_chain(tmp_path: Path) -> None:
    from scripts.validate_ldraw_library import audit_library

    _write(
        tmp_path / "parts" / "root.dat",
        "0 Root\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 s/child.dat\\n",
    )
    _write(
        tmp_path / "parts" / "s" / "child.dat",
        "0 Child\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 missing-primitive.dat\\n",
    )

    report = audit_library(tmp_path)

    assert report["parts_failed"] == 1
    failure = report["failures"][0]
    assert failure["dependency_chain"] == [
        "parts/root.dat",
        "parts/s/child.dat",
        "missing-primitive.dat",
    ]
    assert (
        "dependency chain: parts/root.dat -> parts/s/child.dat -> missing-primitive.dat"
        in failure["message"]
    )
