# ADR 0004: Imported part vocabulary, surface fitting and role recipes

- **Status:** Accepted
- **Date:** 2026-11-18

## Context

After ADR 0003, models are built from rectangular bricks, plates and tiles, plus
roof slopes and wheels. Organic shapes (an elephant, a duck, an apple) come out
terraced, and windows, doors and eyes are flat patches of colour. Real builders
reach for slopes, curved slopes, inverted slopes, cones, round parts, window and
door frames, and brackets. Each of these needs measured geometry and connection
datums. Hand-authoring a profile per part does not scale past a dozen parts.

## Decisions

1. **Import connections, don't hand-author them.**
   - `scripts/build_part_vocabulary.mjs` reads a curated list
     (`docs/data/part-vocabulary-v1.json`) and walks each part's LDraw file tree.
   - Stud and anti-stud datums come from the LDCad Shadow Library's `SNAP_CYL`
     metadata. This includes grids, multi-section cylinders and ID-scoped
     `SNAP_CLEAR`.
   - Each part's body is the convex hull of its geometry without studs.
   - Where the shadow library has no anti-studs, receivers are measured on the
     flat underside.
   - Imported datums are compared against the hand-checked specialist profiles
     in the tests.
   - The resulting profile file is CC BY-SA 4.0, as the shadow library requires.
2. **Surface fitting is scored, not rule-based.**
   - Each part and orientation becomes a cell occupancy pattern, sampled from
     its hull.
   - Around cells where the stepped grid strays from the intended fractional
     occupancy, the fitter tries placements. It keeps those that reduce
     |occupancy − ideal| the most, net of a per-part cost.
3. **Never loosen a joint to gain shape.** A fitted part must meet all of these:
   - Anything resting on it rests on its studs.
   - It sits on material only at its receivers.
   - It clutches material that is not itself fitted.
   - It keeps one colour.
   - It owns its whole cell block, so nothing else is placed in it.

   After fitting, the fitter checks that each piece of material that was one
   piece before fitting is still one piece, with fitted parts joined only through
   their studs and receivers. Any part that splits a piece is undone.
4. **Cones and round parts only where they are the whole cross-section.** A tip,
   a post or a stalk qualifies. Scattered over a wide surface they read as spikes
   and pits.
5. **Role recipes for windows, doors and eyes.**
   - Window and door components on a wall face become frames set into the wall's
     outer layer, with their glass or door.
   - The frame's insert and offset come from LDraw shortcuts and Bricksmith's
     related-parts list. The frame's collision body is its border, so the insert
     fits inside it.
   - Small eyes and lamps become round tiles facing out on 1×1 brackets.
   - Inserts and tiles join their holder through a `mounted` edge (clip, hinge or
     side stud), not a stud-grid joint.
6. **Battlements stay as crenel voids.** Voids along a wall top already give
   merlons in real bricks; no extra recipe was needed.

## Consequences

- The evaluation stays at 24/24 connected with no nominal body overlaps.
- The median fractional surface match rises from 0.831 to 0.854. At the build
  sizes used, this is a modest number; the visual change on curved bodies is
  larger.
- Collision for vocabulary parts uses bounding boxes, which is conservative.
  Exact hull tests against hulls with hundreds of vertices made sequencing too
  slow.
- Bars, clips, pins and hinges are recorded with their datums but join parts only
  through fixed recipes. Free use of SNOT and hinged sub-assemblies is future work.
- Fitting costs about 1 s at xlarge and about 7 s at huge.
