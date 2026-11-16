[object Object]
test("ranks real part candidates directly from a semantic design component", async () => {
  const component = {
    id: "technic-beam",
    role: "technic",
    geometry: { type: "orthogonal_prism", width_studs: 4, depth_studs: 1 },
    height_courses: 1,
    required_interfaces: [{ interface_type: "technic_pin_hole", diameter_mm: 4.8, axis_vector: [0,0,1], count: 3 }],
  };
  const partIndex = { parts: [
    { part_id: "3701", name: "Technic Brick 1 x 4 with Holes", category: "Technic", keywords: ["technic", "brick"] },
  ] };
  const specialisedCatalogue = { profiles: [{
    part_id: "3701",
    nominal_connection_interfaces: [
      { interface_id: "h1", interface_type: "technic_pin_hole", nominal_diameter_mm: 4.8, axis_vector: [0,0,1] },
      { interface_id: "h2", interface_type: "technic_pin_hole", nominal_diameter_mm: 4.8, axis_vector: [0,0,1] },
      { interface_id: "h3", interface_type: "technic_pin_hole", nominal_diameter_mm: 4.8, axis_vector: [0,0,1] },
    ],
  }] };
  const result = await rankDesignComponentCandidates(
    component, partIndex, connections, specialisedCatalogue,
    { async resolvePart() { return { part_id: "3701", dimensions_mm: [32, 9.6, 8] }; } },
  );
  assert.deepEqual(result.target_dimensions_mm, [32, 9.6, 8]);
  assert.equal(result.ranking.candidates[0].specialised_interface_candidate, true);
  assert.equal(result.assembly_status, "candidate_ranking_only_not_placed");
});
