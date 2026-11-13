# ADR 0001: Product and Engineering Principles

- **Status:** Accepted baseline
- **Date:** 2026-11-13

## Context

BrickForge is intended to accept descriptions of arbitrary objects and generate constructions made from genuine L-brick elements, including build instructions and parts inventories.

A narrow category-specific generator would constrain the product. At the same time, attempting every part family and every physical constraint in the first prototype would make progress difficult to measure.

## Decisions

1. Design a category-independent pipeline around geometry, a parts catalogue, an assembly graph, validation, and optimisation.
2. Use LDraw as the initial canonical interchange/export format.
3. Keep AI-generated intent separate from deterministic construction and validation.
4. Begin the first implementation with a deliberately limited set of parts and connection types, while keeping the data model extensible.
5. Accept that the eventual product should support text, reference images, and existing 3D meshes; implement these inputs in stages.
6. Treat visual fidelity, buildability, cost, part count, stability, and ease of assembly as distinct objectives.
7. **Prioritise visual fidelity by default**, subject to hard buildability constraints. The user has confirmed this as the initial optimisation preference. Cost, part count, stability margin, and ease of assembly remain measurable secondary objectives and should be exposed as adjustable trade-offs.

## Consequences

- The first prototype will not support every L-brick element.
- Geometry and connection metadata must be separate concepts.
- Every generated deliverable must be traceable to one assembly graph revision.
- The team must validate data-source licences and terms before redistributing part data.
- The optimisation interface should support alternative profiles without redesigning the core engine.

## Revisit when

- A user-facing MVP scope is agreed.
- A technical spike reveals limitations in LDraw or connection metadata.
- Real user tests show a different default optimisation preference is needed.
