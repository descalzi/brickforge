# Development Roadmap\n\n## Product direction update — design-first engine\n\nThe primary product goal is **description → structured design specification → LEGO construction**. Mesh import is optional reference/validation tooling. The new browser-native engine is being developed against ideal hand-authored specifications before any LLM integration. See [design specification engine](design-spec-engine.md).

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

- [x] Create offline Python geometry/reference tooling (not a product runtime; see [ADR 0002](decisions/0002-browser-first-engine-python-reference-tools.md)).
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

- [x] Define a versioned assembly graph schema and typed reference model; browser JavaScript is authoritative for product assemblies.
- [x] Implement a constrained regular-brick placement strategy for rectangular blocks.
- [x] Generate a simple interlocked 4 x 4-stud, two-course block automatically.
- [x] Export an LDraw model from the canonical graph.
- [ ] Re-import resolved part geometry and compare full model dimensions (type-1 placement transforms are already reparsed and compared).
- [x] Produce a basic BOM from the same graph.
- [x] Port the constrained rectangular strategy to a browser-native engine.
- [x] Add a static-hosted Builder page with local 3D preview and LDraw/JSON downloads.
- [x] Compare browser graph, BOM and LDraw exports with fixed reference fixtures in CI; Python is limited to offline oracle/fixture tooling and is not a parallel production engine.

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
- [x] Define a scale-aware, orientation-aware target-shape representation for the browser product using physical grid pitch/origin and explicit source-axis alignment into the canonical construction frame.
- [x] Integrate browser voxelisation into the mesh inspector and expose per-course occupancy previews.
- [x] Convert imported triangle meshes into a bounded 3D occupancy field at the standard stud/course resolution.
- [x] Add unit-aware mesh inspection plus bounded triangle self-intersection diagnostics, with explicit not-assessed status when the candidate-pair budget is exhausted.
- [ ] Extract per-course 2D cross-sections while retaining surface-distance information for visual fitting.
- [x] Reuse the tested footprint tiler as a per-course candidate generator, prioritise sampled interlocking layouts for complex perforated courses, then solve bounded connected cross-course arrangements. The browser mesh inspector can generate and export a variable-course assembly from its target grid; the currently profiled rectangular brick and plate families are eligible.
- [x] Preserve closed-mesh topological handle/tunnel counts separately from coarse occupancy; conservatively map supported axis-aligned sub-grid openings to grid-cell clearance tunnels, and continue blocking construction for unsupported or unlocalised features.
- [x] Locate and measure axis-aligned sub-grid openings using nineteen sampled orthogonal cross-sections; retain location, size, shape, per-slice minimum/maximum dimensions, slice support, local axial intervals and per-feature clearance-course counts in target-grid version 6.
- [x] Preserve stable axis-aligned sub-grid openings as conservative target-grid clearance tunnels; clip clearances to measured local axial intervals and disclose grid-scale over-clearance.
- [x] Add a browser LDraw part-opening profiler and versioned feature-profile export so candidate part geometry can be measured independently of target meshes.
- [x] Add bounded Part Explorer scans that accumulate up to 48 unique profiles across multiple user searches; skip duplicates and export one combined catalogue.
- [x] Add an initial browser geometric matcher for imported part profiles using shape and per-slice dimensional ranges; report candidates only and do not treat a match as a buildability result.
- [x] Export optional lightweight candidate-part triangle geometry and preview its estimated rigid placement in the Inspector using a separately tested transform; keep visual alignment distinct from physical fit.
- [x] Build a pinned, source-verified Technic seed catalogue (3700, 3701, 3702 and 32064a), with browser scans that create measured opening profiles while keeping nominal connection interfaces separately sourced.
- [x] Add source-derived nominal interface matching, one-to-one feature assignment, rigid placement estimation, coarse transformed-envelope checks and detailed candidate-to-target triangle-surface checks for curated specialised parts. Physical clutch, insertion force and structural compatibility remain unverified.
- [x] Extend feature analysis to sampled oblique section frames, centreline-curvature candidates, partial-span/blind candidates and possible branching groups; allow oblique feature axes in matching. These are sampled geometric hypotheses, not exact medial-axis or tunnel-topology reconstruction.
- [x] Add a first bounded surface-alignment scorer for placed candidate-part triangle geometry, with spatially indexed nearest-target-triangle distances and explicit one-way coverage limitations.
- [x] Add a bounded ±1 mm translation refinement for measured candidate geometry around an opening-derived placement, with an explicit reset to the original alignment and disclosure that surface proximity can reduce opening alignment.
- [x] Add bounded 91-pose local translation/rotation refinement for placed candidate geometry, with reset to the original opening-derived pose and explicit disclosure that surface proximity can worsen interface alignment.
- [x] Combine the hard volumetric target-occupancy coverage check with bidirectional sampled surface-fidelity proxies for complete construction alternatives; volumetric coverage remains a constraint and surface fit differentiates alternatives.
- [x] Add comparative objective metrics and configurable balanced, economy, simplicity and interlock profiles for the bounded connected alternatives. Scores remain relative heuristics, not physical quality measurements.
- [x] Retain, rank and expose up to three distinct connected course arrangements with complete LDraw, assembly-graph, BOM and validation exports for each; provide selectable alternatives in the Mesh Inspector.
- [x] Compare retained alternatives by part count, part-type diversity, nominal mating-pair density and course balance, with the selected objective and metrics included in the validation report.
- [x] Compare complete alternatives using sampled detailed LDraw part-surface fidelity (with a labelled envelope fallback) and source-attributed BOM prices imported by the user. Missing prices remain explicit and suppress a complete total; shipping, taxes, stock and seller basket effects are excluded.

**Initial exit criteria achieved for the supported test scope:** the engine produces and explains multiple valid connected alternatives for the tested rectangular brick/plate course shapes, with complete exports and regression coverage. Broader specialised-part coverage, continuous full surface-fidelity optimisation, exhaustive self-intersection certification and physical stability/load analysis remain outside the completed M5 extension scope.

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

### M5 extension completion — 2026-11-15

The five extension workstreams are implemented for the supported browser/geometry scope:

1. A pinned LDraw Technic seed catalogue and curated Part Explorer scan path produce measured profiles from resolved source geometry. Source-derived nominal interfaces are stored separately from measured voids.
2. Mesh feature analysis now samples principal and oblique section frames. It reports centreline curvature candidates, partial-span/blind candidates and heuristic branching groups; oblique axes are accepted by the feature matcher.
3. Candidate surface placement can test 91 bounded combinations of translation and single-axis rotation around the current pose. The original opening-derived pose remains resettable.
4. Each connected alternative receives a whole-assembly, bidirectional surface-fidelity score from sampled detailed LDraw part triangles where available, with a labelled simplified-envelope fallback. The proxy is recorded in the validation export. A dated, source-attributed price catalogue can be imported to calculate BOM costs; unknown prices prevent a complete total.
5. Python and browser mesh paths perform sweep-and-prune triangle-pair intersection checks with separating-axis tests. Candidate-pair limits produce an explicit not-assessed result rather than a clean bill of health.

These extensions are engineering aids, not physical certification. Oblique analysis is direction-sampled; curved/branching/blind classifications are candidates; surface-fidelity samples at most 4,000 detailed LDraw assembly triangles and falls back to simplified envelopes if source geometry cannot be loaded; specialised interface sizes are nominal LDraw-derived geometry; self-intersection scans skip pairs sharing a vertex and can stop at their candidate-pair budget; costs depend on the user's imported price source and exclude shipping, taxes and availability. Detailed physical clutch, stability and assembly-access checks remain outside M5.



### Semantic design-intent validation — priority clarification, 2026-11-15

Golden reconstruction acceptance is based on the concept requested, not exact STL reproduction. The authored STL is a geometric reference; the authored intent contract is the acceptance specification. Required features (counts, types and relationships), suitable LEGO part roles, relative proportions and valid construction are primary. Exact bounds, surface distance and volume IoU are diagnostics unless a fixture explicitly marks them as design-critical. Exact part inventory is appropriate for calibration fixtures, but general models should permit different valid LEGO arrangements and substitutions. Dedicated elements such as windows, doors and wheels should be selected when suitable catalogue parts exist, rather than approximated with generic bricks by default.

Initial implementation:
- [x] Define a versioned machine-readable contract and JSON Schema in `schemas/design-intent-v1.schema.json`.
- [x] Represent required, optional and forbidden features with explicit counts.
- [x] Represent feature relationships through shared construction groups and minimum separations; add a relative distance-ratio relationship for proportion constraints.
- [x] Map semantic roles to preferred LEGO part families and preferred dedicated part IDs, with explicit opt-in hard requirements.
- [x] Evaluate required-feature coverage, optional-feature coverage, relationship coverage and part-role suitability as separate scores.
- [x] Keep geometric diagnostics separate from semantic pass/fail decisions.
- [x] Add authored contract examples for a four-hole plate with two side walls and a house with two windows and a door.
- [x] Add Node regression tests and run them in CI.

Remaining integration work:
- [ ] Connect Inspector feature-analysis output to the contract evaluator so real reconstructed models are assessed automatically.
- [ ] Add stable feature identity, parent/group assignment and relative-position measurements to the reconstruction result.
- [ ] Feed part-role and family metadata into candidate ranking so dedicated LEGO elements are selected before generic approximations when compatible.
- [ ] Make natural-language design briefs compile into the same contract rather than creating a separate evaluation path.
- [ ] Add end-to-end golden fixtures whose acceptance is driven by these contracts, including positive two-hole and three-hole LEGO reconstructions.

### Golden-model round-trip validation — new priority

The synthetic STL corpus remains useful for isolated algorithm checks, but it does not establish that the generated LEGO assembly preserves the source object's shape. The next validation layer is defined in [golden-model round-trip benchmarks](architecture/golden-roundtrip.md): author reference assemblies first, derive their meshes from resolved LDraw part geometry, send those meshes through the ordinary import pipeline, and compare the reconstructed result with the original assembly. The comparison must include surface and volumetric fidelity, required negative spaces/topology, scale, part inventory and nominal construction validity. A connected graph alone is not an acceptable pass. Ordinary LEGO elements are the default; Technic is optional.

Initial implementation status:
- [x] Define the golden-model round-trip benchmark and acceptance policy.
- [x] Export a canonical assembly as STL using resolved LDraw triangles/quads and the assembly graph transforms.
- [x] Write a sidecar with explicit units, coordinate frame, source assembly hash, STL hash, bounds, BOM and mesh diagnostics.
- [x] Add a source-3001 calibration test for actual resolved geometry and expected physical dimensions.
- [x] Repair inconsistent adjacent-face winding without optional graph dependencies and record raw/repaired mesh diagnostics.
- [x] Re-import the generated single-part STL and verify the voxeliser correctly blocks its non-watertight LDraw display surface.
- [x] Generate an explicit, resolution-declared watertight solid reference from an authored assembly using triangle voxelisation, exterior flood-fill and marching cubes; report limitations and optionally hard-fail if required handles are lost.
- [x] Pass a generated single-part 3001 STL through the real browser Inspector voxelisation and construction flow in headless Chromium CI.
- [x] Verify that a two-through-opening solid reference retains both handles at the declared 1 mm pitch.
- [ ] Boolean-union or robustly compose touching multi-part shells into a watertight model mesh.
- [ ] Add multi-part authored LEGO models and pass their generated STL through the normal browser import/construction pipeline.
- [ ] Compare reconstructed output against reference shape, topology, dimensions and inventory.

The initial exporter deliberately concatenates part shells and does not boolean-union them. The 3001 calibration test found inconsistent raw winding; a dependency-free adjacency traversal now repairs it, but the re-imported LDraw display mesh remains non-watertight and is correctly blocked by the voxeliser. A documented voxel-derived solid-reference generator now exists. It preserves exterior-connected openings only when the declared pitch resolves them; expected handle counts can be supplied as a hard acceptance gate. A real authored 3001 STL now passes through the headless Chromium Inspector and construction flow. This establishes the first closed-loop baseline, not yet multi-part composition or two-hole LEGO reconstruction. The first golden models should cover single-part calibration, simple interlocked assemblies and at least one ordinary-brick negative-space model before progressing to car, aircraft and animal examples. Physical stability and clutch strength remain separate, unproven properties.

### Synthetic STL validation corpus — 2026-11-15

An initial public regression corpus is available at [the fixture gallery](../fixtures.html), with its machine-readable catalogue at [validation-fixtures.json](../data/validation-fixtures.json). Eight deterministic 1 mm voxel-derived STL models cover a solid baseline, one and three through-holes, a blind pocket, an oblique bore, curved and branching tunnels, and a simple car-like silhouette. The meshes are intended to be loaded directly in the Mesh Inspector and reused by automated tests. Tests verify that every published STL parses as a closed, consistently wound solid, has the documented dimensions, and that the basic fixtures retain their expected topological tunnel counts. The corpus is an initial foundation for M8's broader evaluation suite, not completion of that milestone; future additions should include finer-resolution curved geometry, intersecting/invalid meshes, thin walls, concavities, overhangs and representative user-supplied shapes.


### Browser-first engine boundary — 2026-11-15

The product is fully online: the browser JavaScript engine is the sole production engine for mesh processing, feature analysis, LEGO part selection, construction, validation, optimisation, preview and exports. No Python service or Python runtime is required by the deployed application.

Python is retained only for offline reference work that provides independent value: authored golden-model/reference-mesh generation, independent geometry/topology comparison in CI, and pinned LDraw catalogue audits/data preparation. Do not add product features to Python or maintain feature parity with JavaScript. The Python CLI, demos, API extras and duplicate construction paths are legacy/reference tooling and should be reduced or removed once their remaining tests and reference responsibilities are isolated. See [ADR 0002](decisions/0002-browser-first-engine-python-reference-tools.md).

- [x] Establish browser JavaScript as the sole production engine.
- [x] Define the limited offline purpose of Python reference tooling.
- [ ] Audit Python modules and classify each as golden-reference, catalogue/audit, test-only, or duplicate engine.
- [ ] Remove unused Python runtime/CLI/API surface without weakening independent golden validation.
- [ ] Keep browser end-to-end and Node regression suites as the primary product acceptance gates.


#### Initial Python scope audit

The current Python tree separates into these provisional groups; removal is deliberately staged so the independent benchmark is not lost:

- **Retain for offline reference work:** `src/brickforge/geometry/solid_reference.py`, `src/brickforge/parts/ldraw_geometry.py`, `ldraw_resolver.py`, `ldraw_mesh.py`, the minimal assembly/connection model needed to author golden assemblies, and `tests/generate_golden_browser_fixture.py` / `tests/compare_golden_reconstruction.py`.
- **Retain for catalogue maintenance:** `scripts/build_ldraw_catalogue.py`, `scripts/fetch_ldraw_library.py`, `scripts/validate_ldraw_library.py` and the corresponding source/audit tests. These prepare static data; they do not run in the deployed site.
- **Candidates to retire after dependency checks:** the Python mesh inspection/grid/voxelisation path, duplicate Python construction strategies, CLI entry point, demos and optional API dependencies. These overlap with the browser product and are not justified as production code.
- **Do not delete blindly:** first confirm no retained golden-reference or catalogue task imports a candidate module, then migrate or replace only the necessary test coverage. Keep the browser Node and Chromium suites as the product gates.

This is a scope audit, not a claim that the Python duplicate implementation has already been removed.


### Topology-safe mesh reconstruction boundary — 2026-11-15

- [x] Apply Float32-aware boundary tolerance to all three voxel-grid dimensions. This prevents STL coordinate quantisation at exact stud-grid boundaries from creating phantom rows/columns (for example, a 6 × 2 × 2-stud source must remain a 6 × 2 × 2 grid).
- [x] Keep single-course constructions valid; a one-brick authored golden model must reconstruct as one 3001 rather than an artificial two-course stack.
- [x] Refuse multi-hole footprints when the current rectangular-part search cannot find a connected arrangement. Do not emit a connected graph that fills required through-openings.
- [ ] Implement feature-aware specialised-part placement so hole-bearing parts can cover a target region while preserving their internal openings; include explicit part-opening-to-target-feature matching and verify the final authored assembly topology.
- [ ] Re-enable positive two-hole and three-hole round-trip acceptance only after the browser engine produces a final assembly that independently retains the declared tunnel count.

The safe refusal is an interim correctness boundary, not completion of multi-hole construction. The published two-hole and three-hole fixtures currently detect and map their openings, but their true 6 × 2 × 2 footprints cannot be interlocked by the current rectangular standard-brick strategy. Dedicated or rotated hole-bearing elements and their connection constraints are needed.
