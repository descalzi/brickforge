"""Compare the browser-reconstructed assembly with its authored LEGO source."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import trimesh

from brickforge.assembly.model import PlacedPart, build_assembly
from brickforge.geometry import solidify_surface_mesh
from brickforge.parts.connections import load_connection_profiles
from brickforge.parts.ldraw_mesh import assembly_to_mesh
from brickforge.parts.ldraw_resolver import LDrawLibrary

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "tests" / "artifacts"
GRAPH_PATH = ARTIFACTS / "golden-single-3001-reconstruction.assembly.json"
SOURCE_STL = ARTIFACTS / "golden-single-3001-solid.stl"
LIBRARY = LDrawLibrary(ROOT / "tests" / "fixtures" / "ldraw" / "brick-3001")
PROFILES = load_connection_profiles(ROOT / "data" / "connection-profiles" / "basic-bricks.json")

graph = json.loads(GRAPH_PATH.read_text(encoding="utf-8"))
assert graph["schema_version"] == 1
assert graph["coordinate_system"] == "LDraw"
assert graph["length_unit"] == "LDU"
placements = [
    PlacedPart(
        instance_id=item["instance_id"],
        part_id=item["part_id"],
        colour_code=item["colour_code"],
        translation_ldu=tuple(item["translation_ldu"]),
        matrix=tuple(item["matrix"]),
    )
    for item in graph["parts"]
]
reconstructed = build_assembly(
    placements, PROFILES, model_name="browser-reconstructed-golden-3001"
)
available_reference_parts = {"3001", "3002", "3003", "3004", "3622"}
unsupported = sorted({part.part_id for part in reconstructed.parts} - available_reference_parts)
if unsupported:
    raise AssertionError(f"The golden fixture library lacks part geometry for: {unsupported}")

source = trimesh.load(SOURCE_STL, force="mesh", process=True)
reconstructed_surface = assembly_to_mesh(reconstructed, LIBRARY)
reconstructed_solid, reconstructed_report = solidify_surface_mesh(
    reconstructed_surface, pitch_mm=0.8
)
source_solid = source
if not source_solid.is_watertight:
    raise AssertionError("Authored golden STL is not watertight")

source_dimensions = np.asarray(source_solid.extents, dtype=np.float64)
reconstructed_dimensions = np.asarray(reconstructed_solid.extents, dtype=np.float64)
dimension_error = np.abs(source_dimensions - reconstructed_dimensions)

# Remove translation-only differences while preserving orientation and scale.
aligned = reconstructed_solid.copy()
aligned.apply_translation(source_solid.centroid - aligned.centroid)
lower = np.minimum(source_solid.bounds[0], aligned.bounds[0])
upper = np.maximum(source_solid.bounds[1], aligned.bounds[1])
axes = [np.arange(lower[i] + 0.5, upper[i], 2.0) for i in range(3)]
xx, yy, zz = np.meshgrid(*axes, indexing="ij")
points = np.column_stack((xx.ravel(), yy.ravel(), zz.ravel()))
source_inside = source_solid.contains(points)
reconstructed_inside = aligned.contains(points)
intersection = int(np.count_nonzero(source_inside & reconstructed_inside))
union = int(np.count_nonzero(source_inside | reconstructed_inside))
iou = intersection / union if union else 1.0

source_handle_count = int(
    json.loads(SOURCE_STL.with_suffix(".stl.json").read_text(encoding="utf-8"))
    ["solid_reference"]["handle_count"]
)
print(json.dumps({
    "source_parts": 1,
    "reconstructed_parts": len(reconstructed.parts),
    "reconstructed_bom": reconstructed.bom_dict(),
    "source_dimensions_mm": source_dimensions.tolist(),
    "reconstructed_dimensions_mm": reconstructed_dimensions.tolist(),
    "absolute_dimension_error_mm": dimension_error.tolist(),
    "volume_iou_at_2mm_sampling": iou,
    "source_handle_count": source_handle_count,
    "reconstructed_handle_count": reconstructed_report.handle_count,
}, indent=2))

assert float(dimension_error.max()) <= 8.0, (
    "Reconstruction dimensions diverge from the authored model by more than one stud."
)
assert iou >= 0.55, (
    f"Reconstructed geometry overlaps too little of the authored target (IoU={iou:.3f})."
)
assert reconstructed_report.handle_count == source_handle_count, (
    "The browser reconstruction did not preserve the authored model's topology."
)
