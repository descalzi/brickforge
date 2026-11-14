import { analyzeMeshFeatures } from "./mesh-feature-analysis.js?v=featuremeasure2";

self.addEventListener("message", (event) => {
  const { trianglePositions, boundsMin, boundsMax } = event.data || {};
  try {
    if (!trianglePositions || trianglePositions.length < 9 || trianglePositions.length % 9 !== 0) {
      throw new TypeError("Part feature analysis requires complete triangle positions.");
    }
    const triangles = [];
    for (let index = 0; index < trianglePositions.length; index += 9) {
      triangles.push({
        a: [trianglePositions[index], trianglePositions[index + 1], trianglePositions[index + 2]],
        b: [trianglePositions[index + 3], trianglePositions[index + 4], trianglePositions[index + 5]],
        c: [trianglePositions[index + 6], trianglePositions[index + 7], trianglePositions[index + 8]],
      });
    }
    const features = analyzeMeshFeatures(triangles, boundsMin, boundsMax);
    self.postMessage({ type: "complete", features });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Part feature analysis failed.",
    });
  }
});
