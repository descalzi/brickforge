# BrickForge roadmap

The goal is **description → object intent → real-element assembly → instructions**,
built in the browser ([ADR 0003](decisions/0003-intent-v2-massing-and-detailing.md),
[ADR 0004](decisions/0004-part-vocabulary-and-surface-fitting.md),
[ADR 0005](decisions/0005-one-product-surface.md)). The interpreter describes
appearance at real size; the engine owns scale and parts and always returns its best
model with a deviation report.

### Intent engine status

| Area | Done | Next |
| --- | --- | --- |
| Interpretation | v2 schema and instructions; copy-prompt, on-device and gateway routes; a review loop (rendered views and build report back to the model for a revised intent); 24 frozen unseen descriptions | Run a real model (not a stand-in) over the case set and new cases; compare models; measure intent errors |
| Massing | Scale choice, primitives with rotation, thin-part preservation, voids that do not pierce walls, paint, hollowing, course-aligned interlocking tiling with connectivity repair | Phase search for better grid alignment; smarter part choice (fewer 1x1s); stability-aware tiling (support under overhangs) |
| Detailing | 45°/33° roof slopes; real wheels in wheel wells; smooth-top tiles; colour joints; scored surface fitting with straight, curved and inverted slopes, cones, round, wedge and round-corner plates from an imported 83-part vocabulary (LDCad connections); window and door frames; bracket-mounted eye tiles; studs-out panels on side-stud bricks for sideways bulges; flat ears and fins on clip-and-bar hinges; a hidden core of fewer, larger parts ([ADR 0004](decisions/0004-part-vocabulary-and-surface-fitting.md), [ADR 0006](decisions/0006-designed-models.md)) | Free-angle hinges from the intent's tilt, hinged limbs and tails, printed eye tiles, double slopes at ridges, arches and macaroni parts |
| Validation | Nominal connection graph, body envelopes, support proxy, evaluation in CI, real-geometry LDraw renders | Force-based stability, colour availability per element, physical build trials |
| Scale | Sizes up to 128 studs; spatially indexed sequencing and collision checks; instanced 3D viewer for large models | Faster tiling and sweeps for huge models |
| Instructions | Grouped steps (one layer, up to 8 parts; 16 above 1,500 parts); PDF booklet up to 8,000 parts with booklet-style steps (about 240 at most), 4 or 6 steps per page, part callouts and outlined new parts | Sub-assembly pages, zoomed step views for large models |

## Next acceptance gates

1. Run real language models (not a stand-in) over the frozen case set and new
   descriptions; publish coverage and failures.
2. Designed-model quality on organic subjects: compare against a designed set of the
   same subject; free-angle and limb modules (see the roadmap table).
3. Independently validate insertion geometry and run physical build trials.

## Release gates

- Unit tests, the evaluation check and the Chromium studio test must pass.
- Run `python scripts/stamp_browser_modules.py` after source or data changes, then
  `--check` to verify cache-coherent native modules and studio data URLs.
- Do not infer physical quality from a convincing render or a connected nominal graph.
