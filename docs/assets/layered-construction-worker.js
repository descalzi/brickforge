import { buildLayeredFootprintBlock } from "./construction-engine.js";

self.addEventListener("message", async (event) => {
  const { layerFootprints, config } = event.data || {};
  try {
    self.postMessage({ type: "progress", message: "Loading the construction profiles…" });
    const response = await fetch(new URL("../data/connection-profiles/basic-bricks.json", import.meta.url));
    if (!response.ok) throw new Error("Could not load the browser connection profile catalogue.");
    const catalogue = await response.json();
    self.postMessage({ type: "progress", message: "Searching connected course arrangements…" });
    const result = buildLayeredFootprintBlock(layerFootprints, catalogue, config || {});
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Construction generation failed.",
    });
  }
});
