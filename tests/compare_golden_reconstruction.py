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

source_mesh = trimesh.load(SOURCE_STL, force="mesh", process=True)
if not source_mesh.is_watertight:
    raise AssertionError("Authored golden STL is not watertight")
source_solid, source_report = solidify_surface_mesh(source_mesh, pitch_mm=2.0)
reconstructed_surface = assembly_to_mesh(reconstructed, LIBRARY)
reconstructed_solid, reconstructed_report = solidify_surface_mesh(
    reconstructed_surface, pitch_mm=2.0
)

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

source_handle_count = source_report.handle_count
print(json.dumps({
    "source_parts": 1,
    "reconstructed_parts": len(reconstructed.parts),
    "reconstructed_bom": reconstructed.bom_dict(),
    "comparison_pitch_mm": 2.0,
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


# Critical regression: the published two-hole target must remain a two-hole
# object after the browser's construction has been re-imported from its graph.
TWO_HOLE_GRAPH = ARTIFACTS / "golden-two-hole-reconstruction.assembly.json"
TWO_HOLE_STL = ROOT / "docs" / "fixtures" / "block-two-hole-pattern.stl"
two_graph = json.loads(TWO_HOLE_GRAPH.read_text(encoding="utf-8"))
two_placements = [
    PlacedPart(
        instance_id=item["instance_id"],
        part_id=item["part_id"],
        colour_code=item["colour_code"],
        translation_ldu=tuple(item["translation_ldu"]),
        matrix=tuple(item["matrix"]),
    )
    for item in two_graph["parts"]
]
two_reconstructed = build_assembly(
    two_placements, PROFILES, model_name="browser-reconstructed-two-hole"
)
two_source_mesh = trimesh.load(TWO_HOLE_STL, force="mesh", process=True)
# The published fixture is Z-up; Inspector rotates it to the canonical Y-up frame.
two_source_mesh.apply_transform(np.array([
    [1.0, 0.0, 0.0, 0.0],
    [0.0, 0.0, 1.0, 0.0],
    [0.0, -1.0, 0.0, 0.0],
    [0.0, 0.0, 0.0, 1.0],
]))
two_source_solid, two_source_report = solidify_surface_mesh(
    two_source_mesh, pitch_mm=2.0, expected_handle_count=2
)
two_reconstructed_surface = assembly_to_mesh(two_reconstructed, LIBRARY)
two_reconstructed_solid, two_reconstructed_report = solidify_surface_mesh(
    two_reconstructed_surface, pitch_mm=2.0
)
two_dimensions_error = np.abs(
    np.asarray(two_source_solid.extents) - np.asarray(two_reconstructed_solid.extents)
)
two_aligned = two_reconstructed_solid.copy()
two_aligned.apply_translation(two_source_solid.centroid - two_aligned.centroid)
two_lower = np.minimum(two_source_solid.bounds[0], two_aligned.bounds[0])
two_upper = np.maximum(two_source_solid.bounds[1], two_aligned.bounds[1])
two_axes = [np.arange(two_lower[i] + 0.5, two_upper[i], 2.0) for i in range(3)]
two_x, two_y, two_z = np.meshgrid(*two_axes, indexing="ij")
two_points = np.column_stack((two_x.ravel(), two_y.ravel(), two_z.ravel()))
two_source_inside = two_source_solid.contains(two_points)
two_reconstructed_inside = two_aligned.contains(two_points)
two_intersection = int(np.count_nonzero(two_source_inside & two_reconstructed_inside))
two_union = int(np.count_nonzero(two_source_inside | two_reconstructed_inside))
two_iou = two_intersection / two_union if two_union else 1.0
print(json.dumps({
    "golden_model": "two-through-hole",
    "reconstructed_parts": len(two_reconstructed.parts),
    "reconstructed_bom": two_reconstructed.bom_dict(),
    "source_dimensions_mm": two_source_solid.extents.tolist(),
    "reconstructed_dimensions_mm": two_reconstructed_solid.extents.tolist(),
    "absolute_dimension_error_mm": two_dimensions_error.tolist(),
    "volume_iou_at_2mm_sampling": two_iou,
    "source_handle_count": two_source_report.handle_count,
    "reconstructed_handle_count": two_reconstructed_report.handle_count,
}, indent=2))

assert two_source_report.handle_count == 2, (
    "The two-hole reference did not retain its two expected through-openings at 2 mm."
)
assert float(two_dimensions_error.max()) <= 8.0, (
    "Two-hole reconstruction dimensions diverge by more than one stud."
)
assert two_iou >= 0.5, (
    f"Two-hole reconstruction has insufficient volumetric fidelity (IoU={two_iou:.3f})."
)
assert two_reconstructed_report.handle_count == 2, (
    "The final LEGO construction did not preserve both through-openings; "
    f"expected 2, got {two_reconstructed_report.handle_count}."
)
