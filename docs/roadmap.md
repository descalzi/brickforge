# BrickForge roadmap

The goal is **description → object intent → real-element assembly → instructions**.
Browser JavaScript is the production construction engine. Geometry import is an
optional reference tool. The old mesh-first programme is retained in the
[research archive](roadmap-mesh-archive.md); it does not define product priorities.

## Direction (November 2026)

The main pipeline is now **description → object intent v2 → massing + detailing →
instructions** ([ADR 0003](decisions/0003-intent-v2-massing-and-detailing.md)). The
interpreter describes appearance at real size; the engine owns scale and parts and
always returns its best model with a deviation report. The exact v1 brief engine
below remains as the Brief workbench and its benchmark.

### Intent engine status

| Area | Done | Next |
| --- | --- | --- |
| Interpretation | v2 schema and instructions; copy-prompt, on-device and gateway routes; 24 frozen unseen descriptions | Run a real model (not a stand-in) over the case set and new cases; compare models; measure intent errors |
| Massing | Scale choice, primitives with rotation, thin-part preservation, voids that do not pierce walls, paint, hollowing, course-aligned interlocking tiling with connectivity repair | Phase search for better grid alignment; smarter part choice (fewer 1x1s); stability-aware tiling (support under overhangs) |
| Detailing | 45°/33° slopes for roofs and wedges; real wheel assemblies with wheel wells; tiles for smooth tops; colour joints across boundaries | Inverted and curved slopes on spheres/cones, double slopes at ridges, larger wheels, windows/doors as real elements, SNOT for side details |
| Validation | Nominal connection graph, body envelopes, support proxy, evaluation in CI, real-geometry LDraw renders | Force-based stability, colour availability per element, physical build trials |
| Scale | Sizes up to 128 studs; spatially indexed sequencing and collision checks; instanced 3D viewer for large models | Faster tiling and sweeps for huge models; PDF booklets beyond 800 parts |
| Instructions | Grouped steps (one layer, up to 8 parts; 16 above 1,500 parts), PDF booklet up to 800 parts | Sub-assemblies, callouts, better step views for large models |

## Capability milestones

| Milestone | Implemented evidence | Remaining exit work |
| --- | --- | --- |
| Object specification | Versioned millimetre contract, components, shapes, relations, empty spaces, explicit dimension and radial shape tolerance, visual position/colour edits, dimension ratios, axis/anchor alignment, mirror-plane constraints and explicit source-frame facing | Unrestricted relative-layout and component pose synthesis |
| Part discovery and composition | Curated source-backed structural elements, slopes, open frames, mirrored wings, round elements, a centred 3x3 base plate, narrow and shallow slopes, a source-measured faceted curve, a wider round column, a recessed side-stud connector, wheel-pin mounts and tyre/rim composition; export uses real part instances | Wider family coverage, glazing/hinged doors, clips, hinges, axles and richer multi-part mechanisms |
| Global fitting | Exact structural tiling, profile matching, all 24 proper right-angle rotations, X/Z extrusion and orientation-aware facing, repeated extrusions, mixed component course heights, exact multi-part upright prism cover with concavities and keepouts, opt-in stepped sphere/cylinder composition with inner/outer radial bounds and contact-ranked cross-course beam search, direct-attachment constraint pruning and bounded connector-, alignment- and mirror-derived pose fitting, joint-selected dimension variants and mixed brick/plate structural heights | Wider curved families and profile/pose coverage and automatic shape/pose redesign; the original challenge briefs are still independent acceptance targets |
| Validation | Contract and realised relation checks, nominal mating graph, conservative body envelopes plus analytic solid-box/source-prism and compound connector-body material collision checks with explicit rim/tyre seat exceptions, final and per-stage support projection proxies and continuous straight convex/compound-body sweeps with all engaged joint axes required to agree | Measured clutch, detailed mesh collision/insertion, hand access, measured intermediate support, loads and physical stability; none is certified by nominal checks |
| Instructions and revisions | Canonical graph sequence, scene-step inspection, matching LDraw STEP records, real-instance BOM, illustrated PDF booklet with a cover, depth-buffered part diagrams, exploded placement arrows, illustrated inventory, stage hand-support guidance, embedded font and compressed streams, browser-local saved brief revisions | Physical build trials, complex subassembly sequencing and broader instruction usability tests |
| Language integration | Plate-description grammar with recorded defaults and end-to-end construction tests, provider-independent request/schema, browser Prompt API adapter with structured output and cancellation, HTTPS gateway and export/import routes | Actual model inference quality on unseen descriptions, broader description coverage, and deployment of a hosted provider if needed |

## Current benchmark

The studio includes working briefs for an interlocked body, a wall with two
openings, a table, a stepped platform, a courtyard, a windowed pavilion, a sloped
canopy, a small road car, a tapered-wing aircraft, a rounded mushroom study and a
doorway wall, plus an approximate-wheel vehicle that must fit its joints within declared tolerances and an approximately positioned table top resolved through explicit alignment. Two further roof briefs exercise a single composed pitched profile and a preserved central tunnel. Two joint-sized platform briefs test non-nearest width selection and exact mixed-height attachment. A rounded-body brief permits an explicit 6.4 mm stepped shape allowance; it does not replace the exact organic challenge. Four further studies exercise a rotated side-mounted standard plate, a shallow slope, repeated measured curved slopes and one concave curved-plus-plinth material region. The briefs contain no part IDs or build recipes.

New category examples demonstrate curated capabilities. They do not replace or
mark complete the original car, house, aircraft and sphere/organic challenges.
Those specifications can still be blocked where their dimensions, required
function or shape cannot be represented. A failed requirement must not silently
be converted to a different successful model.

The reproducible [structured-brief benchmark](benchmarks.md) reports working studies, parameter variants, negative controls and unchanged original challenges separately. It is not an evaluation of unseen natural-language interpretation.

Blocked Studio briefs list independent component fitting failures. “Test changes to this brief” runs a bounded search over course selection, attachment positions and shape or dimension allowances. The preview reports the edits and realised geometry for a complete planned assembly. Apply the revision to build it, or restore the original brief.

The Studio parts checklist groups the planned instances by LDraw part and colour, shows the first assembly step that uses each group, and exports those quantities as CSV. The illustrated booklet renders in a cancellable browser worker with page progress. Step cards and the Studio slider identify earlier attachment steps. When a sweep fails, the sequence report distinguishes conflicting joint directions from a body blocking a candidate direction and identifies the associated earlier parts.

A chassis can incorporate wheel-pin carriers directly into structural plate courses. Required wheel-to-chassis attachments guide carrier placement. The exact car challenge remains blocked at its wheel dimensions and offers a tested revision with per-axis size and position allowances.

The house challenge offers a tested inset-frame and pitched-roof revision. Component-scoped openings let another component occupy a cutout only if final collision and connection checks pass. The roof proposal measures vertical error at every change in its piecewise-linear cross-section, including the edges of the ridge.

## Next acceptance gates

1. Expand the catalogue using source geometry plus explicit interface evidence,
   retaining attribution and nominal-versus-physical distinctions.
2. Solve flexible dimension/pose relationships and multi-element shapes while
   preserving feature counts, voids and intended proportions.
3. Independently validate actual insertion geometry and physical test assemblies.
4. Connect and evaluate a real interpretation provider after its hosting,
   authentication and cost model is selected. Keep the model replaceable.
5. Prove unseen descriptions across mechanical, architectural, organic and hybrid
   objects; publish coverage and failures rather than a universal-build claim.

## Release gates

- All Node regressions and Chromium product checks must pass.
- The Inspector/reference audits remain separate supporting evidence in CI.
- CI waits for explicit app readiness, not unrelated network idleness.
- Run `python scripts/stamp_browser_modules.py` after source/data changes, then
  `--check` to verify cache-coherent native modules and studio data URLs.
- Verify the published workbench and its exports. Do not infer physical quality
  merely from a convincing render or a connected nominal graph.
