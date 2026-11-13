"""Resolve LDraw type-1 references into transformed primitive geometry."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from brickforge.parts.ldraw_geometry import (
    ColourCode,
    LDrawDocument,
    LDrawPrimitive,
    LDrawSubfileReference,
    read_ldraw_document,
)

Matrix3 = tuple[float, float, float, float, float, float, float, float, float]
IDENTITY_MATRIX: Matrix3 = (1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)
ORIGIN = (0.0, 0.0, 0.0)


class LDrawResolutionError(ValueError):
    """Raised when a referenced file cannot be safely resolved or expanded."""


@dataclass(frozen=True, slots=True)
class ResolvedPrimitive:
    """A primitive transformed into the root part's coordinate system."""

    line_type: int
    colour_code: ColourCode
    edge_base_colour: ColourCode | None
    points: tuple[tuple[float, float, float], ...]
    source_file: str
    line_number: int


class LDrawLibrary:
    """Case-insensitive resolver and geometry expander for an LDraw library.

    The index supports the standard parts/, p/ and models/ roots. Geometry is
    flattened into the coordinate system of the requested root part, while
    preserving the special meaning of colour 24 for later palette lookup.
    """

    def __init__(self, library_root: str | Path) -> None:
        self.root = Path(library_root).resolve()
        if not self.root.is_dir():
            raise FileNotFoundError(f"LDraw library directory not found: {self.root}")

        self._root_index: dict[str, Path] = {}
        self._alias_index: dict[str, Path] = {}
        self._document_cache: dict[Path, LDrawDocument] = {}
        self._build_index()

    def resolve(
        self,
        filename: str | Path,
        *,
        referring_file: str | Path | None = None,
    ) -> Path:
        """Resolve a library filename, preferring the referring file's folder."""
        requested = str(filename).strip().replace("\\", "/")
        if not requested:
            raise LDrawResolutionError("empty LDraw reference filename")

        requested_path = PurePosixPath(requested)
        if requested_path.is_absolute():
            candidate = Path(requested).resolve(strict=False)
            return self._accept_existing(candidate, requested)

        if referring_file is not None:
            referring = Path(referring_file)
            if not referring.is_absolute():
                referring = self.root / referring
            referring = referring.resolve(strict=False)
            if not referring.is_relative_to(self.root):
                raise LDrawResolutionError(
                    f"referring file is outside the LDraw library: {referring}"
                )
            local_candidate = (referring.parent / Path(*requested_path.parts)).resolve(
                strict=False
            )
            local_key = self._root_key(local_candidate)
            if local_key in self._root_index:
                return self._root_index[local_key]
            if local_candidate.is_file():
                return self._accept_existing(local_candidate, requested)

        key = self._normalise_key(requested)
        if key in self._root_index:
            return self._root_index[key]
        if key in self._alias_index:
            return self._alias_index[key]

        raise LDrawResolutionError(
            f"could not resolve LDraw reference {requested!r} within {self.root}"
        )

    def resolve_part_geometry(
        self,
        part_filename: str | Path,
        *,
        colour_code: ColourCode = 16,
        max_depth: int = 64,
    ) -> tuple[ResolvedPrimitive, ...]:
        """Expand a part and all nested sub-files into transformed primitives.

        The 3x3 matrices follow the LDraw row-major point equations. Cyclic
        references and excessive nesting are rejected with a useful location.
        """
        if max_depth < 1:
            raise ValueError("max_depth must be at least 1")

        root_file = self.resolve(part_filename)
        resolved: list[ResolvedPrimitive] = []

        def walk(
            current_file: Path,
            matrix: Matrix3,
            translation: tuple[float, float, float],
            current_colour: ColourCode,
            ancestors: tuple[Path, ...],
            depth: int,
        ) -> None:
            if depth > max_depth:
                raise LDrawResolutionError(
                    f"maximum sub-file depth ({max_depth}) exceeded at {current_file}"
                )
            canonical_file = current_file.resolve()
            if canonical_file in ancestors:
                chain = " -> ".join(path.name for path in (*ancestors, canonical_file))
                raise LDrawResolutionError(f"cyclic LDraw references: {chain}")

            document = self._document_cache.get(canonical_file)
            if document is None:
                document = read_ldraw_document(canonical_file)
                self._document_cache[canonical_file] = document
            next_ancestors = (*ancestors, canonical_file)

            for record in document.records:
                if isinstance(record, LDrawSubfileReference):
                    if record.colour_code == 24:
                        raise LDrawResolutionError(
                            f"{canonical_file}:{record.line_number}: "
                            "type-1 references must not use colour 24"
                        )
                    child_file = self.resolve(
                        record.filename,
                        referring_file=canonical_file,
                    )
                    child_colour = (
                        current_colour if record.colour_code == 16 else record.colour_code
                    )
                    child_matrix = _multiply_matrices(matrix, record.matrix)
                    child_translation = _add_vectors(
                        _apply_matrix(matrix, record.position),
                        translation,
                    )
                    walk(
                        child_file,
                        child_matrix,
                        child_translation,
                        child_colour,
                        next_ancestors,
                        depth + 1,
                    )
                elif isinstance(record, LDrawPrimitive):
                    _append_primitive(
                        resolved,
                        record,
                        canonical_file,
                        matrix,
                        translation,
                        current_colour,
                    )

        walk(root_file, IDENTITY_MATRIX, ORIGIN, colour_code, (), 0)
        return tuple(resolved)

    def _build_index(self) -> None:
        for folder_name in ("parts", "p", "models"):
            base = self.root / folder_name
            if not base.is_dir():
                continue
            for path in sorted(base.rglob("*")):
                if not path.is_file() or path.suffix.casefold() not in {".dat", ".ldr", ".mpd"}:
                    continue
                canonical = path.resolve()
                if not canonical.is_relative_to(self.root):
                    continue
                root_key = self._root_key(canonical)
                alias_key = self._normalise_key(canonical.relative_to(base).as_posix())
                self._root_index.setdefault(root_key, canonical)
                self._alias_index.setdefault(alias_key, canonical)

    def _root_key(self, path: Path) -> str:
        try:
            relative = path.relative_to(self.root)
        except ValueError:
            return ""
        return self._normalise_key(relative.as_posix())

    @staticmethod
    def _normalise_key(value: str) -> str:
        return PurePosixPath(value.replace("\\", "/")).as_posix().casefold()

    def _accept_existing(self, candidate: Path, requested: str) -> Path:
        if not candidate.is_relative_to(self.root):
            raise LDrawResolutionError(
                f"LDraw reference {requested!r} resolves outside the LDraw library root"
            )
        if not candidate.is_file():
            raise LDrawResolutionError(
                f"LDraw reference {requested!r} does not exist inside {self.root}"
            )
        return candidate


def _append_primitive(
    output: list[ResolvedPrimitive],
    primitive: LDrawPrimitive,
    source_file: Path,
    matrix: Matrix3,
    translation: tuple[float, float, float],
    current_colour: ColourCode,
) -> None:
    if primitive.colour_code == 16:
        colour = current_colour
        edge_base_colour = None
    elif primitive.colour_code == 24:
        colour = 24
        edge_base_colour = current_colour
    else:
        colour = primitive.colour_code
        edge_base_colour = None

    transformed_points = tuple(
        _add_vectors(_apply_matrix(matrix, point), translation)
        for point in primitive.points
    )
    output.append(
        ResolvedPrimitive(
            line_type=primitive.line_type,
            colour_code=colour,
            edge_base_colour=edge_base_colour,
            points=transformed_points,
            source_file=source_file.as_posix(),
            line_number=primitive.line_number,
        )
    )


def _apply_matrix(matrix: Matrix3, vector: tuple[float, float, float]) -> tuple[float, float, float]:
    x, y, z = vector
    return (
        matrix[0] * x + matrix[1] * y + matrix[2] * z,
        matrix[3] * x + matrix[4] * y + matrix[5] * z,
        matrix[6] * x + matrix[7] * y + matrix[8] * z,
    )


def _multiply_matrices(left: Matrix3, right: Matrix3) -> Matrix3:
    return tuple(
        sum(left[row * 3 + index] * right[index * 3 + column] for index in range(3))
        for row in range(3)
        for column in range(3)
    )  # type: ignore[return-value]


def _add_vectors(
    left: tuple[float, float, float],
    right: tuple[float, float, float],
) -> tuple[float, float, float]:
    return (left[0] + right[0], left[1] + right[1], left[2] + right[2])
