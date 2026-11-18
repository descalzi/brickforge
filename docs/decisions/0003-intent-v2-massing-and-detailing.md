# ADR 0003: Object intent v2, massing-then-detailing and best-effort output

- **Status:** Accepted
- **Date:** 2026-11-18

## Context

The v1 pipeline asks the interpreter for a millimetre-exact, catalogue-aligned
specification and builds it only if every component can be matched exactly.
That makes the engine a strict verifier. In practice:

- The working briefs are authored by someone who already knows the brick solution
  (positions such as `y: -9.2` follow from real part geometry). A language model
  describing "a small red car" will not produce such numbers, and the 4 mm / 8 mm
  tolerances are much smaller than its likely errors.
- The four original challenges (car, house, aircraft, sphere) stayed blocked,
  because no element matched exactly (for example, no 16 mm wheel).
- No real interpreter had been evaluated end to end.

ADR 0001 makes visual fidelity the default objective. Designing in bricks means
approximating; refusing every approximation does not serve fidelity.

## Decisions

1. **New interpreter contract: object intent v2** (`docs/data/object-intent-schema-v2.json`).
   The interpreter describes how the object looks at its real-world size, as
   overlapping primitives (box, cylinder, cone, sphere, dome, wedge, roof) with
   roles, colours, `void` and `paint` modes and `attach_to` relations. It never
   chooses scale, studs or parts. The engine owns quantisation.
2. **Two-stage construction.** *Massing*: choose a scale from the requested build
   size, rasterise the primitives onto stud × plate cells, hollow hidden material
   and tile every layer with real bricks, plates and tiles. *Detailing*: rebuild
   roofs and wedges with measured slope elements, and place real wheel-pin plates,
   rims and tyres where the scaled wheels are close to the real assembly.
3. **Best effort by default.** The engine returns its best model and a deviation
   report (shape IoU, components lost or thickened, colour joints, gaps closed,
   pieces it could not join). It blocks only on an invalid intent or an empty
   result.
4. **Connectivity is built in, not checked afterwards.** Bricks start on shared
   course boundaries; a brick is used only where its sides look the same over its
   height; the tiler rewards parts that join separate pieces and avoid seams over
   seams. Repair passes restore hidden material, close small gaps and, as a last
   resort, place a joint plate across a colour boundary (hidden cells first).
5. **Evaluate unseen descriptions.** `docs/data/intent-eval-v1.json` holds 24 plain
   descriptions with intents written by a language model before the engine
   existed. They are frozen; failures are findings. `scripts/evaluate_intents.mjs
   --check` runs in CI.
6. **The v1 brief engine stays** as the "Brief workbench" for exact, constrained
   designs and its benchmark. New product work targets the intent engine.

## Consequences

- Any language model can be the interpreter: the Describe & build studio copies
  a prompt for any chat assistant, or uses an on-device model or a gateway.
- Models are recognisable at stud resolution; fine detail below about one stud is
  lost or thickened and reported. Curved surfaces are stepped.
- Regular-element catalogues are now measured from LDraw source. This found and
  fixed ten basic profiles whose footprint orientation disagreed with LDraw, which
  rotated those parts by 90° in v1 LDraw exports.
- Connections remain nominal. Clutch, strength, stability and colour availability
  are not verified; no physical build trial has been run.

## Revisit when

- A real interpretation model has been evaluated on the case set (and new cases).
- Physical build trials show which joints or stability proxies are insufficient.
- Larger part families (curved slopes, inverted slopes, SNOT brackets, larger
  wheels) are profiled for detailing.
