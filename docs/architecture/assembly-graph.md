# Assembly graph v1

BrickForge's assembly graph is the canonical record of a constructed model.
Each placed part is a node with a stable instance identifier, a real LDraw part
identifier, a colour code and a rigid transform in the LDraw coordinate frame.
Each graph edge records a pair of instances and the nominal connector feature
pairs that support their connection.

The version-1 JSON contract is defined in
[\`schemas/assembly-graph-v1.schema.json\`](../../schemas/assembly-graph-v1.schema.json).
The BOM has its own derived-data contract at
[\`schemas/bom-v1.schema.json\`](../../schemas/bom-v1.schema.json).

## Coordinate and placement convention

Translations and matrices are stored in LDraw Units (LDU), with the existing
LDraw convention: -Y points up. A placement matrix contains nine row-major
values, followed by its three-component translation. The same values are
written to the type-1 LDraw part reference.

Part identifiers are stored without a directory or extension. The initial
export writes each reference as \`<part_id>.dat\`, resolved by the user's LDraw
library. Colour codes are numeric LDraw colour identifiers.

## Graph construction and checks

\`build_assembly()\` accepts placed parts and the connection-profile catalogue.
It performs these deterministic checks:

1. Every instance identifier is unique and every part has a known profile.
2. Every transform is finite and orthonormal (including valid mirrored
   orthogonal transforms).
3. The nominal part-body envelopes do not interpenetrate.
4. Each pair of parts is checked by the stud/receiver matcher. A graph edge is
   recorded only when at least one feature pair aligns within the configured
   position tolerance and has opposing connector axes.
5. The resulting graph is connected. A one-part assembly is trivially
   connected.

The body-overlap test transforms the eight corners of a rectangular envelope
based on the profile's nominal footprint and body height, then compares the
resulting axis-aligned bounds. It is deliberately conservative for rotated
parts; it is not detailed triangle-mesh collision detection. Stud projections
and internal receiver geometry are not part of that body envelope.

The existing connection matcher supplies candidate stud-grid alignments. An
edge is therefore evidence of a nominal geometric interface only. Neither
this graph nor these checks prove clutch force, material behaviour, strength,
stability, or legal/approved building techniques. Those require richer
connection data and additional validation.

## Derived outputs

The \`Assembly\` object is the single source for all current outputs:

- **LDraw model:** one type-1 record per placed part, with the stored colour,
  translation and matrix.
- **Assembly JSON:** nodes and explicit graph edges, including each matched
  feature identifier, positional error and connector-axis dot product.
- **BOM JSON:** part quantities grouped by part identifier and colour.

This keeps the model and inventory consistent by construction. Build
instructions and sequencing are not generated yet.

## Reproduce the first demonstrator

Install the development package from the repository root:

\`\`\`bash
python -m pip install -e ".[dev]"
\`\`\`

Run:

\`\`\`bash
brickforge-demo-assembly
\`\`\`

The command validates two 3001 (Brick 2 x 4) instances: a red lower brick at
the origin and a blue upper brick translated by -24 LDU on Y. It writes:

- \`examples/stacked-3001.ldr\`
- \`examples/stacked-3001.assembly.json\`
- \`examples/stacked-3001.bom.json\`

The expected graph contains one edge supported by eight nominal feature
matches, and the BOM contains two 3001 bricks in two colours. The example is a
small integration test of the graph, connection matcher, LDraw exporter and
inventory—not an automatic shape-generation engine.
