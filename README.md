# BrickForge

**BrickForge** is an AI-assisted system for turning descriptions, reference images, and 3D geometry into buildable models made from real LEGO elements, with validated parts inventories and step-by-step building instructions.

The long-term goal is to support arbitrary object categories rather than a fixed catalogue of model types.

## Product goals

- Accept natural-language descriptions and, eventually, photographs and existing 3D files.
- Produce visually faithful constructions from genuine LEGO elements.
- Validate geometric fit, connections, assembly order, and practical buildability.
- Optimise across visual fidelity, part count, cost, stability, and ease of assembly.
- Export an editable LDraw model, a parts inventory, and illustrated instructions.

## Architecture

BrickForge is organised as independent subsystems:

1. **AI interface** — interprets intent and produces a structured design brief.
2. **Geometry** — imports, analyses, and represents target shapes.
3. **Parts catalogue** — indexes part geometry, colours, connection types, and availability.
4. **Construction** — maps target geometry to compatible LEGO elements.
5. **Validation** — checks collisions, connectivity, support, and assembly feasibility.
6. **Optimisation** — searches for better constructions against configurable objectives.
7. **Instructions and application** — sequences the build and presents/export deliverables.

The AI must not directly author arbitrary per-brick placements as the source of truth. Construction decisions belong to deterministic, testable geometry and constraint-solving components.

## Initial technical direction

- Python 3.11+
- FastAPI for the backend API (introduced when the service layer is needed)
- Trimesh for mesh ingestion and geometry operations
- LDraw as the canonical interchange format for LEGO models
- Three.js for the browser-based mesh inspector and a future assembly viewer
- LPub3D as a candidate downstream instruction-rendering tool
- pytest for automated tests

Technology choices are provisional and should be validated with small technical spikes before they become hard dependencies.

## Development status

The project now has a public mesh inspector for STL and OBJ files and a browser-based LDraw part explorer for a curated set of real bricks and plates. The part explorer follows nested sub-file references, composes transforms, applies inherited colours and the LDraw colour table, and shows source-header attribution. BrickForge also has its first authored nominal connection profiles for those six bricks and plates, plus a deterministic stud-to-receiver datum matcher. These are candidate geometric alignments, not physical clutch or stability validation. The Python package also inspects target meshes, parses LDraw part metadata and geometry records, and recursively resolves sub-file references into transformed primitives.

This is still an ingestion foundation, not an automatic LEGO generator. Physical connection metadata, the construction engine, buildability validation, BOM generation, and instructions remain to be implemented.

See [Architecture](docs/architecture/overview.md), [Roadmap](docs/roadmap.md), [Decision log](docs/decisions/0001-product-and-engineering-principles.md), [LDraw geometry ingestion](docs/architecture/ldraw-geometry.md), [nominal connection profiles](docs/architecture/connection-profiles.md), and [parts data-source notes](docs/parts-data-sources.md).

## Local LDraw parts library

The project uses the community-maintained LDraw Parts Library as its initial part-geometry source candidate. Download it locally with:

```bash
python scripts/fetch_ldraw_library.py
```

The archive is extracted to `data/vendor/ldraw/`, which is intentionally ignored by Git. Original part files, headers and licence/readme notices are retained. Read [the data-source notes](docs/parts-data-sources.md) before redistributing any part data.

## Project website

The public project page is published from `docs/` using GitHub Pages, and the source repository is public. Visit the [project site](https://descalzi.github.io/brickforge/), try the [mesh inspector](https://descalzi.github.io/brickforge/inspector.html), or explore [real LDraw parts](https://descalzi.github.io/brickforge/parts.html).

## Scope and compatibility

BrickForge is an independent project and is not affiliated with, endorsed by, or sponsored by the LEGO Group. LEGO is a trademark of the LEGO Group. Part libraries and third-party catalogues must be used in accordance with their respective licences and terms.