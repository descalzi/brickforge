# Measured part feature profiles

The Part Explorer can analyse the resolved triangle geometry of a selected LDraw part and export a versioned JSON profile. It can also scan up to 12 new results per search phrase, accumulate up to 48 unique part profiles across multiple searches, and export them as one catalogue. Previously scanned part IDs are skipped until the user clears the combined catalogue. This is separate from the nominal connection-profile catalogue: it records measured geometric openings, not physical connection behaviour.

## Extraction

The browser resolves the selected part and its nested LDraw references, converts geometry into millimetres, then sends its triangle positions to a dedicated worker. The worker samples nineteen cross-sections along each principal axis and up to eight oblique section frames, finds nested contours, and clusters contours that persist across slices.

Version 2 profiles preserve both representative measurements and per-slice minimum/maximum dimensions, so tapered and countersunk openings are not reduced to a single average. Version 3 adds optional lightweight triangle positions in millimetres for profiles with at most 4,000 triangles; larger profiles remain valid without preview geometry. Versions 1 and 2 remain importable for backward compatibility.

Each detected feature records:

- Local axis and centre position in millimetres; oblique features also retain a world-axis vector.
- Approximate bounds and observed span through the part.
- Representative cross-section width, length, area and perimeter, plus their observed minimum/maximum ranges.
- Representative equivalent circular diameter and its minimum/maximum range, circularity and aspect ratio.
- Number of supporting slices and a coarse confidence label.
- Centreline deviation and a straight/curved candidate label; partial-span versus through candidate classification; possible branching group identifiers when separate tracks approach in shared slices.

Version 2 exports are validated against `schemas/part-feature-profile-v2.schema.json`; version 3 exports are validated against `schemas/part-feature-profile-v3.schema.json`.

## Interpretation and limitations

These profiles are geometry measurements, not connection instructions. A circular opening does not by itself tell us whether a pin, axle, shaft or other part fits; nominal tolerances, surrounding material, wall thickness, part orientation, assembly access and physical clutch behaviour remain separate concerns.

Oblique analysis uses a bounded set of sampled frame directions, not a continuous medial-axis solver. Curved labels are based on centreline deviation from a straight interpolation; branching groups are heuristics based on converging section tracks; partial-span labels cannot reliably distinguish a blind bore from a feature clipped by a mesh boundary. The analyser does not prove tunnel topology for an LDraw part. A missing profile is not proof that a part has no openings.

## Initial candidate matching

The browser Inspector can import one or more exported profiles or a combined catalogue and compare their measured opening features with the target mesh. The matcher uses shape, per-slice equivalent-diameter or width/length ranges, circularity and aspect ratio with explicit dimensional tolerances. It ranks candidates per target feature and records the candidate part's local opening axis. A second bounded search assigns distinct candidate openings to every target opening and compares pairwise centre distances and relative axis relationships, making the pattern comparison invariant to rigid translation and rotation. For non-collinear feature centres, the matcher now derives a rigid rotation matrix and translation vector, then reports centre residual and opening-axis alignment. Collinear layouts are explicitly marked underdetermined. The transform is accepted only when centre RMS residual is at most the larger of 1.5 mm or 5% of the target feature span, and opening-axis alignment RMS is at most 5 degrees. Collinear layouts, high-residual fits and axis-incompatible layouts remain unresolved. The Inspector also transforms the candidate part's eight bounding-box corners and reports whether that AABB remains within the target mesh AABB (with a 2 mm tolerance). This is only a coarse necessary-condition check. When lightweight geometry is included, the Inspector can display the candidate mesh after applying the estimated rigid transform and subtracting the target model centre. The user can now request a bidirectional sampled surface-alignment score: candidate triangle vertices and centroids are compared with the nearest target triangle, and target samples are also compared back to the candidate surface using spatial hashes. Both directional coverages are reported. Because the candidate is one part and the target is often a whole object, the primary fit score correctly remains candidate-to-target; whole-target reverse coverage and the global bidirectional aggregate are context only and do not penalise a local part match. This is a discrete approximation, not an exact Hausdorff distance. A 91-pose local search now tests axis translations at half/full configured radius and single-axis rotations at plus/minus the configured angle, including translation/rotation combinations. The Inspector applies the resulting rotation about the candidate geometry centroid, retains the original opening-derived pose and provides a reset. Surface proximity can still reduce opening alignment and does not establish physical connection or buildability.

## Curated specialised parts and interface matching

The pinned seed catalogue at docs/data/specialised-technic-part-catalogue.json records source-verified LDraw identities and primitive references for Technic bricks 3700, 3701, 3702 and axle-hole part 32064a. The Part Explorer can scan these source parts and export measured triangle-derived opening profiles, with the source catalogue entry attached. The seed catalogue intentionally separates measured opening profiles from nominal interfaces. The three Technic brick profiles derive their 4.8 mm nominal pin-hole diameter from the referenced LDraw peghole primitive (the 3 LDU inner ring radius is scaled by 2); the axle cross-hole entry retains its primitive transform reference without inventing an unverified diameter or axis.

The Inspector compares measured target openings with these nominal interfaces and, where lightweight source geometry is available, runs a detailed candidate-to-target triangle surface check. Rigid pattern matching and the transformed part envelope remain candidate filters. Physical clutch force, insertion clearance, legal combinations, stability and load capacity are not measured.


## Mesh input diagnostics

The Python geometry inspection report now records watertightness, winding consistency, positive-volume status, connected-component count, Euler characteristic, degenerate and duplicate face counts, and a machine-readable validation status. It also performs a bounded sweep-and-prune triangle-pair scan with separating-axis tests. Intersections are reported, and a candidate-pair budget hit is explicitly not assessed. Pairs sharing a vertex are skipped to avoid normal adjacent-face contacts, so a clear scan is not a formal proof against every possible self-contact.


## Complete construction alternatives, cost and mesh intersections

The Inspector compares each retained connected alternative against the source mesh using exposed simplified part-body envelopes. Candidate-to-target and target-to-candidate coverages, mean and 95th-percentile distance, and a combined bidirectional score are reported per alternative and copied into its validation export. This is a whole-assembly proxy: it uses part body envelopes rather than detailed LDraw surface triangles, and sampled nearest-triangle distances are not an exact Hausdorff metric.

A user can import a dated JSON price catalogue with ISO currency, overall source and per-price source/date attribution. The BOM estimator prefers part-and-colour prices, falls back to part-only prices, lists missing part prices, and only reports a complete estimated total when every BOM line is priced. Shipping, taxes, stock, condition, seller minimums and basket optimisation are not included. No prices are hard-coded into BrickForge.

Python mesh inspection and browser voxelisation now use sweep-and-prune broad phases plus triangle separating-axis tests to detect non-adjacent triangle intersections. The scan has a bounded candidate-pair budget; exhaustion is reported as not assessed. A detected intersection blocks construction generation, while a budget-limited scan permits generation only with a warning and an explicit not-assessed field in the validation export. Triangle pairs sharing a geometric vertex are skipped to avoid treating ordinary adjacent mesh faces as self-intersections, so these diagnostics are not a formal proof that every possible self-contact is absent.
