# Development Roadmap

This roadmap is intentionally milestone-based. Each milestone should produce a demonstrable, tested result before the next layer is added.

## M0 — Foundations and technical reconnaissance

- [x] Create repository and initial architecture specification.
- [x] Confirm initial product scope and optimisation defaults.
- [x] Review LDraw file format, part library structure, and licensing.
- [x] Define coordinate conventions and unit conversions.
- [x] Select a small, redistributable or locally sourced fixture set for tests.
- [x] Record decisions and known limitations.

**Exit criteria:** documented technical choices and a reproducible development environment.

## M1 — Geometry ingestion

- [ ] Create Python package and CLI entry point.
- [x] Import STL and OBJ meshes.
- [x] Validate empty, non-watertight, degenerate, and non-finite geometry cases.
- [x] Report units, dimensions, and mesh statistics.
- [ ] Normalise geometry without silently changing intended physical scale.
- [x] Add deterministic unit tests and small test fixtures.

**Exit criteria:** a mesh can be inspected and normalised with a machine-readable report.

## M2 — L-brick coordinate system and parts catalogue

- [x] Document LDraw coordinate conventions and conversion tests.
- [x] Parse LDraw part geometry records and recursively resolve sub-file references.
- [x] Represent part metadata and colour references, including inherited colour context.
- [x] Add a browser part explorer with a searchable index of the full LDraw parts catalogue.
- [x] Model nominal stud and underside receiver datums separately from render geometry for eleven standard bricks and twelve plates.
- [x] Add a deterministic transformed stud/receiver alignment matcher with one-to-one feature assignment.
- [ ] Extend connection profiles to specialised part families and add measured clutch/tolerance data.
- [x] Define catalogue provenance and licensing requirements.

**Exit criteria:** known parts can be loaded, positioned, and exported without coordinate drift. The parser/resolver, browser part explorer, first nominal connection matcher and graph-derived LDraw export are implemented. A full version-pinned official-library audit resolved 24,983 of 24,985 top-level parts (99.992%); the two unresolved decorated variants and their missing upstream references are retained as explicit diagnostics.

## M3 — First construction demonstrator

- [x] Define a versioned assembly graph schema and typed Python model.
- [x] Implement a constrained regular-brick placement strategy for rectangular blocks.
- [x] Generate a simple interlocked 4 x 4-stud, two-course block automatically.
- [x] Export an LDraw model from the canonical graph.
- [ ] Re-import resolved part geometry and compare full model dimensions (type-1 placement transforms are already reparsed and compared).
- [x] Produce a basic BOM from the same graph.
- [x] Port the constrained rectangular strategy to a browser-native engine.
- [x] Add a static-hosted Builder page with local 3D preview and LDraw/JSON downloads.
- [x] Compare browser graph, BOM and LDraw exports with the Python reference examples in CI.

**Current proof of concept:** examples include a manually specified two-brick 2 x 4 stack and a generated 4 x 4-stud block of four 3001 parts, plus tested browser/Python layouts for 12 x 4 x 2, 4 x 8 x 2 and 12 x 8 x 2. The 12 x 8 example uses a two-axis stagger and 1 x 2 perimeter fillers; it has 42 parts, 48 graph edges and 96 nominal feature matches. The browser Builder runs these layouts locally and its output is covered by Node regression tests. See [assembly graph](architecture/assembly-graph.md) and [example files](../examples/).

**Exit criteria:** a generated model uses real catalogue elements, passes the declared connection and geometric checks, and round-trips through LDraw with geometry/dimension comparison. The constrained rectangular generator is now available in the browser; full resolved-geometry round-tripping remains outstanding.

## M4 — Validation

- [x] Detect overlap between nominal transformed part-body envelopes (coarse axis-aligned bounds).
- [x] Match nominal connection-profile features and record candidate graph edges.
- [x] Detect disconnected part instances and unsupported transforms/profiles.
- [x] Produce a machine-readable validation report with explicit check status and limitations.
- [x] Add negative tests for intentionally overlapping and disconnected assemblies.

**Exit criteria:** layered validation reports reliably distinguish geometric checks, candidate connection alignments, and physical/stability heuristics. The current implementation is only the first geometric/connectivity layer.

## M5 — 3D target representation, shape coverage and optimisation

- [x] Define the versioned browser target-grid data model with explicit physical pitch, origin, classification and layer extraction.
- [x] Add a bounded browser voxeliser for closed meshes, including unit conversion, BVH-accelerated occupancy sampling and triangle-cell boundary detection.
- [x] Add explicit source X/Y/Z up-axis alignment into the canonical Y-up construction frame without changing scale.
- [ ] Define a scale-aware, orientation-aware target-shape representation for the browser product.
- [x] Integrate browser voxelisation into the mesh inspector and expose per-course occupancy previews.
- [x] Convert imported triangle meshes into a bounded 3D occupancy field at the standard stud/course resolution.
- [ ] Add robust mesh validation and explicit handling for open, non-watertight, degenerate and self-intersecting surfaces.
- [ ] Extract per-course 2D cross-sections while retaining surface-distance information for visual fitting.
- [x] Reuse the tested footprint tiler as a per-course candidate generator, prioritise sampled interlocking layouts for complex perforated courses, then solve bounded connected cross-course arrangements. The browser mesh inspector can generate and export a variable-course assembly from its target grid; the currently profiled rectangular brick and plate families are eligible.
- [x] Preserve closed-mesh topological handle/tunnel counts separately from coarse occupancy; conservatively map supported axis-aligned sub-grid openings to grid-cell clearance tunnels, and continue blocking construction for unsupported or unlocalised features.
- [x] Locate and measure axis-aligned sub-grid openings using nineteen sampled orthogonal cross-sections; retain location, size, shape, per-slice minimum/maximum dimensions, slice support, local axial intervals and per-feature clearance-course counts in target-grid version 6.
- [x] Preserve stable axis-aligned sub-grid openings as conservative target-grid clearance tunnels; clip clearances to measured local axial intervals and disclose grid-scale over-clearance.
- [x] Add a browser LDraw part-opening profiler and versioned feature-profile export so candidate part geometry can be measured independently of target meshes.
- [x] Add bounded Part Explorer scans that accumulate up to 48 unique profiles across multiple user searches; skip duplicates and export one combined catalogue.
- [x] Add an initial browser geometric matcher for imported part profiles using shape and per-slice dimensional ranges; report candidates only and do not treat a match as a buildability result.
- [x] Export optional lightweight candidate-part triangle geometry and preview its estimated rigid placement in the Inspector using a separately tested transform; keep visual alignment distinct from physical fit.
- [ ] Build a curated, source-verified feature-profile catalogue for useful specialised parts; distinguish measured openings from nominal connection interfaces.
- [ ] Improve matching with one-to-one feature assignment, explicit part rotations, surrounding-envelope checks and validated connection interfaces; keep unmatched features as construction constraints.
- [ ] Improve feature analysis for oblique, curved, branching and blind openings; match measured features to compatible parts or explicit preservation constraints.
- [ ] Add surface-aware candidate placement for slopes, curves and specialised elements.
- [ ] Combine coarse volumetric and surface-fitting strategies.
- [ ] Add objective metrics and configurable optimisation profiles.
- [ ] Compare alternative constructions for fidelity, part count, cost, and complexity.

**Exit criteria:** the engine can produce and explain multiple valid alternatives for selected test shapes.

## M6 — Build sequencing and instructions

- [ ] Derive assembly dependencies from the assembly graph.
- [ ] Group parts into buildable steps and subassemblies.
- [ ] Generate per-step scene data and camera views.
- [ ] Evaluate LPub3D or an alternative instruction renderer.
- [ ] Export a PDF and BOM from the same model revision.

**Exit criteria:** a human can follow the generated instructions to reproduce a test model.

## M7 — AI and user application

- [ ] Define a structured design brief schema.
- [ ] Add natural-language interpretation.
- [ ] Add conversational refinement with versioned model revisions.
- [ ] Add reference-image and source-mesh workflows.
- [x] Add a target-aligned construction envelope preview to the mesh inspector, with source-mesh ghosting and visibility controls. Surface-fit scoring and detailed part geometry remain future work.
- [ ] Build browser-based project management.

**Exit criteria:** a user can describe an object, review a generated construction, request a revision, and export the deliverables.

## M8 — Broadening and production hardening

- [ ] Expand part families and connection types.
- [ ] Improve stability and assembly-accessibility analysis.
- [ ] Add colour/availability/cost providers where permitted.
- [ ] Add reproducibility, performance, observability, and security controls.
- [ ] Build a diverse evaluation suite covering organic and mechanical shapes.

**Exit criteria:** measured performance and documented limitations across a representative shape benchmark.