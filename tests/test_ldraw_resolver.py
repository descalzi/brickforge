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
