#!/usr/bin/env python3
"""Build a compact searchable index of top-level parts from an LDraw library."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


def _sort_key(part: dict[str, Any]) -> tuple[int, int | str]:
    part_id = part["part_id"]
    return (0, int(part_id)) if part_id.isdigit() else (1, part_id)


def read_part_header(path: Path, library_root: Path) -> dict[str, Any]:
    """Read searchable header metadata without copying or rewriting source geometry."""
    metadata: dict[str, Any] = {
        "part_id": path.stem,
        "filename": path.relative_to(library_root).as_posix(),
    }
    keywords: list[str] = []

    for raw_line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line.startswith("0 "):
            continue
        payload = line[2:].strip()
        if not payload:
            continue
        upper = payload.upper()

        if upper.startswith("NAME:"):
            metadata["name"] = payload.split(":", 1)[1].strip()
        elif upper.startswith("AUTHOR:"):
            metadata["author"] = payload.split(":", 1)[1].strip()
        elif upper.startswith("!LDRAW_ORG"):
            metadata["library_type"] = payload[len("!LDRAW_ORG"):].strip()
        elif upper.startswith("!LICENSE"):
            metadata["licence"] = payload[len("!LICENSE"):].strip()
        elif upper.startswith("!CATEGORY"):
            metadata["category"] = payload[len("!CATEGORY"):].strip()
        elif upper.startswith("!KEYWORDS"):
            keywords.extend(
                item.strip() for item in payload[len("!KEYWORDS"):].split(",") if item.strip()
            )
        elif not payload.startswith("!") and not payload.upper().startswith(
            ("BFC ", "NAME:", "AUTHOR:", "LICENSE:", "HISTORY:", "HELP:")
        ):
            metadata.setdefault("description", payload)

    if keywords:
        metadata["keywords"] = sorted(set(keywords), key=str.casefold)
    metadata.setdefault("description", path.stem)
    return metadata


DEFAULT_MIRROR_COMMIT = "c70360d1c588be894997b2168c61909bc8058c4d"


def build_catalogue(
    library_root: Path,
    mirror_commit: str = DEFAULT_MIRROR_COMMIT,
) -> dict[str, Any]:
    """Index only top-level parts; subparts and primitives remain lazy dependencies."""
    if not re.fullmatch(r"[0-9a-f]{40}", mirror_commit):
        raise ValueError("mirror_commit must be a full 40-character lowercase Git SHA")

    archive_root = library_root.resolve()
    root = archive_root
    if not (root / "parts").is_dir() and (root / "ldraw" / "parts").is_dir():
        root = root / "ldraw"
    parts_dir = root / "parts"
    if not parts_dir.is_dir():
        raise FileNotFoundError(f"LDraw parts directory not found under: {archive_root}")

    parts = [
        read_part_header(path, root)
        for path in parts_dir.glob("*.dat")
        if path.is_file()
    ]
    parts.sort(key=_sort_key)

    source: dict[str, Any] = {
        "name": "LDraw.org Parts Library",
        "mirror_repository": "https://github.com/kulits/ldraw-parts",
        "mirror_commit": mirror_commit,
        "geometry_base_url": (
            "https://raw.githubusercontent.com/kulits/ldraw-parts/"
            + mirror_commit
            + "/ldraw/"
        ),
        "archive_sha256": None,
    }
    source_metadata_path = archive_root / "brickforge-source.json"
    if source_metadata_path.is_file():
        source_metadata = json.loads(source_metadata_path.read_text(encoding="utf-8"))
        source["archive_sha256"] = source_metadata.get("archive_sha256")

    return {
        "schema_version": 1,
        "source": source,
        "part_count": len(parts),
        "parts": parts,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--library",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "vendor" / "ldraw",
        help="Extracted official LDraw library root",
    )
    parser.add_argument(
        "--mirror-commit",
        default=DEFAULT_MIRROR_COMMIT,
        help="Full commit SHA of the geometry mirror snapshot",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=(
            Path(__file__).resolve().parents[1]
            / "docs"
            / "data"
            / "ldraw"
            / "parts-index.json"
        ),
        help="Output path for the compact browser search index",
    )
    args = parser.parse_args()

    catalogue = build_catalogue(args.library, mirror_commit=args.mirror_commit)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(catalogue, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {catalogue['part_count']:,} parts to {args.output}")


if __name__ == "__main__":
    main()
