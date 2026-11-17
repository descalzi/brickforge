# BrickForge roadmap

The goal is **description → object specification → real-element assembly → instructions**.
Browser JavaScript is the production construction engine. Geometry import is an
optional reference tool. The old mesh-first programme is retained in the
[research archive](roadmap-mesh-archive.md); it does not define product priorities.

## Capability milestones

| Milestone | Implemented evidence | Remaining exit work |
| --- | --- | --- |
| Object specification | Versioned millimetre contract, components, shapes, relations, empty spaces, explicit dimension and radial shape tolerance, visual position/colour edits, dimension ratios, axis/anchor alignment, mirror-plane constraints and explicit source-frame facing | Unrestricted relative-layout and component pose synthesis |
| Part discovery and composition | Curated source-backed structural elements, slopes, open frames, mirrored wings, round elements, a centred 3x3 base plate, narrow and shallow slopes, a source-measured faceted curve, a wider round column, a recessed side-stud connector, wheel-pin mounts and tyre/rim composition; export uses real part instances | Wider family coverage, glazing/hinged doors, clips, hinges, axles and richer multi-part mechanisms |
| Global fitting | Exact structural tiling, profile matching, all 24 proper right-angle rotations, X/Z extrusion and orientation-aware facing, repeated extrusions, mixed component course heights, exact multi-part upright prism cover with concavities and keepouts, opt-in stepped sphere/cylinder composition with inner/outer radial bounds and contact-ranked cross-course beam search, direct-attachment constraint pruning and bounded connector-, alignment- and mirror-derived pose fitting, joint-selected dimension variants and mixed brick/plate structural heights | Wider curved families and profile/pose coverage and automatic shape/pose redesign; the original challenge briefs are still independent acceptance targets |
| Validation | Contract and realised relation checks, nominal mating graph, conservative body envelopes plus analytic solid-box/source-prism and compound connector-body material collision checks with explicit rim/tyre seat exceptions, final and per-stage support projection proxies and continuous straight convex/compound-body sweeps with all engaged joint axes required to agree | Measured clutch, detailed mesh collision/insertion, hand access, measured intermediate support, loads and physical stability; none is certified by nominal checks |
| Instructions and revisions | Canonical graph sequence, scene-step inspection, matching LDraw STEP records, real-instance BOM, illustrated PDF booklet with a cover, depth-buffered part diagrams, exploded placement arrows, illustrated inventory, stage hand-support guidance, embedded font and compressed streams, browser-local saved brief revisions | Physical build trials, complex subassembly sequencing and broader instruction usability tests |
| Language integration | Provider-independent request/prompt/schema, output validation, cancellation, explicit HTTPS gateway transport and export/import route | A deployed provider, authentication/cost policy, and evaluation of actual model outputs on unseen descriptions; no hosted model service is bundled |

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
