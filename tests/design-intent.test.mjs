import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  evaluateDesignIntent,
  validateDesignIntentContract,
} from "../docs/assets/design-intent.js";

const contract = {
  schema_version: 1,
  fixture_id: "house-two-windows",
  intent: {
    required_features: [
      { feature_type: "window", count: 2 },
      { feature_type: "door", count: 1 },
    ],
    optional_features: [{ feature_type: "chimney", target_count: 1 }],
    forbidden_features: [{ feature_type: "missing_wall", max_count: 0 }],
    relationships: [
      { id: "windows-on-same-wall", type: "same_group", feature_types: ["window", "door"] },
      { id: "windows-spaced", type: "minimum_separation", feature_types: ["window", "window"], min_mm: 8 },
    ],
  },
  part_preferences: {
    roles: [{
      role: "window",
      min_count: 2,
      preferred_families: ["window"],
      preferred_part_ids: ["60592"],
    }],
  },
  construction_constraints: {
    require_connected: true,
    require_no_collisions: true,
    require_topology_preserved: true,
  },
};

const validReconstruction = {
  features: [
    { feature_type: "window", instances: [
      { id: "w1", group_id: "front-wall", center_mm: [-8, 16, 20] },
      { id: "w2", group_id: "front-wall", center_mm: [8, 16, 20] },
    ] },
    { feature_type: "door", instances: [
      { id: "d1", group_id: "front-wall", center_mm: [0, 4, 20] },
    ] },
  ],
  parts: [
    { part_id: "60592", family: "window", role: "window" },
    { part_id: "60592", family: "window", role: "window" },
  ],
  validation: { checks: [
    { id: "graph_connectivity", status: "passed" },
    { id: "body_collision", status: "passed" },
    { id: "topology_preservation", status: "passed" },
  ] },
  diagnostics: { surface_distance_mm: 2.4, volume_iou: 0.71 },
};

test("authored plate and house contracts conform to the v1 contract validator", async () => {
  const source = JSON.parse(await readFile(
    new URL("../docs/data/design-intent-contracts.json", import.meta.url), "utf8",
  ));
  assert.equal(source.schema_version, 1);
  assert.equal(source.contracts.length, 2);
  for (const authored of source.contracts) {
    assert.deepEqual(validateDesignIntentContract(authored), { valid: true, errors: [] });
  }
});

test("design-intent contract validates a semantic model specification", () => {
  assert.deepEqual(validateDesignIntentContract(contract), { valid: true, errors: [] });
});

test("design intent passes required features, relationships and construction gates", () => {
  const report = evaluateDesignIntent(contract, validReconstruction);
  assert.equal(report.status, "passed");
  assert.equal(report.passed, true);
  assert.equal(report.failures.length, 0);
  assert.equal(report.warnings.length, 0);
  assert.equal(report.diagnostics.volume_iou, 0.71);
  assert.equal(report.scores.required_feature_coverage, 1);
  assert.equal(report.scores.optional_feature_coverage, 0);
});

test("missing a required window is a hard semantic failure", () => {
  const reconstruction = structuredClone(validReconstruction);
  reconstruction.features[0].instances.pop();
  const report = evaluateDesignIntent(contract, reconstruction);
  assert.equal(report.status, "failed");
  assert.ok(report.failures.some((message) => message.includes("Expected 2 window")));
});

test("a solid substitute cannot silently satisfy a required opening", () => {
  const reconstruction = structuredClone(validReconstruction);
  reconstruction.features[0].instances = [];
  reconstruction.features.push({
    feature_type: "solid_wall",
    instances: [{ id: "wall", group_id: "front-wall" }],
  });
  const report = evaluateDesignIntent(contract, reconstruction);
  assert.equal(report.passed, false);
});

test("dedicated LEGO element preference warns without becoming a universal hard gate", () => {
  const reconstruction = structuredClone(validReconstruction);
  reconstruction.parts = [
    { part_id: "3001", family: "brick", role: "window" },
    { part_id: "3001", family: "brick", role: "window" },
  ];
  const report = evaluateDesignIntent(contract, reconstruction);
  assert.equal(report.passed, true);
  assert.ok(report.warnings.some((message) => message.includes("preferred-family")));
  assert.ok(report.warnings.some((message) => message.includes("Dedicated preferred")));
});

test("explicitly required dedicated parts become a hard failure", () => {
  const strict = structuredClone(contract);
  strict.part_preferences.roles[0].require_preferred_part = true;
  const reconstruction = structuredClone(validReconstruction);
  reconstruction.parts = [
    { part_id: "3001", family: "brick", role: "window" },
    { part_id: "3001", family: "brick", role: "window" },
  ];
  assert.equal(evaluateDesignIntent(strict, reconstruction).passed, false);
});

test("missing construction assessment cannot be treated as a pass", () => {
  const reconstruction = structuredClone(validReconstruction);
  reconstruction.validation.checks = reconstruction.validation.checks.filter(
    (check) => check.id !== "topology_preservation",
  );
  const report = evaluateDesignIntent(contract, reconstruction);
  assert.equal(report.passed, false);
  assert.ok(report.failures.some((message) => message.includes("not_assessed")));
});

test("contract rejects unsupported relationships and malformed counts", () => {
  const invalid = structuredClone(contract);
  invalid.intent.required_features[0].count = 0;
  invalid.intent.relationships[0].type = "visually_close";
  const result = validateDesignIntentContract(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 2);
});
