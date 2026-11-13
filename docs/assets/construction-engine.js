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


const FOOTPRINT_TILE_PART_IDS = ["3001", "3003", "3004", "3005"];
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

function enumerateFootprintTilings(cells, profiles) {
  const sortedCells = [...cells].map((key) => key.split(",").map(Number))
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const byCell = new Map(sortedCells.map(([x, z]) => [cellKey(x, z), []]));

  for (const [x, z] of sortedCells) {
    for (const partId of FOOTPRINT_TILE_PART_IDS) {
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
  const tilings = [];
  let nodes = 0;
  let limitReached = false;

  function search(remaining, chosen) {
    if (remaining.size === 0) {
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
      if (nextOptions.length === 0) break;
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


function sampleInterlockingFootprints(cells, profiles) {
  const sortedCells = [...cells].map((key) => key.split(",").map(Number))
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const byCell = new Map(sortedCells.map(([x, z]) => [cellKey(x, z), []]));

  for (const [x, z] of sortedCells) {
    for (const partId of FOOTPRINT_TILE_PART_IDS) {
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

  let seed = 2166136261;
  for (const [x, z] of sortedCells) {
    seed = Math.imul(seed ^ x, 16777619) >>> 0;
    seed = Math.imul(seed ^ z, 16777619) >>> 0;
  }
  if (seed === 0) seed = 0x9E3779B9;
  function nextRandom() {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed;
  }

  const sampled = [];
  const signatures = new Set();
  for (let attempt = 0; attempt < 512; attempt += 1) {
    const remaining = new Set(cells);
    const chosen = [];
    while (remaining.size) {
      const keys = [...remaining].sort((a, b) => {
        const [ax, az] = a.split(",").map(Number);
        const [bx, bz] = b.split(",").map(Number);
        return az - bz || ax - bx;
      });
      let nextOptions = null;
      for (const key of keys) {
        const viable = byCell.get(key).filter((tile) =>
          [...tile.cells].every((cell) => remaining.has(cell)));
        if (nextOptions === null || viable.length < nextOptions.length) {
          nextOptions = viable;
        }
        if (nextOptions.length === 0) break;
      }
      if (!nextOptions || nextOptions.length === 0) break;
      const tile = nextOptions[nextRandom() % nextOptions.length];
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
      if (footprintTilingsConnect(previous, tiling)) return [previous, tiling];
    }
    sampled.push(tiling);
  }
  return null;
}

function findFootprintTilings(tilings) {
  let checks = 0;
  for (const lower of tilings) {
    for (const upper of tilings) {
      checks += 1;
      if (checks > MAX_FOOTPRINT_PAIR_CHECKS) return null;
      if (footprintTilingsConnect(lower, upper)) return [lower, upper];
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
  if (!pair) {
    const search = enumerateFootprintTilings(cells, profiles);
    searchLimited = search.limitReached;
    pair = findFootprintTilings(search.tilings);
  }
  if (!pair) {
    const detail = searchLimited
      ? "within the bounded placement search"
      : "using the available rectangular brick profiles";
    throw new Error(
      "No connected pair of interlocking course tilings was found " + detail
        + "; try a different footprint or part catalogue.",
    );
  }

  const [lowerTiling, upperTiling] = pair;
  const placements = [];
  const pitch = baseProfile.stud_pitch_ldu;
  const bodyHeight = baseProfile.body_height_ldu;
  for (let layer = 0; layer < height; layer += 1) {
    const tiling = layer % 2 === 0 ? lowerTiling : upperTiling;
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

export const constructionConstants = Object.freeze({
  lduToMm: LDU_TO_MM,
  maxGeneratedParts: MAX_GENERATED_PARTS,
  rotateY90: ROTATE_Y_90,
});
