import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { createReadStream, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../docs");
const mime = new Map([[".js", "text/javascript"], [".json", "application/json"], [".html", "text/html"]]);
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
    const [
      { constructDesign, validateDesignSpec },
      { decodeCataloguePayload },
      { discoverPartsForRole, rankDesignComponentCandidates },
      { matchRequiredInterfaces },
      { createLDrawGeometryResolverFromSpecialisedCatalogue },
      catalogueResponse,
      fixturesResponse,
      indexResponse,
      specialisedResponse,
    ] = await Promise.all([
      import("./assets/design-spec-engine.js"),
      import("./assets/catalogue-utils.js"),
      import("./assets/part-discovery.js"),
      import("./assets/interface-matcher.js"),
      import("./assets/ldraw-geometry.js"),
      fetch("./data/connection-profiles/basic-bricks.json"),
      fetch("./data/design-spec-fixtures.json"),
      fetch("./data/ldraw/parts-index.json.gz"),
      fetch("./data/specialised-technic-part-catalogue.json"),
    ]);
    if (!catalogueResponse.ok || !fixturesResponse.ok || !indexResponse.ok || !specialisedResponse.ok) {
      throw new Error("Published engine data could not be loaded.");
    }
    const catalogue = await catalogueResponse.json();
    const fixtures = await fixturesResponse.json();
    const indexText = await decodeCataloguePayload(await indexResponse.arrayBuffer());
    const partIndex = JSON.parse(indexText);
    const specialisedCatalogue = await specialisedResponse.json();
    const wheelDiscovery = discoverPartsForRole("wheel", partIndex.parts, catalogue);
    const technicDiscovery = discoverPartsForRole("technic", partIndex.parts, catalogue, { specialisedCatalogue });
    const technicHoleCandidates = technicDiscovery.candidates.filter(candidate =>
      candidate.specialised_interfaces.some(item => item.interface_type === "technic_pin_hole"));
    const technicInterfaceMatches = technicHoleCandidates.filter(candidate =>
      matchRequiredInterfaces([{ interface_type: "round_opening", diameter_mm: 4.8, axis_vector: [0,0,1], count: 1 }], candidate.specialised_interfaces).satisfied);
    const beamCatalogue = {
      ...specialisedCatalogue,
      profiles: specialisedCatalogue.profiles.filter(profile => profile.part_id === "3701"),
    };
    const geometryResolver = createLDrawGeometryResolverFromSpecialisedCatalogue(beamCatalogue);
    const beamComponent = {
      id: "technic-beam",
      role: "beam",
      geometry: { type: "orthogonal_prism", width_studs: 4, depth_studs: 1 },
      height_courses: 1,
      required_interfaces: [{
        interface_type: "round_opening",
        diameter_mm: 4.8,
        axis_vector: [0,0,1],
        count: 3,
      }],
    };
    const beamRanking = await rankDesignComponentCandidates(
      beamComponent,
      { ...partIndex, parts: [] },
      catalogue,
      beamCatalogue,
      geometryResolver,
      { maxCandidates: 1 },
    );
    const selectedBeam = beamRanking.ranking.candidates[0];
    const brief = fixtures.specifications.find(item => item.design_id === "small-house");
    const validation = validateDesignSpec(brief);
    const assembly = constructDesign(brief, catalogue);
    const openingBrief = fixtures.specifications.find(item => item.design_id === "box-with-opening");
    const openingAssembly = constructDesign(openingBrief, catalogue);
    const openingOccupied = new Set();
    for (const part of openingAssembly.parts) {
      const profile = openingAssembly.profile_dimensions[part.part_id];
      const rotated = Math.abs(part.matrix[0]) < 0.5;
      const width = rotated ? profile.footprint_studs_z : profile.footprint_studs_x;
      const depth = rotated ? profile.footprint_studs_x : profile.footprint_studs_z;
      const x0 = Math.round(part.translation_ldu[0] / 20 + 2 - width / 2);
      const z0 = Math.round(part.translation_ldu[2] / 20 + 2 - depth / 2);
      const course = Math.round(-part.translation_ldu[1] / 24);
      for (let x = x0; x < x0 + width; x += 1) {
        for (let z = z0; z < z0 + depth; z += 1) openingOccupied.add(x + "," + z + "," + course);
      }
    }
    const openingVoidPreserved = [0, 1].every(course =>
      [1, 2].every(x => [1, 2].every(z => !openingOccupied.has(x + "," + z + "," + course))));
    return {
      valid: validation.valid,
      openingVoidPreserved,
      openingOccupiedCellCount: openingOccupied.size,
      openingConnectionCount: openingAssembly.connections.length,
      openingVoidCellCount: openingAssembly.design_diagnostics.negative_space_coverage[0].cells_removed,
      cataloguePartCount: partIndex.parts.length,
      wheelCandidateCount: wheelDiscovery.candidate_count,
      wheelPlannerReadyCount: wheelDiscovery.planner_ready_count,
      technicCandidateCount: technicDiscovery.candidate_count,
      technicInterfaceProfileCount: technicDiscovery.profiled_candidate_count,
      technicSpecialisedProfileCount: technicDiscovery.candidates.filter(candidate => candidate.specialised_interface_profile_available).length,
      technicCandidatesDebug: technicDiscovery.candidates.map(candidate => ({ part_id: candidate.part_id, name: candidate.name, specialised: candidate.specialised_interface_profile_available, interfaceCount: candidate.specialised_interfaces.length, filename: candidate.filename })),
      specialisedProfileIds: specialisedCatalogue.profiles.map(profile => profile.part_id),
      technicHoleCandidateCount: technicHoleCandidates.length,
      technicInterfaceMatchCount: technicInterfaceMatches.length,
      technicGeometryResolvedCount: beamRanking.ranking.geometry_resolved_count,
      technicBeamPartId: selectedBeam?.part_id,
      technicBeamInterfaceCandidate: selectedBeam?.specialised_interface_candidate,
      technicBeamPlacementCandidate: selectedBeam?.component_placement_candidate,
      technicBeamLocalTransform: selectedBeam?.part_local_transform,
      technicBeamPhysicalConnectionVerified: selectedBeam?.specialised_interface_match?.physical_connection_verified,
      parts: assembly.parts.length,
      edges: assembly.connections.length,
      matingPairs: assembly.total_mating_pairs,
      bomParts: assembly.bom.total_parts,
      ldrawRecords: assembly.ldraw.split("\n").filter(line => line.startsWith("1 ")).length,
      limitations: assembly.design_diagnostics.limitations,
    };
  });
  assert.equal(result.valid, true);
  assert.equal(result.openingVoidPreserved, true);
  assert.equal(result.openingOccupiedCellCount, 24);
  assert.ok(result.openingConnectionCount > 0);
  assert.equal(result.openingVoidCellCount, 8);
  assert.ok(result.cataloguePartCount > 10000);
  assert.ok(result.wheelCandidateCount > 0);
  assert.ok(result.wheelPlannerReadyCount <= result.wheelCandidateCount);
  assert.ok(result.technicCandidateCount > 0);
  assert.ok(result.technicInterfaceProfileCount > 0);
  assert.ok(result.technicSpecialisedProfileCount > 0, JSON.stringify({ candidates: result.technicCandidatesDebug, profiles: result.specialisedProfileIds }));
  assert.ok(result.technicHoleCandidateCount > 0);
  assert.ok(result.technicInterfaceMatchCount > 0);
  assert.equal(result.technicGeometryResolvedCount, 1);
  assert.equal(result.technicBeamPartId, "3701");
  assert.equal(result.technicBeamInterfaceCandidate, true);
  assert.equal(result.technicBeamPlacementCandidate, true);
  assert.equal(result.technicBeamLocalTransform.coordinate_frame, "component-centred-millimetres");
  assert.equal(result.technicBeamPhysicalConnectionVerified, false);
  assert.ok(result.parts > 0);
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
