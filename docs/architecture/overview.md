# BrickForge System Architecture

## 1. Purpose

BrickForge converts an intended object into a construction made from real L-brick elements and produces artefacts that describe that exact construction: a 3D model, a bill of materials (BOM), and ordered building instructions.

The system is intended to work across arbitrary object categories. It must therefore be built around general geometry, part connectivity, and constraints—not category-specific templates.

## 2. Core design principles

1. **Buildability is a hard constraint.** A visually attractive but impossible construction is not a valid result.
2. **One canonical construction.** The model, BOM, validation report, and instructions must derive from the same versioned assembly graph.
3. **AI proposes; deterministic systems verify.** LLM output is treated as a design brief or proposal, never as proof of geometric or physical correctness.
4. **Part-aware from the start.** Use real part geometry and connection metadata; do not assume every element is a rectangular voxel.
5. **Progressive fidelity.** Begin with a constrained, testable part subset while keeping interfaces extensible to specialised elements.
6. **Explicit trade-offs.** Visual fidelity, cost, part count, strength, and ease of assembly are separate objectives.
7. **Traceability.** Record source geometry, part identifiers, transforms, validation outcomes, and generation settings.

## 3. High-level pipeline

```text
User intent / reference image / source mesh
                  |
                  v
         Design brief (AI-assisted)
                  |
                  v
        Target geometry representation
                  |
                  v
       Shape analysis and segmentation
                  |
                  v
     Candidate L-brick placement search
                  |
                  v
       Assembly graph + LDraw export
                  |
                  v
       Validation and optimisation loop
                  |
          +-------+--------+
          |       |        |
          v       v        v
        3D model  BOM   Build sequence
                            |
                            v
                     Illustrated steps
```

## 4. Subsystems

### 4.1 AI interface

Responsibilities:
- Parse natural-language requests into a versioned, schema-validated design brief.
- Ask for missing constraints when they materially affect the result.
- Extract object attributes, dimensions, desired colours, details, and priorities.
- Later, interpret reference images and support conversational revisions.

The AI layer must not invent part identifiers or claim that a design is buildable without validation.

### 4.2 Geometry

Responsibilities:
- Import supported mesh formats (initially STL and OBJ).
- Validate mesh integrity and units.
- Normalise scale and orientation while preserving source dimensions.
- Compute bounds, surfaces, normals, connected components, and useful geometric features.
- Expose a representation that downstream construction algorithms can query.

Initial implementation should focus on mesh inspection and normalisation, not automatic L-brick conversion.

### 4.3 Parts catalogue

Each part record should eventually include:
- Stable source identifier and description.
- Geometry reference and units.
- Bounding volume and mass where known.
- Available colours and colour identifiers.
- Connection primitives and their local coordinate frames.
- Compatibility rules for connections.
- Source, licence/terms, and catalogue version.

LDraw is the initial model interchange format. LDraw part files provide geometry; additional connection metadata may be required from compatible, appropriately licensed sources or developed in-house. Geometry alone does not fully describe legal or reliable L-brick connections.

### 4.4 Construction engine

The construction engine searches for a set of real elements and transforms that approximate the target while respecting connection and assembly constraints.

The internal representation should be an **assembly graph**:
- Nodes represent placed parts and their transforms.
- Edges represent explicit, typed physical connections.
- Subassemblies group meaningful build stages.
- Each node retains source part and colour identifiers.

Candidate algorithms may include voxel/occupancy methods for coarse structure, surface fitting for appearance, and constraint-based placement for specialised geometry. These are complementary strategies, not mutually exclusive product modes.

The typed reference graph is in `src/brickforge/assembly/`. It stores unique part instances and rigid LDraw transforms, derives graph edges from the nominal stud/receiver matcher, and exports LDraw plus a colour-aware BOM from the same graph. A constrained rectangular placement strategy lives in `src/brickforge/construction/`.

The public [Block builder](https://descalzi.github.io/brickforge/builder.html) runs the corresponding browser-native engine in `docs/assets/construction-engine.js`. It reads the published profile catalogue, places parts, checks candidate connections and nominal body bounds, renders a local 3D preview and creates downloadable outputs on the visitor's device. Node tests compare its assembly graph, BOM and LDraw output with the committed Python-generated fixture. No construction server is needed. Automatic placement against arbitrary input meshes remains future work. See [assembly graph v1](assembly-graph.md).

### 4.5 Validation

Validation should be layered:
- Geometric collision and interpenetration checks.
- Connection compatibility and alignment.
- Graph connectivity and loose-part detection.
- Support and stability heuristics.
- Assembly accessibility and step-order feasibility.
- Part and colour existence in the selected catalogue.

A validation report must distinguish proven checks from heuristics. Structural strength cannot be guaranteed by simple geometric checks.

### 4.6 Optimisation

Treat construction as a multi-objective optimisation problem. Candidate objectives:
- Shape and appearance error.
- Part count.
- Estimated cost.
- Stability/support score.
- Build complexity and number of steps.
- Part availability.

Do not collapse these into one opaque score. Preserve a Pareto set or expose user-selectable weights and explain trade-offs.

### 4.7 Instructions and exports

The instruction system consumes the validated assembly graph, not an independently regenerated model. It must derive:
- A valid dependency order.
- Subassembly and step groupings.
- Per-step added/removed part sets.
- Camera and highlighting data.
- BOM counts by part and colour.

LDraw MPD/ldr is the initial editable model export. LPub3D is a candidate for instruction layout and rendering; integration should be validated with a small fixture before committing to it.

## 5. Coordinate conventions

Nominal L-brick system dimensions:
- Stud pitch: 8.0 mm.
- Standard brick height: 9.6 mm.
- Plate height: 3.2 mm.

The engine should define one documented world coordinate convention and explicit conversion utilities for LDraw coordinates. Never scatter unit conversion constants throughout algorithms.

## 6. Initial service boundaries

Keep geometry and construction libraries independent of web frameworks, databases and LLM providers. The default product runtime is the visitor's browser, served as static assets by GitHub Pages or Cloudflare Pages. Python library and command-line entry points are engineering/reference tools, not user prerequisites. Add remote processing only if measured client-side limits later justify it.

## 7. Open technical questions

- Which source provides reliable connection metadata, and under what licence?
- How should flexible, deformable, or multi-position parts be represented?
- Which stability checks are feasible without physical simulation?
- What instruction format and renderer provide the best quality and automation?
- How should colour availability and retired parts be versioned?
- How should the engine represent illegal-but-common building techniques versus strict clutch/connection rules?
