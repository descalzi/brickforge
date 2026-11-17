import { ldrawReferenceCandidates } from "./catalogue-utils.js?v=d0896f9f9a9d";

const LDU_TO_MM = 0.4;
const MAX_REFERENCE_DEPTH = 64;
const MAX_TRIANGLES = 250000;
const IDENTITY = [1,0,0,0,1,0,0,0,1];

function multiplyMatrices(a, b) {
  const result = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      let value = 0;
      for (let index = 0; index < 3; index += 1) value += a[row * 3 + index] * b[index * 3 + column];
      result.push(value);
    }
  }
  return result;
}

function transformVector(matrix, point) {
  return [
    matrix[0] * point[0] + matrix[1] * point[1] + matrix[2] * point[2],
    matrix[3] * point[0] + matrix[4] * point[1] + matrix[5] * point[2],
    matrix[6] * point[0] + matrix[7] * point[1] + matrix[8] * point[2],
  ];
}

function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }

function numbers(tokens, source, lineNumber) {
  const values = tokens.map(Number);
  if (!values.every(Number.isFinite)) {
    throw new Error(source + ":" + lineNumber + ": invalid numeric LDraw geometry.");
  }
  return values;
}

function parseDocument(text, source) {
  const records = [];
  let description = "";
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("0 ")) {
      if (!description && /^0\s+Name:/i.test(line)) description = line.replace(/^0\s+Name:/i, "").trim();
      continue;
    }
    const tokens = line.split(/\s+/);
    const type = Number(tokens[0]);
    if (type === 1) {
      if (tokens.length < 15) throw new Error(source + ":" + (index + 1) + ": malformed type-1 reference.");
      const values = numbers(tokens.slice(2, 14), source, index + 1);
      records.push({
        type,
        colour: Number(tokens[1]),
        position: values.slice(0, 3),
        matrix: values.slice(3, 12),
        filename: tokens.slice(14).join(" "),
      });
    } else if (type === 3 || type === 4) {
      const expected = type === 3 ? 11 : 14;
      if (tokens.length !== expected) throw new Error(source + ":" + (index + 1) + ": malformed type-" + type + " face.");
      const values = numbers(tokens.slice(2), source, index + 1);
      const points = [];
      for (let offset = 0; offset < values.length; offset += 3) points.push(values.slice(offset, offset + 3));
      records.push({ type, colour: Number(tokens[1]), points });
    }
  }
  return { source, description, records };
}

function pinnedGeometryBase(catalogue) {
  const value = catalogue?.source?.geometry_base_url;
  if (typeof value !== "string"
      || !/^https:\/\/raw\.githubusercontent\.com\/kulits\/ldraw-parts\/[0-9a-f]{40}\/ldraw\/$/.test(value)) {
    throw new TypeError("A pinned, approved LDraw geometry source is required.");
  }
  return value;
}

function descriptor(partId, sourceFilename, positions, triangleCount) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  let surfaceArea = 0;
  for (let index = 0; index < positions.length; index += 9) {
    const a = positions.slice(index, index + 3);
    const b = positions.slice(index + 3, index + 6);
    const c = positions.slice(index + 6, index + 9);
    for (const point of [a, b, c]) {
      for (let axis = 0; axis < 3; axis += 1) {
        minimum[axis] = Math.min(minimum[axis], point[axis]);
        maximum[axis] = Math.max(maximum[axis], point[axis]);
      }
    }
    const ab = b.map((value, axis) => value - a[axis]);
    const ac = c.map((value, axis) => value - a[axis]);
    const cross = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    surfaceArea += Math.hypot(...cross) * 0.5;
  }
  const dimensions = maximum.map((value, axis) => value - minimum[axis]);
  const minMm = [...minimum];
  const maxMm = [...maximum];
  return {
    part_id: partId,
    source_filename: sourceFilename,
    geometry_status: "resolved_ldraw_surface",
    triangle_count: triangleCount,
    bounds_mm: { minimum: minMm, maximum: maxMm },
    dimensions_mm: dimensions,
    bounding_box_volume_mm3: dimensions[0] * dimensions[1] * dimensions[2],
    surface_area_mm2: surfaceArea,
    limitations: [
      "Dimensions and surface area are measured from the resolved display surface.",
      "Bounding-box volume is not a solid-volume measurement.",
      "A resolved surface does not establish watertightness, functional role, connection compatibility or structural strength.",
    ],
  };
}

/**
 * Resolve real LDraw triangles in the browser. Only a pinned official-mirror
 * snapshot is accepted; nested part/subpart/primitive references are fetched lazily.
 */
export function createLDrawGeometryResolver(catalogue, options = {}) {
  const baseUrl = pinnedGeometryBase(catalogue);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const maxTriangles = options.maxTriangles ?? MAX_TRIANGLES;
  const documentCache = new Map();

  async function loadDocument(path) {
    if (documentCache.has(path)) return documentCache.get(path);
    const pending = (async () => {
      const response = await fetchImpl(baseUrl + path, { headers: { Accept: "text/plain" } });
      if (!response.ok) {
        const error = new Error("LDraw source request failed (" + response.status + "): " + path);
        error.status = response.status;
        throw error;
      }
      return parseDocument(await response.text(), path);
    })().catch((error) => {
      documentCache.delete(path);
      throw error;
    });
    documentCache.set(path, pending);
    return pending;
  }

  async function resolveReference(filename, parentPath) {
    let lastError;
    for (const path of ldrawReferenceCandidates(filename, parentPath)) {
      try { return await loadDocument(path); }
      catch (error) {
        lastError = error;
        if (error.status !== 404) throw error;
      }
    }
    throw lastError || new Error("Unable to resolve LDraw reference " + filename);
  }

  async function resolvePart(partId, partIndex, resolveOptions = {}) {
    const part = partIndex?.parts?.find((item) => item.part_id === String(partId));
    if (!part || typeof part.filename !== "string" || !part.filename.startsWith("parts/")
        || part.filename.includes(String.fromCharCode(92)) || part.filename.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
      throw new Error("Part " + partId + " is not present at a safe top-level path in the searchable LDraw index.");
    }
    const root = await loadDocument(part.filename);
    const positions = [];
    const ancestors = new Set();
    async function expand(document, matrix, translation, inheritedColour, depth) {
      if (depth > MAX_REFERENCE_DEPTH) throw new Error("LDraw reference depth limit exceeded at " + document.source);
      if (ancestors.has(document.source)) throw new Error("Cyclic LDraw reference detected at " + document.source);
      ancestors.add(document.source);
      for (const record of document.records) {
        if (record.type === 1) {
          if (!Number.isInteger(record.colour) || record.colour < 0 || record.colour === 24) {
            throw new Error(document.source + ": unsupported type-1 colour code.");
          }
          const child = await resolveReference(record.filename, document.source);
          const childMatrix = multiplyMatrices(matrix, record.matrix);
          const childTranslation = add(transformVector(matrix, record.position), translation);
          await expand(child, childMatrix, childTranslation,
            record.colour === 16 ? inheritedColour : record.colour, depth + 1);
        } else if (record.type === 3 || record.type === 4) {
          const trianglePoints = record.type === 3
            ? [record.points]
            : [[record.points[0], record.points[1], record.points[2]],
              [record.points[0], record.points[2], record.points[3]]];
          for (const triangle of trianglePoints) {
            for (const point of triangle) {
              const transformed = add(transformVector(matrix, point), translation);
              positions.push(...transformed.map((value) => value * LDU_TO_MM));
            }
            if (positions.length / 9 > maxTriangles) {
              throw new RangeError("Resolved part exceeds the " + maxTriangles + " triangle safety limit.");
            }
          }
        }
      }
      ancestors.delete(document.source);
    }
    await expand(root, IDENTITY, [0, 0, 0], 16, 0);
    if (!positions.length) throw new Error("Part " + partId + " contains no resolvable surface triangles.");
    const report = descriptor(String(partId), part.filename, positions, positions.length / 9);
    if (resolveOptions.includeTrianglePositions) report.triangle_positions_mm = positions;
    return report;
  }

  const sourceCommit = baseUrl.match(/\/([0-9a-f]{40})\/ldraw\/$/)?.[1] || null;
  return {
    source_base_url: baseUrl,
    source_commit: sourceCommit,
    resolvePart,
    get cachedDocumentCount() { return documentCache.size; },
  };
}

/** Compare fixed-size part geometry with a required physical envelope, allowing rotations. */
export function scoreGeometrySuitability(geometry, targetDimensionsMm, options = {}) {
  if (!geometry || !Array.isArray(geometry.dimensions_mm)
      || geometry.dimensions_mm.length !== 3
      || !geometry.dimensions_mm.every((value) => Number.isFinite(value) && value > 0)) {
    throw new TypeError("geometry must provide three positive measured dimensions.");
  }
  if (!Array.isArray(targetDimensionsMm) || targetDimensionsMm.length !== 3
      || !targetDimensionsMm.every((value) => Number.isFinite(value) && value > 0)) {
    throw new TypeError("targetDimensionsMm must contain three positive dimensions.");
  }
  const tolerance = options.maxRelativeError ?? 0.2;
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new RangeError("maxRelativeError must be non-negative.");
  const allPermutations = [
    [0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0],
  ];
  const permutations = options.orientationPermutation === undefined
    ? allPermutations
    : [options.orientationPermutation];
  if (permutations.some((permutation) => !Array.isArray(permutation) || permutation.length !== 3
      || new Set(permutation).size !== 3
      || !permutation.every((axis) => Number.isInteger(axis) && axis >= 0 && axis <= 2))) {
    throw new RangeError("orientationPermutation must be a permutation of the three coordinate axes.");
  }
  let best = null;
  for (const permutation of permutations) {
    const errors = targetDimensionsMm.map((target, axis) =>
      Math.abs(geometry.dimensions_mm[permutation[axis]] - target) / target);
    const meanError = errors.reduce((sum, value) => sum + value, 0) / 3;
    if (!best || meanError < best.meanError) {
      best = { permutation, errors, meanError };
    }
  }
  return {
    part_id: geometry.part_id,
    score: Math.max(0, 100 * (1 - best.meanError)),
    mean_relative_error: best.meanError,
    axis_relative_errors: best.errors,
    orientation_permutation: best.permutation,
    within_dimension_tolerance: best.errors.every((error) => error <= tolerance),
    geometry_only_evidence: true,
    limitations: [
      "This is a bounding-dimension comparison, not a surface-shape or functional match.",
      "A suitable envelope does not prove the part can connect to the rest of the model.",
    ],
  };
}

/** Build a resolver from the same pinned official-mirror source as the curated catalogue. */
export function createLDrawGeometryResolverFromSpecialisedCatalogue(specialisedCatalogue, options = {}) {
  const source = specialisedCatalogue?.source_library;
  if (!source || source.repository !== "https://github.com/kulits/ldraw-parts"
      || typeof source.commit !== "string" || !/^[0-9a-f]{40}$/.test(source.commit)
      || source.base_path !== "ldraw/parts/") {
    throw new TypeError("A supported pinned specialised LDraw catalogue source is required.");
  }
  const geometryBaseUrl = "https://raw.githubusercontent.com/kulits/ldraw-parts/"
    + source.commit + "/ldraw/";
  return createLDrawGeometryResolver({ source: { geometry_base_url: geometryBaseUrl } }, options);
}
