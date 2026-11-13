import { buildFootprintBlock } from "./construction-engine.js";

self.addEventListener("message", (event) => {
  const { cells, height, catalogue, options } = event.data;
  try {
    const result = buildFootprintBlock(cells, height, catalogue, options);
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "The footprint could not be generated.",
    });
  }
});
