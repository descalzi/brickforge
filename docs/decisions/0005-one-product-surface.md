# ADR 0005: One product surface; retire the brief workbench, research tools and Python package

- **Status:** Accepted
- **Date:** 2026-11-18
- **Supersedes:** ADR 0002 (Python reference tooling); ADR 0003 decision 6 (keep the Brief workbench)

## Context

The site carried the Describe & build studio and six further pages:

- the Brief workbench (exact v1 briefs);
- the part explorer;
- the mesh inspector and fixtures gallery;
- the footprint builder;
- the part-geometry lab;
- a tools hub.

A Python package with its own CI also remained, as did about 19 MB of STL
fixtures. None of these feed the description pipeline. The studio still loaded
the whole v1 brief engine only for its connection-graph function. Every change
had to keep roughly 40 unrelated test files and an hour-scale CI job green.

## Decision

- The studio and the home page are the product.
- The studio's dependencies are cut to the modules it uses. The connection graph
  now lives in `connection-graph.js`, and the gateway provider in
  `device-interpretation.js`.
- The following are removed:
  - the retired pages and their assets, data and fixtures;
  - their tests;
  - the Python package and its scripts, schemas and examples;
  - the LDraw catalogue refresh workflow;
  - the v1 benchmark and the architecture notes that described it.
- The offline Node generators for part data stay. Their non-web dependencies
  move to `scripts/lib/` and `data/specialist/`.

All of it remains in the Git history should any part be needed again.

## Consequences

- CI covers module syntax, release stamping, JSON validity, unit tests, the
  description evaluation and the Chromium studio test.
- Coverage of the PDF booklet now comes from the studio test and a dedicated
  booklet unit test.
