# Object specification and construction engine

## Contract and production boundary

The input describes the intended object independently of the parts catalogue:
semantic components, millimetre geometry, required/forbidden features, colours,
relations and empty spaces. There are no part IDs or build recipes in authored
briefs. Runtime validation and the JSON Schema share the version-1 contract.
`fit_tolerance_mm` permits an explicit dimension deviation of at most 4 mm;
otherwise dimensions remain exact. `position_tolerance_mm` permits connector-derived translations within an explicit per-axis uncertainty of at most 8 mm; zero keeps a component fixed. Realised sizes are reported against requests.

Browser JavaScript is authoritative. Static publication serves code and data;
construction needs no server. Python ingests source catalogues and produces or
audits independent geometric references.

## Relative intent constraints

`dimension_ratio` preserves named component-axis proportions. Explicit
`aligned_with` relationships specify a coordinate axis, min/max/center anchors
and an optional signed offset. Explicit `symmetric_to` names the mirror axis and
plane and checks equal dimensions, cross-axis centres and mirrored profile
outlines. Legacy unqualified alignment/symmetry remains readable, with a warning
about its weaker interpretation.

These constraints are evaluated on the actual nominal dimensions and positions
after fitting. A dimension allowance cannot silently break a required proportion.
The exported relationship checks retain measured/expected values and tolerances.
This validates relative requirements; it does not synthesise an unrestricted
relative layout from symbolic dimensions.

## Discovery, placement and search

Semantic translation and capability discovery restrict eligible profiles.
Structural components use exact course tiling; automatic course choice can mix
brick and plate heights between components. Specialised components match a
curated body/cylinder/convex profile and dimensions through proper right-angle
rotations. Constant-section elements may repeat along an extrusion. A wheel
recipe composes actual rim and tyre instances; it never exports a fictional
assembly part ID. Recipes belong to the catalogue, not to object templates.

The global search enforces requested direct attachments with cached nominal
interface compatibility, chooses constrained components first and evaluates
realised spatial relationships. Node/combination budgets remain bounded and are
reported. Unknown, absent or geometrically incompatible essentials stay blocked.
Connector-derived translations propagate through declared attachments inside explicit position tolerances, retaining required relationships and rejecting overlaps. This is not yet general polyhedral packing or unrestricted object/pose synthesis.

## Geometry, connectivity and evidence

Structural profiles and selected source-backed specialists expose nominal
stud/receiver, wheel-pin/bore and rim/tyre-seat datums. Wheel bores are directional;
proper orientation matters. Every exported instance contributes to the same
mating graph, BOM, LDraw model, viewer and sequence.

Placed nominal body bounds must not intersect except at an explicitly matched
rim/tyre seat. Specialist envelopes are conservative and exclude connector
protrusions and internal cavities. The tyre/rim exception is source-family
compatibility evidence, not a universal overlap exemption.

`assembly-analysis.js` computes a ground-contact hull and a bounding-volume,
uniform-density centre proxy. It is not a mass or load model. Sequence approaches
sweep nominal bodies along connector axes against prior parts. Stud interference,
internal cavities, deformation, hand access and physical retention are outside
that check. Physical strength and stability remain `not_assessed`.

## Instructions, revisions and language

The canonical sequence covers every part once, preserves graph dependencies and
records nominal approach status. Both scene-step inspection and LDraw STEP
records use it. The browser PDF exporter draws source/nominal geometry as vector
faces, embeds the licensed instruction font and derives the inventory from the
same instances. PDF diagrams are bounded to 120 parts; larger plans retain LDraw
and report exports. A geometrically plausible sequence still needs physical
build trials.

Revisions store validated brief snapshots on the visitor's browser; restoring a
revision re-plans it rather than trusting stale generated geometry.

`text-design.js` provides a provider-neutral prompt/request/schema and validates
returned specifications. The optional gateway transport sends only the explicit
request, omits browser credentials, supports cancellation and has a timeout. No
provider, authentication scheme, billing or real-model quality is represented as
implemented. Exporting the request and importing its returned JSON is supported.

## Release and regression evidence

The primary studio and Inspector renderers are vendored, and fonts are local or
browser fallbacks. Inspector CI waits for actual application readiness rather
than unrelated network idleness. A release stamping script versions project
modules and studio data URLs so a deployment cannot silently mix cached versions.

Node/Chromium regressions cover the authored briefs, malformed intent, missing
features, direct joins, wheel composition/orientation, exact versus tolerated
sizes, collisions, support evidence, canonical sequence/PDF records, gateway
validation/cancellation, revisions, exports and mobile layout. Original challenge
briefs remain unmodified acceptance targets; smaller passing examples do not
silently redefine them.

### Bounded relative placement

Explicit alignment and mirror-plane relations also propose component translations.
The proposals use the candidate's realised body bounds, combine independent axes
for a common component pair, and run alongside connector-derived translations.
Only components with `position_tolerance_mm` can move. Cumulative movement stays
within the original per-coordinate allowance; negative spaces, complete relation
checks, body envelopes and actual mating edges still gate the final assembly.
The shared attempt, round and alternative limits bound propagation. Search reports
include `layout_candidates_generated`; reached limits are not proofs of infeasibility.
This does not infer arbitrary symbolic layouts or add new orientations.

### Semantic facing and profile rotation

Components may require `orientation.up` and `orientation.forward` using signed
world axes. Source-backed profiles declare the corresponding local directions;
slopes define forward as downhill. Candidate rotations must satisfy both the
shape and this frame. Unknown source directions fail closed.
`extrusion_axis` defaults to Z (X/Y outline) and can be X (Z/Y outline); the
profile extrusion length remains `depth_mm`. The editor rotates the outline,
width/depth and position about the component centre together. These are rigid
right-angle operations, not a camera change or a dimensional substitution.

The dome profile has one central top stud, four nominal underside grid contacts
and a central underside tube receiver checked against its source primitives.
A source-backed 3x3 plate supplies a real central stud for the concentric mushroom.

### Illustrated booklet renderer

The PDF uses the canonical parts, BOM and step order. Cover and completed-model
views, illustrated inventory and per-step parts trays accompany depth-buffered
assembly diagrams. New parts retain their colours; previous parts are softened.
Nominal approach vectors supply exploded offsets and placement arrows, labelled
as geometric guidance rather than physical insertion certification. Early and
partial views fit the visible assembly. The pure JavaScript rasterizer tests
per-pixel depth, including intersecting triangles and hidden crease edges, so
it does not depend on source BFC winding or whole-triangle painter ordering.
Page text and arrows remain vectors; diagrams are embedded RGB images at twice
their point dimensions. Browser-native deflate compresses image, text and font
streams. The byte writer computes offsets from actual bytes, not decoded text.
Exports yield between step pages and discard results if the active plan changes.

### Stage support guidance

Canonical steps carry a support snapshot after each addition. An incremental
tracker accumulates uniform-envelope volume and centre, updates the lowest
contact band and its convex hull, and flags projections outside that hull or
line-only contacts. The Studio step description and PDF recommend hand support
for flagged stages. The complete model can pass the final proxy while earlier
stages need holding. The tracker does not repeat all-pairs collision analysis
for every step. Hollow geometry, density, clutch, loads and real physical
stability remain unverified; an unflagged stage is not a stability certificate.

Sequence roots prefer a broad, shallow part with a supported nominal projection
over a loose rolling element. This generic envelope heuristic gives a better
starting foundation; subsequent additions still follow real graph edges and
nominal clear approaches. It is not a physical sequence optimisation proof.

### Exact multi-part profile composition

If a complete extruded profile does not match a single source part, the browser
can pack an upright constant-section profile with structural boxes and measured
slope prisms. It enumerates source-backed placements on an 8 mm horizontal and
3.2 mm vertical grid, then partitions the polygon using all placement edges.
Horizontal bands are split at edge crossings; exact trapezoidal material atoms
are extended through extrusion slabs. A bounded exact-cover search covers each
required atom once, checks source-part volume against atom volume, and retains
concavities and explicit empty spaces. Required capabilities apply to the
composition; forbidden capabilities exclude every candidate. Actual mating
edges still gate the whole assembly. There are no roof/object recipes.

Placement, arrangement-size, search-node and alternative limits are explicit.
A failed bounded search is not a proof of impossibility. Curved surfaces and
non-right-angle placements are outside this exact prism path.

Nominal material collision uses separating axes for solid structural boxes and
convex source slope prisms. Other profiles keep conservative envelopes. This
avoids treating overlap of sloped-part bounding boxes alone as material
interpenetration. Protruding studs, cavities, friction and physical insertion
remain outside the nominal body model.

### Explicit rounded-shape approximation

A sphere or cylinder with positive `shape_tolerance_mm` can opt into stepped
structural composition. Zero remains exact. Kept stud/course cells fit within
the allowed outer radius; every cell touching the required inner core is kept
unless removed by an explicit void. Reported outer-excess and missing-inner-band
bounds are computed from cell corners and nearest points. Bounds, required
source features and empty spaces remain separate constraints. A smooth-curve
requirement is not satisfied by structural boxes, and a grid that erases the
rounded silhouette into a full box is rejected. Partial-cell voids fail closed.

Cross-course beam search ranks component contacts and preserves root-layout
diversity across all layers. It avoids spending a depth-first combination budget
on variants of only the last layers. Source-profile mating and final material
checks still validate selected assemblies. Beam/node limits are exposed; a good
candidate is not an optimality proof. These stepped models do not implement
general smooth curved-part packing.

### Joint-selected dimensions and mixed heights

An uncertain rectangular component enumerates structural grid sizes inside its
explicit per-dimension allowance. Auto courses include both brick and plate
height choices. Measured specialist alternatives are retained alongside those
grids, and source poses/dimension groups retain search diversity. Joints, exact
relations and collisions choose the realised size; nearest rounding alone is
not authoritative. A shared node budget and retained-layout cap expose limits.
Zero allowance never activates dimension changes. Original briefs are immutable.

Auto structural heights that do not divide into brick courses can use the exact
prism cover to combine bricks and plates within one component. Explicit rounded
occupancy masks do not enter this full-box path. Rounded shape allowance and
dimension allowance stay independent. The Studio displays requested and realised
sizes and the allowed deviation beside connection evidence.
