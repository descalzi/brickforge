# BrickForge

**BrickForge** is an AI-assisted system for turning descriptions, reference images, and 3D geometry into buildable models made from real L-brick elements, with validated parts inventories and step-by-step building instructions.

The long-term goal is to support arbitrary object categories rather than a fixed catalogue of model types.

## Product goals

- Accept natural-language descriptions and, eventually, photographs and existing 3D files.
- Produce visually faithful constructions from genuine L-brick elements.
- Validate geometric fit, connections, assembly order, and practical buildability.
- Optimise across visual fidelity, part count, cost, stability, and ease of assembly.
- Export an editable LDraw model, a parts inventory, and illustrated instructions.

## Architecture

BrickForge is organised as independent subsystems:

1. **AI interface** — interprets intent and produces a structured design brief.
2. **Geometry** — imports, analyses, and represents target shapes.
3. **Parts catalogue** — indexes part geometry, colours, connection types, and availability.
4. **Construction** — maps target geometry to compatible L-brick elements.
5. **Validation** — checks collisions, connectivity, support, and assembly feasibility.
6. **Optimisation** — searches for better constructions against configurable objectives.
7. **Instructions and application** — sequences the build and presents/export deliverables.

The AI must not directly author arbitrary per-brick placements as the source of truth. Construction decisions belong to deterministic, testable geometry and constraint-solving components.

## Initial technical direction

- Static HTML, CSS and JavaScript, published with GitHub Pages (Cloudflare Pages is also compatible).
- Browser-native construction and validation, using the visitor's CPU and memory.
- Three.js for local 3D preview and interaction.
- LDraw as the canonical model interchange and download format.
- Python reference implementation and test suite for engineering and regression checks.
- Node's built-in test runner for browser-engine tests; pytest for the Python reference tests.

The user-facing construction flow does not require a Python installation, application server or model-upload service. The site fetches its published connection catalogue and static scripts; placements, validation, preview assembly and downloads are computed in the browser.

## Development status

The project now has a public mesh inspector for STL and OBJ files and a browser-based LDraw part explorer for a curated set of real bricks and plates. The part explorer follows nested sub-file references, composes transforms, applies inherited colours and the LDraw colour table, and shows source-header attribution. BrickForge has its authored nominal connection profiles for eleven standard bricks and two plates, plus a deterministic stud-to-receiver datum matcher. These are candidate geometric alignments, not physical clutch or stability validation. The Python package also inspects target meshes, parses LDraw part metadata and geometry records, and recursively resolves sub-file references into transformed primitives. The resolver is regression-tested with a verbatim LDraw 3001 part/dependency fixture, preserving upstream headers and licence files; validating against a full version-pinned official archive remains outstanding.

A canonical assembly graph is implemented, with unique part instances, LDraw transforms, nominal connection edges, conservative body-envelope overlap checks, connected-graph validation, LDraw export, and a BOM derived from the same placements. A deterministic rectangular-block strategy alternates 2 x 4 brick orientation between courses to bridge seams. It generates a 4 x 4-stud, two-course block from four 3001 parts: four graph edges and 16 nominal mating pairs.

The same constrained construction engine now runs in the browser at the [Block builder](https://descalzi.github.io/brickforge/builder.html). It reads the published connection catalogue, creates the placements and graph, checks connections and nominal body bounds, previews the result in 3D, and downloads LDraw, assembly JSON and BOM files. **No Python installation, account, backend or model upload is required.** Its browser-native implementation is regression-tested against the Python reference output.

Alongside the rectangular generator, an experimental footprint strategy accepts small connected 2D stud grids. It searches exact covers using 2 x 10, 2 x 8, 2 x 4, 2 x 3, 2 x 2, 1 x 8, 1 x 6, 1 x 4, 1 x 3, 1 x 2 and 1 x 1 brick profiles. For smaller footprints, it searches connected two-course pairs in increasing combined part count. For larger footprints, it samples deterministic alternative tilings, favours larger elements, and compares a bounded set of alternatives to improve the part count. It prefers two alternating course tilings with a connected cross-course graph; when a two-layout pair is insufficient, it can also find a repeating three-layout cycle that connects the requested stack height. The browser builder exposes this through an editable #/. occupancy grid; tested examples include L-shaped, stepped U-shaped, enclosed-ring, T-shaped (two, three and four courses), and more complex concave or branching footprints. Search is deliberately bounded (64 occupied cells, 1,000,000 search nodes, 100,000 candidate tilings, 5,000,000 tiling-pair checks and 250,000 three-layout sequence checks), so some otherwise tileable shapes may be rejected. This is an initial orthogonal-footprint capability, not a general arbitrary-shape generator. The two-brick stack and interlocked block examples remain under [examples](examples/), with versioned [assembly graph](schemas/assembly-graph-v1.schema.json) and [BOM](schemas/bom-v1.schema.json) JSON schemas.

For local engineering checks only, install the development package with `python -m pip install -e ".[dev]"`, then run `brickforge-demo-assembly` or `brickforge-demo-block`. These commands are not required by website users.

This is an early constrained construction engine, not yet an arbitrary-shape L-brick generator. The rectangular strategy supports one-axis and two-axis staggered courses, using 2 x 4 and 1 x 2 parts to bridge joints and close perimeter strips; tested layouts include 12 x 4 x 2 and 12 x 8 x 2. The experimental footprint strategy supports only those orthogonal shapes for which the bounded search finds a connected pair of course tilings. Neither strategy consumes the mesh inspector's uploaded STL/OBJ as a construction target. Collision checks use conservative body bounds, and physical stability, build sequencing and instructions remain future work.

See [Architecture](docs/architecture/overview.md), [Assembly graph](docs/architecture/assembly-graph.md), [Roadmap](docs/roadmap.md), [Decision log](docs/decisions/0001-product-and-engineering-principles.md), [LDraw geometry ingestion](docs/architecture/ldraw-geometry.md), [nominal connection profiles](docs/architecture/connection-profiles.md), and [parts data-source notes](docs/parts-data-sources.md).

## Local LDraw parts library

The project uses the community-maintained LDraw Parts Library as its initial part-geometry source candidate. Download it locally with:

```bash
python scripts/fetch_ldraw_library.py
```

The archive is extracted to `data/vendor/ldraw/`, which is intentionally ignored by Git. Original part files, headers and licence/readme notices are retained. Read [the data-source notes](docs/parts-data-sources.md) before redistributing any part data.

## Project website

The public project page is published from `docs/` using GitHub Pages, and the source repository is public. Visit the [project site](https://descalzi.github.io/brickforge/), try the [mesh inspector](https://descalzi.github.io/brickforge/inspector.html), generate a block in the [browser builder](https://descalzi.github.io/brickforge/builder.html), or explore [LDraw parts](https://descalzi.github.io/brickforge/parts.html).

## Scope and compatibility

BrickForge is an independent project. External part libraries and third-party catalogues remain subject to their own licences and terms.