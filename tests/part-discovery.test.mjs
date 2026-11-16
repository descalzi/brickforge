import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverPartsForRole,
  rankDesignComponentCandidates,
  rankPartCandidatesWithGeometry,
  supportedSemanticPartRoles,
} from "../docs/assets/part-discovery.js";

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
  assert.match(result.candidates[0].suitability_status, /geometry_and_interface/);
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

test("ranks Technic candidates against source-derived pin-hole requirements", async () => {
  const technicParts = [
    { part_id: "3701", name: "Brick 1 x 4 with Holes", category: "Brick", keywords: ["brick", "pin hole"] },
  ];
  const specialisedCatalogue = {
    profiles: [{
      part_id: "3701",
      description: "Technic Brick 1 x 4 with Holes",
      dimensions_mm: [32, 9.6, 8],
      nominal_connection_interfaces: [
        { interface_id: "pin-hole-1", interface_type: "technic_pin_hole", nominal_diameter_mm: 4.8, axis_vector: [0,0,1] },
        { interface_id: "pin-hole-2", interface_type: "technic_pin_hole", nominal_diameter_mm: 4.8, axis_vector: [0,0,1] },
        { interface_id: "pin-hole-3", interface_type: "technic_pin_hole", nominal_diameter_mm: 4.8, axis_vector: [0,0,1] },
      ],
    }],
  };
  const discovery = discoverPartsForRole("technic", technicParts, connections, { specialisedCatalogue });
  assert.equal(discovery.candidates[0].specialised_interface_profile_available, true);
  assert.equal(discovery.candidates[0].connection_profile_available, false);
  const ranked = await rankPartCandidatesWithGeometry(
    discovery,
    { async resolvePart() { return { part_id: "3701", dimensions_mm: [32, 9.6, 8], bounds_mm: { minimum: [-16,-1.6,-4], maximum: [16,9.6,4] } }; } },
    { parts: technicParts },
    [32, 9.6, 8],
    { requiredInterfaces: [{ interface_type: "round_opening", diameter_mm: 4.8, axis_vector: [0,0,1], count: 3 }] },
  );
  assert.equal(ranked.candidates[0].specialised_interface_candidate, true);
  assert.equal(ranked.candidates[0].nominal_placement_candidate, false);
  assert.equal(ranked.candidates[0].specialised_interface_match.physical_connection_verified, false);
});

test("ranks real part candidates directly from a semantic design component", async () => {
  const component = {
    id: "technic-beam",
    role: "beam",
    geometry: { type: "orthogonal_prism", width_studs: 4, depth_studs: 1 },
    height_courses: 1,
    required_interfaces: [{ interface_type: "round_opening", diameter_mm: 4.8, axis_vector: [0,0,1], count: 3, positions_mm: [[-8,0,0],[0,0,0],[8,0,0]] }],
  };
  const partIndex = { parts: [] };
  const specialisedCatalogue = { profiles: [{
    part_id: "3701",
    description: "Technic Brick 1 x 4 with Holes",
    source_file: "parts/3701.dat",
    nominal_connection_interfaces: [
      { interface_id: "h1", interface_type: "technic_pin_hole", nominal_diameter_mm: 4.8, axis_vector: [0,0,1], centre_mm: [-8,4,0] },
      { interface_id: "h2", interface_type: "technic_pin_hole", nominal_diameter_mm: 4.8, axis_vector: [0,0,1], centre_mm: [0,4,0] },
      { interface_id: "h3", interface_type: "technic_pin_hole", nominal_diameter_mm: 4.8, axis_vector: [0,0,1], centre_mm: [8,4,0] },
    ],
  }] };
  const result = await rankDesignComponentCandidates(
    component, partIndex, connections, specialisedCatalogue,
    { async resolvePart() { return { part_id: "3701", dimensions_mm: [32, 9.6, 8], bounds_mm: { minimum: [-16,-1.6,-4], maximum: [16,9.6,4] } }; } },
  );
  assert.deepEqual(result.target_dimensions_mm, [32, 9.6, 8]);
  assert.equal(result.discovery.candidates[0].source, "pinned-specialised-part-catalogue");
  assert.equal(result.ranking.candidates[0].specialised_interface_candidate, true);
  assert.equal(result.assembly_status, "candidate_ranking_only_not_placed");
});

test("chooses a dimension-equivalent orientation that aligns a required interface axis", async () => {
  const partList = [{ part_id: "square-beam", name: "Technic square beam", category: "Technic", keywords: ["technic"] }];
  const special = { profiles: [{
    part_id: "square-beam",
    nominal_connection_interfaces: [{
      interface_id: "pin-hole",
      interface_type: "technic_pin_hole",
      nominal_diameter_mm: 4.8,
      axis_vector: [1,0,0],
    }],
  }] };
  const discovery = discoverPartsForRole("beam", partList, connections, { specialisedCatalogue: special });
  const ranked = await rankPartCandidatesWithGeometry(
    discovery,
    { async resolvePart() { return { part_id: "square-beam", dimensions_mm: [10,10,8] }; } },
    { parts: partList },
    [10,10,8],
    { requiredInterfaces: [{ interface_type: "round_opening", diameter_mm: 4.8, axis_vector: [0,1,0], count: 1 }] },
  );
  assert.equal(ranked.candidates[0].specialised_interface_candidate, true);
  assert.deepEqual(ranked.candidates[0].geometry_fit.orientation_permutation, [1,0,2]);
});

test("searches signed rotations to align asymmetric functional interface positions", async () => {
  const partList = [{ part_id: "offset-beam", name: "Offset beam", category: "Beam", keywords: ["beam"] }];
  const special = { profiles: [{
    part_id: "offset-beam",
    nominal_connection_interfaces: [{
      interface_id: "offset-hole",
      interface_type: "technic_pin_hole",
      nominal_diameter_mm: 4.8,
      axis_vector: [0,0,1],
      centre_mm: [8,4,0],
    }],
  }] };
  const discovery = discoverPartsForRole("beam", partList, connections, { specialisedCatalogue: special });
  const ranked = await rankPartCandidatesWithGeometry(
    discovery,
    { async resolvePart() { return { part_id: "offset-beam", dimensions_mm: [10,10,8], bounds_mm: { minimum: [-5,-1,-4], maximum: [5,9,4] } }; } },
    { parts: partList },
    [10,10,8],
    { requiredInterfaces: [{
      interface_type: "round_opening", diameter_mm: 4.8, axis_vector: [0,0,1],
      positions_mm: [[-8,0,0]], position_tolerance_mm: 0.1,
    }] },
  );
  assert.equal(ranked.candidates[0].specialised_interface_candidate, true);
  assert.deepEqual(ranked.candidates[0].geometry_fit.orientation_signs, [-1,-1,1]);
});
