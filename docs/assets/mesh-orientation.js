const ORIENTATION_MATRICES = Object.freeze({
  y: Object.freeze([
    Object.freeze([1, 0, 0]),
    Object.freeze([0, 1, 0]),
    Object.freeze([0, 0, 1]),
  ]),
  // Rotate source Z-up coordinates onto construction Y-up coordinates.
  z: Object.freeze([
    Object.freeze([1, 0, 0]),
    Object.freeze([0, 0, 1]),
    Object.freeze([0, -1, 0]),
  ]),
  // Rotate source X-up coordinates onto construction Y-up coordinates.
  x: Object.freeze([
    Object.freeze([0, -1, 0]),
    Object.freeze([1, 0, 0]),
    Object.freeze([0, 0, 1]),
  ]),
});

export function orientationMatrixToYUp(sourceUpAxis = "y") {
  const matrix = ORIENTATION_MATRICES[sourceUpAxis];
  if (!matrix) throw new RangeError("source up axis must be x, y or z");
  return matrix;
}

export function orientPointToYUp(point, sourceUpAxis = "y") {
  if (!Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite)) {
    throw new TypeError("point must contain three finite coordinates");
  }
  const matrix = orientationMatrixToYUp(sourceUpAxis);
  return matrix.map((row) => row.reduce((sum, value, axis) => sum + value * point[axis], 0));
}
