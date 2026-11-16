# BrickForge roadmap

The goal is **description → object specification → real-element assembly → instructions**.
Browser JavaScript is the production construction engine. Geometry import is an
optional reference tool. The old mesh-first programme is retained in the
[research archive](roadmap-mesh-archive.md); it does not define product priorities.

## Capability milestones

| Milestone | Implemented evidence | Remaining exit work |
| --- | --- | --- |
| Object specification | Versioned millimetre contract, components, shapes, relations, empty spaces, explicit dimension tolerance, visual position/colour edits | Relative/proportional design constraints and unrestricted component pose synthesis |
| Part discovery and composition | Curated source-backed structural elements, slopes, open frames, mirrored wings, round elements, wheel-pin mounts and tyre/rim composition; export uses real part instances | Wider family coverage, glazing/hinged doors, clips, hinges, axles and richer multi-part mechanisms |
| Global fitting | Exact structural tiling, profile matching, all 24 proper right-angle rotations, repeated extrusions, mixed component course heights, direct-attachment constraint pruning and bounded connector-derived pose fitting | General multi-element curved/profile packing and automatic shape/pose redesign; the original challenge briefs are still independent acceptance targets |
| Validation | Contract and realised relation checks, nominal mating graph, placed body envelopes with explicit rim/tyre seat exceptions, support projection proxy and straight approach envelope checks | Measured clutch, detailed mesh collision/insertion, hand access, intermediate support, loads and physical stability; none is certified by nominal checks |
| Instructions and revisions | Canonical graph sequence, scene-step inspection, matching LDraw STEP records, real-instance BOM, vector PDF with embedded font, browser-local saved brief revisions | Physical build trials, complex subassembly sequencing, exploded views and broader instruction usability tests |
| Language integration | Provider-independent request/prompt/schema, output validation, cancellation, explicit HTTPS gateway transport and export/import route | A deployed provider, authentication/cost policy, and evaluation of actual model outputs on unseen descriptions; no hosted model service is bundled |

## Current benchmark

The studio includes working briefs for an interlocked body, a wall with two
openings, a table, a stepped platform, a courtyard, a windowed pavilion, a sloped
canopy, a small road car, a tapered-wing aircraft, a rounded mushroom study and a
doorway wall, plus an approximate-wheel vehicle that must fit its joints within declared tolerances. The briefs contain no part IDs or build recipes.

New category examples demonstrate curated capabilities. They do not replace or
mark complete the original car, house, aircraft and sphere/organic challenges.
Those specifications can still be blocked where their dimensions, required
function or shape cannot be represented. A failed requirement must not silently
be converted to a different successful model.

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
