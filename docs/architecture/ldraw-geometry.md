# LDraw geometry ingestion

BrickForge keeps descriptive/provenance parsing in `parts/ldraw.py`
separate from geometric record parsing in `parts/ldraw_geometry.py` and
recursive library expansion in `parts/ldraw_resolver.py`.

## Supported records

The geometry parser recognises:

| LDraw line type | BrickForge representation |
| --- | --- |
| 1 | `LDrawSubfileReference`: colour, translation, 3×3 transform and filename |
| 2 | `LDrawPrimitive`: a two-point line |
| 3 | `LDrawPrimitive`: a three-point filled triangle |
| 4 | `LDrawPrimitive`: a four-point filled quadrilateral |
| 5 | `LDrawPrimitive`: a four-point optional line |

Type-0 metadata/comments and unknown integer line types are ignored. A malformed
record with a recognised geometry type raises `LDrawParseError` with its
source and line number. Ordinary colour identifiers are stored as integers;
LDraw direct RGB colour tokens (`0x2RRGGBB`) are retained as hexadecimal strings.

## Library resolution and transforms

`LDrawLibrary` indexes the standard `parts/`, `p/`, and `models/` folders
with case-insensitive filename lookup. It prefers references relative to the
file containing the reference, then looks in the library indexes. Absolute
references are accepted only when they remain inside the selected library root.

`resolve_part_geometry()` recursively expands type-1 references and returns
type-2 to type-5 primitives in the root part's coordinate system. Translation
and 3×3 matrices are composed at each level using the point equations in the
LDraw specification. Missing files, cyclic references, path escapes, and
excessive nesting are rejected.

Colour 16 is resolved to the current inherited colour. Colour 24 remains
explicitly marked as the edge/complement colour, with the inherited base colour
attached as `edge_base_colour`; it is not guessed without the LDraw colour
definition table. Explicit part colours and direct RGB tokens are preserved.

## Coordinate units

LDraw geometry is stored in LDraw Units (LDU), not millimetres. The nominal
conversion used by BrickForge is 1 LDU = 0.4 mm. A stud pitch is 20 LDU, a
standard brick height is 24 LDU, and a plate height is 8 LDU. These values are
centralised in the parser module; resolved geometry remains in source LDU until
a caller explicitly converts it.

LDraw uses a right-handed coordinate system with -Y pointing up. The parser
preserves the source matrix and translation; the resolver composes and applies
them without changing the source coordinate convention.

## Browser part explorer

`docs/parts.html` and `docs/assets/parts.js` provide a visual proof of concept
for six common brick and plate parts. The browser fetches each LDraw text file
from a public mirror, recursively resolves type-1 references across `parts/`
and `p/`, composes the 3×3 transforms and translations, and expands types 2–5
into Three.js meshes and line segments. The viewer reads `LDConfig.ldr` for
face and edge colours, resolves colour 16 against the selected preview colour,
and converts LDU to millimetres for its displayed dimensions. It also collects
the source `AUTHOR` and `!LICENSE` notices from all files in the expanded
part tree.

This page is an integration demonstrator, not the canonical catalogue import:
it depends on a third-party public mirror which may lag the official release,
and it does not yet validate physical connection points. The Python resolver
still needs validation against a downloaded, version-pinned official archive.

## Nominal connection metadata

The first BrickForge-authored connection profiles are documented in [connection profiles](connection-profiles.md). They are separate from render geometry and describe stud and underside receiver datums for six standard bricks and plates. A transformed feature matcher identifies opposed stud/receiver pairs within a nominal positional tolerance. This is only a candidate grid-alignment test; it does not prove clutch engagement, stability or buildability.

## Deliberate boundaries

This parser and resolver expand render geometry; they do not infer or prove
physical LEGO connections. Type-1 references describe file composition, not
physical connection declarations. Colour-24 RGB values also require an LDraw
colour definition table, which is not yet implemented. Connection primitives,
compatibility, collision checks, and assembly ordering remain separate
BrickForge subsystems.