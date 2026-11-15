"""Generate a real authored LDraw brick as a solid STL for browser E2E tests."""
from __future__ import annotations

from pathlib import Path

from brickforge.assembly.model import PlacedPart, build_assembly
from brickforge.geometry import export_assembly_solid_reference_stl
from brickforge.parts.connections import load_connection_profiles
from brickforge.parts.ldraw_resolver import LDrawLibrary

ROOT = Path(__file__).resolve().parents[1]
PROFILES = load_connection_profiles(ROOT / "data" / "connection-profiles" / "basic-bricks.json")
LIBRARY = LDrawLibrary(ROOT / "tests" / "fixtures" / "ldraw" / "brick-3001")
ASSEMBLY = build_assembly(
    [PlacedPart("reference-brick", "3001", 4)],
    PROFILES,
    model_name="golden-single-3001",
)
DESTINATION = ROOT / "tests" / "artifacts" / "golden-single-3001-solid.stl"
manifest = export_assembly_solid_reference_stl(
    ASSEMBLY, LIBRARY, DESTINATION, pitch_mm=0.5
)
print(
    f"Generated {DESTINATION} ({manifest['solid_reference']['occupied_voxels']} "
    "solid-reference voxels)"
)
