# Measured part feature profiles

The Part Explorer can analyse the resolved triangle geometry of a selected LDraw part and export a versioned JSON profile. It can also scan up to 12 new results per search phrase, accumulate up to 48 unique part profiles across multiple searches, and export them as one catalogue. Previously scanned part IDs are skipped until the user clears the combined catalogue. This is separate from the nominal connection-profile catalogue: it records measured geometric openings, not physical connection behaviour.

## Extraction

The browser resolves the selected part and its nested LDraw references, converts geometry into millimetres, then sends its triangle positions to a dedicated worker. The worker samples nineteen cross-sections along each principal axis, finds nested contours, and clusters contours that persist across slices.

Version 2 profiles preserve both representative measurements and per-slice minimum/maximum dimensions, so tapered and countersunk openings are not reduced to a single average. Version 3 adds optional lightweight triangle positions in millimetres for profiles with at most 4,000 triangles; larger profiles remain valid without preview geometry. Versions 1 and 2 remain importable for backward compatibility.

Each detected feature records:

- Local axis and centre position in millimetres.
- Approximate bounds and observed span through the part.
- Representative cross-section width, length, area and perimeter, plus their observed minimum/maximum ranges.
- Representative equivalent circular diameter and its minimum/maximum range, circularity and aspect ratio.
- Number of supporting slices and a coarse confidence label.

Version 2 exports are validated against `schemas/part-feature-profile-v2.schema.json`; version 3 exports are validated against `schemas/part-feature-profile-v3.schema.json`.

## Interpretation and limitations

These profiles are geometry measurements, not connection instructions. A circular opening does not by itself tell us whether a pin, axle, shaft or other part fits; nominal tolerances, surrounding material, wall thickness, part orientation, assembly access and physical clutch behaviour remain separate concerns.

The current analyser uses principal-axis sections only. It may miss or approximate oblique, curved, branching and blind openings, and it does not infer topology for the LDraw part. A missing profile is not proof that a part has no openings.

## Initial candidate matching

The browser Inspector can import one or more exported profiles or a combined catalogue and compare their measured opening features with the target mesh. The matcher uses shape, per-slice equivalent-diameter or width/length ranges, circularity and aspect ratio with explicit dimensional tolerances. It ranks candidates per target feature and records the candidate part's local opening axis. A second bounded search assigns distinct candidate openings to every target opening and compares pairwise centre distances and relative axis relationships, making the pattern comparison invariant to rigid translation and rotation. For non-collinear feature centres, the matcher now derives a rigid rotation matrix and translation vector, then reports centre residual and opening-axis alignment. Collinear layouts are explicitly marked underdetermined. The transform is accepted only when centre RMS residual is at most the larger of 1.5 mm or 5% of the target feature span, and opening-axis alignment RMS is at most 5 degrees. Collinear layouts, high-residual fits and axis-incompatible layouts remain unresolved. The Inspector also transforms the candidate part's eight bounding-box corners and reports whether that AABB remains within the target mesh AABB (with a 2 mm tolerance). This is only a coarse necessary-condition check. When lightweight geometry is included, the Inspector can display the candidate mesh after applying the estimated rigid transform and subtracting the target model centre. The user can now request a bidirectional sampled surface-alignment score: candidate triangle vertices and centroids are compared with the nearest target triangle, and target samples are also compared back to the candidate surface using spatial hashes. Both directional coverages are reported alongside symmetric mean/RMS/95th-percentile distance and a combined score. This is a discrete approximation, not an exact Hausdorff distance. A seven-position local translation refinement can test ±1 mm along each axis around the opening-derived placement and reset to the original opening alignment. This is a one-way candidate-surface-to-target-surface proximity measure; refinement can reduce opening alignment and does not assess reverse coverage, containment, collision, connection interfaces or physical buildability.

## Next step

Build a curated set of source-verified profiles for useful specialised parts, then improve matching with one-to-one feature assignment, explicit rotations, surrounding-envelope checks and verified connection interfaces. A match must remain a geometric candidate until its placement and buildability have been independently validated.


## Mesh input diagnostics

The Python geometry inspection report now records watertightness, winding consistency, positive-volume status, connected-component count, Euler characteristic, degenerate and duplicate face counts, and a machine-readable validation status. Open/non-manifold geometry, duplicate or degenerate faces, and disconnected shells are called out explicitly. This is an ingestion diagnostic, not a self-intersection test: the report always states that triangle self-intersections are not assessed. A mesh passing the closed-solid checks must therefore not be interpreted as proven intersection-free.
