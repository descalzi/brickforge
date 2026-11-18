import { voxelizeMesh } from "./mesh-voxelizer.js?v=c008cadea6e8";

self.addEventListener("message", (event) => {
  const { vertices, indices, units, pitchMm, maxCells } = event.data;
  try {
    const result = voxelizeMesh({
      vertices,
      indices,
      units,
      pitchMm,
      maxCells,
      onProgress: (progress) => self.postMessage({ type: "progress", ...progress }),
    });
    self.postMessage({
      type: "complete",
      result,
    }, [result.classification.buffer, result.surface_coverage.buffer]);
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Mesh voxelisation failed.",
    });
  }
});
