import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { constructDesign, validateDesignSpec } from "../docs/assets/design-spec-engine.js";

const carBrief = {
  schema_version: 1,
  design_id: "compact-car",
  name: "Compact car body",
  description: "A small, solid prototype car body footprint.",
  units: "studs-and-brick-courses",
  components: [
    { id: "chassis", name: "Chassis", role: "chassis", geometry: { type: "orthogonal_prism", width_studs: 4, depth_studs: 4 }, origin_studs: [0,0], height_courses: 2, priority: "essential" },
  ],
  requirements: { required_roles: ["chassis"], require_connected: true },
  preferences: { colours: [4,1], max_parts: 80, optimisation: "balanced" },
};

test("authored ideal design specifications validate independently of any LLM", async () => {
  const fixtures = JSON.parse(await readFile(new URL("../docs/data/design-spec-fixtures.json", import.meta.url), "utf8"));
  assert.equal(fixtures.schema_version, 1);
  for (const spec of fixtures.specifications) {
    assert.deepEqual(validateDesignSpec(spec), { valid: true, errors: [] });
  }
});

test("constructs a connected semantic brief into real catalogue placements and exports", async () => {
  const catalogue = JSON.parse(await readFile(new URL("../docs/data/connection-profiles/basic-bricks.json", import.meta.url), "utf8"));
  const result = constructDesign(carBrief, catalogue);
  assert.equal(result.design_id, "compact-car");
  assert.ok(result.parts.length > 0);
  assert.ok(result.connections.length > 0);
  assert.equal(result.assembly_graph.parts.length, result.parts.length);
  assert.equal(result.bom.total_parts, result.parts.length);
  assert.match(result.ldraw, /3001\.dat/);
  assert.equal(result.design_diagnostics.component_coverage[0].status, "represented_in_layer_occupancy");
});

test("rejects malformed specifications, duplicate IDs and non-array relationships", () => {
  const invalid = structuredClone(carBrief);
  invalid.components.push(structuredClone(invalid.components[0]));
  assert.equal(validateDesignSpec(invalid).valid, false);
  const malformedRelationships = structuredClone(carBrief);
  malformedRelationships.relationships = { type: "attached_to" };
  assert.equal(validateDesignSpec(malformedRelationships).valid, false);
});

test("constructs stepped-height components through variable-course planning", async () => {
  const catalogue = JSON.parse(await readFile(new URL("../docs/data/connection-profiles/basic-bricks.json", import.meta.url), "utf8"));
  const stepped = structuredClone(carBrief);
  stepped.components[0].height_courses = 1;
  stepped.components.push({
    id: "upper", name: "Upper body", role: "body",
    geometry: { type: "orthogonal_prism", width_studs: 2, depth_studs: 2 },
    origin_studs: [1,1], base_course: 1, height_courses: 1,
  });
  const result = constructDesign(stepped, catalogue);
  assert.equal(result.course_part_counts.length, 2);
  assert.ok(result.connections.length > 0);
  assert.equal(result.dimensions_mm.height, 19.2);
  assert.equal(result.design_diagnostics.component_coverage[1].base_course, 1);
});

test("rejects disconnected footprints rather than inventing a bridge", async () => {
  const catalogue = JSON.parse(await readFile(new URL("../docs/data/connection-profiles/basic-bricks.json", import.meta.url), "utf8"));
  const disconnected = structuredClone(carBrief);
  disconnected.components[0].origin_studs = [0,0];
  disconnected.components.push({ id: "remote", name: "Remote pod", role: "pod", geometry: { type: "orthogonal_prism", width_studs: 1, depth_studs: 1 }, origin_studs: [8,8], height_courses: 2 });
  assert.throws(() => constructDesign(disconnected, catalogue), /No fully connected variable-course construction/);
});

test("rejects an unsatisfied hard spatial relationship before placement", async () => {
  const catalogue = JSON.parse(await readFile(new URL("../docs/data/connection-profiles/basic-bricks.json", import.meta.url), "utf8"));
  const separated = structuredClone(carBrief);
  separated.components.push({
    id: "body", name: "Body", role: "body",
    geometry: { type: "orthogonal_prism", width_studs: 4, depth_studs: 2 },
    origin_studs: [0, 5], height_courses: 2,
  });
  separated.relationships = [{ type: "attached_to", from: "body", to: "chassis", required: true }];
  assert.throws(() => constructDesign(separated, catalogue), /Spatial relationship attached_to is not satisfied/);
});

test("does not silently ignore functional component requirements", async () => {
  const catalogue = JSON.parse(await readFile(new URL("../docs/data/connection-profiles/basic-bricks.json", import.meta.url), "utf8"));
  const functional = structuredClone(carBrief);
  functional.components[0].functional_requirements = ["rotates"];
  assert.throws(() => constructDesign(functional, catalogue), /specialised-part planner/);
});

test("does not silently merge different semantic component colours", async () => {
  const catalogue = JSON.parse(await readFile(new URL("../docs/data/connection-profiles/basic-bricks.json", import.meta.url), "utf8"));
  const coloured = structuredClone(carBrief);
  coloured.components[0].colour_code = 4;
  coloured.components.push({
    id: "body", name: "Body", role: "body",
    geometry: { type: "orthogonal_prism", width_studs: 4, depth_studs: 2 },
    origin_studs: [0, 4], height_courses: 2, colour_code: 1,
  });
  assert.throws(() => constructDesign(coloured, catalogue), /per-component colours/);
});
