# Development Roadmap

This roadmap is intentionally milestone-based. Each milestone should produce a demonstrable, tested result before the next layer is added.

## M0 — Foundations and technical reconnaissance

- [x] Create repository and initial architecture specification.
- [x] Confirm initial product scope and optimisation defaults.
- [x] Review LDraw file format, part library structure, and licensing.
- [x] Define coordinate conventions and unit conversions.
- [ ] Select a small, redistributable or locally sourced fixture set for tests.
- [x] Record decisions and known limitations.

**Exit criteria:** documented technical choices and a reproducible development environment.

## M1 — Geometry ingestion

- [ ] Create Python package and CLI entry point.
- [x] Import STL and OBJ meshes.
- [ ] Validate empty, non-watertight, degenerate, and non-finite geometry cases.
- [x] Report units, dimensions, and mesh statistics.
- [ ] Normalise geometry without silently changing intended physical scale.
- [x] Add deterministic unit tests and small test fixtures.

**Exit criteria:** a mesh can be inspected and normalised with a machine-readable report.

## M2 — LEGO coordinate system and parts catalogue

- [x] Document LDraw coordinate conventions and conversion tests.
- [x] Parse LDraw part geometry records and recursively resolve sub-file references.
- [x] Represent part metadata and colour references, including inherited colour context.
- [ ] Model connection primitives separately from render geometry.
- [x] Define catalogue provenance and licensing requirements.

**Exit criteria:** known parts can be loaded, positioned, and exported without coordinate drift. The parser/resolver groundwork is implemented; validating against a downloaded official library and adding an LDraw export path remain before this milestone is complete.

## M3 — First construction demonstrator

- [ ] Define an assembly graph schema.
- [ ] Implement a constrained regular-brick/plate placement strategy.
- [ ] Generate a simple solid/cube-like construction.
- [ ] Export a valid LDraw model.
- [ ] Re-import and compare dimensions and placements.
- [ ] Produce a basic BOM.

**Exit criteria:** a small generated model uses real catalogue elements and round-trips through LDraw.

## M4 — Validation

- [ ] Detect geometric overlaps.
- [ ] Validate declared connection compatibility.
- [ ] Detect disconnected parts and unsupported placements.
- [ ] Produce machine-readable validation reports.
- [ ] Add negative tests for intentionally invalid assemblies.

**Exit criteria:** invalid test constructions are reliably rejected with actionable diagnostics.

## M5 — Shape coverage and optimisation

- [ ] Add surface-aware candidate placement.
- [ ] Combine coarse volumetric and surface-fitting strategies.
- [ ] Add objective metrics and configurable optimisation profiles.
- [ ] Compare alternative constructions for fidelity, cost, and complexity.

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
- [ ] Build browser-based 3D preview and project management.

**Exit criteria:** a user can describe an object, review a generated construction, request a revision, and export the deliverables.

## M8 — Broadening and production hardening

- [ ] Expand part families and connection types.
- [ ] Improve stability and assembly-accessibility analysis.
- [ ] Add colour/availability/cost providers where permitted.
- [ ] Add reproducibility, performance, observability, and security controls.
- [ ] Build a diverse evaluation suite covering organic and mechanical shapes.

**Exit criteria:** measured performance and documented limitations across a representative shape benchmark.