"""Deterministic alternating-course construction for rectangular brick blocks."""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from brickforge.assembly.model import Assembly, PlacedPart, build_assembly
from brickforge.parts.connections import (
    IDENTITY_MATRIX,
    ConnectionProfile,
    Matrix3,
    Vector3,
)

ROTATE_Y_90: Matrix3 = (
    0.0, 0.0, 1.0,
    0.0, 1.0, 0.0,
    -1.0, 0.0, 0.0,
)


def build_rectangular_block(
    width_studs: int,
    depth_studs: int,
    height_bricks: int,
    profiles: Mapping[str, ConnectionProfile],
    *,
    part_id: str = "3001",
    colour_codes: Sequence[int] = (4, 1),
    position_tolerance_ldu: float = 0.25,
) -> Assembly:
    """Tile a rectangular block with alternating 2x4 brick orientations.

    Even courses place each brick's four-stud axis along world X. Odd courses
    rotate the bricks 90 degrees about Y so they bridge the seams below.
    Width and depth must be tileable in every requested course. The resulting
    placements still pass through the canonical assembly validator, which
    rejects disconnected layouts and nominal body-envelope overlaps.

    This first strategy requires a rectangular 4x2-stud brick profile such as
    LDraw part 3001. It does not yet optimise part choice or handle irregular
    boundaries.
    """
    dimensions = (width_studs, depth_studs, height_bricks)
    if any(
        isinstance(value, bool) or not isinstance(value, int) or value <= 0
        for value in dimensions
    ):
        raise ValueError("block dimensions must be positive integers")
    if not colour_codes:
        raise ValueError("colour_codes must contain at least one LDraw colour code")

    try:
        profile = profiles[part_id]
    except KeyError:
        raise ValueError(f"no connection profile is available for part {part_id!r}") from None

    if profile.footprint_studs_x != 4 or profile.footprint_studs_z != 2:
        raise ValueError(
            "rectangular block strategy currently requires a 4x2-stud part profile"
        )

    pitch = profile.stud_pitch_ldu
    placements: list[PlacedPart] = []
    for layer in range(height_bricks):
        rotated = layer % 2 == 1
        matrix = ROTATE_Y_90 if rotated else IDENTITY_MATRIX
        tile_width = 2 if rotated else 4
        tile_depth = 4 if rotated else 2
        if width_studs % tile_width or depth_studs % tile_depth:
            orientation = "rotated" if rotated else "unrotated"
            raise ValueError(
                f"{width_studs}x{depth_studs} studs cannot be tiled by the "
                f"{orientation} 4x2 course"
            )

        count_x = width_studs // tile_width
        count_z = depth_studs // tile_depth
        half_width_ldu = width_studs * pitch / 2.0
        half_depth_ldu = depth_studs * pitch / 2.0
        tile_width_ldu = tile_width * pitch
        tile_depth_ldu = tile_depth * pitch

        for index_x in range(count_x):
            centre_x = (
                -half_width_ldu
                + tile_width_ldu / 2.0
                + index_x * tile_width_ldu
            )
            for index_z in range(count_z):
                centre_z = (
                    -half_depth_ldu
                    + tile_depth_ldu / 2.0
                    + index_z * tile_depth_ldu
                )
                translation: Vector3 = (
                    centre_x,
                    -layer * profile.body_height_ldu,
                    centre_z,
                )
                placements.append(
                    PlacedPart(
                        instance_id=(
                            f"layer-{layer:02d}-x-{index_x:03d}-z-{index_z:03d}"
                        ),
                        part_id=part_id,
                        colour_code=colour_codes[layer % len(colour_codes)],
                        translation_ldu=translation,
                        matrix=matrix,
                    )
                )

    return build_assembly(
        placements,
        profiles,
        model_name=f"block-{width_studs}x{depth_studs}x{height_bricks}",
        position_tolerance_ldu=position_tolerance_ldu,
    )
