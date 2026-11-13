"""Read provenance and descriptive metadata from LDraw part files.

This module intentionally does not infer legal connection points from geometry.
Connection metadata is a separate, versioned BrickForge data model.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterator


@dataclass(frozen=True, slots=True)
class LDrawPartHeader:
    """Descriptive and provenance fields present in an LDraw part header."""

    file_path: str
    description: str
    name: str | None
    author: str | None
    library_type: str | None
    license_notice: str | None

    def to_dict(self) -> dict[str, str | None]:
        """Return a JSON-serialisable record."""
        return asdict(self)


def read_part_header(path: str | Path) -> LDrawPartHeader:
    """Read leading type-0 metadata from a part file, stopping at geometry."""
    source = Path(path)
    description = ""
    name: str | None = None
    author: str | None = None
    library_type: str | None = None
    license_notice: str | None = None

    with source.open("r", encoding="utf-8", errors="replace") as stream:
        for raw_line in stream:
            line = raw_line.strip()
            if not line:
                continue

            if not line.startswith("0"):
                break

            payload = line[1:].strip()
            if not payload:
                continue

            upper = payload.upper()
            if upper.startswith("NAME:"):
                name = payload.split(":", 1)[1].strip() or None
            elif upper.startswith("AUTHOR:"):
                author = payload.split(":", 1)[1].strip() or None
            elif upper.startswith("!LDRAW_ORG"):
                library_type = payload[len("!LDRAW_ORG"):].strip() or None
            elif upper.startswith("!LICENSE"):
                license_notice = payload[len("!LICENSE"):].strip() or None
            elif not description and not payload.startswith("!"):
                description = payload

    if not description:
        description = source.stem

    return LDrawPartHeader(
        file_path=source.as_posix(),
        description=description,
        name=name,
        author=author,
        library_type=library_type,
        license_notice=license_notice,
    )


def iter_part_headers(library_root: str | Path) -> Iterator[LDrawPartHeader]:
    """Yield part-header records from an extracted LDraw library.

    The supplied path may be either the archive root or its `parts` directory.
    Primitive files in `p/` are not treated as catalogue parts.
    """
    root = Path(library_root)
    parts_dir = root if root.name.lower() == "parts" else root / "parts"
    if not parts_dir.is_dir():
        raise FileNotFoundError(f"LDraw parts directory not found: {parts_dir}")

    for part_file in sorted(parts_dir.rglob("*.dat")):
        if part_file.is_file():
            yield read_part_header(part_file)
