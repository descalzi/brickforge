# Product: BrickForge

BrickForge aims to turn an object description into a coherent model built from
real plastic-brick elements, with a parts inventory and building instructions.

## Product pipeline

1. Interpret descriptive text into a catalogue-independent object specification.
2. Decompose the object into components, geometry, dimensions, relationships,
   required features, functions and explicit empty spaces.
3. Discover and fit source-backed elements and compatible small assemblies.
4. Validate the realised geometry and nominal connection graph.
5. Inspect, revise and export the canonical model, inventory and instructions.

The deterministic construction engine is browser JavaScript, served as static
files from `docs/` through GitHub Pages. Python supports offline source ingestion,
independent fixtures and geometry audits; it is not a parallel product engine.

## Current surfaces

| Surface | Purpose |
| --- | --- |
| `index.html` | Explain the object-first workflow, link working proofs and state limits |
| `designer.html` | Main workbench: briefs, component edits, planning, evidence, sequence, revisions and exports |
| `tools.html` | Supporting catalogue, mesh and construction-research tools |
| `parts.html` | Search metadata and inspect source parts; discovery is not placement certification |
| `inspector.html` | Optional STL/OBJ reference and geometry diagnostics |
| `builder.html` | Legacy footprint/course-tiling research |
| `fixtures.html` | Reference mesh validator gallery |

## Language and privacy boundary

No hosted language service is bundled. The studio can export a provider-neutral
interpretation request or POST it to a gateway the visitor explicitly configures.
The request includes their description, interpretation instructions and the
response schema. Browser credentials are omitted; API keys belong behind the
gateway. Its authentication, cost policy and real-model evaluation remain open.
Construction itself runs locally. Saved revisions are brief snapshots stored on
the visitor's browser, not cloud projects or automatic backups.

## Evidence boundary

The eligible catalogue is curated. Nominal source profiles cover selected real
elements and a tyre/rim assembly, not the whole searchable parts library. The
planner can refuse unsupported shapes, poses, sizes, mechanisms and functions.

A source mesh, matched connector or support projection is not physical proof.
The studio reports body-envelope checks, a uniform-volume support proxy and
straight approach tests separately from unverified clutch, strength, insertion
and structural stability. PDF instructions expose this boundary too.

## Product decisions

- Test the construction engine with ideal authored specifications before relying
  on an LLM. Those specifications contain no part IDs or construction recipes.
- Preserve intent, features, proportions and voids; reject unsupported essentials.
- Exact dimensions remain exact unless a component explicitly permits a bounded
  dimension tolerance.
- Select specialised elements by function and geometry rather than replacing
  every object feature with a rectangular block.
- Preserve useful view direction across rebuilds; provide explicit front/top/fit
  controls and visible progress/cancellation.
- Use generic public terminology: bricks, plates, elements and construction.
- Preserve source authors, revision and licence notices. No secrets in the repo.
- Keep the existing engineered visual language, accessible controls and responsive
  layout; the studio is the primary entry point.
