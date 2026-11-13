"""Deterministic interlocking construction for connected 2D stud footprints.

This experimental strategy tiles each course with catalogue brick rectangles,
then alternates two tilings whose cross-course interface graph is connected.
It deliberately has bounded search limits; it does not claim to solve every
polyomino or arbitrary 3D shape.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from brickforge.assembly.model import Assembly, PlacedPart, build_assembly
from brickforge.parts.connections import (
    IDENTITY_MATRIX,
    ConnectionProfile,
    Matrix3,
)

ROTATE_Y_90: Matrix3 = (
    0.0, 0.0, 1.0,
    0.0, 1.0, 0.0,
    -1.0, 0.0, 0.0,
)

_TILE_PART_IDS = ("3001", "3003", "3004", "3005")
_MAX_FOOTPRINT_CELLS = 64
_MAX_SEARCH_NODES = 1_000_000
_MAX_TILINGS = 100_000
_MAX_PAIR_CHECKS = 5_000_000


@dataclass(frozen=True, slots=True)
class _Tile:
    part_id: str
    x: int
    z: int
    width: int
    depth: int
    rotated: bool
    cells: frozenset[tuple[int, int]]


def _connected_cells(cells: frozenset[tuple[int, int]]) -> bool:
    pending = [next(iter(cells))]
    visited = set(pending)
    while pending:
        x, z = pending.pop()
        for neighbour in ((x - 1, z), (x + 1, z), (x, z - 1), (x, z + 1)):
            if neighbour in cells and neighbour not in visited:
                visited.add(neighbour)
                pending.append(neighbour)
    return len(visited) == len(cells)


def _enumerate_tilings(
    cells: frozenset[tuple[int, int]],
    profiles: Mapping[str, ConnectionProfile],
) -> tuple[list[tuple[_Tile, ...]], bool]:
    candidates: list[_Tile] = []
    by_cell: dict[tuple[int, int], list[_Tile]] = {cell: [] for cell in cells}

    for x, z in sorted(cells, key=lambda cell: (cell[1], cell[0])):
        for part_id in _TILE_PART_IDS:
            profile = profiles.get(part_id)
            if profile is None:
                continue
            orientations = [(profile.footprint_studs_x, profile.footprint_studs_z, False)]
            if profile.footprint_studs_x != profile.footprint_studs_z:
                orientations.append((profile.footprint_studs_z, profile.footprint_studs_x, True))
            for width, depth, rotated in orientations:
                tile_cells = frozenset(
                    (x + dx, z + dz)
                    for dx in range(width)
                    for dz in range(depth)
                )
                if tile_cells <= cells:
                    tile = _Tile(
                        part_id, x, z, width, depth, rotated, tile_cells
                    )
                    candidates.append(tile)
                    for cell in tile_cells:
                        by_cell[cell].append(tile)

    def tile_priority(tile: _Tile) -> int:
        part_number = int(tile.part_id)
        return (
            (tile.x * 73_856_093)
            ^ (tile.z * 19_349_663)
            ^ (tile.width * 83_492_791)
            ^ (tile.depth * 2_654_435_761)
            ^ (part_number * 97_531)
        ) & 0xFFFFFFFF

    for options in by_cell.values():
        options.sort(
            key=lambda tile: (
                -(tile.width * tile.depth),
                tile_priority(tile),
                tile.part_id,
                tile.x,
                tile.z,
                tile.rotated,
            )
        )

    tilings: list[tuple[_Tile, ...]] = []
    nodes = 0
    limit_reached = False

    def search(
        remaining: frozenset[tuple[int, int]],
        chosen: list[_Tile],
    ) -> None:
        nonlocal nodes, limit_reached
        if not remaining:
            tilings.append(tuple(chosen))
            if len(tilings) > _MAX_TILINGS:
                tilings.pop()
                limit_reached = True
            return
        nodes += 1
        if nodes > _MAX_SEARCH_NODES or limit_reached:
            limit_reached = True
            return

        viable_by_cell = {
            cell: [
                tile for tile in by_cell[cell]
                if tile.cells <= remaining
            ]
            for cell in remaining
        }
        next_cell = min(
            remaining,
            key=lambda cell: (len(viable_by_cell[cell]), cell[1], cell[0]),
        )
        for tile in viable_by_cell[next_cell]:
            search(remaining - tile.cells, chosen + [tile])
            if limit_reached:
                return

    search(cells, [])
    tilings.sort(
        key=lambda tiling: (
            len(tiling),
            tuple(
                (tile.part_id, tile.x, tile.z, tile.rotated)
                for tile in tiling
            ),
        )
    )
    return tilings, limit_reached


def _tilings_connect(
    lower: tuple[_Tile, ...],
    upper: tuple[_Tile, ...],
) -> bool:
    count = len(lower) + len(upper)
    parent = list(range(count))

    def find(index: int) -> int:
        root = index
        while parent[root] != root:
            root = parent[root]
        while parent[index] != index:
            next_index = parent[index]
            parent[index] = root
            index = next_index
        return root

    def join(first: int, second: int) -> None:
        root_first = find(first)
        root_second = find(second)
        if root_first != root_second:
            parent[root_second] = root_first

    upper_owner = {
        cell: upper_index
        for upper_index, tile in enumerate(upper)
        for cell in tile.cells
    }
    for lower_index, tile in enumerate(lower):
        for cell in tile.cells:
            upper_index = upper_owner.get(cell)
            if upper_index is not None:
                join(lower_index, len(lower) + upper_index)

    root = find(0)
    return all(find(index) == root for index in range(1, count))


def _find_interlocking_tilings(
    tilings: Sequence[tuple[_Tile, ...]],
) -> tuple[tuple[_Tile, ...], tuple[_Tile, ...]] | None:
    checks = 0
    for lower in tilings:
        for upper in tilings:
            checks += 1
            if checks > _MAX_PAIR_CHECKS:
                return None
            if _tilings_connect(lower, upper):
                return lower, upper
    return None




def _sample_interlocking_tilings(
    cells: frozenset[tuple[int, int]],
    profiles: Mapping[str, ConnectionProfile],
) -> tuple[tuple[_Tile, ...], tuple[_Tile, ...]] | None:
    by_cell: dict[tuple[int, int], list[_Tile]] = {cell: [] for cell in cells}
    for x, z in sorted(cells, key=lambda cell: (cell[1], cell[0])):
        for part_id in _TILE_PART_IDS:
            profile = profiles.get(part_id)
            if profile is None:
                continue
            orientations = [(profile.footprint_studs_x, profile.footprint_studs_z, False)]
            if profile.footprint_studs_x != profile.footprint_studs_z:
                orientations.append((profile.footprint_studs_z, profile.footprint_studs_x, True))
            for width, depth, rotated in orientations:
                tile_cells = frozenset(
                    (x + dx, z + dz)
                    for dx in range(width)
                    for dz in range(depth)
                )
                if tile_cells <= cells:
                    tile = _Tile(part_id, x, z, width, depth, rotated, tile_cells)
                    for cell in tile_cells:
                        by_cell[cell].append(tile)

    def tile_priority(tile: _Tile) -> int:
        part_number = int(tile.part_id)
        return (
            (tile.x * 73_856_093)
            ^ (tile.z * 19_349_663)
            ^ (tile.width * 83_492_791)
            ^ (tile.depth * 2_654_435_761)
            ^ (part_number * 97_531)
        ) & 0xFFFFFFFF

    for options in by_cell.values():
        options.sort(
            key=lambda tile: (
                -(tile.width * tile.depth),
                tile_priority(tile),
                tile.part_id,
                tile.x,
                tile.z,
                tile.rotated,
            )
        )

    seed = 2_166_136_261
    for x, z in sorted(cells, key=lambda cell: (cell[1], cell[0])):
        seed = ((seed ^ x) * 16_777_619) & 0xFFFFFFFF
        seed = ((seed ^ z) * 16_777_619) & 0xFFFFFFFF
    if seed == 0:
        seed = 0x9E3779B9

    def next_random() -> int:
        nonlocal seed
        seed = (seed * 1_664_525 + 1_013_904_223) & 0xFFFFFFFF
        return seed

    sampled: list[tuple[_Tile, ...]] = []
    signatures: set[tuple[tuple[str, int, int, bool], ...]] = set()
    for _ in range(512):
        remaining = set(cells)
        chosen: list[_Tile] = []
        while remaining:
            viable_by_cell = {
                cell: [
                    tile for tile in by_cell[cell]
                    if tile.cells <= remaining
                ]
                for cell in remaining
            }
            next_cell = min(
                remaining,
                key=lambda cell: (len(viable_by_cell[cell]), cell[1], cell[0]),
            )
            options = viable_by_cell[next_cell]
            if not options:
                break
            tile = options[next_random() % len(options)]
            chosen.append(tile)
            remaining.difference_update(tile.cells)
        if remaining:
            continue

        tiling = tuple(chosen)
        signature = tuple(sorted(
            (tile.part_id, tile.x, tile.z, tile.rotated)
            for tile in tiling
        ))
        if signature in signatures:
            continue
        signatures.add(signature)
        for previous in sampled:
            if _tilings_connect(previous, tiling):
                return previous, tiling
        sampled.append(tiling)
    return None


def build_footprint_block(
    footprint_cells: Sequence[tuple[int, int]],
    height_bricks: int,
    profiles: Mapping[str, ConnectionProfile],
    *,
    colour_codes: Sequence[int] = (4, 1),
    position_tolerance_ldu: float = 0.25,
) -> Assembly:
    """Build an interlocked stack over a connected orthogonal stud footprint.

    Cells are integer (x, z) stud positions. Courses alternate between two
    exact-cover tilings so every part participates in one connected
    cross-course interface graph. Supported tiles are the 2x4, 2x2, 1x2 and
    1x1 brick profiles (IDs 3001, 3003, 3004 and 3005).

    The bounded exact-cover search is intended for small irregular footprints.
    It may reject a valid footprint when no supported tiling is found within
    its search budget. The canonical assembly validator remains authoritative.
    """
    if (
        isinstance(height_bricks, bool)
        or not isinstance(height_bricks, int)
        or height_bricks < 2
    ):
        raise ValueError("height_bricks must be an integer of at least two courses")
    if not footprint_cells:
        raise ValueError("footprint_cells must contain at least one stud position")

    cells_list: list[tuple[int, int]] = []
    for cell in footprint_cells:
        if (
            not isinstance(cell, (tuple, list))
            or len(cell) != 2
            or any(isinstance(value, bool) or not isinstance(value, int) for value in cell)
        ):
            raise ValueError("each footprint cell must be an integer (x, z) pair")
        cells_list.append((cell[0], cell[1]))
    if len(set(cells_list)) != len(cells_list):
        raise ValueError("footprint_cells must not contain duplicate positions")
    if len(cells_list) > _MAX_FOOTPRINT_CELLS:
        raise ValueError(f"footprints are limited to {_MAX_FOOTPRINT_CELLS} occupied cells")

    raw_cells = frozenset(cells_list)
    if not _connected_cells(raw_cells):
        raise ValueError("footprint_cells must form one orthogonally connected shape")

    if not colour_codes:
        raise ValueError("colour_codes must contain at least one LDraw colour code")
    if any(
        isinstance(code, bool) or not isinstance(code, int) or code < 0
        for code in colour_codes
    ):
        raise ValueError("colour codes must be non-negative integers")

    min_x = min(x for x, _ in raw_cells)
    min_z = min(z for _, z in raw_cells)
    cells = frozenset((x - min_x, z - min_z) for x, z in raw_cells)
    width = max(x for x, _ in cells) + 1
    depth = max(z for _, z in cells) + 1

    if "3001" not in profiles:
        raise ValueError("footprint construction requires the 2x4 brick profile 3001")

    for part_id in _TILE_PART_IDS:
        if part_id not in profiles:
            continue
        profile = profiles[part_id]
        if profile.stud_pitch_ldu != profiles["3001"].stud_pitch_ldu:
            raise ValueError("all footprint brick profiles must use the same stud pitch")
        if profile.body_height_ldu != profiles["3001"].body_height_ldu:
            raise ValueError("all footprint brick profiles must use the same brick height")

    if not any(part_id in profiles for part_id in _TILE_PART_IDS[1:]):
        raise ValueError("footprint construction requires at least one smaller brick profile")

    tilings, search_limited = _enumerate_tilings(cells, profiles)
    pair = _find_interlocking_tilings(tilings)
    if pair is None:
        if search_limited:
            detail = "within the bounded placement search"
        else:
            detail = "using the available rectangular brick profiles"
        raise ValueError(
            "no connected pair of interlocking course tilings was found "
            f"{detail}; try a different footprint or part catalogue"
        )

    lower_tiling, upper_tiling = pair
    pitch = profiles["3001"].stud_pitch_ldu
    body_height = profiles["3001"].body_height_ldu
    placements: list[PlacedPart] = []

    for layer in range(height_bricks):
        tiling = lower_tiling if layer % 2 == 0 else upper_tiling
        colour = colour_codes[layer % len(colour_codes)]
        layer_y = -layer * body_height
        for index, tile in enumerate(tiling):
            profile = profiles[tile.part_id]
            centre_x = (tile.x + tile.width / 2.0 - width / 2.0) * pitch
            centre_z = (tile.z + tile.depth / 2.0 - depth / 2.0) * pitch
            placements.append(
                PlacedPart(
                    instance_id=f"layer-{layer:02d}-part-{index:03d}",
                    part_id=tile.part_id,
                    colour_code=colour,
                    translation_ldu=(centre_x, layer_y, centre_z),
                    matrix=ROTATE_Y_90 if tile.rotated else IDENTITY_MATRIX,
                )
            )

    model_name = f"footprint-{width}x{depth}-{len(cells)}cells-x{height_bricks}"
    return build_assembly(
        placements,
        profiles,
        model_name=model_name,
        position_tolerance_ldu=position_tolerance_ldu,
    )
