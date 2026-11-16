import assert from "node:assert/strict";
import test from "node:test";

import { discoverPartsForRole, rankPartCandidatesWithGeometry, supportedSemanticPartRoles } from "../docs/assets/part-discovery.js";

const parts = [
  { part_id: "3001", name: "Brick 2 x 4", category: "Brick", keywords: ["building"] },
  { part_id: "3003", name: "Wheel 8 x 14", category: "Wheel", keywords: ["tyre", "rim"] },
  { part_id: "3004", name: "Wheel hub", category: "Vehicle", keywords: ["wheel"] },
  { part_id: "3005", name: "Window 1 x 2 x 2", category: "Window", keywords: ["transparent"] },
  { part_id: "3006", name: "Slope Brick", category: "Slope", keywords: ["wedge"] },
];
const connections = { profiles: [{ part_id: "3001" }] };

test("semantic role discovery ranks functional catalogue evidence", () => {
  const result = discoverPartsForRole("wheel", parts, connections);
  assert.equal(result.candidate_count, 2);
  assert.equal(result.candidates[0].part_id, "3003");
  assert.equal(result.planner_ready_count, 0);
  assert.equal(result.candidates[0].planner_eligible, false);
  assert.equal(result.candidates[0].geometry_inspection_required, true);
});

test("profiled candidates are distinguished from text-only discoveries", () => {
  const result = discoverPartsForRole("brick", parts, connections);
  assert.equal(result.candidates[0].part_id, "3001");
  assert.equal(result.candidates[0].connection_profile_available, true);
  assert.equal(result.candidates[0].planner_eligible, false);
  assert.match(result.candidates[0].suitability_status, /requires_geometry/);
});

test("custom role synonyms and deterministic limits are supported", () => {
  const result = discoverPartsForRole("landing gear", parts, connections, {
    synonyms: ["wheel", "hub"],
    limit: 1,
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidate_count, 2);
  assert.ok(supportedSemanticPartRoles().includes("wheel"));
});

test("rejects invalid discovery inputs", () => {
  assert.throws(() => discoverPartsForRole("", parts, connections), /non-empty/);
  assert.throws(() => discoverPartsForRole("wheel", {}, connections), /array/);
  assert.throws(() => discoverPartsForRole("wheel", parts, connections, { limit: 0 }), /positive integer/);
});

test("combines semantic discovery, measured dimensions and connection-profile readiness", async () => {
  const discovery = discoverPartsForRole("brick", parts, connections);
  const geometryResolver = {
    async resolvePart(partId) {
      if (partId === "3001") return { part_id: partId, dimensions_mm: [32, 11.2, 16] };
      throw new Error("geometry source unavailable");
    },
  };
  const ranked = await rankPartCandidatesWithGeometry(
    discovery, geometryResolver, { parts }, [32, 11.2, 16],
  );
  assert.equal(ranked.geometry_resolved_count, 1);
  assert.equal(ranked.nominal_placement_candidate_count, 1);
  assert.equal(ranked.candidates[0].part_id, "3001");
  assert.equal(ranked.candidates[0].nominal_placement_candidate, true);
  assert.equal(ranked.candidates[0].requires_connection_validation, true);
});

test("keeps geometry fetch failures as explicit candidate diagnostics", async () => {
  const discovery = discoverPartsForRole("wheel", parts, connections);
  const ranked = await rankPartCandidatesWithGeometry(
    discovery, { async resolvePart() { throw new Error("network unavailable"); } },
    { parts }, [12, 12, 8],
  );
  assert.equal(ranked.geometry_resolved_count, 0);
  assert.ok(ranked.candidates.every((candidate) => candidate.suitability_status === "geometry_unavailable"));
});

test("rejects invalid geometry ranking controls", async () => {
  const discovery = discoverPartsForRole("brick", parts, connections);
  const resolver = { async resolvePart() { return { dimensions_mm: [1, 2, 3] }; } };
  await assert.rejects(() => rankPartCandidatesWithGeometry(discovery, resolver, { parts }, [1,2,3], { concurrency: 0 }), /positive integers/);
});
