# Nominal connection profiles — version 1

BrickForge's canonical connection data is authored in
`data/connection-profiles/basic-bricks.json`. An identical published copy lives
at `docs/data/connection-profiles/basic-bricks.json` because GitHub Pages
publishes the `docs/` directory only. CI checks that these two files remain
byte-for-byte identical. The browser loads the published copy at
`./data/connection-profiles/basic-bricks.json`. The data is intentionally
separate from the LDraw render-geometry files. Geometry records describe surfaces and
sub-file composition; these profiles describe candidate physical interfaces.

## Coordinate frame

All positions are in LDraw units (LDU), in the source part's local coordinate
frame. LDraw uses -Y as up.

- One stud pitch is 20 LDU (8 mm).
- The top-stud datum is placed on the top body plane at Y = 0.
- A stud's approach axis points along -Y, out of the top face.
- An underside receiver datum is placed on the lower body plane: Y = 24 LDU
  for a standard brick and Y = 8 LDU for a plate.
- A receiver's approach axis points along +Y, into the underside.

The catalogue currently includes parts 3001, 3003, 3004, 3005, 3020 and 3021.
Every position is represented as an explicit feature so later part families
can add different connector types without changing the profile envelope.

## Matching semantics

`load_connection_profiles()` validates and loads the JSON catalogue.
`find_mating_pairs()` applies caller-supplied rigid transforms, then reports
one-to-one pairs where:

1. one feature is a stud and the other is a stud receiver;
2. their transformed datum positions are within the configured LDU tolerance;
3. their transformed axes oppose one another.

A feature cannot be paired more than once in one result. This provides the
first deterministic geometric interface for an assembly graph.

## What this does not prove

The profiles are nominal stud-grid datums based on the standard part footprint.
The receiver is an intended stud-entry location, not a measured representation
of the internal tube, cavity or clutch profile. The matcher does not model
interference, friction, clutch force, material deformation, wear, legal part
combinations or structural stability.

A non-zero result therefore means **candidate grid alignment**, not a validated
LEGO connection. Do not use these profiles to assert that an arbitrary part
combination will physically hold together. Specialised elements (Technic,
clips, bars, hinges, slopes, tiles, flex parts and others) need their own
connection schemas and separately verified data.

## Provenance

The connection datums are BrickForge-authored, not copied from BrickLink Studio
or another proprietary connectivity database. LDraw part IDs and descriptions
identify the geometry basis. The per-part source author and licence notice are
retained as provenance hints; the original LDraw files and every dependency
header remain authoritative for attribution and licence review.

The matching implementation is in `src/brickforge/parts/connections.py`,
with its JSON Schema at
`schemas/connection-profiles-v1.schema.json`.
