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

The project now has a working public mesh-inspection page for STL and OBJ files, plus a tested Python ingestion foundation. The Python package can inspect target meshes, parse LDraw part metadata and geometric records, and recursively resolve LDraw sub-file references into transformed primitives while retaining colour-inheritance context.

This is still an ingestion foundation, not an automatic LEGO generator. Physical connection metadata, the construction engine, buildability validation, BOM generation, and instructions remain to be implemented.

See [Architecture](docs/architecture/overview.md), [Roadmap](docs/roadmap.md), [Decision log](docs/decisions/0001-product-and-engineering-principles.md), [LDraw geometry ingestion](docs/architecture/ldraw-geometry.md), and [parts data-source notes](docs/parts-data-sources.md).

## Local LDraw parts library

The project uses the community-maintained LDraw Parts Library as its initial part-geometry source candidate. Download it locally with:

```bash
python scripts/fetch_ldraw_library.py
```

The archive is extracted to `data/vendor/ldraw/`, which is intentionally ignored by Git. Original part files, headers and licence/readme notices are retained. Read [the data-source notes](docs/parts-data-sources.md) before redistributing any part data.

## Project website

The public project page is published from `docs/` using GitHub Pages, and the source repository is public. Visit the [project site](https://descalzi.github.io/brickforge/) or open the [mesh inspector](https://descalzi.github.io/brickforge/inspector.html).

## Scope and compatibility

BrickForge is an independent project and is not affiliated with, endorsed by, or sponsored by the LEGO Group. LEGO is a trademark of the LEGO Group. Part libraries and third-party catalogues must be used in accordance with their respective licences and terms.