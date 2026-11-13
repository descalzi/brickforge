"""BrickForge-owned nominal connection metadata for standard LDraw parts.

These features describe candidate stud-grid interfaces. They are deliberately
not a claim about clutch force, friction, legal combinations, or stability.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from enum import StrEnum
from math import isclose, isfinite, sqrt
from pathlib import Path
from typing import TypeAlias

Vector3: TypeAlias = tuple[float, float, float]
Matrix3: TypeAlias = tuple[
    float, float, float, float, float, float, float, float, float
]

IDENTITY_MATRIX: Matrix3 = (
    1.0, 0.0, 0.0,
    0.0, 1.0, 0.0,
    0.0, 0.0, 1.0,
)
ORIGIN: Vector3 = (0.0, 0.0, 0.0)


class ConnectorKind(StrEnum):
    """Supported nominal mating feature types."""

    STUD = "stud"
    STUD_RECEIVER = "stud_receiver"


@dataclass(frozen=True, slots=True)
class ConnectionFeature:
    """A nominal connector datum in one part's local LDraw coordinate frame."""

    feature_id: str
    kind: ConnectorKind
    position_ldu: Vector3
    axis: Vector3

    @property
    def mate_kind(self) -> ConnectorKind:
        """Return the connector kind this feature is intended to mate with."""
        if self.kind is ConnectorKind.STUD:
            return ConnectorKind.STUD_RECEIVER
        return ConnectorKind.STUD


@dataclass(frozen=True, slots=True)
class ConnectionProfile:
    """BrickForge-authored nominal stud-grid metadata for one part."""

    part_id: str
    description: str
    source_filename: str
    source_author: str
    source_license_notice: str
    footprint_studs_x: int
    footprint_studs_z: int
    body_height_ldu: float
    stud_pitch_ldu: float
    stud_projection_ldu: float
    features: tuple[ConnectionFeature, ...]
    limitations: tuple[str, ...]

    @property
    def studs(self) -> tuple[ConnectionFeature, ...]:
        return tuple(feature for feature in self.features if feature.kind is ConnectorKind.STUD)

    @property
    def receivers(self) -> tuple[ConnectionFeature, ...]:
        return tuple(
            feature for feature in self.features
            if feature.kind is ConnectorKind.STUD_RECEIVER
        )


@dataclass(frozen=True, slots=True)
class MatingPair:
    """Two connector datums that align under the supplied rigid transforms."""

    feature_a: str
    feature_b: str
    position_error_ldu: float
    axis_dot: float


def load_connection_profiles(path: str | Path) -> dict[str, ConnectionProfile]:
    """Load and validate a version-1 BrickForge connection-profile catalogue."""
    source = Path(path)
    payload = json.loads(source.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("schema_version") != 1:
        raise ValueError(f"{source}: unsupported connection catalogue schema_version")

    raw_profiles = payload.get("profiles")
    if not isinstance(raw_profiles, list):
        raise ValueError(f"{source}: profiles must be a list")

    profiles: dict[str, ConnectionProfile] = {}
    for index, raw in enumerate(raw_profiles):
        if not isinstance(raw, dict):
            raise ValueError(f"{source}: profile {index} must be an object")
        profile = _parse_profile(raw, source, index)
        if profile.part_id in profiles:
            raise ValueError(f"{source}: duplicate part_id {profile.part_id!r}")
        profiles[profile.part_id] = profile
    return profiles


def find_mating_pairs(
    profile_a: ConnectionProfile,
    profile_b: ConnectionProfile,
    *,
    matrix_a: Matrix3 = IDENTITY_MATRIX,
    translation_a: Vector3 = ORIGIN,
    matrix_b: Matrix3 = IDENTITY_MATRIX,
    translation_b: Vector3 = ORIGIN,
    position_tolerance_ldu: float = 0.25,
    axis_dot_tolerance: float = 1e-6,
) -> tuple[MatingPair, ...]:
    """Find one-to-one stud/receiver datum matches after rigid transforms.

    A match requires opposite connector kinds, coincident datum positions
    within the supplied LDU tolerance, and opposing axes. This is a geometric
    alignment test only; it does not prove clutch engagement or stability.
    """
    if not isfinite(position_tolerance_ldu) or position_tolerance_ldu < 0:
        raise ValueError("position_tolerance_ldu must be finite and non-negative")
    if not isfinite(axis_dot_tolerance) or not 0 <= axis_dot_tolerance < 1:
        raise ValueError("axis_dot_tolerance must be in the range [0, 1)")

    candidates: list[tuple[float, float, ConnectionFeature, ConnectionFeature]] = []
    for feature_a in profile_a.features:
        for feature_b in profile_b.features:
            if feature_a.mate_kind is not feature_b.kind:
                continue
            position_a = _transform_point(feature_a.position_ldu, matrix_a, translation_a)
            position_b = _transform_point(feature_b.position_ldu, matrix_b, translation_b)
            error = _distance(position_a, position_b)
            if error > position_tolerance_ldu:
                continue

            axis_a = _normalise(_apply_matrix(matrix_a, feature_a.axis))
            axis_b = _normalise(_apply_matrix(matrix_b, feature_b.axis))
            axis_dot = sum(axis_a[i] * axis_b[i] for i in range(3))
            if axis_dot > -1.0 + axis_dot_tolerance:
                continue
            candidates.append((error, axis_dot, feature_a, feature_b))

    # Greedy nearest-neighbour assignment prevents reusing one receiver for
    # several studs when placements have small numerical offsets.
    candidates.sort(key=lambda item: (item[0], item[2].feature_id, item[3].feature_id))
    used_a: set[str] = set()
    used_b: set[str] = set()
    matches: list[MatingPair] = []
    for error, axis_dot, feature_a, feature_b in candidates:
        if feature_a.feature_id in used_a or feature_b.feature_id in used_b:
            continue
        used_a.add(feature_a.feature_id)
        used_b.add(feature_b.feature_id)
        matches.append(
            MatingPair(
                feature_a=feature_a.feature_id,
                feature_b=feature_b.feature_id,
                position_error_ldu=error,
                axis_dot=axis_dot,
            )
        )
    return tuple(matches)


def _parse_profile(raw: dict[str, object], source: Path, index: int) -> ConnectionProfile:
    prefix = f"{source}: profile {index}"
    part_id = _required_string(raw, "part_id", prefix)
    description = _required_string(raw, "description", prefix)
    source_filename = _required_string(raw, "source_filename", prefix)
    source_author = _required_string(raw, "source_author", prefix)
    source_license_notice = _required_string(raw, "source_license_notice", prefix)

    footprint_x = _positive_integer(raw, "footprint_studs_x", prefix)
    footprint_z = _positive_integer(raw, "footprint_studs_z", prefix)
    body_height = _positive_number(raw, "body_height_ldu", prefix)
    pitch = _positive_number(raw, "stud_pitch_ldu", prefix)
    projection = _positive_number(raw, "stud_projection_ldu", prefix)

    raw_features = raw.get("features")
    if not isinstance(raw_features, list) or not raw_features:
        raise ValueError(f"{prefix}: features must be a non-empty list")

    features: list[ConnectionFeature] = []
    seen_ids: set[str] = set()
    for feature_index, item in enumerate(raw_features):
        feature_prefix = f"{prefix}: feature {feature_index}"
        if not isinstance(item, dict):
            raise ValueError(f"{feature_prefix} must be an object")
        feature_id = _required_string(item, "feature_id", feature_prefix)
        if feature_id in seen_ids:
            raise ValueError(f"{feature_prefix}: duplicate feature_id {feature_id!r}")
        seen_ids.add(feature_id)

        try:
            kind = ConnectorKind(_required_string(item, "kind", feature_prefix))
        except ValueError:
            raise ValueError(f"{feature_prefix}: unsupported connector kind") from None

        position = _vector(item.get("position_ldu"), f"{feature_prefix}.position_ldu")
        axis = _normalise(_vector(item.get("axis"), f"{feature_prefix}.axis"))
        expected_axis = (0.0, -1.0, 0.0) if kind is ConnectorKind.STUD else (0.0, 1.0, 0.0)
        if not all(isclose(axis[i], expected_axis[i], abs_tol=1e-6) for i in range(3)):
            raise ValueError(f"{feature_prefix}: axis does not match its connector kind")
        features.append(
            ConnectionFeature(
                feature_id=feature_id,
                kind=kind,
                position_ldu=position,
                axis=axis,
            )
        )

    studs = [feature for feature in features if feature.kind is ConnectorKind.STUD]
    receivers = [
        feature for feature in features
        if feature.kind is ConnectorKind.STUD_RECEIVER
    ]
    expected_count = footprint_x * footprint_z
    if len(studs) != expected_count or len(receivers) != expected_count:
        raise ValueError(
            f"{prefix}: expected {expected_count} studs and receivers "
            f"for a {footprint_x}x{footprint_z} grid"
        )

    limits = raw.get("limitations", [])
    if not isinstance(limits, list) or not all(isinstance(value, str) for value in limits):
        raise ValueError(f"{prefix}: limitations must be a list of strings")

    return ConnectionProfile(
        part_id=part_id,
        description=description,
        source_filename=source_filename,
        source_author=source_author,
        source_license_notice=source_license_notice,
        footprint_studs_x=footprint_x,
        footprint_studs_z=footprint_z,
        body_height_ldu=body_height,
        stud_pitch_ldu=pitch,
        stud_projection_ldu=projection,
        features=tuple(features),
        limitations=tuple(limits),
    )


def _required_string(raw: dict[str, object], key: str, prefix: str) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{prefix}: {key} must be a non-empty string")
    return value.strip()


def _positive_integer(raw: dict[str, object], key: str, prefix: str) -> int:
    value = raw.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{prefix}: {key} must be a positive integer")
    return value


def _positive_number(raw: dict[str, object], key: str, prefix: str) -> float:
    value = raw.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{prefix}: {key} must be a positive number")
    number = float(value)
    if not isfinite(number) or number <= 0:
        raise ValueError(f"{prefix}: {key} must be a positive finite number")
    return number


def _vector(value: object, name: str) -> Vector3:
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError(f"{name} must be a three-number array")
    if any(isinstance(item, bool) or not isinstance(item, (int, float)) for item in value):
        raise ValueError(f"{name} must contain only numbers")
    vector = (float(value[0]), float(value[1]), float(value[2]))
    if not all(isfinite(item) for item in vector):
        raise ValueError(f"{name} must contain only finite numbers")
    return vector


def _normalise(vector: Vector3) -> Vector3:
    length = sqrt(sum(component * component for component in vector))
    if length <= 1e-12:
        raise ValueError("connector axis cannot be a zero vector")
    return tuple(component / length for component in vector)  # type: ignore[return-value]


def _apply_matrix(matrix: Matrix3, vector: Vector3) -> Vector3:
    x, y, z = vector
    return (
        matrix[0] * x + matrix[1] * y + matrix[2] * z,
        matrix[3] * x + matrix[4] * y + matrix[5] * z,
        matrix[6] * x + matrix[7] * y + matrix[8] * z,
    )


def _transform_point(point: Vector3, matrix: Matrix3, translation: Vector3) -> Vector3:
    transformed = _apply_matrix(matrix, point)
    return (
        transformed[0] + translation[0],
        transformed[1] + translation[1],
        transformed[2] + translation[2],
    )


def _distance(left: Vector3, right: Vector3) -> float:
    return sqrt(sum((left[index] - right[index]) ** 2 for index in range(3)))
