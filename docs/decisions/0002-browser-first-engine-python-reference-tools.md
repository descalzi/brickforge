# ADR 0002: Browser-first engine and Python reference tooling

- **Status:** Accepted
- **Date:** 2026-11-15

## Context

BrickForge is a fully online product. The deployed application is a static web application and should perform mesh ingestion, analysis, LEGO part selection, construction, validation, optimisation, preview and export in the user's browser. A server-side Python engine is not part of the product architecture.

The repository currently contains both browser JavaScript and a substantial Python implementation of geometry, parts, assembly and construction logic. Maintaining two production engines would duplicate features and fixes, create behavioural drift, and slow development. The Python implementation must therefore have a narrowly defined purpose if it is to remain.

## Decisions

1. **The browser JavaScript engine is the sole authoritative production engine.** New product capabilities are implemented in the browser first. User workflows must not depend on Python, a Python API, a server-side job, or model upload.
2. **Do not pursue Python/browser feature parity.** The Python assembly and construction implementations are not a second product engine. Do not port new browser features to Python merely to keep the implementations aligned.
3. **Retain Python only as offline engineering and test tooling where it adds independent value**, specifically:
   - generating authored golden reference assemblies and reference meshes from pinned LDraw source geometry;
   - independently measuring and comparing reference/reconstructed geometry and topology in CI;
   - auditing and preparing version-pinned source catalogues and test fixtures;
   - running focused offline tests for those utilities.
4. **Do not use Python output as runtime input to the deployed application.** Any data needed by the online product must be published as versioned static assets and consumed by browser code.
5. **Avoid expanding the Python package surface.** Treat the Python CLI, demos, API extras and duplicate runtime construction pathways as legacy/reference tooling. Remove them when their remaining test/reference responsibilities have been migrated or isolated; do not break the golden benchmark or catalogue audit in the process.
6. **Keep the canonical assembly and deliverables browser-owned.** The browser engine produces the authoritative assembly graph, BOM, validation report, LDraw model and preview. Offline Python checks may assess exported artefacts but must not silently replace or repair the browser result.

## Consequences

- Browser JavaScript and Node-based tests are the primary product implementation and regression path.
- Python remains a development dependency only for explicitly identified offline reference tasks.
- CI may use Python to generate independent test fixtures and compare outputs, but a successful Python test cannot substitute for browser end-to-end coverage.
- A future server-side execution mode would require a new architecture decision backed by measured browser performance or capability limits; it is not assumed or planned.
- Simplifying or removing the Python package is a cleanup task, not a prerequisite for continuing browser-engine development.

## Revisit when

- Browser performance measurements demonstrate that a specific workload cannot reasonably run client-side.
- A genuine independent offline validation need cannot be met by the retained reference tools.
