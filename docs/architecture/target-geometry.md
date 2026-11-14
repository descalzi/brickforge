# Target geometry representation

## Purpose

The target geometry layer converts an imported mesh into a deterministic, scale-aware representation that construction algorithms can query. It is an intermediate description of the requested shape, not a construction and not a claim that the shape can be built from available elements.

The representation must be independent of the part catalogue and assembly graph. This lets mesh analysis evolve without changing the canonical construction format.

## Coordinate and grid conventions

- Canonical world coordinates are millimetres, with **Y up**.
- Horizontal stud-grid pitch is 8.0 mm along X and Z.
- A standard brick course is 9.6 mm high along Y; a plate course is 3.2 mm.
- Grid indices are integer triples `(x, y, z)`; Y is the course axis.
- A cell's physical bounds are derived from a grid origin and the pitch tuple `(8.0, 9.6, 8.0)` mm for brick-course sampling. Plate-resolution sampling is a separate grid specification, not a silent change to the brick grid.
- Source mesh coordinates, declared units, and any user-selected scale/orientation transform must be retained as provenance. Import must never silently resize or rotate a model to make it fit.

The grid origin and alignment offset are explicit values. A caller may centre the grid around the target or anchor it to a selected datum, but the chosen alignment must be reproducible and included in the result.

## Cell data

The first implementation should retain more information than a single occupied/empty bit:

- **Interior occupancy** — whether the cell lies inside a closed target solid.
- **Surface coverage** — a normalised estimate of how much of the cell intersects the target surface.
- **Boundary classification** — interior, exterior, or boundary/uncertain.
- **Optional surface distance** — distance from the cell centre to the nearest target surface, when available.

This allows the construction engine to distinguish a solid core from thin surface details and to score candidate placements for visual fit. Exact sampling method and thresholds must be versioned; they must not be hidden constants.

## Mesh handling policy

1. Preserve source units and original bounds in the import report.
2. Reject empty meshes, non-finite coordinates, and degenerate faces before voxelisation.
3. Initially require a closed, watertight mesh for solid interior filling. A non-watertight mesh may later use an explicit surface-shell mode with a user-selected thickness; it must never be silently treated as a filled solid.
4. Keep disconnected components identifiable. Do not bridge gaps or merge nearby components during import.
5. Record winding consistency and self-intersection diagnostics. If a mesh cannot be classified reliably, return an explicit unsupported/uncertain result rather than guessing its interior.
6. Apply resource limits before allocating the grid. Report the requested dimensions and estimated cell count when a limit is exceeded.

## Layer extraction and construction hand-off

A brick-course grid can be sliced into 2D X/Z occupancy maps, one per Y course. Each map is a candidate target footprint, not a final brick layout. The existing bounded footprint tiler can be reused to propose part arrangements for individual courses; the complete 3D candidate must still pass cross-course connection, collision, and graph-connectivity checks.

Layer extraction must preserve the relationship to the original 3D target so later surface fitting can distinguish a solid internal fill from visible exterior geometry. A layer that cannot be tiled or connected must be reported as such; the engine must not silently omit occupied cells.

## Determinism and browser parity

The browser implementation is the product implementation and is authoritative for user-facing mesh ingestion and construction. The Python package is a supporting reference and offline analysis tool, not a mandatory parallel implementation. Share versioned data contracts and analytic test fixtures; require algorithm-level parity only where an independent Python result provides meaningful verification. Do not duplicate browser features in Python merely for symmetry.

Each result should carry a representation version, source identifier/hash where available, source units, scale/orientation transform, grid origin, grid pitches, dimensions, classification settings and warnings. This is required for reproducible regeneration and meaningful comparisons between engine versions.

## Initial regression corpus

Start with small analytic and synthetic meshes whose expected results are known:

- Axis-aligned cuboids whose dimensions are exact multiples and non-multiples of stud/course pitch.
- Translated and uniformly scaled copies of the same cuboid.
- A cylinder and a sphere to exercise curved boundaries.
- A mesh with disconnected components.
- Open, non-watertight, degenerate and non-finite input cases.
- Inputs that exceed the configured cell budget.

Tests must cover both geometry classification and the derived per-course 2D maps. Browser/Python parity is a release requirement before the mesh-to-builder workflow is exposed.

## Current implementation status

The Python supporting package defines `GridSpec` and immutable `TargetGrid`
data types in `src/brickforge/geometry/grid.py`. The model validates physical
grid spacing, dimensions, source bounds, cell classifications and surface
coverage; it provides deterministic cell/world mapping, flattened indexing,
summary metadata and per-course footprint extraction. The representation is
versioned and exported from `brickforge.geometry`.

The browser now has the authoritative versioned `GridSpec` and `TargetGrid` data model in `docs/assets/target-grid.js`. It uses the same X/Y/Z dimensions, Y/Z/X backing layout, X-fastest flat indexing, millimetre coordinates, cell-centre mapping, classification values, source provenance and per-course footprint ordering as the Python reference. Its data-model tests exercise the same synthetic grid and summary values as the Python tests. Browser mesh voxelisation is implemented in `docs/assets/mesh-voxelizer.js` and runs in a dedicated worker. The browser path uses a triangle BVH for point-in-solid scanlines and nearest-surface queries, so it can remain responsive without introducing a second server-side processing path.\n\nThe Python reference package now also provides `voxelize_mesh()` in
`src/brickforge/geometry/voxelize.py`. It converts declared source units to
millimetres, aligns a grid to the global pitch, enforces a cell budget, and
classifies each cell using a deterministic 3x3x3 sample lattice. It currently
requires watertight, consistently wound meshes and processes cells in bounded
batches. The sampled inside fraction is stored as surface coverage.

The browser voxeliser is the primary implementation. It uses a 3x3x3 interior sample lattice and nearest-triangle distance to retain thin features; this is still an approximation, not exact triangle-cell clipping. It requires a closed, consistently wound mesh and enforces face, cell and ray-test budgets. Open-mesh shell mode, self-intersection diagnostics, orientation-aware grids and automatic mesh-driven construction remain future work.

## Deliberate boundary

A target occupancy grid does not prove that an assembly can be built. It does not encode clutch force, support, build sequence, or part-specific connection geometry. Those remain separate construction and validation responsibilities.
