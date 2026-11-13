"""Generate the deterministic two-brick assembly proof of concept."""

from __future__ import annotations

import argparse
from pathlib import Path

from brickforge.assembly.model import Assembly, PlacedPart, build_assembly
from brickforge.parts.connections import load_connection_profiles


def build_stacked_brick_demo() -> Assembly:
    """Build two connected 2x4 bricks with contrasting LDraw colours."""
    repository_root = Path(__file__).resolve().parents[3]
    catalogue = (
        repository_root
        / "data"
        / "connection-profiles"
        / "basic-bricks.json"
    )
    profiles = load_connection_profiles(catalogue)
    return build_assembly(
        (
            PlacedPart(
                instance_id="lower-brick",
                part_id="3001",
                colour_code=4,
            ),
            PlacedPart(
                instance_id="upper-brick",
                part_id="3001",
                colour_code=1,
                translation_ldu=(0.0, -24.0, 0.0),
            ),
        ),
        profiles,
        model_name="stacked-3001",
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate BrickForge's two-brick assembly example."
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parents[3] / "examples",
        help="directory for the LDraw model, graph JSON and BOM JSON",
    )
    args = parser.parse_args()

    assembly = build_stacked_brick_demo()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    outputs = {
        "stacked-3001.ldr": assembly.to_ldraw(),
        "stacked-3001.assembly.json": assembly.to_json(),
        "stacked-3001.bom.json": assembly.bom_json(),
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
