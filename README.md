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
- Three.js for a future browser-based 3D viewer
- LPub3D as a candidate downstream instruction-rendering tool
- pytest for automated tests

Technology choices are provisional and should be validated with small technical spikes before they become hard dependencies.

## Development status

The repository currently contains the initial project specification and scaffold. The first engineering milestone is a reliable geometry-to-brick pipeline, beginning with mesh inspection, LEGO coordinate conventions, a parts metadata model, and a small demonstrator.

See [Architecture](docs/architecture/overview.md), [Roadmap](docs/roadmap.md), [Decision log](docs/decisions/0001-product-and-engineering-principles.md), and [parts data-source notes](docs/parts-data-sources.md).

## Local LDraw parts library

The project uses the community-maintained LDraw Parts Library as its initial part-geometry source candidate. Download it locally with:

```bash
python scripts/fetch_ldraw_library.py
```

The archive is extracted to `data/vendor/ldraw/`, which is intentionally ignored by Git. Original part files, headers and licence/readme notices are retained. Read [the data-source notes](docs/parts-data-sources.md) before redistributing any part data.

## Project website

The first static project page is in `docs/`. To publish it with GitHub Pages, open **Settings → Pages**, select **Deploy from a branch**, then choose **main** and **/docs**. The page is public on the internet even if the source repository is private. Private-repository Pages hosting requires a GitHub plan that supports it; see [GitHub's publishing-source documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Scope and compatibility

BrickForge is an independent project and is not affiliated with, endorsed by, or sponsored by the LEGO Group. LEGO is a trademark of the LEGO Group. Part libraries and third-party catalogues must be used in accordance with their respective licences and terms.