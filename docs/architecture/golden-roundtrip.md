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

The benchmark report should keep these dimensions separate:

- **Scale and pose:** dimensions, bounds, orientation and origin after the declared normalisation.
- **Shape coverage:** bidirectional surface distance and volumetric overlap, with separate precision and recall so missing holes or filled cavities are visible.
- **Topology:** connected components, tunnels/handles and explicitly authored openings. A topological feature that disappears is a hard failure when the fixture marks it as required.
- **Part inventory:** exact and family-level part counts, plus colour where relevant.
- **Construction validity:** graph connectivity, nominal mating interfaces, body collision and unsupported transforms.
- **Physical confidence:** always reported separately. Nominal connector alignment is not proof of clutch force, stability, strength or legal building technique.

Metrics must be computed on the complete exported construction, not only on the occupancy grid or feature detector. The original authored model is retained as the reference even when the reconstructed model uses a different valid part arrangement.

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

A golden fixture passes only when all required checks pass. In particular:

- A generated connected assembly is not sufficient.
- A missing required opening, filled cavity, disconnected component or severe surface mismatch is a failure.
- A result that is visually close but not nominally connectable is a failure.
- A result that is nominally connectable but visually wrong is also a failure.
- Unknown or unassessed physical properties remain unknown; they must not be promoted to a pass.

Synthetic fixtures remain valuable for parser, topology and algorithm unit tests. Golden models complement them; they do not replace them.
