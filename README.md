# BrickForge

An object-first, browser-based brick construction engine.

**Description → structured object specification → source-backed elements → assembly → instructions.**

[Open the Design Studio](https://descalzi.github.io/brickforge/designer.html?fixture=small-road-car&run=1)

## What works

- Versioned millimetre briefs with semantic components, shape requirements,
  relationships, explicit empty spaces and optional bounded dimension tolerance.
- Structural tiling and profiled specialised-part placement, including slopes,
  open frames, mirrored wings, round elements, wheel mounts and tyre/rim assembly.
- Exact multi-part upright profile composition using source slopes and structural
  infill, preserving concavities and declared keepouts.
- Bounded global search with direct-attachment pruning and nominal mating edges.
- Placed-body checks with analytic box/slope-prism narrow phase, final/stage
  support projection proxies and nominal straight approaches,
  with physical clutch, stability, insertion and strength kept unverified.
- Interactive inspection, editable components, browser-local brief revisions,
  LDraw STEP export, BOM/report JSON and compressed illustrated PDF booklets.
- A local description parser for dimensioned plates, square through-openings and
  side walls. An optional browser language-model adapter and HTTPS gateway use
  the same validated object contract. On-device availability depends on the browser.

The catalogue and geometry solver are curated and bounded. These proofs are not
an arbitrary-object generator or a physical buildability certification. See the
[current roadmap](docs/roadmap.md) and [engine architecture](docs/architecture/design-spec-engine.md).

## Run and verify

Serve `docs/` with any static HTTP server, for example:

```sh
python -m http.server 8000 --directory docs
node --test tests/*.test.mjs
python scripts/stamp_browser_modules.py --check
```

After source or data changes, run `python scripts/stamp_browser_modules.py` before
committing. It versions native module URLs and the studio's data release without
a JavaScript bundler. Chromium CI exercises real pages, workers, downloads and
mobile layout. The Python package and Inspector regressions are supporting
source/geometry audits, not the production construction runtime.

## Source data and engineering tools

The [tools hub](https://descalzi.github.io/brickforge/tools.html) retains the part
explorer, optional mesh inspector, footprint builder and reference gallery.
LDraw geometry is pinned to a source revision. Curated display surfaces retain
recursive attribution under `docs/data/part-meshes/`; the broader library remains
lazy-loaded rather than bundled into the repository. Three.js and the embedded
PDF font retain their licences under `docs/assets/vendor/`.

The previous mesh-first programme is archived in
[the research roadmap](docs/roadmap-mesh-archive.md). Mesh input does not supply
object intent and is not the main product pipeline.
