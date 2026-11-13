#!/usr/bin/env python3
"""Audit recursive geometry resolution across every top-level LDraw part."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

from brickforge.parts.ldraw_resolver import LDrawLibrary


def locate_library_root(library: Path) -> Path:
    """Accept either the extracted archive root or its nested ldraw/ directory."""
    root = library.resolve()
    if (root / "parts").is_dir():
        return root
    nested = root / "ldraw"
    if (nested / "parts").is_dir():
        return nested
    raise FileNotFoundError(f"LDraw parts directory not found under: {library}")


def audit_library(library: Path, *, max_parts: int | None = None) -> dict[str, Any]:
    """Resolve every selected top-level part and collect a machine-readable report."""
    root = locate_library_root(library)
    part_paths = sorted(
        (path for path in (root / "parts").glob("*.dat") if path.is_file()),
        key=lambda path: path.name.casefold(),
    )
    if max_parts is not None:
        if max_parts < 1:
            raise ValueError("max_parts must be at least 1")
        part_paths = part_paths[:max_parts]

    resolver = LDrawLibrary(root)
    resolved_count = 0
    failed_count = 0
    primitive_count = 0
    source_files: set[str] = set()
    failures: list[dict[str, str]] = []
    error_types: Counter[str] = Counter()

    for part_path in part_paths:
        relative_path = part_path.relative_to(root).as_posix()
        try:
            geometry = resolver.resolve_part_geometry(relative_path)
        except Exception as error:  # Keep auditing after a malformed or missing dependency.
            failed_count += 1
            error_types[type(error).__name__] += 1
            failures.append(
                {
                    "part_id": part_path.stem,
                    "filename": relative_path,
                    "error_type": type(error).__name__,
                    "message": str(error),
                    "dependency_chain": list(
                        getattr(error, "dependency_chain", ())
                    ),
                }
            )
            continue

        resolved_count += 1
        primitive_count += len(geometry)
        source_files.update(item.source_file for item in geometry)

    return {
        "schema_version": 1,
        "library_root": root.as_posix(),
        "parts_scanned": len(part_paths),
        "parts_resolved": resolved_count,
        "parts_failed": failed_count,
        "resolution_rate": (
            resolved_count / len(part_paths) if part_paths else 0.0
        ),
        "expanded_primitive_records": primitive_count,
        "unique_source_files_expanded": len(source_files),
        "error_types": dict(sorted(error_types.items())),
        "failures": failures,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--library",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "vendor" / "ldraw",
        help="Extracted official LDraw library root",
    )
    parser.add_argument(
        "--max-parts",
        type=int,
        help="Audit only the first N top-level parts (useful for smoke tests)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("ldraw-validation-report.json"),
        help="Write the complete machine-readable report to this path",
    )
    parser.add_argument(
        "--fail-on-errors",
        action="store_true",
        help="Return a non-zero exit code if any part fails to resolve",
    )
    args = parser.parse_args()

    report = audit_library(args.library, max_parts=args.max_parts)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    print(
        "LDraw geometry audit: "
        f"{report['parts_resolved']:,}/{report['parts_scanned']:,} parts resolved; "
        f"{report['parts_failed']:,} failed; "
        f"{report['expanded_primitive_records']:,} primitive records expanded."
    )
    for failure in report["failures"][:20]:
        print(
            f"FAILED {failure['filename']}: "
            f"{failure['error_type']}: {failure['message']}"
        )
    if len(report["failures"]) > 20:
        print(f"... and {len(report['failures']) - 20:,} additional failures; see JSON report.")

    return 1 if args.fail_on_errors and report["parts_failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
