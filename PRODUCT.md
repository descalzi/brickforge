# Product: BrickForge

BrickForge aims to turn an object description into a coherent model built from
real plastic-brick elements, with a parts inventory and building instructions.

## Product pipeline

1. Interpret descriptive text into an object intent: overlapping primitives at
   real-world size with roles, colours, openings and surface colour (no parts).
2. Choose the scale and rasterise the intent onto the stud grid (massing).
3. Tile with real elements, then detail: slopes and curves on surfaces, wheels,
   window and door frames, bracket-mounted eyes.
4. Validate the nominal connection graph and report deviations from the intent.
5. Inspect and export the model, inventory and instructions.

The construction engine is browser JavaScript, served as static files from
`docs/` through GitHub Pages. Part data is prepared offline by Node scripts.

## Current surfaces

| Surface | Purpose |
| --- | --- |
| `index.html` | Explain the workflow, link models built from descriptions and state limits |
| `studio.html` | Main entry: describe, interpret with any model, build, inspect deviations and export |

## Language and privacy boundary

No hosted language service is bundled. The studio can export a provider-neutral
interpretation request or POST it to a gateway the visitor explicitly configures.
The request includes their description, interpretation instructions and the
response schema. Browser credentials are omitted; API keys belong behind the
gateway. Its authentication, cost policy and real-model evaluation remain open.
Construction itself runs locally.

## Evidence boundary

The eligible catalogue is curated. Nominal source profiles cover selected real
elements and a tyre/rim assembly, not the whole searchable parts library. The
planner can refuse unsupported shapes, poses, sizes, mechanisms and functions.

A source mesh, matched connector or support projection is not physical proof.
The studio reports body-envelope checks, a uniform-volume support proxy and
straight approach tests separately from unverified clutch, strength, insertion
and structural stability. PDF instructions expose this boundary too.

## Product decisions

- Evaluate on unseen plain descriptions with a frozen interpreter output; failures
  are findings, not fixtures to edit.
- Prefer a recognisable, connected model with a stated deviation over a refusal;
  block only invalid intents.
- Select specialised elements by function and geometry rather than replacing
  every object feature with a rectangular block.
- Preserve useful view direction across rebuilds; provide explicit front/top/fit
  controls and visible progress/cancellation.
- Use generic public terminology: bricks, plates, elements and construction.
- Preserve source authors, revision and licence notices. No secrets in the repo.
- Keep the existing engineered visual language, accessible controls and responsive
  layout; the studio is the primary entry point.
