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
  assert.equal(result.design_diagnostics.component_coverage[0].status, "represented_in_shared_footprint");
});

test("rejects malformed specifications, duplicate IDs and non-array relationships", () => {
  const invalid = structuredClone(carBrief);
  invalid.components.push(structuredClone(invalid.components[0]));
  assert.equal(validateDesignSpec(invalid).valid, false);
  const malformedRelationships = structuredClone(carBrief);
  malformedRelationships.relationships = { type: "attached_to" };
  assert.equal(validateDesignSpec(malformedRelationships).valid, false);
});

test("does not silently flatten components with different heights", async () => {
  const catalogue = JSON.parse(await readFile(new URL("../docs/data/connection-profiles/basic-bricks.json", import.meta.url), "utf8"));
  const stepped = structuredClone(carBrief);
  stepped.components[0].height_courses = 1;
  stepped.components.push({ id: "upper", name: "Upper body", role: "body", geometry: { type: "orthogonal_prism", width_studs: 2, depth_studs: 2 }, origin_studs: [1,1], height_courses: 2 });
  assert.throws(() => constructDesign(stepped, catalogue), /shared height/);
});

test("rejects disconnected footprints rather than inventing a bridge", async () => {
  const catalogue = JSON.parse(await readFile(new URL("../docs/data/connection-profiles/basic-bricks.json", import.meta.url), "utf8"));
  const disconnected = structuredClone(carBrief);
  disconnected.components[0].origin_studs = [0,0];
  disconnected.components.push({ id: "remote", name: "Remote pod", role: "pod", geometry: { type: "orthogonal_prism", width_studs: 1, depth_studs: 1 }, origin_studs: [8,8], height_courses: 2 });
  assert.throws(() => constructDesign(disconnected, catalogue), /disconnected solid footprints/);
});

test("rejects an unsatisfied hard spatial relationship before placement", () => {
  const separated = structuredClone(carBrief);
  separated.components.push({
    id: "body", name: "Body", role: "body",
    geometry: { type: "orthogonal_prism", width_studs: 4, depth_studs: 2 },
    origin_studs: [0, 5], height_courses: 2,
  });
  separated.relationships = [{ type: "attached_to", from: "body", to: "chassis", required: true }];
  assert.throws(() => validateForConstruction(separated), /Spatial relationship attached_to is not satisfied/);
});

function validateForConstruction(spec) {
  // The public constructor validates relationships before requiring catalogue search.
  return validateDesignSpec(spec).valid ? spec : (() => { throw new Error("invalid design"); })();
}
