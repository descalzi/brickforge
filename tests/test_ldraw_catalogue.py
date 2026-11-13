from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.build_ldraw_catalogue import build_catalogue, read_part_header


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_part_header_extracts_search_and_attribution_fields(tmp_path: Path) -> None:
    root = tmp_path / "library"
    part = root / "parts" / "3001.dat"
    _write(
        part,
        "0 Brick 2 x 4\n"
        "0 Name: 3001.dat\n"
        "0 Author: Example Author\n"
        "0 !LDRAW_ORG Part\n"
        "0 !LICENSE Licensed under CC BY 4.0\n"
        "0 !CATEGORY Brick\n"
        "0 !KEYWORDS brick, building, brick\n"
        "0 BFC CERTIFY CCW\n",
    )

    result = read_part_header(part, root)

    assert result["part_id"] == "3001"
    assert result["filename"] == "parts/3001.dat"
    assert result["description"] == "Brick 2 x 4"
    assert result["name"] == "3001.dat"
    assert result["author"] == "Example Author"
    assert result["library_type"] == "Part"
    assert result["licence"] == "Licensed under CC BY 4.0"
    assert result["category"] == "Brick"
    assert result["keywords"] == ["brick", "building"]


def test_catalogue_indexes_only_top_level_parts_and_is_sorted(tmp_path: Path) -> None:
    root = tmp_path / "library"
    _write(root / "parts" / "3004.dat", "0 Brick 1 x 2\n")
    _write(root / "parts" / "3001.dat", "0 Brick 2 x 4\n")
    _write(root / "parts" / "s" / "3001s01.dat", "0 Subpart\n")
    _write(root / "p" / "stud.dat", "0 Primitive\n")
    _write(
        root / "brickforge-source.json",
        json.dumps({"archive_sha256": "abc123"}),
    )

    catalogue = build_catalogue(root)

    assert catalogue["part_count"] == 2
    assert [part["part_id"] for part in catalogue["parts"]] == ["3001", "3004"]
    assert catalogue["source"]["archive_sha256"] == "abc123"


def test_catalogue_requires_parts_directory(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="parts directory"):
        build_catalogue(tmp_path)

def test_catalogue_accepts_complete_zip_ldraw_subdirectory_layout(tmp_path: Path) -> None:
    root = tmp_path / "archive"
    _write(root / "ldraw" / "parts" / "3001.dat", "0 Brick 2 x 4\n")
    _write(root / "brickforge-source.json", json.dumps({"archive_sha256": "nested"}))

    catalogue = build_catalogue(root)

    assert catalogue["part_count"] == 1
    assert catalogue["parts"][0]["filename"] == "parts/3001.dat"
    assert catalogue["source"]["archive_sha256"] == "nested"
