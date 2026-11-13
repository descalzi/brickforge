/**
 * Re-centre a camera at a new target without changing its viewing offset.
 * Inputs and output are [x, y, z] arrays, independent of the rendering library.
 */
export function recenterCameraPosition(cameraPosition, oldTarget, newTarget) {
  if (![cameraPosition, oldTarget, newTarget].every(
    (vector) => Array.isArray(vector) && vector.length === 3
      && vector.every(Number.isFinite),
  )) {
    throw new TypeError("Camera positions and targets must be finite three-component arrays.");
  }
  return cameraPosition.map(
    (coordinate, index) => newTarget[index] + coordinate - oldTarget[index],
  );
}
