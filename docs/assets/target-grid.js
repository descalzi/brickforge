export const TARGET_GRID_VERSION = 1;
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
  constructor({ spec, classification, surface_coverage, source_units, source_bounds_mm, warnings = [] }) {
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
    const classes = Uint8Array.from(classification);
    const coverage = Float32Array.from(surface_coverage);
    this.spec = spec;
    this.classification = classes;
    this.surface_coverage = coverage;
    this.source_units = source_units;
    this.source_bounds_mm = bounds.map((point) => Object.freeze(point));
    this.warnings = warnings.slice();
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
      warnings: this.warnings.slice(),
    };
  }
}
