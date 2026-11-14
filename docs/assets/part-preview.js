const IDENTITY = Object.freeze([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);

function finiteVector(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new TypeError(label + " must contain three finite numbers");
  }
  return value;
}

function validRotation(matrix) {
  if (!Array.isArray(matrix) || matrix.length !== 3
      || matrix.some((row) => !Array.isArray(row) || row.length !== 3 || !row.every(Number.isFinite))) {
    return false;
  }
  for (let first = 0; first < 3; first += 1) {
    for (let second = 0; second < 3; second += 1) {
      const dot = matrix[first].reduce((sum, value, axis) => sum + value * matrix[second][axis], 0);
      if (Math.abs(dot - (first === second ? 1 : 0)) > 1e-4) return false;
    }
  }
  const determinant = matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1])
    - matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0])
    + matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
  return Math.abs(determinant - 1) <= 1e-4;
}

export function transformPartPreviewPositions(positions, rotation = IDENTITY, translation = [0, 0, 0], modelCenter = [0, 0, 0]) {
  if ((!Array.isArray(positions) && !ArrayBuffer.isView(positions))
      || positions.length === 0 || positions.length % 3 !== 0
      || !Array.from(positions).every(Number.isFinite)) {
    throw new TypeError("part preview positions must contain finite XYZ triples");
  }
  if (!validRotation(rotation)) {
    throw new TypeError("part preview rotation must be a proper orthonormal 3x3 matrix");
  }
  finiteVector(translation, "part preview translation");
  finiteVector(modelCenter, "model centre");
  const transformed = new Float32Array(positions.length);
  for (let index = 0; index < positions.length; index += 3) {
    const [x, y, z] = [positions[index], positions[index + 1], positions[index + 2]];
    transformed[index] = rotation[0][0] * x + rotation[0][1] * y + rotation[0][2] * z
      + translation[0] - modelCenter[0];
    transformed[index + 1] = rotation[1][0] * x + rotation[1][1] * y + rotation[1][2] * z
      + translation[1] - modelCenter[1];
    transformed[index + 2] = rotation[2][0] * x + rotation[2][1] * y + rotation[2][2] * z
      + translation[2] - modelCenter[2];
  }
  return transformed;
}
