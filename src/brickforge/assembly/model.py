"""Canonical assembly graph, nominal collision checks, and LDraw export."""

from __future__ import annotations

import json
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from itertools import product
from math import isclose, isfinite

from brickforge.parts.connections import (
    IDENTITY_MATRIX,
    ORIGIN,
    ConnectionProfile,
    MatingPair,
    Matrix3,
    Vector3,
    find_mating_pairs,
)

_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
_PART_ID = re.compile(r"^[A-Za-z0-9_-]+$")


class AssemblyError(ValueError):
    """Raised when a proposed assembly fails a deterministic validation check."""


@dataclass(frozen=True, slots=True)
class PlacedPart:
    """One real catalogue part placed in the assembly's LDraw world frame."""

    instance_id: str
    part_id: str
    colour_code: int
    translation_ldu: Vector3 = ORIGIN
    matrix: Matrix3 = IDENTITY_MATRIX

    def __post_init__(self) -> None:
        if not _IDENTIFIER.fullmatch(self.instance_id):
            raise ValueError("instance_id must be a simple, non-empty identifier")
        if not _PART_ID.fullmatch(self.part_id):
            raise ValueError("part_id must contain only letters, digits, '_' or '-'")
        if (
            isinstance(self.colour_code, bool)
            or not isinstance(self.colour_code, int)
            or self.colour_code < 0
        ):
            raise ValueError("colour_code must be a non-negative LDraw colour number")
        if len(self.translation_ldu) != 3 or not all(
            isfinite(value) for value in self.translation_ldu
        ):
            raise ValueError("translation_ldu must contain three finite numbers")
        if len(self.matrix) != 9 or not all(isfinite(value) for value in self.matrix):
            raise ValueError("matrix must contain nine finite numbers")
        _validate_rotation_matrix(self.matrix)


@dataclass(frozen=True, slots=True)
class AssemblyConnection:
    """A graph edge supported by one or more aligned nominal feature pairs."""

    instance_a: str
    instance_b: str
    mating_pairs: tuple[MatingPair, ...]


@dataclass(frozen=True, slots=True)
class BomItem:
    """An aggregated part-and-colour inventory line."""

    part_id: str
    colour_code: int
    quantity: int


@dataclass(frozen=True, slots=True)
class Assembly:
    """A connected, validated assembly graph and its canonical placed parts."""

    model_name: str
    parts: tuple[PlacedPart, ...]
    connections: tuple[AssemblyConnection, ...]

    @property
    def total_mating_pairs(self) -> int:
        """Return the number of matched nominal connector datum pairs."""
        return sum(len(connection.mating_pairs) for connection in self.connections)

    @property
    def bom(self) -> tuple[BomItem, ...]:
        """Return a deterministic BOM grouped by part identifier and colour."""
        quantities: dict[tuple[str, int], int] = {}
        for part in self.parts:
            key = (part.part_id, part.colour_code)
            quantities[key] = quantities.get(key, 0) + 1
        return tuple(
            BomItem(part_id, colour_code, quantity)
            for (part_id, colour_code), quantity in sorted(quantities.items())
        )

    def to_dict(self) -> dict[str, object]:
        """Serialise the graph using the version-1 JSON representation."""
        return {
            "schema_version": 1,
            "coordinate_system": "LDraw",
            "length_unit": "LDU",
            "model_name": self.model_name,
            "parts": [
                {
                    "instance_id": part.instance_id,
                    "part_id": part.part_id,
                    "colour_code": part.colour_code,
                    "translation_ldu": list(part.translation_ldu),
                    "matrix": list(part.matrix),
                }
                for part in self.parts
            ],
            "connections": [
                {
                    "instance_a": connection.instance_a,
                    "instance_b": connection.instance_b,
                    "mating_pairs": [
                        {
                            "feature_a": pair.feature_a,
                            "feature_b": pair.feature_b,
                            "position_error_ldu": pair.position_error_ldu,
                            "axis_dot": pair.axis_dot,
                        }
                        for pair in connection.mating_pairs
                    ],
                }
                for connection in self.connections
            ],
        }

    def to_json(self) -> str:
        """Return a stable, human-readable assembly graph JSON document."""
        return json.dumps(self.to_dict(), indent=2, sort_keys=True) + "\n"

    def bom_dict(self) -> dict[str, object]:
        """Serialise the bill of materials derived from this assembly graph."""
        return {
            "schema_version": 1,
            "model_name": self.model_name,
            "total_parts": len(self.parts),
            "items": [
                {
                    "part_id": item.part_id,
                    "colour_code": item.colour_code,
                    "quantity": item.quantity,
                }
                for item in self.bom
            ],
        }

    def bom_json(self) -> str:
        """Return a stable, human-readable BOM JSON document."""
        return json.dumps(self.bom_dict(), indent=2, sort_keys=True) + "\n"

    def to_ldraw(self) -> str:
        """Export this exact graph as a single-file LDraw model."""
        lines = [
            f"0 {self.model_name}",
            f"0 Name: {self.model_name}.ldr",
            "0 Author: BrickForge",
            "0 // Part placements use the canonical assembly graph transforms.",
        ]
        for part in self.parts:
            values = (
                part.translation_ldu
                + part.matrix
            )
            numbers = " ".join(_format_number(value) for value in values)
            lines.append(f"1 {part.colour_code} {numbers} {part.part_id}.dat")
        return "\n".join(lines) + "\n"


def build_assembly(
    placements: Iterable[PlacedPart],
    profiles: Mapping[str, ConnectionProfile],
    *,
    model_name: str = "BrickForge model",
    position_tolerance_ldu: float = 0.25,
    collision_tolerance_ldu: float = 1e-6,
) -> Assembly:
    """Validate placements and derive a connected graph from nominal interfaces.

    The body collision check uses transformed axis-aligned bounding envelopes
    based on each connection profile's nominal footprint and body height. It
    is conservative for rotated parts and is not a detailed mesh collision
    test. Connector matches are candidate geometric alignments only.
    """
    parts = tuple(placements)
    if not parts:
        raise AssemblyError("an assembly must contain at least one placed part")
    if not isinstance(model_name, str) or not model_name.strip() or any(
        character in model_name for character in "\r\n"
    ):
        raise AssemblyError("model_name must be a non-empty single-line string")
    if not isfinite(position_tolerance_ldu) or position_tolerance_ldu < 0:
        raise AssemblyError("position_tolerance_ldu must be finite and non-negative")
    if not isfinite(collision_tolerance_ldu) or collision_tolerance_ldu < 0:
        raise AssemblyError("collision_tolerance_ldu must be finite and non-negative")

    instance_ids = [part.instance_id for part in parts]
    if len(set(instance_ids)) != len(instance_ids):
        raise AssemblyError("instance_id values must be unique")

    missing_profiles = sorted({part.part_id for part in parts} - set(profiles))
    if missing_profiles:
        raise AssemblyError(
            "no connection profile is available for part(s): "
            + ", ".join(missing_profiles)
        )

    bounds = {
        part.instance_id: _body_bounds(part, profiles[part.part_id])
        for part in parts
    }
    for index, part_a in enumerate(parts):
        for part_b in parts[index + 1 :]:
            if _bounds_overlap_in_volume(
                bounds[part_a.instance_id],
                bounds[part_b.instance_id],
                collision_tolerance_ldu,
            ):
                raise AssemblyError(
                    f"nominal body bounds overlap for {part_a.instance_id!r} "
                    f"and {part_b.instance_id!r}"
                )

    connections: list[AssemblyConnection] = []
    for index, part_a in enumerate(parts):
        profile_a = profiles[part_a.part_id]
        for part_b in parts[index + 1 :]:
            matches = find_mating_pairs(
                profile_a,
                profiles[part_b.part_id],
                matrix_a=part_a.matrix,
                translation_a=part_a.translation_ldu,
                matrix_b=part_b.matrix,
                translation_b=part_b.translation_ldu,
                position_tolerance_ldu=position_tolerance_ldu,
            )
            if matches:
                connections.append(
                    AssemblyConnection(
                        instance_a=part_a.instance_id,
                        instance_b=part_b.instance_id,
                        mating_pairs=matches,
                    )
                )

    _validate_graph_connectivity(instance_ids, connections)
    return Assembly(
        model_name=model_name.strip(),
        parts=parts,
        connections=tuple(connections),
    )


def _validate_rotation_matrix(matrix: Matrix3) -> None:
    rows = (
        matrix[0:3],
        matrix[3:6],
        matrix[6:9],
    )
    for row_index, row_a in enumerate(rows):
        for column_index, row_b in enumerate(rows):
            dot = sum(row_a[index] * row_b[index] for index in range(3))
            expected = 1.0 if row_index == column_index else 0.0
            if not isclose(dot, expected, abs_tol=1e-6):
                raise ValueError("matrix must be an orthonormal LDraw rotation")
    determinant = (
        matrix[0] * (matrix[4] * matrix[8] - matrix[5] * matrix[7])
        - matrix[1] * (matrix[3] * matrix[8] - matrix[5] * matrix[6])
        + matrix[2] * (matrix[3] * matrix[7] - matrix[4] * matrix[6])
    )
    if not isclose(abs(determinant), 1.0, abs_tol=1e-6):
        raise ValueError("matrix determinant must have an absolute value of one")


def _body_bounds(
    part: PlacedPart, profile: ConnectionProfile
) -> tuple[Vector3, Vector3]:
    half_x = profile.footprint_studs_x * profile.stud_pitch_ldu / 2.0
    half_z = profile.footprint_studs_z * profile.stud_pitch_ldu / 2.0
    local_corners = product(
        (-half_x, half_x),
        (0.0, profile.body_height_ldu),
        (-half_z, half_z),
    )
    world_corners = tuple(
        _transform_point(
            (x, y, z),
            part.matrix,
            part.translation_ldu,
        )
        for x, y, z in local_corners
    )
    minimum: Vector3 = tuple(
        min(point[axis] for point in world_corners) for axis in range(3)
    )  # type: ignore[assignment]
    maximum: Vector3 = tuple(
        max(point[axis] for point in world_corners) for axis in range(3)
    )  # type: ignore[assignment]
    return minimum, maximum


def _transform_point(point: Vector3, matrix: Matrix3, translation: Vector3) -> Vector3:
    x, y, z = point
    return (
        matrix[0] * x + matrix[1] * y + matrix[2] * z + translation[0],
        matrix[3] * x + matrix[4] * y + matrix[5] * z + translation[1],
        matrix[6] * x + matrix[7] * y + matrix[8] * z + translation[2],
    )


def _bounds_overlap_in_volume(
    bounds_a: tuple[Vector3, Vector3],
    bounds_b: tuple[Vector3, Vector3],
    tolerance: float,
) -> bool:
    minimum_a, maximum_a = bounds_a
    minimum_b, maximum_b = bounds_b
    overlaps = tuple(
        min(maximum_a[axis], maximum_b[axis])
        - max(minimum_a[axis], minimum_b[axis])
        for axis in range(3)
    )
    return all(overlap > tolerance for overlap in overlaps)


def _validate_graph_connectivity(
    instance_ids: list[str],
    connections: list[AssemblyConnection],
) -> None:
    adjacency: dict[str, set[str]] = {
        instance_id: set() for instance_id in instance_ids
    }
    for connection in connections:
        adjacency[connection.instance_a].add(connection.instance_b)
        adjacency[connection.instance_b].add(connection.instance_a)

    visited = {instance_ids[0]}
    pending = [instance_ids[0]]
    while pending:
        current = pending.pop()
        for neighbour in adjacency[current]:
            if neighbour not in visited:
                visited.add(neighbour)
                pending.append(neighbour)

    if len(visited) != len(instance_ids):
        disconnected = sorted(set(instance_ids) - visited)
        raise AssemblyError(
            "assembly contains disconnected part instance(s): "
            + ", ".join(disconnected)
        )


def _format_number(value: float) -> str:
    if abs(value) < 1e-12:
        return "0"
    return format(value, ".12g")
