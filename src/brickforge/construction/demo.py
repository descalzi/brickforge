"""Generate BrickForge's first interlocked rectangular block example."""

from __future__ import annotations

import argparse
from pathlib import Path

from brickforge.construction.rectangular import build_rectangular_block
from brickforge.parts.connections import load_connection_profiles


def build_interlocked_block_demo():
    """Build a two-course 4x4-stud block from four 2x4 bricks."""
    repository_root = Path(__file__).resolve().parents[3]
    catalogue = (
        repository_root
        / "data"
        / "connection-profiles"
        / "basic-bricks.json"
    )
    profiles = load_connection_profiles(catalogue)
    return build_rectangular_block(
        width_studs=4,
        depth_studs=4,
        height_bricks=2,
        profiles=profiles,
        part_id="3001",
        colour_codes=(4, 1),
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate BrickForge's interlocked 4x4x2 brick block."
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parents[3] / "examples",
        help="directory for the LDraw model, graph JSON and BOM JSON",
    )
    args = parser.parse_args()

    assembly = build_interlocked_block_demo()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    outputs = {
        "block-4x4x2.ldr": assembly.to_ldraw(),
        "block-4x4x2.assembly.json": assembly.to_json(),
        "block-4x4x2.bom.json": assembly.bom_json(),
    }
    for filename, content in outputs.items():
        path = args.output_dir / filename
        path.write_text(content, encoding="utf-8")
        print(f"Wrote {path}")
    print(
        f"Validated {len(assembly.parts)} parts, "
        f"{len(assembly.connections)} graph edge(s), "
        f"{assembly.total_mating_pairs} nominal mating pairs."
    )


if __name__ == "__main__":
    main()
