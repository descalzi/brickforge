# Text-to-LEGO design specification v1

## Product direction

BrickForge's primary input is a structured description of the intended object, independent of the LEGO catalogue. Natural-language/LLM interpretation is deliberately downstream of this contract and is not required by the construction engine.

The design specification describes **what the object is**. It must not contain LEGO part IDs, brick placements, connection datums or a prescribed assembly strategy. Those are construction-engine decisions.

## v1 contract

The JSON Schema is `schemas/design-spec-v1.schema.json`. Its stable top-level identity is:

- `schema_version`, `design_id`, `name`, and declared units;
- semantic `components` with stable IDs, names, functional roles and geometry;
- `relationships` between semantic components;
- hard `requirements` and soft `preferences`.

Component priority and provenance distinguish essential, preferred and optional/inferred details. The contract is versioned and provider-independent.

## Current implemented construction slice

`docs/assets/design-spec-engine.js` validates this contract and converts connected orthogonal-prism footprints into the existing browser assembly pipeline. The construction step uses the published connection-profile catalogue, the deterministic interlocking footprint search, nominal stud/receiver matching, body-envelope collision checks, graph connectivity, LDraw export and BOM generation.

The hand-authored fixtures in `docs/data/design-spec-fixtures.json` are examples of ideal structured output. They do not specify any LEGO solution.

### Explicit v1 limitations

This is a first end-to-end vertical slice, not the finished arbitrary-object engine:

- each component is currently an orthogonal rectangular prism on an integer stud grid;
- all components in one construction must share a height in brick courses;
- their union must be connected and non-overlapping;
- semantic component boundaries are retained as annotations, but the current solid-footprint strategy does not yet create separate physical subassemblies;
- the published connection catalogue currently provides authored nominal profiles for a limited set of rectangular brick/plate families;
- the current matcher verifies nominal stud/receiver datum alignment, not physical clutch force, strength or stability;
- windows, wheels, curved/sloped surfaces, Technic interfaces, vertical variation, support analysis, build sequence and instruction generation are not yet implemented by this strategy.

Unsupported geometry is rejected rather than silently flattened or claimed as solved.

## Test strategy

- `tests/design-spec-engine.test.mjs` tests schema-level validation behaviour and deterministic assembly outputs in Node.
- `tests/browser-design-spec.e2e.mjs` loads the same browser modules and published data in headless Chromium and checks placements, connections, BOM and LDraw output.
- The authored car, aircraft, house and organic-object briefs are a growing benchmark corpus. Passing schema validation is not evidence that the current construction strategy can build all four categories.

## Planned engine evolution

1. Catalogue enrichment: semantic part roles, real geometry descriptors, dimensions, connection interfaces, orientations, colour and availability metadata.
2. Candidate generation: role-aware part discovery and geometric/functional suitability scoring.
3. General geometry: non-uniform heights, 3D component volumes, negative space, openings, curved and sloped surfaces.
4. Assembly planning: global constraint search over candidate parts and poses, not independent greedy substitutions.
5. Physical validation: detailed collision, interface compatibility, support/stability and assembly-order checks with explicit confidence levels.
6. Optimisation and outputs: fidelity/part-count/cost trade-offs, BOM, LDraw and build instructions.

The legacy mesh inspector remains an optional reference-geometry tool. It is not the source of design intent and does not define the main product workflow.
