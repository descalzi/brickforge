"""Typed parsing of LDraw geometric records.

This module reads the geometry instructions in an LDraw file without trying
to infer physical connection points. Type-1 records reference other LDraw
files; types 2-5 describe lines and filled polygons. Connection metadata stays
in a separate BrickForge model.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import isfinite
from pathlib import Path
from typing import TypeAlias

LDU_TO_MM = 0.4
STUD_PITCH_LDU = 20.0
BRICK_HEIGHT_LDU = 24.0
PLATE_HEIGHT_LDU = 8.0

Vector3: TypeAlias = tuple[float, float, float]
ColourCode: TypeAlias = int | str


class LDrawParseError(ValueError):
    """Raised when a recognised LDraw geometry record is malformed."""


@dataclass(frozen=True, slots=True)
class LDrawSubfileReference:
    """A type-1 reference to another LDraw file and its local transform."""

    colour_code: ColourCode
    position: Vector3
    matrix: tuple[float, float, float, float, float, float, float, float, float]
    filename: str
    line_number: int


@dataclass(frozen=True, slots=True)
class LDrawPrimitive:
    """A type-2 to type-5 geometric primitive in local LDraw coordinates."""

    line_type: int
    colour_code: ColourCode
    points: tuple[Vector3, ...]
    line_number: int


LDrawRecord: TypeAlias = LDrawSubfileReference | LDrawPrimitive


@dataclass(frozen=True, slots=True)
class LDrawDocument:
    """Parsed geometry records from one LDraw text file."""

    source: str
    records: tuple[LDrawRecord, ...]

    @property
    def references(self) -> tuple[LDrawSubfileReference, ...]:
        """Return type-1 child-file references in source order."""
        return tuple(
            record for record in self.records if isinstance(record, LDrawSubfileReference)
        )

    @property
    def primitives(self) -> tuple[LDrawPrimitive, ...]:
        """Return type-2 to type-5 geometry in source order."""
        return tuple(record for record in self.records if isinstance(record, LDrawPrimitive))


def ldu_to_mm(value: float) -> float:
    """Convert an LDraw unit to millimetres (1 LDU = 0.4 mm nominally)."""
    return value * LDU_TO_MM


def mm_to_ldu(value: float) -> float:
    """Convert millimetres to LDraw units (1 LDU = 0.4 mm nominally)."""
    return value / LDU_TO_MM


def read_ldraw_document(path: str | Path) -> LDrawDocument:
    """Read and parse an LDraw text file from disk."""
    source = Path(path)
    content = source.read_text(encoding="utf-8-sig")
    return parse_ldraw_text(content, source=source.as_posix())


def parse_ldraw_text(content: str, *, source: str = "<string>") -> LDrawDocument:
    """Parse supported geometry records, retaining source line numbers.

    Line type 0 metadata/comments and unknown line types are ignored. Malformed
    records with recognised geometry line types raise :class:`LDrawParseError`
    rather than silently producing incomplete geometry.
    """
    records: list[LDrawRecord] = []

    for line_number, raw_line in enumerate(content.splitlines(), start=1):
        stripped = raw_line.strip()
        if not stripped:
            continue

        tokens = stripped.split()
        try:
            line_type = int(tokens[0])
        except (ValueError, IndexError):
            # The LDraw specification says invalid line types are ignored.
            continue

        if line_type == 0:
            continue
        if line_type == 1:
            records.append(_parse_subfile_reference(tokens, source, line_number))
        elif line_type in (2, 3, 4, 5):
            records.append(_parse_primitive(tokens, line_type, source, line_number))
        # Unknown integer line types are reserved/invalid and do not define
        # geometry understood by this parser.

    return LDrawDocument(source=source, records=tuple(records))


def _parse_subfile_reference(
    tokens: list[str],
    source: str,
    line_number: int,
) -> LDrawSubfileReference:
    if len(tokens) < 15:
        raise _record_error(source, line_number, "type-1 record requires 14 fields and a filename")

    colour = _parse_colour(tokens[1], source, line_number)
    values = _parse_floats(tokens[2:14], source, line_number)
    filename = " ".join(tokens[14:]).strip()
    if not filename:
        raise _record_error(source, line_number, "type-1 record has no referenced filename")

    return LDrawSubfileReference(
        colour_code=colour,
        position=(values[0], values[1], values[2]),
        matrix=(
            values[3], values[4], values[5],
            values[6], values[7], values[8],
            values[9], values[10], values[11],
        ),
        filename=filename,
        line_number=line_number,
    )


def _parse_primitive(
    tokens: list[str],
    line_type: int,
    source: str,
    line_number: int,
) -> LDrawPrimitive:
    point_counts = {2: 2, 3: 3, 4: 4, 5: 4}
    expected_tokens = 2 + point_counts[line_type] * 3
    if len(tokens) != expected_tokens:
        raise _record_error(
            source,
            line_number,
            f"type-{line_type} record requires {expected_tokens} fields; got {len(tokens)}",
        )

    colour = _parse_colour(tokens[1], source, line_number)
    values = _parse_floats(tokens[2:], source, line_number)
    points = tuple(
        (values[index], values[index + 1], values[index + 2])
        for index in range(0, len(values), 3)
    )

    return LDrawPrimitive(
        line_type=line_type,
        colour_code=colour,
        points=points,
        line_number=line_number,
    )


def _parse_colour(token: str, source: str, line_number: int) -> ColourCode:
    try:
        return int(token, 10)
    except ValueError:
        # Direct RGB colours use the LDraw form 0x2RRGGBB.
        if (
            len(token) == 9
            and token[:3].lower() == "0x2"
            and all(character in "0123456789abcdefABCDEF" for character in token[3:])
        ):
            return token.upper()
        raise _record_error(source, line_number, f"invalid colour code: {token!r}") from None


def _parse_floats(tokens: list[str], source: str, line_number: int) -> list[float]:
    values: list[float] = []
    for token in tokens:
        try:
            value = float(token)
        except ValueError:
            raise _record_error(
                source, line_number, f"invalid numeric field: {token!r}"
            ) from None
        if not isfinite(value):
            raise _record_error(
                source, line_number, f"non-finite numeric field: {token!r}"
            )
        values.append(value)
    return values


def _record_error(source: str, line_number: int, message: str) -> LDrawParseError:
    return LDrawParseError(f"{source}:{line_number}: {message}")
