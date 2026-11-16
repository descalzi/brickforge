import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { createReadStream, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../docs");
const mime = new Map([[".js","text/javascript"],[".json","application/json"],[".html","text/html"]]);
const server = http.createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
  catch { response.writeHead(400).end(); return; }
  const target = path.resolve(root, "." + pathname);
  if (!target.startsWith(root + path.sep) && target !== root) { response.writeHead(403).end(); return; }
  if (!existsSync(target)) { response.writeHead(404).end("Not found"); return; }
  response.setHeader("Content-Type", mime.get(path.extname(target)) || "application/octet-stream");
  createReadStream(target).pipe(response);
});
await new Promise((resolve) => server.listen(4174, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:4174/index.html", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const [{ constructDesign, validateDesignSpec }, catalogueResponse, fixturesResponse] = await Promise.all([
      import("./assets/design-spec-engine.js"),
      fetch("./data/connection-profiles/basic-bricks.json"),
      fetch("./data/design-spec-fixtures.json"),
    ]);
    if (!catalogueResponse.ok || !fixturesResponse.ok) throw new Error("Published engine data could not be loaded.");
    const catalogue = await catalogueResponse.json();
    const fixtures = await fixturesResponse.json();
    const brief = fixtures.specifications.find(item => item.design_id === "small-house");
    const validation = validateDesignSpec(brief);
    const assembly = constructDesign(brief, catalogue);
    return {
      valid: validation.valid,
      cataloguePartCount: partIndex.parts.length,\n      wheelCandidateCount: wheelDiscovery.candidate_count,\n      wheelPlannerReadyCount: wheelDiscovery.planner_ready_count,\n      parts: assembly.parts.length,
      edges: assembly.connections.length,
      matingPairs: assembly.total_mating_pairs,
      bomParts: assembly.bom.total_parts,
      ldrawRecords: assembly.ldraw.split("\n").filter(line => line.startsWith("1 ")).length,
      limitations: assembly.design_diagnostics.limitations,
    };
  });
  assert.equal(result.valid, true);
  assert.ok(result.cataloguePartCount > 10000);\n  assert.ok(result.wheelCandidateCount > 0);\n  assert.ok(result.wheelPlannerReadyCount <= result.wheelCandidateCount);\n  assert.ok(result.parts > 0);
  assert.ok(result.edges > 0);
  assert.ok(result.matingPairs > 0);
  assert.equal(result.bomParts, result.parts);
  assert.equal(result.ldrawRecords, result.parts);
  assert.ok(result.limitations.length >= 3);
  console.log("Headless Chromium design-to-assembly result: " + JSON.stringify(result));
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
