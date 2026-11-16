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
