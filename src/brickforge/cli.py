"""Command-line interface for local BrickForge mesh inspection."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Sequence

from brickforge.geometry import inspect_mesh


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="brickforge",
        description="Inspect source meshes before converting them into LEGO targets.",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    inspect = commands.add_parser("inspect", help="inspect an STL/OBJ mesh")
    inspect.add_argument("mesh", type=Path, help="path to the input mesh")
    inspect.add_argument(
        "--units", choices=("mm", "cm", "m"), required=True,
        help="physical units represented by the source coordinates",
    )
    inspect.add_argument(
        "--json", dest="json_path", type=Path,
        help="write the complete machine-readable report to this file",
    )
    inspect.add_argument(
        "--fail-on-review", action="store_true",
        help="return exit code 2 when the mesh needs review",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Run the BrickForge CLI and return a process exit code."""
    args = _parser().parse_args(argv)
    if args.command == "inspect":
        try:
            report = inspect_mesh(args.mesh, units=args.units)
        except (OSError, ValueError, TypeError) as exc:
            print(f"brickforge: {exc}", file=sys.stderr)
            return 1

        payload = json.dumps(report.to_dict(), indent=2, sort_keys=True)
        if args.json_path is not None:
            try:
                args.json_path.parent.mkdir(parents=True, exist_ok=True)
                args.json_path.write_text(payload + "\n", encoding="utf-8")
            except OSError as exc:
                print(f"brickforge: could not write report: {exc}", file=sys.stderr)
                return 1

        print(
            f"{report.validation_status}: {args.mesh} "
            f"({report.dimensions_mm[0]:.3f} × "
            f"{report.dimensions_mm[1]:.3f} × "
            f"{report.dimensions_mm[2]:.3f} mm)"
        )
        for warning in report.warnings:
            print(f"warning: {warning}")
        if args.json_path is None:
            print(payload)
        return 2 if args.fail_on_review and report.validation_status != "closed_solid_checks_passed" else 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
