# ADR 0006: Designed models: studs-out panels, hinged modules, feature recipes and a review loop

- **Status:** Accepted
- **Date:** 2026-11-18

## Context

A model built studs-up on one grid reads as a voxel sculpture, even with slopes on
its surface (ADR 0004). Designed sets of organic subjects, such as a cat, look
different for four reasons:

- They build sideways-facing surfaces studs-out, so a haunch is drawn in 3.2 mm
  plate contours.
- They build features as separate sub-assemblies set at an angle (ears on hinges).
- They pick one part per feature (eye tiles, wedge-plate ears).
- They spend parts where they are seen.

## Decisions

1. **Studs-out panels** (`snot-panels.js`).
   - A sphere or dome whose side bulges out at least two studs becomes a panel.
     The panel is rebuilt in its own grid, with "up" pointing out of the surface,
     re-sampled from the intent, smoothed by the surface fitter in that frame and
     tiled with the same tiler.
   - It hangs on 1×1 bricks with a side stud (87087) in the body behind it. A side
     stud meets the panel's 8 mm stud grid every five plates.
   - Anchors are thinned to the fewest that still hold every panel part.
   - The panel is split into rigid groups, so the main tiler sees each group as one
     piece.
   - Panel cells may not reach into foreign material or into other detailing.
2. **Hinged modules** (`module-detailing.js`).
   - An upright, flat ear or fin is cut out of the body. It is rebuilt flat in
     three cross-laid plate layers: rows, then columns, then rows again, so seams
     and colour changes cannot split it.
   - It stands on a clip-and-bar hinge: plate 60470b grips the bar of plate 48336
     on the head. The pose comes from LDCad clip and bar datums.
   - Clip and bar are joined by a `clip_on_bar` edge. Their envelopes overlap by
     design, so that pair is exempt from the envelope check, like tyres on rims.
3. **Wedge and round-corner plates** join the surface fitter's vocabulary. A
   partly filled cell (a wedge tip, a rounded corner) may rest on material without
   an anti-stud there. The cell-level connectivity check still undoes any part that
   splits the model.
4. **Feature recipes.**
   - Eyes, pupils and noses smaller than 2.5 studs become paint whatever mode the
     intent gives them, and then round tiles on brackets. An eye and its pupil
     become one tile.
   - Detail thinner than a third of a stud becomes surface paint, not a thickened
     bar.
5. **Hidden core.**
   - Inside the model each extra part costs four times as much in the tiler, so
     hidden material is laid with fewer, larger parts. This saves about 4–5% of
     parts on large models.
   - Fitted surface parts that end up in a loose piece go back to plain cells, and
     the model is tiled again.
6. **Review loop** (studio).
   - After a build, the language model can review the model. It receives three
     rendered views, the description, the intent and a short build report, and
     returns a revised intent, which is built.
   - The copy route copies the prompt and downloads the image. A gateway receives
     the image as base64. The on-device model receives text only.

## Consequences

- At 64 studs the cat gets studs-out panels on its torso and haunch (about a dozen side-stud
  bricks), two hinged ears and bracket eyes. It stays one connected model with no envelope
  overlaps. The build takes about 15–20 s in Node.
- The evaluation set stays 24/24 connected with no envelope overlaps.
- Not done:
  - free-angle hinges (ears stand upright; tilt is not yet taken from the intent);
  - modules for limbs and tails;
  - printed parts (eye tiles are plain colour);
  - a measured comparison against a designed set.
