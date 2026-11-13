from pathlib import Path

import pytest

from brickforge.parts.ldraw_geometry import (
    LDU_TO_MM,
    BRICK_HEIGHT_LDU,
    LDrawParseError,
    LDrawPrimitive,
    LDrawSubfileReference,
    ldu_to_mm,
    mm_to_ldu,
    parse_ldraw_text,
    read_ldraw_document,
)


def test_parse_type_one_reference_with_transform_and_filename() -> None:
    document = parse_ldraw_text(
        "1 4 10 20 30 1 0 0 0 1 0 0 0 1 3001.dat\n",
        source="parts/example.dat",
    )

    assert len(document.references) == 1
    reference = document.references[0]
    assert isinstance(reference, LDrawSubfileReference)
    assert reference.colour_code == 4
    assert reference.position == (10.0, 20.0, 30.0)
    assert reference.matrix == (1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)
    assert reference.filename == "3001.dat"
    assert reference.line_number == 1


def test_parse_primitive_line_types_two_to_five() -> None:
    document = parse_ldraw_text(
        "2 24 0 0 0 1 2 3\n"
        "3 16 0 0 0 1 0 0 0 1 0\n"
        "4 16 0 0 0 1 0 0 1 1 0 0 1 0\n"
        "5 24 0 0 0 1 0 0 0 1 0 1 1 0\n"
    )

    assert [primitive.line_type for primitive in document.primitives] == [2, 3, 4, 5]
    assert [len(primitive.points) for primitive in document.primitives] == [2, 3, 4, 4]
    assert all(isinstance(item, LDrawPrimitive) for item in document.records)
    assert document.primitives[0].colour_code == 24


def test_parse_direct_colour_and_ignore_meta_and_unknown_types() -> None:
    document = parse_ldraw_text(
        "0 Brick sample\n"
        "0 BFC CERTIFY CCW\n"
        "6 this future record is not geometry\n"
        "3 0x2A1B2C3 0 0 0 1 0 0 0 1 0\n"
    )

    assert len(document.records) == 1
    assert document.primitives[0].colour_code == "0X2A1B2C3"


def test_malformed_supported_record_reports_source_and_line() -> None:
    with pytest.raises(LDrawParseError, match=r"parts/bad.dat:2: type-2 record"):
        parse_ldraw_text(
            "0 Example\n"
            "2 24 0 0 0 1 2\n",
            source="parts/bad.dat",
        )


def test_non_finite_geometry_is_rejected() -> None:
    with pytest.raises(LDrawParseError, match="non-finite numeric field"):
        parse_ldraw_text("2 24 0 0 nan 1 2 3\n")


def test_read_document_strips_utf8_bom(tmp_path: Path) -> None:
    part = tmp_path / "sample.dat"
    part.write_text("0 Example\n2 24 0 0 0 1 2 3\n", encoding="utf-8-sig")

    document = read_ldraw_document(part)

    assert document.source == part.as_posix()
    assert len(document.primitives) == 1


def test_ldu_conversion_constants_are_consistent() -> None:
    assert LDU_TO_MM == 0.4
    assert BRICK_HEIGHT_LDU == 24.0
    assert ldu_to_mm(24.0) == pytest.approx(9.6)
    assert mm_to_ldu(9.6) == pytest.approx(24.0)
