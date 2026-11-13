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
    """Tile a rectangular block with interlocked 2x4 and 1x2 brick courses.

    Even courses use a regular 4x2 grid. Odd courses use a 90-degree rotation
    for a single-axis stagger, or a two-axis shift when both dimensions extend
    beyond one brick. The 1x2 parts close the resulting one-stud perimeter
    strips. Every proposed placement passes through the canonical assembly
    validator.

    The strategy uses the 2x4 profile (3001) and the 1x2 profile (3004). It
    does not yet optimise part choice or handle irregular boundaries.
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

        half_width_ldu = width_studs * pitch / 2.0
        half_depth_ldu = depth_studs * pitch / 2.0
        layer_colour = colour_codes[layer % len(colour_codes)]
        layer_y = -layer * profile.body_height_ldu

        # A one-direction stagger is sufficient for a 4-stud-deep or
        # 4-stud-wide footprint. When both dimensions are larger, a rotated
        # grid creates separate components at the middle seam in the second
        # direction. Use a two-axis stagger with a 1x2 perimeter instead.
        staggered_width = rotated and width_studs > 4 and depth_studs == 4
        staggered_depth = rotated and width_studs == 4 and depth_studs > 4
        staggered_both = rotated and width_studs > 4 and depth_studs > 4

        if staggered_width or staggered_depth or staggered_both:
            try:
                edge_profile = profiles["3004"]
            except KeyError:
                raise ValueError(
                    "staggered blocks require the 1x2 brick profile 3004"
                ) from None
            if (
                edge_profile.footprint_studs_x != 2
                or edge_profile.footprint_studs_z != 1
            ):
                raise ValueError("part profile 3004 must be a 2x1-stud brick")

            if staggered_width:
                # Bridge the lower columns with rotated 2x4 bricks; use
                # rotated 1x2 bricks for the two one-stud-wide side strips.
                inner_columns = (width_studs - 2) // 2
                for index_x in range(inner_columns):
                    centre_x = (
                        -width_studs / 2.0 + 2.0 + 2.0 * index_x
                    ) * pitch
                    placements.append(
                        PlacedPart(
                            instance_id=(
                                f"layer-{layer:02d}-inner-x-{index_x:03d}-z-000"
                            ),
                            part_id=part_id,
                            colour_code=layer_colour,
                            translation_ldu=(centre_x, layer_y, 0.0),
                            matrix=ROTATE_Y_90,
                        )
                    )
                edge_columns = (
                    ("left", -width_studs / 2.0 + 0.5),
                    ("right", width_studs / 2.0 - 0.5),
                )
                for edge_name, centre_x_studs in edge_columns:
                    for index_z in range(depth_studs // 2):
                        centre_z = (
                            -depth_studs / 2.0 + 1.0 + 2.0 * index_z
                        ) * pitch
                        placements.append(
                            PlacedPart(
                                instance_id=(
                                    f"layer-{layer:02d}-edge-{edge_name}-"
                                    f"z-{index_z:03d}"
                                ),
                                part_id="3004",
                                colour_code=layer_colour,
                                translation_ldu=(
                                    centre_x_studs * pitch,
                                    layer_y,
                                    centre_z,
                                ),
                                matrix=ROTATE_Y_90,
                            )
                        )

            elif staggered_depth:
                # With one 4-stud-wide lower column, stagger the 2x4
                # elements along depth and close the two 1-stud end strips.
                for index_z in range(depth_studs // 2 - 1):
                    centre_z = (
                        -depth_studs / 2.0 + 2.0 + 2.0 * index_z
                    ) * pitch
                    placements.append(
                        PlacedPart(
                            instance_id=(
                                f"layer-{layer:02d}-inner-x-000-z-{index_z:03d}"
                            ),
                            part_id=part_id,
                            colour_code=layer_colour,
                            translation_ldu=(0.0, layer_y, centre_z),
                            matrix=IDENTITY_MATRIX,
                        )
                    )
                for edge_name, centre_z_studs in (
                    ("front", -depth_studs / 2.0 + 0.5),
                    ("back", depth_studs / 2.0 - 0.5),
                ):
                    for index_x in range(width_studs // 2):
                        centre_x = (
                            -width_studs / 2.0 + 1.0 + 2.0 * index_x
                        ) * pitch
                        placements.append(
                            PlacedPart(
                                instance_id=(
                                    f"layer-{layer:02d}-edge-{edge_name}-"
                                    f"x-{index_x:03d}"
                                ),
                                part_id="3004",
                                colour_code=layer_colour,
                                translation_ldu=(
                                    centre_x,
                                    layer_y,
                                    centre_z_studs * pitch,
                                ),
                                matrix=IDENTITY_MATRIX,
                            )
                        )

            else:
                # Shift the upper 2x4 grid by half a brick in X and half a
                # row in Z. The core bridges lower seams in both directions;
                # 1x2 elements close the one-stud perimeter strips.
                core_columns = width_studs // 4 - 1
                core_rows = depth_studs // 2 - 1
                for index_x in range(core_columns):
                    centre_x = (
                        -width_studs / 2.0 + 4.0 + 4.0 * index_x
                    ) * pitch
                    for index_z in range(core_rows):
                        centre_z = (
                            -depth_studs / 2.0 + 2.0 + 2.0 * index_z
                        ) * pitch
                        placements.append(
                            PlacedPart(
                                instance_id=(
                                    f"layer-{layer:02d}-core-x-{index_x:03d}-"
                                    f"z-{index_z:03d}"
                                ),
                                part_id=part_id,
                                colour_code=layer_colour,
                                translation_ldu=(centre_x, layer_y, centre_z),
                                matrix=IDENTITY_MATRIX,
                            )
                        )

                side_columns = (
                    ("left", -width_studs / 2.0 + 1.0),
                    ("right", width_studs / 2.0 - 1.0),
                )
                for edge_name, centre_x_studs in side_columns:
                    for index_z in range(depth_studs - 2):
                        centre_z = (
                            -depth_studs / 2.0 + 1.5 + index_z
                        ) * pitch
                        placements.append(
                            PlacedPart(
                                instance_id=(
                                    f"layer-{layer:02d}-edge-{edge_name}-"
                                    f"z-{index_z:03d}"
                                ),
                                part_id="3004",
                                colour_code=layer_colour,
                                translation_ldu=(
                                    centre_x_studs * pitch,
                                    layer_y,
                                    centre_z,
                                ),
                                matrix=IDENTITY_MATRIX,
                            )
                        )

                end_rows = (
                    ("front", -depth_studs / 2.0 + 0.5),
                    ("back", depth_studs / 2.0 - 0.5),
                )
                for edge_name, centre_z_studs in end_rows:
                    for index_x in range(width_studs // 2):
                        centre_x = (
                            -width_studs / 2.0 + 1.0 + 2.0 * index_x
                        ) * pitch
                        placements.append(
                            PlacedPart(
                                instance_id=(
                                    f"layer-{layer:02d}-edge-{edge_name}-"
                                    f"x-{index_x:03d}"
                                ),
                                part_id="3004",
                                colour_code=layer_colour,
                                translation_ldu=(
                                    centre_x,
                                    layer_y,
                                    centre_z_studs * pitch,
                                ),
                                matrix=IDENTITY_MATRIX,
                            )
                        )
            continue

        count_x = width_studs // tile_width
        count_z = depth_studs // tile_depth
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
                    layer_y,
                    centre_z,
                )
                placements.append(
                    PlacedPart(
                        instance_id=(
                            f"layer-{layer:02d}-x-{index_x:03d}-z-{index_z:03d}"
                        ),
                        part_id=part_id,
                        colour_code=layer_colour,
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
