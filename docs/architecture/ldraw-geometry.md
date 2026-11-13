# LDraw geometry ingestion

BrickForge keeps the descriptive/provenance parser in `parts/ldraw.py`
separate from the geometric record parser in `parts/ldraw_geometry.py`.

## Supported records

The geometry parser currently recognises:

| LDraw line type | BrickForge representation |
| --- | --- |
| 1 | `LDrawSubfileReference`: colour, translation, 3×3 transform and filename |
| 2 | `LDrawPrimitive`: a two-point line |
| 3 | `LDrawPrimitive`: a three-point filled triangle |
| 4 | `LDrawPrimitive`: a four-point filled quadrilateral |
| 5 | `LDrawPrimitive`: a four-point optional line |

Type-0 metadata/comments and unknown integer line types are ignored. A malformed
record with a recognised geometry type raises `LDrawParseError` with its
source and line number. Direct solid and transparent colour tokens are retained
as hexadecimal strings; ordinary colour identifiers are integers.

## Coordinate units

LDraw geometry is stored in LDraw Units (LDU), not millimetres. The nominal
conversion used by BrickForge is 1 LDU = 0.4 mm. A stud pitch is 20 LDU, a
standard brick height is 24 LDU, and a plate height is 8 LDU. These values are
centralised in the parser module; geometry remains in source LDU until a caller
explicitly converts it.

LDraw uses a right-handed coordinate system with -Y pointing up. Type-1
references carry a 3×3 matrix and translation. The current parser preserves
these values but does not yet recursively resolve references or apply the
transforms.

## Deliberate boundaries

Parsing geometry does not prove that parts connect. Type-1 references describe
file composition; they are not physical connection declarations. Physical
connection primitives, compatibility, collision checks and assembly ordering
will be modelled separately and validated independently.
