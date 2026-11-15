const IDENTITY_MATRIX = Object.freeze([
  1, 0, 0,
  0, 1, 0,
  0, 0, 1,
]);

const ROTATE_Y_90 = Object.freeze([
  0, 0, 1,
  0, 1, 0,
  -1, 0, 0,
]);

const LDU_TO_MM = 0.4;
const DEFAULT_POSITION_TOLERANCE_LDU = 0.25;
const DEFAULT_COLLISION_TOLERANCE_LDU = 1e-6;
const MAX_GENERATED_PARTS = 200;

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new TypeError(label + " must be a finite number.");
  }
  return number;
}

function transformVector(matrix, vector) {
  const [x, y, z] = vector;
  return [
    matrix[0] * x + matrix[1] * y + matrix[2] * z,
    matrix[3] * x + matrix[4] * y + matrix[5] * z,
    matrix[6] * x + matrix[7] * y + matrix[8] * z,
  ];
}

function transformPoint(matrix, translation, point) {
  const transformed = transformVector(matrix, point);
  return [
    transformed[0] + translation[0],
    transformed[1] + translation[1],
    transformed[2] + translation[2],
  ];
}

function distance3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function findMatingPairs(
  profileA,
  placementA,
  profileB,
  placementB,
  positionToleranceLdu = DEFAULT_POSITION_TOLERANCE_LDU,
) {
  const tolerance = finiteNumber(positionToleranceLdu, "positionToleranceLdu");
  if (tolerance < 0) {
    throw new RangeError("positionToleranceLdu must be non-negative.");
  }

  const candidates = [];
  for (const featureA of profileA.features) {
    for (const featureB of profileB.features) {
      if (featureA.kind === featureB.kind) continue;

      const positionA = transformPoint(
        placementA.matrix,
        placementA.translation_ldu,
        featureA.position_ldu,
      );
      const positionB = transformPoint(
        placementB.matrix,
        placementB.translation_ldu,
        featureB.position_ldu,
      );
      const positionError = distance3(positionA, positionB);
      if (positionError > tolerance) continue;

      const axisA = transformVector(placementA.matrix, featureA.axis);
      const axisB = transformVector(placementB.matrix, featureB.axis);
      const axisDot = axisA.reduce((sum, value, index) => sum + value * axisB[index], 0);
      if (axisDot > -1 + 1e-6) continue;

      candidates.push({
        position_error_ldu: positionError,
        axis_dot: axisDot,
        feature_a: featureA.feature_id,
        feature_b: featureB.feature_id,
      });
    }
  }

  candidates.sort((a, b) =>
    a.position_error_ldu - b.position_error_ldu
    || compareText(a.feature_a, b.feature_a)
    || compareText(a.feature_b, b.feature_b));

  const usedA = new Set();
  const usedB = new Set();
  const matches = [];
  for (const candidate of candidates) {
    if (usedA.has(candidate.feature_a) || usedB.has(candidate.feature_b)) continue;
    usedA.add(candidate.feature_a);
    usedB.add(candidate.feature_b);
    matches.push(candidate);
  }
  return matches;
}

function bodyBounds(placement, profile) {
  const halfX = profile.footprint_studs_x * profile.stud_pitch_ldu / 2;
  const halfZ = profile.footprint_studs_z * profile.stud_pitch_ldu / 2;
  const corners = [];

  for (const x of [-halfX, halfX]) {
    for (const y of [0, profile.body_height_ldu]) {
      for (const z of [-halfZ, halfZ]) {
        corners.push(transformPoint(
          placement.matrix,
          placement.translation_ldu,
          [x, y, z],
        ));
      }
    }
  }

  const minimum = [0, 1, 2].map((axis) =>
    Math.min(...corners.map((point) => point[axis])));
  const maximum = [0, 1, 2].map((axis) =>
    Math.max(...corners.map((point) => point[axis])));
  return { minimum, maximum };
}

function boundsOverlapInVolume(a, b, tolerance) {
  const overlaps = [0, 1, 2].map((axis) =>
    Math.min(a.maximum[axis], b.maximum[axis])
    - Math.max(a.minimum[axis], b.minimum[axis]));
  return overlaps.every((overlap) => overlap > tolerance);
}

function validateConnectedGraph(parts, connections) {
  if (parts.length <= 1) return;

  const adjacency = new Map(parts.map((part) => [part.instance_id, new Set()]));
  for (const edge of connections) {
    adjacency.get(edge.instance_a).add(edge.instance_b);
    adjacency.get(edge.instance_b).add(edge.instance_a);
  }

  const visited = new Set([parts[0].instance_id]);
  const pending = [parts[0].instance_id];
  while (pending.length) {
    const current = pending.pop();
    for (const neighbour of adjacency.get(current)) {
      if (!visited.has(neighbour)) {
        visited.add(neighbour);
        pending.push(neighbour);
      }
    }
  }

  if (visited.size !== parts.length) {
    const disconnected = parts
      .map((part) => part.instance_id)
      .filter((id) => !visited.has(id))
      .sort(compareText);
    throw new Error(
      "The proposed block contains disconnected parts: " + disconnected.join(", ") + ".",
    );
  }
}

function validatePlacements(parts, profiles, options) {
  const ids = new Set();
  const bounds = new Map();

  for (const part of parts) {
    if (ids.has(part.instance_id)) {
      throw new Error("Part instance identifiers must be unique.");
    }
    ids.add(part.instance_id);
    const profile = profiles.get(String(part.part_id));
    if (!profile) {
      throw new Error("No connection profile is available for part " + part.part_id + ".");
    }
    bounds.set(part.instance_id, bodyBounds(part, profile));
  }

  for (let indexA = 0; indexA < parts.length; indexA += 1) {
    for (let indexB = indexA + 1; indexB < parts.length; indexB += 1) {
      const a = parts[indexA];
      const b = parts[indexB];
      if (boundsOverlapInVolume(
        bounds.get(a.instance_id),
        bounds.get(b.instance_id),
        options.collisionToleranceLdu,
      )) {
        throw new Error(
          "Nominal body bounds overlap for " + a.instance_id + " and " + b.instance_id + ".",
        );
      }
    }
  }

  const connections = [];
  for (let indexA = 0; indexA < parts.length; indexA += 1) {
    const partA = parts[indexA];
    const profileA = profiles.get(String(partA.part_id));
    for (let indexB = indexA + 1; indexB < parts.length; indexB += 1) {
      const partB = parts[indexB];
      const profileB = profiles.get(String(partB.part_id));
      const matingPairs = findMatingPairs(
        profileA,
        partA,
        profileB,
        partB,
        options.positionToleranceLdu,
      );
      if (matingPairs.length) {
        connections.push({
          instance_a: partA.instance_id,
          instance_b: partB.instance_id,
          mating_pairs: matingPairs,
        });
      }
    }
  }

  validateConnectedGraph(parts, connections);
  return connections;
}

function createBom(parts) {
  const quantities = new Map();
  for (const part of parts) {
    const key = part.part_id + "\u0000" + part.colour_code;
    quantities.set(key, (quantities.get(key) || 0) + 1);
  }

  const items = [...quantities.entries()].map(([key, quantity]) => {
    const [partId, colourCode] = key.split("\u0000");
    return {
      part_id: partId,
      colour_code: Number(colourCode),
      quantity,
    };
  });
  items.sort((a, b) =>
    compareText(a.part_id, b.part_id) || a.colour_code - b.colour_code);
  return {
    schema_version: 1,
    model_name: "",
    total_parts: parts.length,
    items,
  };
}

function formatNumber(value) {
  const number = finiteNumber(value, "LDraw coordinate");
  if (Math.abs(number) < 1e-12) return "0";
  return Number(number.toPrecision(12)).toString();
}

export function exportLDraw(assembly) {
  const lines = [
    "0 " + assembly.model_name,
    "0 Name: " + assembly.model_name + ".ldr",
    "0 Author: BrickForge",
    "0 // Part placements use the canonical assembly graph transforms.",
  ];

  for (const part of assembly.parts) {
    const values = [...part.translation_ldu, ...part.matrix].map(formatNumber);
    lines.push(
      "1 " + part.colour_code + " " + values.join(" ") + " " + part.part_id + ".dat",
    );
  }
  return lines.join("\n") + "\n";
}

export function buildRectangularBlock(widthStuds, depthStuds, heightBricks, catalogue, config = {}) {
  const width = Number(widthStuds);
  const depth = Number(depthStuds);
  const height = Number(heightBricks);
  for (const [name, value] of [
    ["widthStuds", width],
    ["depthStuds", depth],
    ["heightBricks", height],
  ]) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new RangeError(name + " must be a positive integer.");
    }
  }

  if (height < 2) {
    throw new RangeError("heightBricks must be at least 2 courses for an interlocked block.");
  }

  if (!catalogue || catalogue.schema_version !== 1 || !Array.isArray(catalogue.profiles)) {
    throw new TypeError("The connection profile catalogue is missing or unsupported.");
  }
  const profiles = new Map(catalogue.profiles.map((profile) => [String(profile.part_id), profile]));
  const partId = String(config.partId || "3001");
  const profile = profiles.get(partId);
  if (!profile) {
    throw new Error("No connection profile is available for part " + partId + ".");
  }
  if (profile.footprint_studs_x !== 4 || profile.footprint_studs_z !== 2) {
    throw new Error("The rectangular block strategy currently requires a 4×2-stud part.");
  }

  const colourCodes = config.colourCodes || [4, 1];
  if (!Array.isArray(colourCodes) || colourCodes.length === 0) {
    throw new TypeError("At least one LDraw colour code is required.");
  }
  for (const code of colourCodes) {
    if (!Number.isInteger(code) || code < 0) {
      throw new RangeError("Colour codes must be non-negative integers.");
    }
  }

  const positionToleranceLdu = config.positionToleranceLdu ?? DEFAULT_POSITION_TOLERANCE_LDU;
  const collisionToleranceLdu = config.collisionToleranceLdu ?? DEFAULT_COLLISION_TOLERANCE_LDU;
  const maxParts = config.maxParts ?? MAX_GENERATED_PARTS;
  if (!Number.isFinite(positionToleranceLdu) || positionToleranceLdu < 0) {
    throw new RangeError("positionToleranceLdu must be finite and non-negative.");
  }
  if (!Number.isFinite(collisionToleranceLdu) || collisionToleranceLdu < 0) {
    throw new RangeError("collisionToleranceLdu must be finite and non-negative.");
  }

  const placements = [];
  const pitch = profile.stud_pitch_ldu;
  function addPlacement(placement) {
    placements.push(placement);
    if (placements.length > maxParts) {
      throw new RangeError(
        "This browser prototype is limited to " + maxParts + " parts per model.",
      );
    }
  }

  for (let layer = 0; layer < height; layer += 1) {
    const rotated = layer % 2 === 1;
    const matrix = [...(rotated ? ROTATE_Y_90 : IDENTITY_MATRIX)];
    const tileWidth = rotated ? 2 : 4;
    const tileDepth = rotated ? 4 : 2;
    if (width % tileWidth !== 0 || depth % tileDepth !== 0) {
      const orientation = rotated ? "rotated" : "unrotated";
      throw new RangeError(
        width + "×" + depth + " studs cannot be tiled by the " + orientation + " 4×2 course.",
      );
    }

    const layerColour = colourCodes[layer % colourCodes.length];
    const layerY = layer === 0 ? 0 : -layer * profile.body_height_ldu;
    const halfWidthLdu = width * pitch / 2;
    const halfDepthLdu = depth * pitch / 2;

    // One-axis layouts use a simple stagger. When both dimensions are
    // wider than one brick, use a two-axis stagger so upper elements bridge
    // the central seams in both directions.
    const staggeredWidth = rotated && width > 4 && depth === 4;
    const staggeredDepth = rotated && width === 4 && depth > 4;
    const staggeredBoth = rotated && width > 4 && depth > 4;
    if (staggeredWidth || staggeredDepth || staggeredBoth) {
      const edgeProfile = profiles.get("3004");
      if (!edgeProfile) {
        throw new Error("Staggered blocks require the 1×2 part profile 3004.");
      }
      if (edgeProfile.footprint_studs_x !== 2 || edgeProfile.footprint_studs_z !== 1) {
        throw new Error("Part profile 3004 must have a 2×1-stud footprint.");
      }

      if (staggeredWidth) {
        // Bridge lower columns with rotated 2×4 bricks and fill the two
        // one-stud-wide side strips with rotated 1×2 bricks.
        const innerColumns = (width - 2) / 2;
        for (let indexX = 0; indexX < innerColumns; indexX += 1) {
          const centreX = (-width / 2 + 2 + 2 * indexX) * pitch;
          addPlacement({
            instance_id: "layer-" + String(layer).padStart(2, "0")
              + "-inner-x-" + String(indexX).padStart(3, "0") + "-z-000",
            part_id: partId,
            colour_code: layerColour,
            translation_ldu: [
              Object.is(centreX, -0) ? 0 : centreX,
              layerY,
              0,
            ],
            matrix: [...ROTATE_Y_90],
          });
        }
        for (const [edgeName, centreXStuds] of [
          ["left", -width / 2 + 0.5],
          ["right", width / 2 - 0.5],
        ]) {
          for (let indexZ = 0; indexZ < depth / 2; indexZ += 1) {
            const centreZ = (-depth / 2 + 1 + 2 * indexZ) * pitch;
            addPlacement({
              instance_id: "layer-" + String(layer).padStart(2, "0")
                + "-edge-" + edgeName + "-z-" + String(indexZ).padStart(3, "0"),
              part_id: "3004",
              colour_code: layerColour,
              translation_ldu: [
                centreXStuds * pitch,
                layerY,
                Object.is(centreZ, -0) ? 0 : centreZ,
              ],
              matrix: [...ROTATE_Y_90],
            });
          }
        }
      } else if (staggeredDepth) {
        // With one lower column, shift 2×4 bricks by one stud along depth
        // and close the one-stud-wide front and back strips.
        for (let indexZ = 0; indexZ < depth / 2 - 1; indexZ += 1) {
          const centreZ = (-depth / 2 + 2 + 2 * indexZ) * pitch;
          addPlacement({
            instance_id: "layer-" + String(layer).padStart(2, "0")
              + "-inner-x-000-z-" + String(indexZ).padStart(3, "0"),
            part_id: partId,
            colour_code: layerColour,
            translation_ldu: [
              0,
              layerY,
              Object.is(centreZ, -0) ? 0 : centreZ,
            ],
            matrix: [...IDENTITY_MATRIX],
          });
        }
        for (const [edgeName, centreZStuds] of [
          ["front", -depth / 2 + 0.5],
          ["back", depth / 2 - 0.5],
        ]) {
          for (let indexX = 0; indexX < width / 2; indexX += 1) {
            const centreX = (-width / 2 + 1 + 2 * indexX) * pitch;
            addPlacement({
              instance_id: "layer-" + String(layer).padStart(2, "0")
                + "-edge-" + edgeName + "-x-" + String(indexX).padStart(3, "0"),
              part_id: "3004",
              colour_code: layerColour,
              translation_ldu: [
                Object.is(centreX, -0) ? 0 : centreX,
                layerY,
                centreZStuds * pitch,
              ],
              matrix: [...IDENTITY_MATRIX],
            });
          }
        }
      } else {
        // Shift the upper 2×4 grid half a brick in X and half a row in Z.
        // Its core bridges lower joints in both directions. The 1×2 parts
        // close the one-stud perimeter strips without overlapping one another.
        const coreColumns = width / 4 - 1;
        const coreRows = depth / 2 - 1;
        for (let indexX = 0; indexX < coreColumns; indexX += 1) {
          const centreX = (-width / 2 + 4 + 4 * indexX) * pitch;
          for (let indexZ = 0; indexZ < coreRows; indexZ += 1) {
            const centreZ = (-depth / 2 + 2 + 2 * indexZ) * pitch;
            addPlacement({
              instance_id: "layer-" + String(layer).padStart(2, "0")
                + "-core-x-" + String(indexX).padStart(3, "0")
                + "-z-" + String(indexZ).padStart(3, "0"),
              part_id: partId,
              colour_code: layerColour,
              translation_ldu: [
                Object.is(centreX, -0) ? 0 : centreX,
                layerY,
                Object.is(centreZ, -0) ? 0 : centreZ,
              ],
              matrix: [...IDENTITY_MATRIX],
            });
          }
        }

        for (const [edgeName, centreXStuds] of [
          ["left", -width / 2 + 1],
          ["right", width / 2 - 1],
        ]) {
          for (let indexZ = 0; indexZ < depth - 2; indexZ += 1) {
            const centreZ = (-depth / 2 + 1.5 + indexZ) * pitch;
            addPlacement({
              instance_id: "layer-" + String(layer).padStart(2, "0")
                + "-edge-" + edgeName + "-z-" + String(indexZ).padStart(3, "0"),
              part_id: "3004",
              colour_code: layerColour,
              translation_ldu: [
                centreXStuds * pitch,
                layerY,
                Object.is(centreZ, -0) ? 0 : centreZ,
              ],
              matrix: [...IDENTITY_MATRIX],
            });
          }
        }

        for (const [edgeName, centreZStuds] of [
          ["front", -depth / 2 + 0.5],
          ["back", depth / 2 - 0.5],
        ]) {
          for (let indexX = 0; indexX < width / 2; indexX += 1) {
            const centreX = (-width / 2 + 1 + 2 * indexX) * pitch;
            addPlacement({
              instance_id: "layer-" + String(layer).padStart(2, "0")
                + "-edge-" + edgeName + "-x-" + String(indexX).padStart(3, "0"),
              part_id: "3004",
              colour_code: layerColour,
              translation_ldu: [
                Object.is(centreX, -0) ? 0 : centreX,
                layerY,
                centreZStuds * pitch,
              ],
              matrix: [...IDENTITY_MATRIX],
            });
          }
        }
      }
      continue;
    }

    const countX = width / tileWidth;
    const countZ = depth / tileDepth;
    const tileWidthLdu = tileWidth * pitch;
    const tileDepthLdu = tileDepth * pitch;

    for (let indexX = 0; indexX < countX; indexX += 1) {
      const centreX = -halfWidthLdu + tileWidthLdu / 2 + indexX * tileWidthLdu;
      for (let indexZ = 0; indexZ < countZ; indexZ += 1) {
        const centreZ = -halfDepthLdu + tileDepthLdu / 2 + indexZ * tileDepthLdu;
        addPlacement({
          instance_id: "layer-" + String(layer).padStart(2, "0")
            + "-x-" + String(indexX).padStart(3, "0")
            + "-z-" + String(indexZ).padStart(3, "0"),
          part_id: partId,
          colour_code: layerColour,
          translation_ldu: [
            Object.is(centreX, -0) ? 0 : centreX,
            layerY,
            Object.is(centreZ, -0) ? 0 : centreZ,
          ],
          matrix,
        });
      }
    }
  }

  const connections = validatePlacements(placements, profiles, {
    positionToleranceLdu,
    collisionToleranceLdu,
  });

  const modelName = "block-" + width + "x" + depth + "x" + height;
  const assemblyGraph = {
    schema_version: 1,
    coordinate_system: "LDraw",
    length_unit: "LDU",
    model_name: modelName,
    parts: placements,
    connections,
  };
  const bom = createBom(placements);
  bom.model_name = modelName;

  return {
    model_name: modelName,
    parts: placements,
    connections,
    total_mating_pairs: connections.reduce(
      (sum, connection) => sum + connection.mating_pairs.length,
      0,
    ),
    assembly_graph: assemblyGraph,
    bom,
    ldraw: exportLDraw({ model_name: modelName, parts: placements }),
    dimensions_mm: {
      width: width * pitch * LDU_TO_MM,
      depth: depth * pitch * LDU_TO_MM,
      height: height * profile.body_height_ldu * LDU_TO_MM,
    },
  };
}


const FOOTPRINT_TILE_PART_IDS = ["3001", "3002", "3003", "3004", "3005", "3006", "3007", "3008", "3009", "3010", "3622"];
const FOOTPRINT_PLATE_TILE_PART_IDS = ["3832", "3034", "3795", "3020", "3021", "3022", "3460", "3666", "3710", "3623", "3023", "3024"];
const MAX_FOOTPRINT_CELLS = 64;
const MAX_FOOTPRINT_SEARCH_NODES = 1000000;
const MAX_FOOTPRINT_TILINGS = 100000;
const MAX_FOOTPRINT_PAIR_CHECKS = 5000000;

function cellKey(x, z) {
  return x + "," + z;
}

function footprintTilePriority(tile) {
  const partNumber = Number(tile.part_id);
  return (
    Math.imul(tile.x, 73856093)
    ^ Math.imul(tile.z, 19349663)
    ^ Math.imul(tile.width, 83492791)
    ^ Math.imul(tile.depth, 2654435761)
    ^ Math.imul(partNumber, 97531)
  ) >>> 0;
}

function compareTiles(a, b) {
  return (b.width * b.depth) - (a.width * a.depth)
    || footprintTilePriority(a) - footprintTilePriority(b)
    || compareText(a.part_id, b.part_id)
    || a.x - b.x
    || a.z - b.z
    || Number(a.rotated) - Number(b.rotated);
}

function compareTilings(a, b) {
  if (a.length !== b.length) return a.length - b.length;
  for (let index = 0; index < a.length; index += 1) {
    const tileA = a[index];
    const tileB = b[index];
    const difference = compareText(tileA.part_id, tileB.part_id)
      || tileA.x - tileB.x
      || tileA.z - tileB.z
      || Number(tileA.rotated) - Number(tileB.rotated);
    if (difference) return difference;
  }
  return 0;
}

function footprintCellsAreConnected(cells) {
  const first = cells.values().next().value;
  const pending = [first];
  const visited = new Set(pending);
  while (pending.length) {
    const [x, z] = pending.pop().split(",").map(Number);
    for (const neighbour of [
      cellKey(x - 1, z), cellKey(x + 1, z),
      cellKey(x, z - 1), cellKey(x, z + 1),
    ]) {
      if (cells.has(neighbour) && !visited.has(neighbour)) {
        visited.add(neighbour);
        pending.push(neighbour);
      }
    }
  }
  return visited.size === cells.size;
}

function enumerateFootprintTilings(cells, profiles, tilePartIds = FOOTPRINT_TILE_PART_IDS) {
  const sortedCells = [...cells].map((key) => key.split(",").map(Number))
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const byCell = new Map(sortedCells.map(([x, z]) => [cellKey(x, z), []]));
  const wholeFootprintTiles = [];

  for (const [x, z] of sortedCells) {
    for (const partId of tilePartIds) {
      const profile = profiles.get(partId);
      if (!profile) continue;
      const orientations = [[profile.footprint_studs_x, profile.footprint_studs_z, false]];
      if (profile.footprint_studs_x !== profile.footprint_studs_z) {
        orientations.push([profile.footprint_studs_z, profile.footprint_studs_x, true]);
      }
      for (const [width, depth, rotated] of orientations) {
        const tileCells = new Set();
        for (let dx = 0; dx < width; dx += 1) {
          for (let dz = 0; dz < depth; dz += 1) {
            tileCells.add(cellKey(x + dx, z + dz));
          }
        }
        if ([...tileCells].every((key) => cells.has(key))) {
          const tile = { part_id: partId, x, z, width, depth, rotated, cells: tileCells };
          if (tileCells.size === cells.size) wholeFootprintTiles.push(tile);
          for (const key of tileCells) byCell.get(key).push(tile);
        }
      }
    }
  }

  for (const options of byCell.values()) options.sort(compareTiles);
  // Preserve a one-element exact cover even when MRV would otherwise pick a
  // boundary cell first and eliminate the full-footprint candidate.
  const tilings = wholeFootprintTiles.map((tile) => [tile]);
  let nodes = 0;
  let limitReached = false;

  function search(remaining, chosen) {
    if (remaining.size === 0) {
      if (chosen.length === 1 && chosen[0].cells.size === cells.size) return;
      tilings.push([...chosen]);
      if (tilings.length > MAX_FOOTPRINT_TILINGS) {
        tilings.pop();
        limitReached = true;
      }
      return;
    }
    nodes += 1;
    if (nodes > MAX_FOOTPRINT_SEARCH_NODES || limitReached) {
      limitReached = true;
      return;
    }

    const remainingKeys = [...remaining].sort((a, b) => {
      const [ax, az] = a.split(",").map(Number);
      const [bx, bz] = b.split(",").map(Number);
      return az - bz || ax - bx;
    });
    let nextOptions = null;
    for (const key of remainingKeys) {
      const viable = byCell.get(key).filter((tile) =>
        [...tile.cells].every((cell) => remaining.has(cell)));
      if (nextOptions === null || viable.length < nextOptions.length) {
        nextOptions = viable;
      }
    }
    for (const tile of nextOptions || []) {
      const nextRemaining = new Set([...remaining].filter((key) => !tile.cells.has(key)));
      search(nextRemaining, [...chosen, tile]);
      if (limitReached) return;
    }
  }

  search(new Set(cells), []);
  tilings.sort(compareTilings);
  return { tilings, limitReached };
}

function sampleLayerFootprintTilings(cells, profiles, tilePartIds = FOOTPRINT_TILE_PART_IDS) {
  const ordered = [...cells].map((key) => key.split(',').map(Number)).sort((a,b) => a[1]-b[1] || a[0]-b[0]);
  const byCell = new Map(ordered.map(([x,z]) => [cellKey(x,z), []]));
  for (const [x,z] of ordered) for (const partId of tilePartIds) {
    const profile = profiles.get(partId); if (!profile) continue;
    const orientations = [[profile.footprint_studs_x,profile.footprint_studs_z,false]];
    if (profile.footprint_studs_x !== profile.footprint_studs_z) orientations.push([profile.footprint_studs_z,profile.footprint_studs_x,true]);
    for (const [width,depth,rotated] of orientations) {
      const tileCells = new Set();
      for (let dx=0;dx<width;dx+=1) for (let dz=0;dz<depth;dz+=1) tileCells.add(cellKey(x+dx,z+dz));
      if ([...tileCells].every((key) => cells.has(key))) {
        const tile={part_id:partId,x,z,width,depth,rotated,cells:tileCells};
        for (const key of tileCells) byCell.get(key).push(tile);
      }
    }
  }
  for (const options of byCell.values()) options.sort(compareTiles);
  let seed=2166136261; for (const [x,z] of ordered) { seed=Math.imul(seed^x,16777619)>>>0; seed=Math.imul(seed^z,16777619)>>>0; }
  if (!seed) seed=0x9E3779B9;
  const random=()=>{ seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/0x100000000; };
  const results=[], signatures=new Set();
  for (let attempt=0;attempt<96 && results.length<24;attempt+=1) {
    const remaining=new Set(cells), chosen=[]; let valid=true;
    while (remaining.size) {
      const keys=[...remaining];
      const start=Math.floor(random()*keys.length);
      let selected=null;
      for (let offset=0;offset<keys.length;offset+=1) {
        const key=keys[(start+offset)%keys.length];
        const viable=byCell.get(key).filter((tile)=>[...tile.cells].every((cell)=>remaining.has(cell)));
        if (viable.length) { selected=viable; break; }
      }
      if (!selected) { valid=false; break; }
      const tile=selected[Math.floor(random()*selected.length)]; chosen.push(tile);
      for (const key of tile.cells) remaining.delete(key);
    }
    if (!valid) continue;
    chosen.sort(compareTiles);
    const signature=chosen.map((tile)=>tile.part_id+':'+tile.x+':'+tile.z+':'+Number(tile.rotated)).join('|');
    if (!signatures.has(signature)) { signatures.add(signature); results.push(chosen); }
  }
  return results.sort(compareTilings);
}

function sampleStripTilings(cells, profiles, tilePartIds = FOOTPRINT_TILE_PART_IDS) {
  const coordinates = [...cells].map((key) => key.split(",").map(Number));
  const minX = Math.min(...coordinates.map(([x]) => x));
  const maxX = Math.max(...coordinates.map(([x]) => x));
  const minZ = Math.min(...coordinates.map(([, z]) => z));
  const maxZ = Math.max(...coordinates.map(([, z]) => z));
  const horizontal = minZ === maxZ && maxX - minX + 1 === cells.size;
  const vertical = minX === maxX && maxZ - minZ + 1 === cells.size;
  if (!horizontal && !vertical) return [];

  const axisX = horizontal;
  const length = cells.size;
  const candidates = [];
  for (const partId of tilePartIds) {
    const profile = profiles.get(partId);
    if (!profile) continue;
    let tileLength = 0;
    let rotated = false;
    if (axisX) {
      if (profile.footprint_studs_z === 1) tileLength = profile.footprint_studs_x;
      else if (profile.footprint_studs_x === 1) {
        tileLength = profile.footprint_studs_z;
        rotated = true;
      }
    } else if (profile.footprint_studs_x === 1) {
      tileLength = profile.footprint_studs_z;
    } else if (profile.footprint_studs_z === 1) {
      tileLength = profile.footprint_studs_x;
      rotated = true;
    }
    if (tileLength > 0) candidates.push({ partId, tileLength, rotated });
  }
  candidates.sort((a, b) => b.tileLength - a.tileLength || compareText(a.partId, b.partId));
  if (!candidates.length || candidates[candidates.length - 1].tileLength !== 1) return [];
  const maxLength = candidates[0].tileLength;
  const results = [];
  const signatures = new Set();

  for (let offset = 0; offset < maxLength; offset += 1) {
    const tiling = [];
    let position = 0;
    let valid = true;
    while (position < length) {
      const segmentEnd = position < offset ? offset : length;
      const remaining = segmentEnd - position;
      const candidate = candidates.find((item) => item.tileLength <= remaining);
      if (!candidate) {
        valid = false;
        break;
      }
      const x = axisX ? minX + position : minX;
      const z = axisX ? minZ : minZ + position;
      const tileCells = new Set();
      for (let step = 0; step < candidate.tileLength; step += 1) {
        tileCells.add(cellKey(x + (axisX ? step : 0), z + (axisX ? 0 : step)));
      }
      if (![...tileCells].every((key) => cells.has(key))) {
        valid = false;
        break;
      }
      tiling.push({
        part_id: candidate.partId,
        x,
        z,
        width: axisX ? candidate.tileLength : 1,
        depth: axisX ? 1 : candidate.tileLength,
        rotated: candidate.rotated,
        cells: tileCells,
      });
      position += candidate.tileLength;
    }
    if (!valid || !tiling.length) continue;
    tiling.sort(compareTiles);
    const signature = tiling.map((tile) =>
      tile.part_id + ":" + tile.x + ":" + tile.z + ":" + Number(tile.rotated)).join("|");
    if (!signatures.has(signature)) {
      signatures.add(signature);
      results.push(tiling);
    }
  }
  return results.sort(compareTilings);
}

function footprintTilingsConnect(lower, upper) {
  const count = lower.length + upper.length;
  const parent = Array.from({ length: count }, (_, index) => index);

  function find(index) {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  }

  function join(a, b) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  }

  const upperOwner = new Map();
  upper.forEach((tile, index) => {
    for (const key of tile.cells) upperOwner.set(key, index);
  });
  lower.forEach((tile, lowerIndex) => {
    for (const key of tile.cells) {
      const upperIndex = upperOwner.get(key);
      if (upperIndex !== undefined) join(lowerIndex, lower.length + upperIndex);
    }
  });

  const root = find(0);
  for (let index = 1; index < count; index += 1) {
    if (find(index) !== root) return false;
  }
  return true;
}


function sampleInterlockingFootprints(cells, profiles, tilePartIds = FOOTPRINT_TILE_PART_IDS) {
  if (cells.size <= 18) return null;
  const sortedCells = [...cells].map((key) => key.split(",").map(Number))
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const byCell = new Map(sortedCells.map(([x, z]) => [cellKey(x, z), []]));

  for (const [x, z] of sortedCells) {
    for (const partId of tilePartIds) {
      const profile = profiles.get(partId);
      if (!profile) continue;
      const orientations = [[profile.footprint_studs_x, profile.footprint_studs_z, false]];
      if (profile.footprint_studs_x !== profile.footprint_studs_z) {
        orientations.push([profile.footprint_studs_z, profile.footprint_studs_x, true]);
      }
      for (const [width, depth, rotated] of orientations) {
        const tileCells = new Set();
        for (let dx = 0; dx < width; dx += 1) {
          for (let dz = 0; dz < depth; dz += 1) {
            tileCells.add(cellKey(x + dx, z + dz));
          }
        }
        if ([...tileCells].every((key) => cells.has(key))) {
          const tile = { part_id: partId, x, z, width, depth, rotated, cells: tileCells };
          for (const key of tileCells) byCell.get(key).push(tile);
        }
      }
    }
  }
  for (const options of byCell.values()) options.sort(compareTiles);
  for (const options of byCell.values()) {
    const wholeTile = options.find((tile) => tile.cells.size === cells.size);
    if (wholeTile) return [[wholeTile], [wholeTile]];
  }

  let seed = 2166136261;
  for (const [x, z] of sortedCells) {
    seed = Math.imul(seed ^ x, 16777619) >>> 0;
    seed = Math.imul(seed ^ z, 16777619) >>> 0;
  }
  if (seed === 0) seed = 0x9E3779B9;
  function nextRandom() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  }

  const sampled = [];
  const signatures = new Set();
  let bestPair = null;
  let bestPartCount = Infinity;
  let firstPairAttempt = null;
  for (let attempt = 0; attempt < 512; attempt += 1) {
    const remaining = new Set(cells);
    const chosen = [];
    while (remaining.size) {
      const keys = [...remaining].sort((a, b) => {
        const [ax, az] = a.split(",").map(Number);
        const [bx, bz] = b.split(",").map(Number);
        return az - bz || ax - bx;
      });
      let minimumOptions = Infinity;
      let tiedKeys = [];
      const optionsByKey = new Map();
      for (const key of keys) {
        const viable = byCell.get(key).filter((tile) =>
          [...tile.cells].every((cell) => remaining.has(cell)));
        optionsByKey.set(key, viable);
        if (viable.length < minimumOptions) {
          minimumOptions = viable.length;
          tiedKeys = [key];
        } else if (viable.length === minimumOptions) {
          tiedKeys.push(key);
        }
      }
      if (minimumOptions === 0) break;
      const nextKey = tiedKeys[nextRandom() % tiedKeys.length];
      const nextOptions = optionsByKey.get(nextKey);
      const randomFraction = nextRandom() / 0x100000000;
      const choiceIndex = Math.floor(randomFraction * randomFraction * nextOptions.length);
      const tile = nextOptions[choiceIndex];
      chosen.push(tile);
      for (const key of tile.cells) remaining.delete(key);
    }
    if (remaining.size) continue;

    const tiling = [...chosen];
    const signature = tiling.map((tile) =>
      tile.part_id + ":" + tile.x + ":" + tile.z + ":" + Number(tile.rotated))
      .sort().join("|");
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    for (const previous of sampled) {
      if (footprintTilingsConnect(previous, tiling)) {
        const partCount = previous.length + tiling.length;
        if (firstPairAttempt === null) firstPairAttempt = attempt;
        if (partCount < bestPartCount) {
          bestPair = [previous, tiling];
          bestPartCount = partCount;
        }
      }
    }
    sampled.push(tiling);
    // Spend at most 32 additional samples improving the first valid pair.
    if (firstPairAttempt !== null && attempt - firstPairAttempt >= 31) break;
  }
  return bestPair;
}

function findFootprintTilings(tilings) {
  const byPartCount = new Map();
  for (const tiling of tilings) {
    if (!byPartCount.has(tiling.length)) byPartCount.set(tiling.length, []);
    byPartCount.get(tiling.length).push(tiling);
  }

  let checks = 0;
  const maximumTotal = Math.max(0, ...byPartCount.keys()) * 2;
  for (let totalParts = 2; totalParts <= maximumTotal; totalParts += 1) {
    for (let lowerCount = 1; lowerCount < totalParts; lowerCount += 1) {
      const upperCount = totalParts - lowerCount;
      for (const lower of byPartCount.get(lowerCount) || []) {
        for (const upper of byPartCount.get(upperCount) || []) {
          checks += 1;
          if (checks > MAX_FOOTPRINT_PAIR_CHECKS) return null;
          if (footprintTilingsConnect(lower, upper)) return [lower, upper];
        }
      }
    }
  }
  return null;
}

function footprintTilingsOverlap(lower, upper) {
  const upperCells = new Set();
  for (const tile of upper) {
    for (const key of tile.cells) upperCells.add(key);
  }
  for (const tile of lower) {
    for (const key of tile.cells) {
      if (upperCells.has(key)) return true;
    }
  }
  return false;
}

function footprintTilingSequenceConnects(sequence) {
  const offsets = [];
  let count = 0;
  for (const tiling of sequence) {
    offsets.push(count);
    count += tiling.length;
  }
  const parent = Array.from({ length: count }, (_, index) => index);

  function find(index) {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  }

  function join(a, b) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  }

  for (let layer = 0; layer < sequence.length - 1; layer += 1) {
    const upperOwner = new Map();
    sequence[layer + 1].forEach((tile, index) => {
      for (const key of tile.cells) upperOwner.set(key, index);
    });
    sequence[layer].forEach((tile, index) => {
      for (const key of tile.cells) {
        const upperIndex = upperOwner.get(key);
        if (upperIndex !== undefined) {
          join(offsets[layer] + index, offsets[layer + 1] + upperIndex);
        }
      }
    });
  }

  const root = find(0);
  for (let index = 1; index < count; index += 1) {
    if (find(index) !== root) return false;
  }
  return true;
}

function findThreeCourseTilingSequence(tilings, height) {
  let checks = 0;
  for (const first of tilings) {
    for (const second of tilings) {
      for (const third of tilings) {
        checks += 1;
        if (checks > 250000) return null;
        const cycle = [first, second, third];
        const sequence = Array.from(
          { length: height },
          (_, layer) => cycle[layer % cycle.length],
        );
        if (footprintTilingSequenceConnects(sequence)) return cycle;
      }
    }
  }
  return null;
}

export function buildFootprintBlock(footprintCells, heightBricks, catalogue, config = {}) {
  const height = Number(heightBricks);
  if (!Number.isInteger(height) || height < 2) {
    throw new RangeError("heightBricks must be an integer of at least 2 courses.");
  }
  if (!Array.isArray(footprintCells) || footprintCells.length === 0) {
    throw new TypeError("footprintCells must contain at least one [x, z] stud position.");
  }
  const rawKeys = [];
  for (const cell of footprintCells) {
    if (!Array.isArray(cell) || cell.length !== 2
      || !Number.isInteger(cell[0]) || !Number.isInteger(cell[1])) {
      throw new TypeError("Each footprint cell must be an integer [x, z] pair.");
    }
    rawKeys.push(cellKey(cell[0], cell[1]));
  }
  const rawCells = new Set(rawKeys);
  if (rawCells.size !== rawKeys.length) {
    throw new RangeError("footprintCells must not contain duplicate positions.");
  }
  if (rawCells.size > MAX_FOOTPRINT_CELLS) {
    throw new RangeError("Footprints are limited to " + MAX_FOOTPRINT_CELLS + " occupied cells.");
  }
  if (!footprintCellsAreConnected(rawCells)) {
    throw new RangeError("footprintCells must form one orthogonally connected shape.");
  }
  if (!catalogue || catalogue.schema_version !== 1 || !Array.isArray(catalogue.profiles)) {
    throw new TypeError("The connection profile catalogue is missing or unsupported.");
  }
  const profiles = new Map(catalogue.profiles.map((profile) => [String(profile.part_id), profile]));
  const baseProfile = profiles.get("3001");
  if (!baseProfile) {
    throw new Error("Footprint construction requires the 2×4 brick profile 3001.");
  }
  if (!FOOTPRINT_TILE_PART_IDS.slice(1).some((partId) => profiles.has(partId))) {
    throw new Error("Footprint construction requires at least one smaller brick profile.");
  }
  for (const partId of FOOTPRINT_TILE_PART_IDS) {
    const profile = profiles.get(partId);
    if (profile && (profile.stud_pitch_ldu !== baseProfile.stud_pitch_ldu
      || profile.body_height_ldu !== baseProfile.body_height_ldu)) {
      throw new Error("All footprint brick profiles must use the same stud pitch and brick height.");
    }
  }

  const colourCodes = config.colourCodes || [4, 1];
  if (!Array.isArray(colourCodes) || colourCodes.length === 0
    || colourCodes.some((code) => !Number.isInteger(code) || code < 0)) {
    throw new RangeError("Colour codes must be a non-empty list of non-negative integers.");
  }
  const positionToleranceLdu = config.positionToleranceLdu ?? DEFAULT_POSITION_TOLERANCE_LDU;
  const collisionToleranceLdu = config.collisionToleranceLdu ?? DEFAULT_COLLISION_TOLERANCE_LDU;
  const maxParts = config.maxParts ?? MAX_GENERATED_PARTS;
  if (!Number.isFinite(positionToleranceLdu) || positionToleranceLdu < 0
    || !Number.isFinite(collisionToleranceLdu) || collisionToleranceLdu < 0
    || !Number.isInteger(maxParts) || maxParts < 1) {
    throw new RangeError("Construction tolerances and maxParts must be valid non-negative values.");
  }

  const coordinates = [...rawCells].map((key) => key.split(",").map(Number));
  const minX = Math.min(...coordinates.map(([x]) => x));
  const minZ = Math.min(...coordinates.map(([, z]) => z));
  const cells = new Set(coordinates.map(([x, z]) => cellKey(x - minX, z - minZ)));
  const width = Math.max(...coordinates.map(([x]) => x - minX)) + 1;
  const depth = Math.max(...coordinates.map(([, z]) => z - minZ)) + 1;

  let pair = sampleInterlockingFootprints(cells, profiles);
  let searchLimited = false;
  let tilingSequence = null;
  if (!pair) {
    let search;
    if (cells.size > MAX_FOOTPRINT_CELLS) {
      const stripTilings = sampleStripTilings(cells, profiles);
      const interlockingPair = stripTilings.length ? null : sampleInterlockingFootprints(cells, profiles);
      search = {
        tilings: stripTilings.length ? stripTilings
          : interlockingPair || sampleLayerFootprintTilings(cells, profiles),
        limitReached: true,
      };
    } else {
      search = enumerateFootprintTilings(cells, profiles);
    }
    searchLimited = search.limitReached;
    pair = findFootprintTilings(search.tilings);
    if (!pair) {
      tilingSequence = findThreeCourseTilingSequence(search.tilings, height);
    }
  }
  if (!pair && !tilingSequence) {
    const detail = searchLimited
      ? "within the bounded placement search"
      : "using the available rectangular course profiles";
    throw new Error(
      "No connected interlocking course arrangement was found " + detail
        + "; try a different footprint or part catalogue.",
    );
  }

  if (pair) tilingSequence = [pair[0], pair[1]];
  const placements = [];
  const pitch = baseProfile.stud_pitch_ldu;
  const bodyHeight = baseProfile.body_height_ldu;
  for (let layer = 0; layer < height; layer += 1) {
    const tiling = tilingSequence[layer % tilingSequence.length];
    const colour = colourCodes[layer % colourCodes.length];
    const layerY = -layer * bodyHeight;
    for (let index = 0; index < tiling.length; index += 1) {
      const tile = tiling[index];
      const centreX = (tile.x + tile.width / 2 - width / 2) * pitch;
      const centreZ = (tile.z + tile.depth / 2 - depth / 2) * pitch;
      placements.push({
        instance_id: "layer-" + String(layer).padStart(2, "0")
          + "-part-" + String(index).padStart(3, "0"),
        part_id: tile.part_id,
        colour_code: colour,
        translation_ldu: [
          Object.is(centreX, -0) ? 0 : centreX,
          layerY,
          Object.is(centreZ, -0) ? 0 : centreZ,
        ],
        matrix: [...(tile.rotated ? ROTATE_Y_90 : IDENTITY_MATRIX)],
      });
      if (placements.length > maxParts) {
        throw new RangeError("This browser prototype is limited to " + maxParts + " parts per model.");
      }
    }
  }

  const connections = validatePlacements(placements, profiles, {
    positionToleranceLdu,
    collisionToleranceLdu,
  });
  const modelName = "footprint-" + width + "x" + depth + "-" + cells.size + "cells-x" + height;
  const assemblyGraph = {
    schema_version: 1,
    coordinate_system: "LDraw",
    length_unit: "LDU",
    model_name: modelName,
    parts: placements,
    connections,
  };
  const bom = createBom(placements);
  bom.model_name = modelName;

  return {
    model_name: modelName,
    parts: placements,
    connections,
    total_mating_pairs: connections.reduce(
      (sum, connection) => sum + connection.mating_pairs.length,
      0,
    ),
    assembly_graph: assemblyGraph,
    bom,
    ldraw: exportLDraw({ model_name: modelName, parts: placements }),
    dimensions_mm: {
      width: width * pitch * LDU_TO_MM,
      depth: depth * pitch * LDU_TO_MM,
      height: height * bodyHeight * LDU_TO_MM,
    },
  };
}


const MAX_LAYERED_SEQUENCE_CHECKS = 250000;
const MAX_LAYERED_COURSE_CELLS = 256;

/**
 * Build a variable-footprint stack from bottom-to-top per-course cell lists.
 * Coordinates are shared across courses so a tile in one course can only
 * connect to a tile above it where their occupied stud cells overlap.
 */
function buildLayeredSequenceArtifacts(sequence, context, alternativeIndex) {
  const { profiles, width, depth, pitch, bodyHeight, colourCodes, positionToleranceLdu,
    collisionToleranceLdu, maxParts, courseType } = context;
  const placements = [];
  for (let layer = 0; layer < sequence.length; layer += 1) {
    const tiling = sequence[layer];
    const colour = colourCodes[layer % colourCodes.length];
    for (let index = 0; index < tiling.length; index += 1) {
      const tile = tiling[index];
      const centreX = (tile.x + tile.width / 2 - width / 2) * pitch;
      const centreZ = (tile.z + tile.depth / 2 - depth / 2) * pitch;
      placements.push({
        instance_id: "layer-" + String(layer).padStart(2, "0") + "-part-" + String(index).padStart(3, "0"),
        part_id: tile.part_id,
        colour_code: colour,
        translation_ldu: [Object.is(centreX, -0) ? 0 : centreX, -layer * bodyHeight, Object.is(centreZ, -0) ? 0 : centreZ],
        matrix: [...(tile.rotated ? ROTATE_Y_90 : IDENTITY_MATRIX)],
      });
      if (placements.length > maxParts) throw new RangeError("This browser prototype is limited to " + maxParts + " parts per model.");
    }
  }
  const connections = validatePlacements(placements, profiles, { positionToleranceLdu, collisionToleranceLdu });
  const baseName = courseType + "-layered-" + width + "x" + depth + "-" + sequence.length + "courses";
  const modelName = alternativeIndex === 0 ? baseName : baseName + "-alternative-" + (alternativeIndex + 1);
  const assemblyGraph = { schema_version: 1, coordinate_system: "LDraw", length_unit: "LDU", model_name: modelName, parts: placements, connections };
  const bom = createBom(placements);
  bom.model_name = modelName;
  return {
    model_name: modelName, parts: placements, connections,
    total_mating_pairs: connections.reduce((sum, connection) => sum + connection.mating_pairs.length, 0),
    assembly_graph: assemblyGraph, bom, ldraw: exportLDraw({ model_name: modelName, parts: placements }),
    dimensions_mm: { width: width * pitch * LDU_TO_MM, depth: depth * pitch * LDU_TO_MM, height: sequence.length * bodyHeight * LDU_TO_MM },
    course_part_counts: sequence.map((tiling) => tiling.length),
    profile_dimensions: Object.fromEntries([...new Set(placements.map((part) => part.part_id))].map((partId) => {
      const profile = profiles.get(partId);
      return [partId, { footprint_studs_x: profile.footprint_studs_x, footprint_studs_z: profile.footprint_studs_z,
        body_height_ldu: profile.body_height_ldu, stud_pitch_ldu: profile.stud_pitch_ldu }];
    })),
  };
}

function compareLayeredSequences(a, b) {
  if (a.partCount !== b.partCount) return a.partCount - b.partCount;
  for (let layer = 0; layer < a.sequence.length; layer += 1) {
    const difference = compareTilings(a.sequence[layer], b.sequence[layer]);
    if (difference) return difference;
  }
  return 0;
}

export function buildLayeredFootprintBlock(layerFootprints, catalogue, config = {}) {
  if (!Array.isArray(layerFootprints) || layerFootprints.length < 2) {
    throw new TypeError("layerFootprints must contain at least two bottom-to-top courses.");
  }
  if (!catalogue || catalogue.schema_version !== 1 || !Array.isArray(catalogue.profiles)) {
    throw new TypeError("The connection profile catalogue is missing or unsupported.");
  }
  const profiles = new Map(catalogue.profiles.map((profile) => [String(profile.part_id), profile]));
  const courseType = config.courseType || "brick";
  if (!["brick", "plate"].includes(courseType)) {
    throw new RangeError("courseType must be 'brick' or 'plate'.");
  }
  const tilePartIds = courseType === "plate" ? FOOTPRINT_PLATE_TILE_PART_IDS : FOOTPRINT_TILE_PART_IDS;
  const basePartId = courseType === "plate" ? "3020" : "3001";
  const baseProfile = profiles.get(basePartId);
  if (!baseProfile) {
    throw new Error("Layered " + courseType + " construction requires profile " + basePartId + ".");
  }
  if (!tilePartIds.slice(1).some((partId) => profiles.has(partId))) {
    throw new Error("Layered " + courseType + " construction requires smaller tile profiles.");
  }
  for (const partId of tilePartIds) {
    const profile = profiles.get(partId);
    if (profile && (profile.stud_pitch_ldu !== baseProfile.stud_pitch_ldu
      || profile.body_height_ldu !== baseProfile.body_height_ldu)) {
      throw new Error("All layered " + courseType + " profiles must use the same stud pitch and course height.");
    }
  }

  const colourCodes = config.colourCodes || [4, 1];
  if (!Array.isArray(colourCodes) || colourCodes.length === 0
    || colourCodes.some((code) => !Number.isInteger(code) || code < 0)) {
    throw new RangeError("Colour codes must be a non-empty list of non-negative integers.");
  }
  const positionToleranceLdu = config.positionToleranceLdu ?? DEFAULT_POSITION_TOLERANCE_LDU;
  const collisionToleranceLdu = config.collisionToleranceLdu ?? DEFAULT_COLLISION_TOLERANCE_LDU;
  const maxParts = config.maxParts ?? MAX_GENERATED_PARTS;
  if (!Number.isFinite(positionToleranceLdu) || positionToleranceLdu < 0
    || !Number.isFinite(collisionToleranceLdu) || collisionToleranceLdu < 0
    || !Number.isInteger(maxParts) || maxParts < 1) {
    throw new RangeError("Construction tolerances and maxParts must be valid non-negative values.");
  }

  if (layerFootprints.length > maxParts) {
    throw new RangeError("The number of occupied courses exceeds the browser prototype part limit.");
  }

  const parsedLayers = [];
  const allCoordinates = [];
  for (let layer = 0; layer < layerFootprints.length; layer += 1) {
    const footprint = layerFootprints[layer];
    if (!Array.isArray(footprint) || footprint.length === 0) {
      throw new RangeError("Course " + (layer + 1) + " has no occupied cells; empty courses cannot be bridged.");
    }
    const keys = new Set();
    const coordinates = [];
    for (const cell of footprint) {
      if (!Array.isArray(cell) || cell.length !== 2
        || !Number.isInteger(cell[0]) || !Number.isInteger(cell[1])) {
        throw new TypeError("Each course cell must be an integer [x, z] pair.");
      }
      const key = cellKey(cell[0], cell[1]);
      if (keys.has(key)) throw new RangeError("Course " + (layer + 1) + " contains duplicate cells.");
      keys.add(key);
      coordinates.push([cell[0], cell[1]]);
      allCoordinates.push([cell[0], cell[1]]);
    }
    if (keys.size > MAX_LAYERED_COURSE_CELLS) {
      throw new RangeError("Each mesh-derived course is limited to " + MAX_LAYERED_COURSE_CELLS + " occupied cells in this browser prototype.");
    }
    parsedLayers.push(coordinates);
  }

  const minX = Math.min(...allCoordinates.map(([x]) => x));
  const minZ = Math.min(...allCoordinates.map(([, z]) => z));
  const maxX = Math.max(...allCoordinates.map(([x]) => x));
  const maxZ = Math.max(...allCoordinates.map(([, z]) => z));
  const width = maxX - minX + 1;
  const depth = maxZ - minZ + 1;
  const layerCandidates = [];
  let searchLimited = false;

  for (let layer = 0; layer < parsedLayers.length; layer += 1) {
    const cells = new Set(parsedLayers[layer].map(([x, z]) => cellKey(x - minX, z - minZ)));
    let search;
    if (cells.size > MAX_FOOTPRINT_CELLS) {
      const stripTilings = sampleStripTilings(cells, profiles, tilePartIds);
      const interlockingPair = stripTilings.length ? null : sampleInterlockingFootprints(cells, profiles, tilePartIds);
      search = {
        tilings: stripTilings.length ? stripTilings
          : interlockingPair || sampleLayerFootprintTilings(cells, profiles, tilePartIds),
        limitReached: true,
      };
    } else {
      const interlockingPair = sampleInterlockingFootprints(cells, profiles, tilePartIds);
      search = interlockingPair
        ? { tilings: interlockingPair, limitReached: true }
        : enumerateFootprintTilings(cells, profiles, tilePartIds);
    }
    searchLimited ||= search.limitReached;
    if (!search.tilings.length) {
      throw new Error("Course " + (layer + 1)
        + " cannot be tiled by the available rectangular course profiles.");
    }
    search.tilings.sort(compareTilings);
    layerCandidates.push(search.tilings);
  }

  const minimumRemaining = Array(layerCandidates.length + 1).fill(0);
  for (let layer = layerCandidates.length - 1; layer >= 0; layer -= 1) {
    const minimumForCourse = layerCandidates[layer].reduce(
      (minimum, tiling) => Math.min(minimum, tiling.length), Infinity,
    );
    minimumRemaining[layer] = minimumRemaining[layer + 1] + minimumForCourse;
  }

  const maxAlternatives = config.maxAlternatives ?? 3;
  if (!Number.isInteger(maxAlternatives) || maxAlternatives < 1 || maxAlternatives > 5) {
    throw new RangeError("maxAlternatives must be an integer from 1 to 5.");
  }
  let checks = 0;
  let budgetReached = false;
  const chosen = [];
  const candidates = [];
  const candidateSignatures = new Set();
  let visitedNodes = 0;
  const maximumSearchNodes = MAX_LAYERED_SEQUENCE_CHECKS * 4;
  function sequenceSignature(sequence) {
    return sequence.map((tiling) => tiling.map((tile) =>
      [tile.part_id, tile.x, tile.z, tile.width, tile.depth, Number(tile.rotated)].join(",")
    ).join(";")).join("|");
  }
  function searchSequences(layer, partCount) {
    visitedNodes += 1;
    if (visitedNodes > maximumSearchNodes) { budgetReached = true; return; }
    if (layer === layerCandidates.length) {
      checks += 1;
      if (checks > MAX_LAYERED_SEQUENCE_CHECKS) { budgetReached = true; return; }
      if (!footprintTilingSequenceConnects(chosen)) return;
      const signature = sequenceSignature(chosen);
      if (candidateSignatures.has(signature)) return;
      candidateSignatures.add(signature);
      candidates.push({ sequence: chosen.slice(), partCount });
      candidates.sort(compareLayeredSequences);
      if (candidates.length > maxAlternatives) {
        const removed = candidates.pop();
        candidateSignatures.delete(sequenceSignature(removed.sequence));
      }
      return;
    }
    for (const tiling of layerCandidates[layer]) {
      const nextCount = partCount + tiling.length;
      const worstCount = candidates.length === maxAlternatives ? candidates[candidates.length - 1].partCount : Infinity;
      if (nextCount + minimumRemaining[layer + 1] > worstCount) continue;
      if (layer > 0 && !footprintTilingsOverlap(chosen[layer - 1], tiling)) continue;
      chosen.push(tiling);
      searchSequences(layer + 1, nextCount);
      chosen.pop();
      if (budgetReached) return;
    }
  }
  searchSequences(0, 0);
  if (!candidates.length) {
    const detail = budgetReached || searchLimited ? "within the bounded course-layout search" : "using the available rectangular brick profiles";
    const courseSummary = layerCandidates.map((items, index) =>
      "course " + (index + 1) + ": " + parsedLayers[index].length + " cell(s), " + items.length + " layout candidate(s)").join("; ");
    const searchSummary = " " + courseSummary + ". Checked " + checks + " complete sequence(s) across " + visitedNodes + " search node(s)"
      + (budgetReached ? "; sequence budget reached" : "") + (searchLimited ? "; course layouts were sampled or bounded" : "");
    throw new Error("No fully connected variable-course construction was found " + detail + "; " + searchSummary
      + ". Try a different course family, target orientation or part catalogue.");
  }

  const pitch = baseProfile.stud_pitch_ldu;
  const bodyHeight = baseProfile.body_height_ldu;
  const optimizationProfile = config.optimizationProfile ?? "balanced";
  const optimizationWeights = {
    balanced: { parts: 0.4, variety: 0.25, interlock: 0.2, courseBalance: 0.15 },
    economy: { parts: 0.7, variety: 0.1, interlock: 0.1, courseBalance: 0.1 },
    simplicity: { parts: 0.25, variety: 0.6, interlock: 0.05, courseBalance: 0.1 },
    interlock: { parts: 0.2, variety: 0.1, interlock: 0.55, courseBalance: 0.15 },
  };
  if (!Object.hasOwn(optimizationWeights, optimizationProfile)) {
    throw new RangeError("optimizationProfile must be balanced, economy, simplicity or interlock.");
  }
  const search = {
    optimization_profile: optimizationProfile,
    sequence_checks: checks, sequence_search_nodes: visitedNodes, budget_reached: budgetReached,
    candidate_tilings_per_course: layerCandidates.map((items) => items.length),
    candidate_search_limited: searchLimited, valid_alternative_count: candidates.length,
    requested_alternative_count: maxAlternatives,
  };
  const artifacts = candidates.map((candidate, index) => buildLayeredSequenceArtifacts(candidate.sequence, {
    profiles, width, depth, pitch, bodyHeight, colourCodes, positionToleranceLdu,
    collisionToleranceLdu, maxParts, courseType,
  }, index));
  const minimumPartCount = Math.min(...artifacts.map((artifact) => artifact.parts.length));
  const minimumTypeCount = Math.min(...artifacts.map((artifact) => new Set(artifact.parts.map((part) => part.part_id)).size));
  const maximumMatingDensity = Math.max(...artifacts.map((artifact) =>
    artifact.total_mating_pairs / Math.max(1, artifact.parts.length)));
  for (const artifact of artifacts) {
    const typeMix = new Map();
    for (const part of artifact.parts) typeMix.set(part.part_id, (typeMix.get(part.part_id) || 0) + 1);
    const courseMean = artifact.course_part_counts.reduce((sum, count) => sum + count, 0) / artifact.course_part_counts.length;
    const courseSpread = Math.max(...artifact.course_part_counts) - Math.min(...artifact.course_part_counts);
    const courseBalanceScore = 1 / (1 + courseSpread / Math.max(1, courseMean));
    const averageMatingPairsPerPart = artifact.total_mating_pairs / Math.max(1, artifact.parts.length);
    const metrics = {
      part_count: artifact.parts.length,
      unique_part_types: typeMix.size,
      part_type_mix: [...typeMix.entries()].sort((a, b) => compareText(a[0], b[0]))
        .map(([part_id, quantity]) => ({ part_id, quantity })),
      connection_count: artifact.connections.length,
      total_mating_pairs: artifact.total_mating_pairs,
      average_mating_pairs_per_part: averageMatingPairsPerPart,
      course_part_counts: artifact.course_part_counts,
      course_part_count_spread: courseSpread,
      part_efficiency: minimumPartCount / artifact.parts.length,
      type_simplicity: minimumTypeCount / typeMix.size,
      interlock_density: maximumMatingDensity > 0 ? averageMatingPairsPerPart / maximumMatingDensity : 1,
      course_balance: courseBalanceScore,
    };
    const weights = optimizationWeights[optimizationProfile];
    artifact.optimization_metrics = metrics;
    artifact.optimization_score = (
      metrics.part_efficiency * weights.parts
      + metrics.type_simplicity * weights.variety
      + metrics.interlock_density * weights.interlock
      + metrics.course_balance * weights.courseBalance
    );
    artifact.optimization_profile = optimizationProfile;
  }
  artifacts.sort((a, b) => b.optimization_score - a.optimization_score
    || a.parts.length - b.parts.length
    || a.optimization_metrics.unique_part_types - b.optimization_metrics.unique_part_types);
  const baseModelName = courseType + "-layered-" + width + "x" + depth + "-" + layerFootprints.length + "courses";
  artifacts.forEach((artifact, index) => {
    const modelName = index === 0 ? baseModelName : baseModelName + "-alternative-" + (index + 1);
    artifact.alternative_rank = index + 1;
    artifact.model_name = modelName;
    artifact.assembly_graph.model_name = modelName;
    artifact.bom.model_name = modelName;
    artifact.ldraw = exportLDraw({ model_name: modelName, parts: artifact.parts });
  });
  const alternatives = artifacts.map((artifact, index) => ({
    ...artifact, alternative_rank: index + 1, search,
    validation_report: {
      schema_version: 1, overall_status: "nominal_checks_passed",
      checks: [
        { id: "target_coverage", status: "passed", summary: "Every occupied target cell is represented by exactly one selected part footprint." },
        { id: "body_overlap", status: "passed", summary: "No pair of nominal part body envelopes overlaps beyond the configured tolerance." },
        { id: "connection_alignment", status: "passed", summary: artifact.connections.length.toLocaleString() + " connected part pairs contain nominal stud-to-receiver alignment matches (" + artifact.total_mating_pairs.toLocaleString() + " mating pairs)." },
        { id: "graph_connectivity", status: "passed", summary: "All generated part instances belong to one connected nominal connection graph." },
        { id: "search_optimality", status: budgetReached || searchLimited ? "limited" : "passed",
          summary: budgetReached || searchLimited ? "Candidate or sequence search was bounded; alternatives are ranked by part count but are not guaranteed to be globally optimal."
            : "All candidate course layouts within the configured search were evaluated." },
        { id: "surface_fidelity", status: "not_assessed", summary: "The generated simplified part envelopes have not been compared against source-mesh surface distance." },
        { id: "physical_stability", status: "not_assessed", summary: "Clutch force, load capacity and physical stability have not been measured or simulated." },
        { id: "assembly_accessibility", status: "not_assessed", summary: "Tool access and the physical order of assembly have not been validated." },
      ],
      limitations: [
        "Connection results use nominal catalogue stud and receiver datums, not measured clutch-force data.",
        "Body collision checks use nominal axis-aligned envelopes and do not inspect detailed part geometry.",
        "A connected graph does not by itself prove that the construction is physically stable or practically assemblable.",
        "The preview uses simplified part body envelopes and does not measure source-surface fidelity.",
        ...(budgetReached || searchLimited ? ["The bounded search does not guarantee a minimum-part construction."] : []),
      ],
    },
  }));
  return { ...alternatives[0], alternatives };
}

export const constructionConstants = Object.freeze({
  lduToMm: LDU_TO_MM,
  maxGeneratedParts: MAX_GENERATED_PARTS,
  rotateY90: ROTATE_Y_90,
});
