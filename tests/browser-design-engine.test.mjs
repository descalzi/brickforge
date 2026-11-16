import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateDesignSpec } from "../docs/assets/design-spec.js";
import { planDesign } from "../docs/assets/design-engine.js";

const catalogue = JSON.parse(await readFile(new URL("../data/connection-profiles/basic-bricks.json", import.meta.url), "utf8"));
const partCatalogue = JSON.parse(await readFile(new URL("../docs/data/part-capabilities-v1.json", import.meta.url), "utf8"));
const designTranslation = JSON.parse(await readFile(new URL("../docs/data/design-translation-v1.json", import.meta.url), "utf8"));
const carBody = {
  schema_version: 1, design_id: "stacked-body-test", name: "Stacked body",
  units: "mm",
  components: [{
    id: "body", label: "Main body", role: "chassis", geometry: "rectangular_prism",
    dimensions_mm: { width: 32, depth: 32, height: 19.2 },
    position_mm: { x: 0, y: 0, z: 0 }, priority: "essential",
    function: ["supports upper body"], confidence: "explicit"
  }],
  relationships: [],
  constraints: { require_connected: true, allow_intersections: false, max_parts: 40, max_search_nodes: 100000, course_type: "brick" },
  appearance: { preferred_colours: [4] }
};

test("design specification is independent of LEGO part selection", () => {
  assert.deepEqual(validateDesignSpec(carBody), { valid: true, errors: [] });
  assert.equal(JSON.stringify(carBody).includes("3001"), false);
  assert.equal(JSON.stringify(carBody).includes("part_id"), false);
});

test("spec validator rejects duplicate IDs, invalid dimensions and dangling relationships", () => {
  const invalid = structuredClone(carBody);
  invalid.components.push(structuredClone(invalid.components[0]));
  invalid.components[0].dimensions_mm.width = 0;
  invalid.relationships.push({ type: "attached_to", from: "body", to: "missing" });
  const result = validateDesignSpec(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(message => message.includes("unique")));
  assert.ok(result.errors.some(message => message.includes("positive")));
  assert.ok(result.errors.some(message => message.includes("unknown component")));
  const legoCoupled = structuredClone(carBody);
  legoCoupled.components[0].preferred_families = ["Technic"];
  assert.equal(validateDesignSpec(legoCoupled).valid, false);
});

test("planner solves a two-course 4x4-stud assembly using globally interlocking layouts", () => {
  const result = planDesign(carBody, catalogue, { partCatalogue, designTranslation });
  assert.equal(result.status, "planned", result.failures?.join("; "));
  assert.equal(result.parts.length, 4);
  assert.equal(result.connections.length, 4);
  assert.equal(result.total_mating_pairs, 16);
  assert.equal(result.validation.checks.find(check => check.id === "graph_connectivity").status, "passed");
  assert.equal(result.validation.checks.find(check => check.id === "physical_clutch_strength").status, "not_assessed");
  assert.match(result.ldraw, /3001\.dat/);
  assert.deepEqual(result.bom.items, [{ part_id: "3001", colour_code: 4, quantity: 4 }]);
});

test("planner reports unsupported physical dimensions rather than silently changing scale", () => {
  const invalidScale = structuredClone(carBody);
  invalidScale.components[0].dimensions_mm.width = 31;
  const result = planDesign(invalidScale, catalogue, { partCatalogue, designTranslation });
  assert.equal(result.status, "blocked");
  assert.match(result.failures[0], /align to 8 mm stud pitch/);
});

test("planner enforces the complete-design part budget", () => {
  const constrained = structuredClone(carBody);
  constrained.constraints.max_parts = 3;
  const result = planDesign(constrained, catalogue, { partCatalogue, designTranslation });
  assert.equal(result.status, "blocked");
  assert.match(result.failures[0], /max_parts/);
});

test("planner refuses to substitute a structural brick for an unverified wheel role", () => {
  const wheel = structuredClone(carBody);
  wheel.components[0].role = "wheel";
  const result = planDesign(wheel, catalogue, { partCatalogue, designTranslation });
  assert.equal(result.status, "blocked");
  assert.match(result.failures[0], /Reference-only parts exist for semantic role wheel/);
  assert.match(result.failures[0], /3739/);
});

test("required spatial relationships are evaluated before construction", () => {
  const related = structuredClone(carBody);
  related.components.push({
    id: "roof", role: "structural", geometry: "rectangular_prism",
    dimensions_mm: { width: 32, depth: 32, height: 9.6 },
    position_mm: { x: 0, y: 10, z: 0 }, priority: "essential"
  });
  related.relationships = [{ type: "above", from: "roof", to: "body" }];
  const result = planDesign(related, catalogue, { partCatalogue, designTranslation });
  assert.equal(result.status, "blocked");
  assert.match(result.failures[0], /not satisfied/);
});

test("overlapping semantic component volumes are blocked", () => {
  const overlapping = structuredClone(carBody);
  overlapping.components.push({
    id: "overlap", role: "structural", geometry: "rectangular_prism",
    dimensions_mm: { width: 8, depth: 8, height: 9.6 },
    position_mm: { x: 8, y: 0, z: 8 }, priority: "essential"
  });
  const result = planDesign(overlapping, catalogue, { partCatalogue, designTranslation });
  assert.equal(result.status, "blocked");
  assert.match(result.failures[0], /overlap in their specified volumes/);
});

test("planner optimises semantic components together and connects an upper component to the chassis", () => {
  const design = structuredClone(carBody);
  design.design_id = "body-with-roof";
  design.components.push({
    id: "roof", label: "Upper deck", role: "structural", geometry: "rectangular_prism",
    dimensions_mm: { width: 32, depth: 32, height: 9.6 },
    position_mm: { x: 0, y: 19.2, z: 0 }, priority: "essential"
  });
  design.relationships = [{ type: "above", from: "roof", to: "body" }];
  const result = planDesign(design, catalogue, { partCatalogue, designTranslation });
  assert.equal(result.status, "planned", result.failures?.join("; "));
  assert.equal(result.parts.length, 6);
  assert.equal(result.validation.checks.find(check => check.id === "graph_connectivity").status, "passed");
  assert.equal(result.component_reports.length, 2);
});

test("planner refuses individually plausible components that cannot form one global assembly", () => {
  const design = structuredClone(carBody);
  design.components.push({
    id: "remote", role: "structural", geometry: "rectangular_prism",
    dimensions_mm: { width: 8, depth: 8, height: 9.6 },
    position_mm: { x: 160, y: 0, z: 0 }, priority: "essential"
  });
  const result = planDesign(design, catalogue, { partCatalogue, designTranslation });
  assert.equal(result.status, "blocked");
  assert.match(result.failures[0], /globally connected/);
});

test("planner distinguishes semantic candidates from parts with verified placement profiles", () => {
  const beam = structuredClone(carBody);
  beam.components[0].role = "beam";
  beam.components[0].dimensions_mm = { width: 32, depth: 8, height: 9.6 };
  const result = planDesign(beam, catalogue, { partCatalogue, designTranslation });
  assert.equal(result.status, "blocked");
  assert.match(result.failures[0], /Semantic candidates exist for beam/);
  assert.match(result.failures[0], /3701/);
});

test("hand-authored car, house, aircraft and organic specifications are valid intent inputs", async () => {
  const fixtures = JSON.parse(await readFile(new URL("../docs/data/design-spec-fixtures.json", import.meta.url), "utf8"));
  assert.equal(fixtures.challenge_specs.length, 4);
  for (const challenge of fixtures.challenge_specs) {
    const validation = validateDesignSpec(challenge);
    assert.equal(validation.valid, true, challenge.design_id + ": " + validation.errors.join("; "));
  }
});

test("car and aircraft specifications preserve cylinder and extruded-wing intent and refuse unsupported construction", async () => {
  const fixtures = JSON.parse(await readFile(new URL("../docs/data/design-spec-fixtures.json", import.meta.url), "utf8"));
  const car = planDesign(fixtures.challenge_specs.find(item => item.design_id === "challenge-car"), catalogue, { partCatalogue, designTranslation });
  assert.equal(car.status, "blocked");
  assert.match(car.failures[0], /Reference-only parts exist for semantic role wheel/);
  const aircraft = planDesign(fixtures.challenge_specs.find(item => item.design_id === "challenge-aircraft"), catalogue, { partCatalogue, designTranslation });
  assert.equal(aircraft.status, "blocked");
  assert.match(aircraft.failures[0], /Reference-only parts exist for semantic role wing/);
});

test("organic form intent is valid but is not silently reduced to a rectangular block", async () => {
  const fixtures = JSON.parse(await readFile(new URL("../docs/data/design-spec-fixtures.json", import.meta.url), "utf8"));
  const organic = fixtures.challenge_specs.find(item => item.design_id === "challenge-organic-form");
  const result = planDesign(organic, catalogue, { partCatalogue, designTranslation });
  assert.equal(result.status, "blocked");
  assert.match(result.failures[0], /No part-role translation exists|No source-backed part candidates/);
});

test("a sphere-shaped component is never silently tiled as a rectangular box",()=>{
 const sphere=structuredClone(carBody);
 sphere.components[0].geometry="sphere";
 sphere.components[0].geometry_parameters={radius_mm:16};
 sphere.components[0].dimensions_mm={width:32,depth:32,height:32};
 const result=planDesign(sphere,catalogue,{partCatalogue,designTranslation});
 assert.equal(result.status,"blocked");
 assert.match(result.failures[0],/geometry primitive sphere is not yet supported/);
 assert.match(result.failures[0],/no rectangular-block substitution/);
});
