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
available_reference_parts = {"3001", "3002", "3003", "3004", "3009", "3010", "3622"}
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
    "reconstructed_placements": [
        {
            "part_id": part.part_id,
            "translation_ldu": list(part.translation_ldu),
            "matrix": list(part.matrix),
        }
        for part in reconstructed.parts
    ],
    "comparison_pitch_mm": 2.0,
    "source_dimensions_mm": source_dimensions.tolist(),
    "reconstructed_dimensions_mm": reconstructed_dimensions.tolist(),
    "absolute_dimension_error_mm": dimension_error.tolist(),
    "volume_iou_at_2mm_sampling": iou,
    "source_handle_count": source_handle_count,
    "reconstructed_handle_count": reconstructed_report.handle_count,
}, indent=2))

# This is a single-part calibration fixture, so retaining the authored part
# identity and inventory is the semantic acceptance criterion. Dimensional and
# volumetric metrics above remain diagnostics: voxelisation and legal LEGO
# substitutions can legitimately change the exact envelope and surface.
expected_single_part_bom = [
    {"part_id": "3001", "colour_code": 4, "quantity": 1}
]
actual_single_part_bom = reconstructed.bom_dict()["items"]
assert actual_single_part_bom == expected_single_part_bom, (
    "The single-3001 calibration model did not retain its authored LEGO part "
    f"identity/inventory: {actual_single_part_bom}"
)
assert reconstructed_report.handle_count == source_handle_count, (
    "The browser reconstruction did not preserve the authored model's required topology."
)


# Critical regression: the two-hole target must never be emitted as a
# connected-but-topologically-wrong rectangular assembly. Until a specialised
# hole-bearing part strategy exists, the browser must refuse this footprint.
TWO_HOLE_STL = ROOT / "docs" / "fixtures" / "block-two-hole-pattern.stl"
TWO_HOLE_REPORT = ARTIFACTS / "golden-two-hole-construction-report.json"
two_source_mesh = trimesh.load(TWO_HOLE_STL, force="mesh", process=True)
# The published fixture is centimetres and Z-up; Inspector scales to mm and rotates to Y-up.
two_source_mesh.apply_scale(10.0)
two_source_mesh.apply_transform(np.array([
    [1.0, 0.0, 0.0, 0.0],
    [0.0, 0.0, 1.0, 0.0],
    [0.0, -1.0, 0.0, 0.0],
    [0.0, 0.0, 0.0, 1.0],
]))
two_source_solid, two_source_report = solidify_surface_mesh(
    two_source_mesh, pitch_mm=2.0, expected_handle_count=2
)
if not TWO_HOLE_REPORT.exists():
    raise AssertionError("The Chromium Inspector did not write its two-hole construction report.")
two_report = json.loads(TWO_HOLE_REPORT.read_text(encoding="utf-8"))
assert two_source_report.handle_count == 2, (
    "The two-hole source reference did not retain its two expected through-openings."
)
assert two_report.get("expected_tunnels") == 2, "The Inspector report does not declare both required openings."
assert two_report.get("grid_dimensions") == [6, 2, 2], (
    "The two-hole source must map to its true 6 × 2 × 2 stud grid; "
    f"got {two_report.get('grid_dimensions')}."
)
assert two_report.get("outcome") == "blocked_without_generating_an_invalid_assembly", (
    "The browser must refuse this target until it can preserve both holes."
)
assert "No fully connected variable-course construction" in two_report.get("construction_status", ""), (
    "The Inspector did not explain why the two-hole construction was refused."
)
assert two_report.get("feature_details", "").count("Feature ") >= 2, (
    "The Inspector report must retain both detected opening features."
)
print(json.dumps({
    "golden_model": "two-through-hole",
    "source_dimensions_mm": two_source_solid.extents.tolist(),
    "source_handle_count": two_source_report.handle_count,
    "browser_grid_dimensions": two_report["grid_dimensions"],
    "browser_outcome": two_report["outcome"],
    "construction_status": two_report["construction_status"],
    "feature_details": two_report["feature_details"],
}, indent=2))
