export const TARGET_GRID_VERSION = 6;
export const BRICK_GRID_PITCH_MM = Object.freeze([8, 9.6, 8]);

export const CellClass = Object.freeze({
  EXTERIOR: 0,
  INTERIOR: 1,
  BOUNDARY: 2,
});

function finiteVector(value, label, positive = false) {
  if (!Array.isArray(value) || value.length !== 3
      || !value.every((item) => Number.isFinite(item) && (!positive || item > 0))) {
    throw new TypeError(label + " must contain three " + (positive ? "positive " : "") + "finite numbers");
  }
  return value.map(Number);
}

function positiveDimensions(value) {
  if (!Array.isArray(value) || value.length !== 3
      || !value.every((item) => Number.isSafeInteger(item) && item > 0)) {
    throw new TypeError("grid dimensions must be three positive integers");
  }
  return value.slice();
}

export class GridSpec {
  constructor({ dimensions, origin_mm, pitch_mm = BRICK_GRID_PITCH_MM }) {
    this.dimensions = positiveDimensions(dimensions);
    this.origin_mm = finiteVector(origin_mm, "grid origin");
    this.pitch_mm = finiteVector(pitch_mm, "grid pitch", true);
    Object.freeze(this.dimensions);
    Object.freeze(this.origin_mm);
    Object.freeze(this.pitch_mm);
    Object.freeze(this);
  }

  get cell_count() {
    return this.dimensions[0] * this.dimensions[1] * this.dimensions[2];
  }

  get array_shape() {
    const [width, height, depth] = this.dimensions;
    return [height, depth, width];
  }

  contains(x, y, z) {
    const [width, height, depth] = this.dimensions;
    return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z)
      && x >= 0 && x < width && y >= 0 && y < height && z >= 0 && z < depth;
  }

  flat_index(x, y, z) {
    if (!this.contains(x, y, z)) {
      throw new RangeError("grid cell is outside dimensions: " + JSON.stringify([x, y, z]));
    }
    const [width, , depth] = this.dimensions;
    return x + width * (z + depth * y);
  }

  cell_center_mm(x, y, z) {
    if (!this.contains(x, y, z)) {
      throw new RangeError("grid cell is outside dimensions: " + JSON.stringify([x, y, z]));
    }
    return [x, y, z].map((index, axis) =>
      this.origin_mm[axis] + (index + 0.5) * this.pitch_mm[axis]);
  }

  cell_bounds_mm(x, y, z) {
    if (!this.contains(x, y, z)) {
      throw new RangeError("grid cell is outside dimensions: " + JSON.stringify([x, y, z]));
    }
    const minimum = [x, y, z].map((index, axis) =>
      this.origin_mm[axis] + index * this.pitch_mm[axis]);
    return [minimum, minimum.map((value, axis) => value + this.pitch_mm[axis])];
  }
}

export class TargetGrid {
  constructor({ spec, classification, surface_coverage, source_units, source_bounds_mm, warnings = [], topology = null, features = [], feature_keepouts = [] }) {
    if (!(spec instanceof GridSpec)) throw new TypeError("spec must be a GridSpec");
    if (!["mm", "cm", "m", "in"].includes(source_units)) {
      throw new TypeError("source_units must be 'mm', 'cm', 'm' or 'in'");
    }
    if (!Array.isArray(source_bounds_mm) || source_bounds_mm.length !== 2) {
      throw new TypeError("source bounds must contain two finite 3D points");
    }
    const bounds = source_bounds_mm.map((point) => finiteVector(point, "source bounds"));
    if (bounds[1].some((value, axis) => value < bounds[0][axis])) {
      throw new RangeError("source maximum bounds must not be below minimum bounds");
    }
    if (!Array.isArray(warnings) || !warnings.every((warning) => typeof warning === "string")) {
      throw new TypeError("warnings must be an array of strings");
    }
    if (!classification || classification.length !== spec.cell_count
        || !surface_coverage || surface_coverage.length !== spec.cell_count) {
      throw new RangeError("classification and surface coverage must match grid cell count");
    }
    for (let index = 0; index < spec.cell_count; index += 1) {
      if (!Number.isInteger(classification[index])
          || ![CellClass.EXTERIOR, CellClass.INTERIOR, CellClass.BOUNDARY].includes(classification[index])) {
        throw new RangeError("classification contains an unknown cell class");
      }
      if (!Number.isFinite(surface_coverage[index])
          || surface_coverage[index] < 0 || surface_coverage[index] > 1) {
        throw new RangeError("surface coverage values must be finite and between 0 and 1");
      }
    }
    let topologySummary = null;
    if (topology !== null) {
      const fields = ["component_count", "vertex_count", "edge_count", "face_count", "euler_characteristic", "handle_count"];
      if (!topology || typeof topology !== "object"
          || fields.some((field) => !Number.isSafeInteger(topology[field]))
          || topology.component_count < 1 || topology.vertex_count < 1
          || topology.edge_count < 1 || topology.face_count < 1 || topology.handle_count < 0) {
        throw new TypeError("topology must contain valid closed-mesh component, count, Euler and handle data");
      }
      topologySummary = Object.freeze(Object.fromEntries(fields.map((field) => [field, topology[field]])));
    }
    if (!Array.isArray(features)) throw new TypeError("features must be an array");
    const featureRecords = features.map((feature, index) => {
      const axes = ["x", "y", "z"];
      const numericFields = [
        "observed_span_mm", "width_mm", "length_mm", "area_mm2",
        "perimeter_mm", "equivalent_diameter_mm", "minimum_equivalent_diameter_mm",
        "maximum_equivalent_diameter_mm", "minimum_width_mm", "maximum_width_mm",
        "minimum_length_mm", "maximum_length_mm", "minimum_area_mm2", "maximum_area_mm2",
        "circularity", "aspect_ratio",
      ];
      if (!feature || typeof feature !== "object"
          || typeof feature.id !== "string" || !feature.id
          || !axes.includes(feature.axis)
          || feature.axis_index !== axes.indexOf(feature.axis)
          || typeof feature.shape !== "string" || !feature.shape
          || !["high", "medium"].includes(feature.confidence)
          || !Number.isSafeInteger(feature.sample_support) || feature.sample_support < 2
          || numericFields.some((field) => !Number.isFinite(feature[field]))
          || feature.observed_span_mm < 0
          || numericFields.slice(1, 6).some((field) => feature[field] <= 0)
          || feature.minimum_equivalent_diameter_mm <= 0
          || feature.maximum_equivalent_diameter_mm < feature.minimum_equivalent_diameter_mm
          || feature.minimum_width_mm <= 0 || feature.maximum_width_mm < feature.minimum_width_mm
          || feature.minimum_length_mm <= 0 || feature.maximum_length_mm < feature.minimum_length_mm
          || feature.minimum_area_mm2 <= 0 || feature.maximum_area_mm2 < feature.minimum_area_mm2
          || feature.circularity < 0 || feature.circularity > 1
          || feature.aspect_ratio < 1) {
        throw new TypeError("feature " + index + " contains invalid measured opening metadata");
      }
      const centre = finiteVector(feature.center_mm, "feature centre");
      if (!Array.isArray(feature.bounds_mm) || feature.bounds_mm.length !== 2) {
        throw new TypeError("feature bounds must contain two 3D points");
      }
      const featureBounds = feature.bounds_mm.map((point) => finiteVector(point, "feature bounds"));
      if (featureBounds[1].some((value, axis) => value < featureBounds[0][axis])) {
        throw new RangeError("feature maximum bounds must not be below minimum bounds");
      }
      return Object.freeze({
        id: feature.id,
        axis: feature.axis,
        axis_index: feature.axis_index,
        shape: feature.shape,
        center_mm: Object.freeze(centre),
        bounds_mm: Object.freeze(featureBounds.map((point) => Object.freeze(point))),
        observed_span_mm: feature.observed_span_mm,
        width_mm: feature.width_mm,
        length_mm: feature.length_mm,
        area_mm2: feature.area_mm2,
        perimeter_mm: feature.perimeter_mm,
        equivalent_diameter_mm: feature.equivalent_diameter_mm,
        minimum_equivalent_diameter_mm: feature.minimum_equivalent_diameter_mm,
        maximum_equivalent_diameter_mm: feature.maximum_equivalent_diameter_mm,
        minimum_width_mm: feature.minimum_width_mm,
        maximum_width_mm: feature.maximum_width_mm,
        minimum_length_mm: feature.minimum_length_mm,
        maximum_length_mm: feature.maximum_length_mm,
        minimum_area_mm2: feature.minimum_area_mm2,
        maximum_area_mm2: feature.maximum_area_mm2,
        circularity: feature.circularity,
        aspect_ratio: feature.aspect_ratio,
        sample_support: feature.sample_support,
        confidence: feature.confidence,
      });
    });
    if (!Array.isArray(feature_keepouts) || feature_keepouts.some((item) =>
      !item || typeof item.feature_id !== "string" || !["x", "y", "z"].includes(item.axis)
      || !Number.isSafeInteger(item.cell_count) || item.cell_count < 0
      || typeof item.preserved !== "boolean"
      || (item.axial_cell_count !== undefined
        && (!Number.isSafeInteger(item.axial_cell_count) || item.axial_cell_count < 0))
      || (item.support_slices !== undefined
        && (!Number.isSafeInteger(item.support_slices) || item.support_slices < 0))
      || (item.local_axial_bounds_mm !== undefined
        && (!Array.isArray(item.local_axial_bounds_mm) || item.local_axial_bounds_mm.length !== 2
          || !item.local_axial_bounds_mm.every(Number.isFinite)
          || item.local_axial_bounds_mm[1] <= item.local_axial_bounds_mm[0])))) {
      throw new TypeError("feature keep-outs must contain valid feature identifiers, axes and cell counts");
    }
    const keepoutRecords = feature_keepouts.map((item) => Object.freeze({ ...item }));
    const classes = Uint8Array.from(classification);
    const coverage = Float32Array.from(surface_coverage);
    this.spec = spec;
    this.classification = classes;
    this.surface_coverage = coverage;
    this.source_units = source_units;
    this.source_bounds_mm = bounds.map((point) => Object.freeze(point));
    this.warnings = warnings.slice();
    this.topology = topologySummary;
    this.features = Object.freeze(featureRecords);
    this.feature_keepouts = Object.freeze(keepoutRecords);
    Object.freeze(this.source_bounds_mm);
    Object.freeze(this.warnings);
    Object.freeze(this);
  }

  get occupied_cell_count() {
    return this.classification.reduce((count, value) =>
      count + (value !== CellClass.EXTERIOR ? 1 : 0), 0);
  }

  get boundary_cell_count() {
    return this.classification.reduce((count, value) =>
      count + (value === CellClass.BOUNDARY ? 1 : 0), 0);
  }

  layer_footprint(y) {
    const [width, height, depth] = this.spec.dimensions;
    if (!Number.isInteger(y) || y < 0 || y >= height) {
      throw new RangeError("grid layer is outside height: " + y);
    }
    const cells = [];
    for (let z = 0; z < depth; z += 1) {
      for (let x = 0; x < width; x += 1) {
        if (this.classification[this.spec.flat_index(x, y, z)] !== CellClass.EXTERIOR) {
          cells.push([x, z]);
        }
      }
    }
    return cells.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  }

  summary() {
    return {
      representation_version: TARGET_GRID_VERSION,
      dimensions: this.spec.dimensions.slice(),
      origin_mm: this.spec.origin_mm.slice(),
      pitch_mm: this.spec.pitch_mm.slice(),
      source_units: this.source_units,
      source_bounds_mm: this.source_bounds_mm.map((point) => point.slice()),
      occupied_cell_count: this.occupied_cell_count,
      boundary_cell_count: this.boundary_cell_count,
      topology: this.topology ? { ...this.topology } : null,
      features: this.features.map((feature) => ({
        ...feature,
        center_mm: feature.center_mm.slice(),
        bounds_mm: feature.bounds_mm.map((point) => point.slice()),
      })),
      feature_keepouts: this.feature_keepouts.map((item) => ({ ...item })),
      warnings: this.warnings.slice(),
    };
  }
}
