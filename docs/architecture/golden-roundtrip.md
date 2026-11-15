# Golden-model round-trip benchmarks

## Purpose

Synthetic meshes are useful for isolated geometry edge cases, but they are not sufficient evidence that a LEGO construction is faithfully reconstructed. BrickForge must also test against models whose intended construction is already known.

A golden model starts as an authored, version-controlled LEGO assembly, not as an anonymous STL. Its assembly graph, LDraw source, part inventory, transforms and intended geometry are the reference truth. A deterministic exporter derives a mesh from that model. The normal import pipeline then processes the mesh without being told the original placements. The reconstructed result is compared with the saved reference.

This creates a closed-loop benchmark:

1. Author a model using real catalogue parts and a validated assembly graph.
2. Save the canonical LDraw model, assembly JSON and BOM.
3. Resolve the actual LDraw part geometry and transforms to create a watertight STL (or a documented multi-shell mesh where union is not possible).
4. Feed that STL through the same unit detection, mesh inspection, orientation, voxelisation, feature analysis and construction path used for user uploads.
5. Compare the reconstructed assembly and its rendered geometry against the original reference.
6. Record failures by category; never call a result successful merely because a connected graph was produced.

## What is compared

The benchmark report keeps these dimensions separate. They are not interchangeable, and a single geometric score must never decide whether a design has been understood.

- **Design-intent constraints (primary):** required features and their counts, such as four openings, two side walls, two windows, a door, wheels or a roof. Each fixture declares which features are mandatory, optional or forbidden, and their important relationships.
- **LEGO interpretation (primary):** whether the selected catalogue elements are appropriate representations of the requested features. A window should normally be represented by a suitable LEGO window element, not silently replaced by a solid wall or an arbitrary collection of ordinary bricks. Dedicated elements are preferred when the catalogue contains a suitable part and the part is compatible with the construction.
- **Relative arrangement and proportions (primary):** feature positions, spacing, orientation, adjacency and ratios within declared tolerances. For example, two windows should remain on the same wall with approximately the intended separation; a four-hole plate should retain four distinct openings in the intended pattern. Translation and modest dimensional changes are normally immaterial.
- **Construction validity (hard gate):** graph connectivity, nominal mating interfaces, body collision and supported transforms. This remains a geometric/nominal assessment, not physical certification.
- **Topology and negative space (hard gate when declared):** required openings, tunnels, cavities and separations must remain represented. Missing a required opening or merging two distinct openings is a failure.
- **Scale, pose and shape coverage (diagnostic unless explicitly constrained):** dimensions, bounds, bidirectional surface distance and volumetric overlap help explain differences, but exact envelope agreement and a universal IoU threshold are not product acceptance criteria. A valid substitution may change the silhouette or surface.
- **Part inventory (fixture-dependent):** exact inventory is required for calibration fixtures whose purpose is to test part identity. For general design fixtures, compare suitable part families and feature-role coverage rather than demanding the original part-by-part BOM.
- **Physical confidence:** always reported separately. Nominal connector alignment is not proof of clutch force, stability, strength or legal building technique.

Metrics must be computed on the complete exported construction, not only on the occupancy grid or feature detector. Every golden fixture must declare its semantic constraints and acceptance tolerances before reconstruction. A fixture may pass with dimensional or surface differences when its required design intent, LEGO interpretation and construction constraints are preserved. Conversely, a high geometric score must not hide a missing or incorrectly represented feature.

## Fixture design

Golden fixtures should progress from controlled to representative:

1. **Single-part calibration:** standard brick and plate families, including orientation and scale variations.
2. **Simple assemblies:** stacked bricks, staggered courses and irregular footprints.
3. **Negative-space models:** frames, arches, windows and repeated openings made from ordinary bricks and plates. These are essential for catching the false assumption that a sub-grid opening can be represented by deleting a whole voxel cell.
4. **Recognisable objects:** small car, aircraft and animal silhouettes assembled from ordinary LEGO elements. These exercise curvature, overhangs, thin features and disconnected visual subassemblies.
5. **Stress cases:** thin walls, narrow gaps, asymmetric details, slopes, curved parts and deliberately unsupported geometry.

The ordinary LEGO catalogue is the default. Technic parts are optional catalogue candidates and must not be required to make the benchmark suite pass.

## Mesh generation requirements

The exporter uses resolved source part geometry and canonical assembly transforms; it does not substitute proxy boxes. The raw LDraw-derived STL remains a display-surface export: its adjacent-face winding is repaired and disclosed, but the source geometry is not guaranteed watertight. A separate `solidify_surface_mesh` stage now rasterises those triangles at a declared physical pitch (0.5 mm by default), fills only regions not connected to the exterior, and extracts a watertight marching-cubes solid. It explicitly applies the voxel-grid transform and reconciles the known half-voxel boundary margin back to the source mesh's measured bounds; this prevents the reference export itself from shifting an edge across a stud-grid boundary. `export_assembly_solid_reference_stl` writes that reference STL and a sidecar with units, assembly hash, STL hash, BOM, voxel pitch, topology and limitations. Through-openings can be preserved when resolved by the pitch; callers can provide an expected handle count, which makes loss of a required opening a hard failure. This is an explicitly resolution-limited reference approximation, not recovered CAD: narrow details may be lost or enlarged, and enclosed cavities are filled. The Python and browser target-grid voxelisers now anchor their grid origin to the mesh's own lower bounds rather than flooring arbitrary world coordinates to global stud multiples. Translation-only changes to an STL therefore cannot add an entire row of studs. The authored single-brick regression re-imports this solid STL and runs it through the Python target-grid voxeliser. The two-opening synthetic regression checks topology preservation. Multi-part authored assembly composition and the browser Inspector round-trip remain subsequent milestones.

STL has no embedded unit metadata. Every generated STL therefore has a sidecar manifest containing the declared units, coordinate frame, source assembly hash, exporter version, expected bounds, topology expectations and reference assembly/BOM identifiers. The importer is still required to receive or infer units explicitly; the manifest is benchmark metadata, not a hidden scale override.

## Acceptance policy

Each golden fixture must define a machine-readable intent contract before it is run. At minimum, the contract records required feature types/counts, feature relationships, preferred LEGO part roles or families, construction constraints and which geometric measurements are merely diagnostic.

A golden fixture passes only when all mandatory intent and construction checks pass. In particular:

- A generated connected assembly is not sufficient.
- Every required feature must be present and recognisable; forbidden features must not be introduced.
- Required feature counts and relationships (for example, four distinct holes or two windows on one wall) must be preserved within declared tolerances.
- Where a suitable dedicated LEGO element exists and is compatible, the reconstruction should use that element rather than an inferior generic approximation.
- Nominally invalid, disconnected or colliding constructions fail even if they look close.
- Dimensional, surface and volumetric differences are reported, but are hard gates only when a fixture explicitly marks a measurement as design-critical.
- Exact part inventory is a hard gate only for part-identity calibration fixtures; general design fixtures assess part-role/family suitability and feature coverage.
- Unknown or unassessed physical properties remain unknown; they must not be promoted to a pass.

Synthetic fixtures remain valuable for parser, topology and algorithm unit tests. Golden models complement them; they do not replace them.
