# BrickForge

Describe an object; get a buildable model made of real brick elements, with a
parts list and step-by-step instructions.

**Description → object intent (any language model) → massing + detailing → instructions.**

[Open Describe & build](https://descalzi.github.io/brickforge/studio.html?example=cottage&run=1) ·
[Evaluation: 24 descriptions](docs/intent-evaluation.md) ·
[ADR 0003](docs/decisions/0003-intent-v2-massing-and-detailing.md)

## How it works

1. **Interpret.** A language model writes an *object intent*
   ([schema](docs/data/object-intent-schema-v2.json)): what the object looks like at
   real size, as overlapping boxes, cylinders, cones, spheres, domes, wedges,
   roofs and tubes (curved, tapering paths for limbs, trunks, tails and horns),
   with colours, openings (`void`) and surface colour (`paint`). A `smooth`
   finish tiles upward-facing surfaces for sculptures and animals. It never
   names parts or studs. Use any chat assistant (the studio copies the prompt), an
   on-device browser model, or your own gateway.
2. **Massing.** The engine picks the scale from the build size, rasterises the
   shapes onto the stud grid, hollows hidden material and tiles every layer with
   real bricks, plates and tiles, staggering seams and joining every piece.
3. **Detailing.** Roofs and wedges become measured 45° or 33° slopes; road wheels
   close to the real assembly size become wheel-pin plates with rims and tyres in
   wheel wells. Window and door components become real frames with glass or a
   door set into the wall; small eyes and lamps become round tiles facing out on
   1×1 brackets. Elsewhere, *surface fitting* swaps stepped edges for straight,
   curved and inverted slopes, cones and round parts wherever they follow the
   intended surface more closely, without loosening any stud joint.
   The part vocabulary for this ([list](docs/data/part-vocabulary-v1.json)) is
   imported from LDraw geometry and LDCad connection data by
   `node scripts/build_part_vocabulary.mjs`.
4. **Report and export.** The engine always returns its best model, with a
   deviation report (shape match, lost or thickened components, colour joints),
   LDraw with steps, a parts list and an illustrated PDF booklet (up to 800
   parts; open the LDraw file in BrickLink Studio or LeoCAD for larger models).

Build sizes set the longest side: small 12, medium 20, large 32, xlarge 64 and
huge 128 studs. Detail below about one stud disappears, so houses and vehicles
want large or xlarge and castles or scenes want huge (several thousand parts,
roughly 20–40 seconds in the browser).

On the [evaluation set](docs/intent-evaluation.md) all 24 descriptions produce a
single stud-connected model (median shape match 0.83). The intents were written
by a language model acting under the published instructions before the engine
existed; a different model will write different intents. Connections are
nominal: clutch, strength, stability and colour availability are not verified,
and no physical build trial has been run.

The earlier exact-brief engine is kept as the
[Brief workbench](https://descalzi.github.io/brickforge/designer.html?fixture=small-road-car&run=1)
with its own [benchmark](docs/benchmarks.md).

## Run and verify

Serve `docs/` with any static HTTP server, for example:

```sh
python -m http.server 8000 --directory docs
node --test tests/*.test.mjs
node scripts/evaluate_intents.mjs --check
python scripts/stamp_browser_modules.py --check
```

`node scripts/evaluate_intents.mjs --write --images` refreshes the evaluation
report and previews after reviewing an engine change. Regular-element profiles are
measured from LDraw by `node scripts/build_standard_profiles.mjs`.

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

Stud and anti-stud positions in
`docs/data/connection-profiles/part-vocabulary-profiles-v1.json` are derived from the
[LDCad Shadow Library](https://github.com/RolandMelkert/LDCadShadowLibrary) by
Roland Melkert and contributors, licensed
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); that file is
shared under the same licence. Part geometry comes from the LDraw parts library
under each file's own notice (CC BY 4.0 or earlier CCAL 2.0).

The previous mesh-first programme is archived in
[the research roadmap](docs/roadmap-mesh-archive.md). Mesh input does not supply
object intent and is not the main product pipeline.
