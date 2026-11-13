from pathlib import Path

import pytest

from brickforge.parts.ldraw import iter_part_headers, read_part_header


def test_read_part_header_preserves_licence_notice(tmp_path: Path) -> None:
    part = tmp_path / "3001.dat"
    part.write_text(
        "0 Brick 2 x 4\n"
        "0 Name: 3001.dat\n"
        "0 Author: Example Author\n"
        "0 !LDRAW_ORG Part\n"
        "0 !LICENSE Redistributable under CC BY 4.0\n"
        "0 BFC CERTIFY CCW\n"
        "2 24 0 0 0 1 0 0\n",
        encoding="utf-8",
    )

    header = read_part_header(part)

    assert header.description == "Brick 2 x 4"
    assert header.name == "3001.dat"
    assert header.author == "Example Author"
    assert header.library_type == "Part"
    assert header.license_notice == "Redistributable under CC BY 4.0"


def test_iter_part_headers_scans_parts_and_subparts(tmp_path: Path) -> None:
    parts = tmp_path / "parts"
    (parts / "s").mkdir(parents=True)
    (parts / "3001.dat").write_text("0 Brick 2 x 4\n2 24 0 0 0 1 0 0\n", encoding="utf-8")
    (parts / "s" / "3001s01.dat").write_text(
        "0 Brick subpart\n2 16 0 0 0 1 0 0\n",
        encoding="utf-8",
    )

    headers = list(iter_part_headers(tmp_path))

    assert [Path(item.file_path).name for item in headers] == ["3001.dat", "3001s01.dat"]


def test_iter_part_headers_requires_parts_directory(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        list(iter_part_headers(tmp_path))
