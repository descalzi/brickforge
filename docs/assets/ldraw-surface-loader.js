import { ldrawReferenceCandidates } from "./catalogue-utils.js";

const LDU_TO_MM = 0.4;
const RAW_BASE = "https://raw.githubusercontent.com/kulits/ldraw-parts/c70360d1c588be894997b2168c61909bc8058c4d/ldraw/";
const MAX_REFERENCE_DEPTH = 64;
const MAX_PART_TRIANGLES = 100_000;
const MAX_ASSEMBLY_TRIANGLES = 4_000;
const fileCache = new Map();
const documentCache = new Map();
const partGeometryCache = new Map();

function finiteNumbers(tokens, source, lineNumber) {
  const values = tokens.map(Number);
  if (!values.every(Number.isFinite)) {
    throw new Error(source + ":" + lineNumber + ": non-finite LDraw coordinate");
  }
  return values;
}

export function parseLDrawSurfaceText(content, source = "unknown.dat") {
  const records = [];
  content.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("0")) return;
    const tokens = line.split(/\s+/);
    const type = Number(tokens[0]);
    if (type === 1) {
      if (tokens.length < 15) throw new Error(source + ":" + (index + 1) + ": malformed type-1 record");
      const values = finiteNumbers(tokens.slice(2, 14), source, index + 1);
      records.push({
        type: 1,
        position: values.slice(0, 3),
        matrix: values.slice(3, 12),
        filename: tokens.slice(14).join(" "),
      });
    } else if (type === 3 || type === 4) {
      const count = type === 3 ? 3 : 4;
      if (tokens.length !== 2 + count * 3) {
        throw new Error(source + ":" + (index + 1) + ": malformed type-" + type + " record");
      }
      const values = finiteNumbers(tokens.slice(2), source, index + 1);
      const points = [];
      for (let offset = 0; offset < values.length; offset += 3) {
        points.push(values.slice(offset, offset + 3));
      }
      records.push({ type, points });
    }
  });
  return { source, records };
}

async function fetchFile(path) {
  if (!fileCache.has(path)) {
    const request = fetch(RAW_BASE + path, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      headers: { Accept: "text/plain" },
    }).then(async (response) => {
      if (!response.ok) {
        const error = new Error("LDraw request failed (" + response.status + "): " + path);
        error.status = response.status;
        throw error;
      }
      return response.text();
    }).catch((error) => {
      fileCache.delete(path);
      throw error;
    });
    fileCache.set(path, request);
  }
  return fileCache.get(path);
}

async function getDocument(path) {
  if (!documentCache.has(path)) {
    const pending = fetchFile(path).then((text) => parseLDrawSurfaceText(text, path))
      .catch((error) => {
        documentCache.delete(path);
        throw error;
      });
    documentCache.set(path, pending);
  }
  return documentCache.get(path);
}

async function resolveDocument(filename, parentPath) {
  let lastError;
  for (const candidate of ldrawReferenceCandidates(filename, parentPath)) {
    try {
      return await getDocument(candidate);
    } catch (error) {
      lastError = error;
      if (error.status !== 404) throw error;
    }
  }
  throw lastError || new Error("Could not resolve LDraw reference " + filename);
}

function multiplyMatrix(left, right) {
  const result = new Array(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let inner = 0; inner < 3; inner += 1) {
        result[row * 3 + column] += left[row * 3 + inner] * right[inner * 3 + column];
      }
    }
  }
  return result;
}

function applyMatrix(matrix, point) {
  return [
    matrix[0] * point[0] + matrix[1] * point[1] + matrix[2] * point[2],
    matrix[3] * point[0] + matrix[4] * point[1] + matrix[5] * point[2],
    matrix[6] * point[0] + matrix[7] * point[1] + matrix[8] * point[2],
  ];
}

async function expandDocument(document, matrix, translation, ancestors, depth, output) {
  if (depth > MAX_REFERENCE_DEPTH) {
    throw new Error("Maximum LDraw reference depth exceeded at " + document.source);
  }
  if (ancestors.has(document.source)) throw new Error("Cyclic LDraw reference at " + document.source);
  ancestors.add(document.source);
  output.source_files.add(document.source);
  for (const record of document.records) {
    if (record.type === 1) {
      const child = await resolveDocument(record.filename, document.source);
      const childMatrix = multiplyMatrix(matrix, record.matrix);
      const transformedPosition = applyMatrix(matrix, record.position);
      const childTranslation = transformedPosition.map((value, axis) => value + translation[axis]);
      await expandDocument(child, childMatrix, childTranslation, ancestors, depth + 1, output);
      continue;
    }
    const faces = record.type === 3
      ? [record.points]
      : record.type === 4
        ? [[record.points[0], record.points[1], record.points[2]],
          [record.points[0], record.points[2], record.points[3]]]
        : [];
    for (const face of faces) {
      for (const point of face) {
        const transformed = applyMatrix(matrix, point)
          .map((value, axis) => (value + translation[axis]) * LDU_TO_MM);
        // Match the Part Explorer's LDraw-to-Three Y-up orientation.
        output.positions.push(transformed[0], -transformed[1], -transformed[2]);
      }
      if (output.positions.length / 9 > MAX_PART_TRIANGLES) {
        throw new RangeError("LDraw part exceeds the detailed surface triangle limit.");
      }
    }
  }
  ancestors.delete(document.source);
}

export async function loadLDrawPartSurface(partId) {
  const id = String(partId).trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(id)) throw new TypeError("Invalid LDraw part ID.");
  if (!partGeometryCache.has(id)) {
    const pending = (async () => {
      const root = await getDocument("parts/" + id + ".dat");
      const output = { positions: [], source_files: new Set() };
      await expandDocument(root, [1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0], new Set(), 0, output);
      if (!output.positions.length) throw new Error("No triangle surfaces found for LDraw part " + id);
      const minimum = [Infinity, Infinity, Infinity];
      const maximum = [-Infinity, -Infinity, -Infinity];
      for (let index = 0; index < output.positions.length; index += 3) {
        for (let axis = 0; axis < 3; axis += 1) {
          minimum[axis] = Math.min(minimum[axis], output.positions[index + axis]);
          maximum[axis] = Math.max(maximum[axis], output.positions[index + axis]);
        }
      }
      const centre = minimum.map((value, axis) => (value + maximum[axis]) / 2);
      const positions = new Float32Array(output.positions.length);
      for (let index = 0; index < output.positions.length; index += 3) {
        positions[index] = output.positions[index] - centre[0];
        positions[index + 1] = output.positions[index + 1] - centre[1];
        positions[index + 2] = output.positions[index + 2] - centre[2];
      }
      return {
        part_id: id,
        positions,
        triangle_count: positions.length / 9,
        bounds_mm: [minimum, maximum],
        source_files: [...output.source_files],
      };
    })().catch((error) => {
      partGeometryCache.delete(id);
      throw error;
    });
    partGeometryCache.set(id, pending);
  }
  return partGeometryCache.get(id);
}

function insideOrOnEnvelope(point, box) {
  const dx = point[0] - box.position[0];
  const dy = point[1] - box.position[1];
  const dz = point[2] - box.position[2];
  const localX = dx * box.cosine - dz * box.sine;
  const localZ = dx * box.sine + dz * box.cosine;
  return Math.abs(localX) <= box.size[0] / 2 + 0.05
    && Math.abs(dy) <= box.size[1] / 2 + 0.05
    && Math.abs(localZ) <= box.size[2] / 2 + 0.05;
}

export async function loadConstructionLDrawSurface(result, grid, targetCellBounds, modelCenter, previewTransform) {
  if (!result?.parts?.length || !result.profile_dimensions || typeof previewTransform !== "function") {
    throw new TypeError("A construction with part dimensions and a preview transform is required.");
  }
  const uniqueIds = [...new Set(result.parts.map((part) => String(part.part_id)))];
  const geometryById = new Map();
  for (const partId of uniqueIds) geometryById.set(partId, await loadLDrawPartSurface(partId));
  const boxes = result.parts.map((part) => {
    const profile = result.profile_dimensions[part.part_id];
    if (!profile) throw new Error("Missing profile dimensions for " + part.part_id);
    const transform = previewTransform(part, profile, grid, targetCellBounds, modelCenter);
    return {
      part_id: part.part_id,
      position: transform.position_mm,
      size: transform.size_mm,
      cosine: Math.cos(transform.rotation_y_rad),
      sine: Math.sin(transform.rotation_y_rad),
      rotation: transform.rotation_y_rad,
    };
  });
  const totalTriangles = result.parts.reduce((sum, part) =>
    sum + geometryById.get(String(part.part_id)).triangle_count, 0);
  const stride = Math.max(1, Math.ceil(totalTriangles / MAX_ASSEMBLY_TRIANGLES));
  const output = [];
  let sourceTriangleIndex = 0;
  let sampledTriangles = 0;
  for (let boxIndex = 0; boxIndex < boxes.length; boxIndex += 1) {
    const box = boxes[boxIndex];
    const geometry = geometryById.get(String(box.part_id));
    for (let triangle = 0; triangle < geometry.triangle_count; triangle += 1) {
      const keepSample = sourceTriangleIndex % stride === 0;
      sourceTriangleIndex += 1;
      if (!keepSample) continue;
      const points = [0, 1, 2].map((corner) => {
        const offset = triangle * 9 + corner * 3;
        const x = geometry.positions[offset];
        const y = geometry.positions[offset + 1];
        const z = geometry.positions[offset + 2];
        return [
          box.position[0] + x * box.cosine + z * box.sine,
          box.position[1] + y,
          box.position[2] - x * box.sine + z * box.cosine,
        ];
      });
      const centroid = [0, 1, 2].map((axis) =>
        (points[0][axis] + points[1][axis] + points[2][axis]) / 3);
      const occluded = boxes.some((other, otherIndex) =>
        otherIndex !== boxIndex && insideOrOnEnvelope(centroid, other));
      if (occluded) continue;
      for (const point of points) output.push(point[0], point[1], point[2]);
      sampledTriangles += 1;
      if (sampledTriangles >= MAX_ASSEMBLY_TRIANGLES) break;
    }
    if (sampledTriangles >= MAX_ASSEMBLY_TRIANGLES) break;
  }
  if (!output.length) throw new Error("No exposed detailed LDraw construction triangles were available.");
  return {
    positions: new Float32Array(output),
    sampled_triangle_count: sampledTriangles,
    source_triangle_count: totalTriangles,
    source_part_file_count: [...geometryById.values()]
      .reduce((sum, geometry) => sum + geometry.source_files.length, 0),
    method: "detailed-ldraw-part-surfaces",
    sample_stride: stride,
  };
}
