import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../docs");
const mime = new Map([[".html","text/html"],[".js","text/javascript"],[".json","application/json"],[".stl","model/stl"],[".css","text/css"],[".png","image/png"],[".svg","image/svg+xml"]]);
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
await new Promise((resolve) => server.listen(4173, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const fixtures = [
  { file: "block-through-hole.stl", tunnels: 1 },
  { file: "block-two-hole-pattern.stl", tunnels: 2 },
  { file: "block-three-hole-pattern.stl", tunnels: 3 },
];
const failures = [];
try {
  for (const fixture of fixtures) {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on("pageerror", error => consoleErrors.push(error.message));
    page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await page.goto("http://127.0.0.1:4173/inspector.html?fixture=" + fixture.file, { waitUntil: "networkidle" });
    await page.locator("#voxelise-button").waitFor({ state: "visible" });
    await page.waitForFunction(() => {
      const button = document.querySelector("#voxelise-button");
      return button && !button.disabled;
    }, null, { timeout: 60000 });
    await page.locator("#voxelise-button").click();
    await page.waitForFunction(() => {
      const status = document.querySelector("#voxelise-status");
      return status && ["complete","warning","error"].includes(status.dataset.state);
    }, null, { timeout: 180000 });
    const voxelStatus = await page.locator("#voxelise-status").innerText();
    const constructionStatus = await page.locator("#construction-status").innerText();
    const buildEnabled = await page.locator("#build-construction").isEnabled();
    const featureStatus = await page.locator("#voxel-feature-status").innerText().catch(() => "");
    console.log(JSON.stringify({ fixture: fixture.file, voxelStatus, featureStatus, constructionStatus }));
    assert.match(voxelStatus, /Voxelisation complete/i, fixture.file + ": voxelisation did not complete. " + voxelStatus);
    assert.doesNotMatch(constructionStatus, /Construction blocked/i,
      fixture.file + ": " + constructionStatus + " | " + voxelStatus + " | " + featureStatus);
    assert.equal(buildEnabled, true, fixture.file + ": construction button remained disabled. " + constructionStatus);
    await page.locator("#build-construction").click();
    await page.waitForFunction(() => {
      const status = document.querySelector("#construction-status");
      return status && status.dataset.state !== "working";
    }, null, { timeout: 180000 });
    const resultStatus = await page.locator("#construction-status").innerText();
    assert.doesNotMatch(resultStatus, /Construction blocked|failed/i, fixture.file + ": " + resultStatus);
    assert.equal(consoleErrors.length, 0, fixture.file + ": browser errors: " + consoleErrors.join(" | "));
    console.log(JSON.stringify({ fixture: fixture.file, expectedTunnels: fixture.tunnels, voxelStatus, featureStatus, constructionStatus: resultStatus }));
    await page.close();
  }
} catch (error) {
  failures.push(error);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
if (failures.length) throw failures[0];
