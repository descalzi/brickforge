import assert from "node:assert/strict";
import test from "node:test";

import { discoverPartsForRole, supportedSemanticPartRoles } from "../docs/assets/part-discovery.js";

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
  assert.equal(result.candidates[0].planner_eligible, true);
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
