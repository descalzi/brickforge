# Measured part feature profiles

The Part Explorer can analyse the resolved triangle geometry of a selected LDraw part and export a versioned JSON profile. This is separate from the nominal connection-profile catalogue: it records measured geometric openings, not physical connection behaviour.

## Extraction

The browser resolves the selected part and its nested LDraw references, converts geometry into millimetres, then sends its triangle positions to a dedicated worker. The worker samples seven cross-sections along each principal axis, finds nested contours, and clusters contours that persist across slices.

Each detected feature records:

- Local axis and centre position in millimetres.
- Approximate bounds and observed span through the part.
- Cross-section width, length, area and perimeter.
- Equivalent circular diameter, circularity and aspect ratio.
- Number of supporting slices and a coarse confidence label.

The export is validated against `schemas/part-feature-profile-v1.schema.json`.

## Interpretation and limitations

These profiles are geometry measurements, not connection instructions. A circular opening does not by itself tell us whether a pin, axle, shaft or other part fits; nominal tolerances, surrounding material, wall thickness, part orientation, assembly access and physical clutch behaviour remain separate concerns.

The current analyser uses principal-axis sections only. It may miss or approximate oblique, curved, branching and blind openings, and it does not infer topology for the LDraw part. A missing profile is not proof that a part has no openings.

## Next step

Build a curated set of source-verified profiles for useful specialised parts, then compare target-mesh features against those profiles. A match must remain a geometric candidate until its placement, surrounding envelope and connection interfaces have been independently validated.
