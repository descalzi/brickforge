# Design specification and construction engine

## Product boundary

The primary workflow is **description → structured design specification → LEGO construction**. A design specification describes the intended object independently of the LEGO catalogue. It must not contain part IDs, LEGO-specific placement recipes or preselected construction solutions.

STL/OBJ import remains useful for optional reference comparison and mesh validation. It is not the product's primary design representation.

## Specification v1

The contract is defined in [design-spec-v1.schema.json](../../schemas/design-spec-v1.schema.json), with runtime validation in `docs/assets/design-spec.js`.

A specification describes:
- semantic components and their roles/functions;
- geometry class, dimensions in millimetres and world-space position;
- essential/preferred/optional priority and confidence;
- required and forbidden features;
- spatial relationships between components;
- appearance preferences and construction constraints.

The v1 geometric primitive is an axis-aligned rectangular prism. The schema is deliberately versioned so richer primitives, coordinate frames, negative space, curves, functional joints and uncertainty can be added without making LEGO part choices part of the intent contract.

## Deterministic planner

`docs/assets/design-engine.js` is browser-native and deterministic. It:
1. validates the design specification;
2. checks semantic relationships and component-volume intersections;
3. searches the supplied connection-profile catalogue for candidates with the required course height and nominal interfaces;
4. enumerates exact-cover tilings for each course;
5. explores combinations of course layouts and scores complete assemblies, selecting a connected graph rather than committing to the first local tiling;
6. derives nominal interface edges, BOM and LDraw export from the selected placements;
7. reports checks and limitations separately.

The planner is catalogue-driven: part dimensions and mating-feature datums come from the supplied profiles, not from hard-coded part IDs in the algorithm. Search budgets are explicit and bounded.

## Typed connector compatibility

`docs/assets/connector-matcher.js` adds a connector-level compatibility API independent of the rectangular-course tiler. It transforms interface datums into world space and checks connector type, axis alignment, centre offset and (where defined) nominal diameter. The versioned compatibility rules are in `docs/data/connector-compatibility-v1.json`. A separate source-backed semantic catalogue (`docs/data/part-capabilities-v1.json`) describes structural bricks and selected Technic beams, with roles, capabilities, dimensions, interfaces and source provenance. `docs/assets/design-translation.js` maps catalogue-independent object roles/features to part-catalogue roles/capabilities, and `docs/assets/part-catalogue.js` validates and ranks those candidates. The construction planner uses that translated discovery result to restrict its geometric candidates. No LEGO family or part ID is part of the user-authored design specification.

The existing source-derived Technic catalogue contributes real pin-hole interfaces for parts 3700, 3701 and 3702. The matcher can compare those interfaces against a pin candidate and build an assembly-level list of nominal matches. This is a compatibility assessment only: the candidate pin used in the regression test is synthetic, and the result explicitly does not verify physical clutch.

## Evidence and honesty

The current trusted course-placement catalogue contains standard bricks and plates with nominal stud/receiver datums. A separate source-derived Technic catalogue provides hole-interface geometry for selected beam parts, and the typed connector matcher now matches the measured 2780 friction-pin datum to 3701 beam-hole datums in a nominal, explicitly unverified test. A matching datum is evidence of a geometric candidate interface, not proof of clutch force or structural integrity. Typed connector compatibility is kept separate from the course-placement planner until real connector part geometry and validated insertion/retention behaviour are available.

Consequently, the engine:
- blocks semantic roles such as wheel/window when the catalogue has no verified capability data for them;
- blocks required semantic features that the catalogue cannot represent;
- marks physical clutch strength and structural stability as not assessed;
- never silently fills a missing specialist feature with a generic brick.

This is a deliberately small but end-to-end vertical slice. It proves a hand-authored design specification can drive a globally searched, connected, exported assembly. It does not yet claim arbitrary object construction.

## Browser workbench and regression

Open [the Design Engine workbench](../designer.html). The authored fixtures in `docs/data/design-spec-fixtures.json` are intentionally LEGO-agnostic. Alongside the passing interlocked-body fixture, they include car, house, aircraft and organic-form challenge specifications. These are valid intent inputs; the planner is expected to explain current catalogue/geometry blockers rather than fabricate builds. The page fetches the catalogue, runs the deterministic planner in the browser, displays a footprint preview and exposes LDraw, BOM and assembly-report downloads.

Node tests exercise validation, scale rejection, global interlocking, multi-component designs, car/house/aircraft/organic intent, role refusal, relationship constraints and part budgets. A separate headless Chromium regression opens the actual workbench URL and verifies the generated result and diagnostics.

## Production/runtime boundary\n\nThe construction planner and browser workbench are JavaScript modules and run in the browser. Python is not a parallel production engine. Python may remain for offline LDraw ingestion, catalogue generation and independent audit/test tooling where it provides a clear advantage.\n\n## Next engineering layers

1. Enrich the part catalogue with semantic roles, measured geometry descriptors, orientation constraints and source provenance.
2. Add specialised interfaces (Technic pins/axles, clips/bars, hinges, wheels/tyres, windows and other families) with compatibility evidence and confidence levels.
3. Replace rectangular-only component geometry with multi-primitive geometry, negative space and feature constraints.
4. Expand the global planner to joint component placement, support graphs, stability, collision and build sequence constraints.
5. Add multi-objective optimisation and instruction generation.
6. Only after the engine's input/output contract is stable, integrate an LLM adapter that produces this specification.

## Design studio milestone

`designer.html` is the main interactive engine workbench. It provides five passing, editable object briefs, separate unresolved challenge briefs, component highlighting, orbit/zoom and course inspection, JSON import/save, URL-fragment brief sharing, and LDraw/BOM/full-report exports. Geometry is explicitly a nominal profile preview. A software-projected 3D viewer supports environments without WebGL; the bundled Three.js viewer is used where available. Third-party code and its MIT notice are pinned under `docs/assets/vendor/three`.

Planning runs in a disposable module worker with cancellation and a 30-second UI timeout. Edits, imports and fixture changes invalidate previous geometry and downloads. No language-model service is represented as implemented.

The millimetre specification now accepts `negative_spaces`, each with an ID, position and rectangular dimensions. The planner excludes fully covered grid cells per component/course and refuses partial-cell cuts. It searches layouts around those keepouts and checks nominal graph connectivity. Keepouts apply to nominal part bodies; studs, underside geometry, physical clearances and mesh-level collision are not verified. Course and cell envelopes bound browser memory. `attached_to` additionally requires a direct mating edge between the named components.

Course placement uses the LDraw top-face datum: a body with semantic lower Y bound `y` and height `h` is translated to `-(y+h)/0.4` LDU. Tests independently recover body bounds from exported transforms and check component containment and keepout exclusion. The course slider uses global physical elevations, including components that begin above the foundation, and is not presented as a proven build order.

## Profiled specialised-element milestone

The global planner now accepts `specialistCatalogue` alongside the structural
connection catalogue. `specialist-placement.js` discovers candidates using the
same semantic translation/capability search as the course planner. It explores
four yaw rotations, matches nominal body dimensions, and, for extruded profiles,
compares the requested convex cross-section with the source-backed profile.
Matching constant-section elements can repeat along the extrusion. Candidate
placements enter the same global stud/receiver graph search as ordinary bricks.
No object names or fixture IDs select a construction recipe.

The first eligible elements are slopes 3039 and 3037 and open window frame
60592. `scripts/build_specialist_profiles.mjs` resolves their surfaces from the
pinned LDraw revision, creates static mesh assets and records attribution for all
38 recursively referenced files. These surfaces are used by both the WebGL and
software viewers. Nominal connection datums and body silhouettes remain authored
profiles; source triangles are not proof of clutch or strength. Window glazing
is not included. Window envelopes cannot receive an overlapping keepout until
cavity-aware collision is implemented. Concave cross-sections and non-matching
extrusions are rejected. General polyhedral packing is not implemented.

The windowed-pavilion and long-canopy fixtures exercise mixed structural and
specialised parts, opposed orientations and repeated extrusion. Regressions
also change dimensions and cross-sections to ensure a similar envelope cannot
silently substitute for a different shape.

`assembly-instructions.js` derives a deterministic nominal graph sequence.
Each new part follows an edge to an earlier step (or starts a new subassembly
for explicitly disconnected designs). The studio can inspect that sequence,
export its JSON, and export LDraw `STEP` records in the same order. This is a
connection-order preview, not a verified insertion path or stability proof.

Next priorities remain wheel/tyre/axle and connector insertion geometry,
more general multi-element shape fitting, support and access checks, and then
the natural-language adapter. The original car, aircraft, house and organic
challenge briefs remain unmodified; passing smaller capability tests does not
make those challenges solved.
