# Text-to-LEGO design specification v1

## Product direction

BrickForge's primary input is a structured description of the intended object, independent of the LEGO catalogue. Natural-language/LLM interpretation is deliberately downstream of this contract and is not required by the construction engine.

The design specification describes **what the object is**. It must not contain LEGO part IDs, brick placements, connection datums or a prescribed assembly strategy. Those are construction-engine decisions.

## v1 contract

The JSON Schema is `schemas/design-spec-v1.schema.json`; the JavaScript entry points are `validateDesignSpec(spec)` and `constructDesign(spec, connectionCatalogue, options)`. The separate catalogue services expose `discoverPartsForRole`, `createLDrawGeometryResolver` and `rankPartCandidatesWithGeometry`. Their stable top-level identity is:

- `schema_version`, `design_id`, `name`, and declared units;
- semantic `components` with stable IDs, names, functional roles and geometry;
- `relationships` between semantic components;
- hard `requirements` and soft `preferences`.

Component priority and provenance distinguish essential, preferred and optional/inferred details. The contract is versioned and provider-independent.

## Current implemented construction slice

`docs/assets/design-spec-engine.js` validates this contract and converts orthogonal-prism component volumes into per-course occupancy and the browser's variable-course assembly planner. The construction step uses the published connection-profile catalogue, the deterministic interlocking footprint search, nominal stud/receiver matching, body-envelope collision checks, graph connectivity, LDraw export and BOM generation. A separate role-aware catalogue discovery module searches the full LDraw name/category/keyword index for wheel, window, axle, slope and other semantic roles. It clearly distinguishes text-only discoveries from candidates with authored connection profiles; discovery is not mistaken for physical suitability. A pinned-source LDraw geometry resolver now expands nested part, subpart and primitive references in the browser, measures real display-surface bounds and surface area, and scores fixed-part envelopes against target dimensions across rotations. Semantic discovery can now be combined with bounded-concurrency geometry resolution to rank candidates and identify the subset that has both a measured envelope fit and an authored nominal connection profile. These are candidate-generation signals only; they do not yet prove functional or connection suitability.

The hand-authored fixtures in `docs/data/design-spec-fixtures.json` are examples of ideal structured output. They do not specify any LEGO solution.

### Explicit v1 limitations

This is a first end-to-end vertical slice, not the finished arbitrary-object engine:

- each component is currently an orthogonal rectangular prism on an integer stud grid with an integer base course and height;
- the per-course occupancy must be non-empty and the complete selected part graph must be connected;
- component volumes may not overlap; the current planner is bounded to 64 courses and 256 occupied cells per course;
- semantic component boundaries are retained as annotations, but the current variable-course strategy does not yet create separate physical subassemblies;
- the published connection catalogue currently provides authored nominal profiles for a limited set of rectangular brick/plate families; the broader 25k-part index is searchable and its real LDraw geometry can be resolved, but most results are not yet planner-eligible;
- the current matcher verifies nominal stud/receiver datum alignment, not physical clutch force, strength or stability;
- selecting and placing specialised parts such as windows, wheels, curved/sloped surfaces and Technic interfaces is not yet implemented; catalogue text discovery alone is not a substitute; negative-space/keep-out semantics, support analysis, build sequence and instruction generation are also outstanding.

Unsupported geometry is rejected rather than silently flattened or claimed as solved.

## Test strategy

- `tests/design-spec-engine.test.mjs` tests schema-level validation behaviour and deterministic assembly outputs in Node.
- `tests/browser-design-spec.e2e.mjs` loads the same browser modules and published data in headless Chromium and checks placements, connections, BOM and LDraw output.
- The authored car, aircraft, house and organic-object briefs are a growing benchmark corpus. Passing schema validation is not evidence that the current construction strategy can build all four categories.

## Planned engine evolution

1. Catalogue enrichment: semantic part roles, measured geometry descriptors, dimensions, connection interfaces, orientations, colour and availability metadata. The first browser geometry resolver is implemented; richer descriptors and profile coverage remain.
2. Candidate generation: role-aware part discovery and geometric/functional suitability scoring. The first semantic-plus-envelope ranking pipeline is implemented; exact interface compatibility and feature-aware geometry scoring remain.
3. General geometry: arbitrary non-orthogonal shapes, explicit negative space and keep-outs, openings, curved and sloped surfaces.
4. Assembly planning: global constraint search over candidate parts and poses, not independent greedy substitutions.
5. Physical validation: detailed collision, interface compatibility, support/stability and assembly-order checks with explicit confidence levels.
6. Optimisation and outputs: fidelity/part-count/cost trade-offs, BOM, LDraw and build instructions.

The legacy mesh inspector remains an optional reference-geometry tool. It is not the source of design intent and does not define the main product workflow.
