const SUPPORTED_RELATIONSHIPS = new Set(["same_group", "minimum_separation"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(label + " must be an array.");
  return value;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function validateDesignIntentContract(contract) {
  const errors = [];
  if (!isRecord(contract)) return { valid: false, errors: ["Contract must be an object."] };
  if (contract.schema_version !== 1) errors.push("schema_version must be 1.");
  if (typeof contract.fixture_id !== "string" || !contract.fixture_id.trim()) {
    errors.push("fixture_id must be a non-empty string.");
  }
  if (!isRecord(contract.intent)) errors.push("intent must be an object.");
  const intent = contract.intent || {};
  for (const key of ["required_features", "forbidden_features", "relationships"]) {
    if (intent[key] !== undefined && !Array.isArray(intent[key])) {
      errors.push("intent." + key + " must be an array.");
    }
  }
  for (const [index, feature] of (intent.required_features || []).entries()) {
    if (!isRecord(feature) || typeof feature.feature_type !== "string"
        || !feature.feature_type.trim() || !Number.isInteger(feature.count)
        || feature.count < 1) {
      errors.push("intent.required_features[" + index + "] needs feature_type and a positive integer count.");
    }
  }
  for (const [index, feature] of (intent.forbidden_features || []).entries()) {
    if (!isRecord(feature) || typeof feature.feature_type !== "string"
        || !feature.feature_type.trim() || (feature.max_count !== undefined
          && (!Number.isInteger(feature.max_count) || feature.max_count < 0))) {
      errors.push("intent.forbidden_features[" + index + "] needs feature_type and an optional non-negative max_count.");
    }
  }
  for (const [index, relation] of (intent.relationships || []).entries()) {
    if (!isRecord(relation) || !SUPPORTED_RELATIONSHIPS.has(relation.type)
        || !Array.isArray(relation.feature_types) || relation.feature_types.length < 2
        || !relation.feature_types.every((type) => typeof type === "string")) {
      errors.push("intent.relationships[" + index + "] has an unsupported or incomplete relationship.");
    }
    if (relation?.type === "minimum_separation"
        && (!finite(relation.min_mm) || relation.min_mm < 0)) {
      errors.push("intent.relationships[" + index + "].min_mm must be non-negative.");
    }
  }
  if (contract.part_preferences !== undefined && !isRecord(contract.part_preferences)) {
    errors.push("part_preferences must be an object.");
  }
  if (contract.construction_constraints !== undefined
      && !isRecord(contract.construction_constraints)) {
    errors.push("construction_constraints must be an object.");
  }
  return { valid: errors.length === 0, errors };
}

function featureInstances(reconstruction, type) {
  const records = (reconstruction.features || []).filter((feature) => feature.feature_type === type);
  return records.flatMap((feature) => Array.isArray(feature.instances)
    ? feature.instances
    : Array.from({ length: Number.isInteger(feature.count) ? feature.count : 0 }, (_, index) => ({
      id: type + "-" + index,
    })));
}

function distance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 3 || b.length !== 3
      || !a.every(finite) || !b.every(finite)) return null;
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function evaluateRelationship(relation, reconstruction) {
  const groups = relation.feature_types.map((type) => featureInstances(reconstruction, type));
  if (relation.type === "same_group") {
    const groupSets = groups.map((items) => new Set(items.map((item) => item.group_id).filter(Boolean)));
    const shared = groupSets.length ? [...groupSets[0]].filter((id) =>
      groupSets.every((set) => set.has(id))) : [];
    const required = relation.min_shared_groups ?? 1;
    return {
      id: relation.id || "same_group",
      status: shared.length >= required ? "passed" : "failed",
      observed: shared.length,
      required,
      message: shared.length >= required
        ? "Required feature types share a construction group."
        : "Required feature types were not found together in enough construction groups.",
    };
  }
  const first = groups[0];
  const second = groups[1];
  const distances = [];
  for (const a of first) for (const b of second) {
    const value = distance(a.center_mm, b.center_mm);
    if (value !== null) distances.push(value);
  }
  const closest = distances.length ? Math.min(...distances) : null;
  const passed = closest !== null && closest >= relation.min_mm
    && (relation.max_mm === undefined || closest <= relation.max_mm);
  return {
    id: relation.id || "minimum_separation",
    status: passed ? "passed" : "failed",
    observed_minimum_mm: closest,
    required_minimum_mm: relation.min_mm,
    maximum_mm: relation.max_mm ?? null,
    message: passed ? "Feature separation is within the declared range."
      : "Feature separation is missing or outside the declared range.",
  };
}

/**
 * Evaluate semantic requirements independently from shape similarity.
 * This is a design-intent gate, not a physical-stability certification.
 */
export function evaluateDesignIntent(contract, reconstruction) {
  const validation = validateDesignIntentContract(contract);
  if (!validation.valid) {
    throw new TypeError("Invalid design-intent contract: " + validation.errors.join(" "));
  }
  if (!isRecord(reconstruction)) throw new TypeError("reconstruction must be an object.");
  const features = requireArray(reconstruction.features || [], "reconstruction.features");
  const parts = requireArray(reconstruction.parts || [], "reconstruction.parts");
  const failures = [];
  const warnings = [];
  const checks = [];

  for (const required of contract.intent.required_features || []) {
    const observed = featureInstances({ features }, required.feature_type).length;
    const passed = observed === required.count;
    checks.push({
      id: "required:" + required.feature_type,
      status: passed ? "passed" : "failed",
      expected: required.count,
      observed,
    });
    if (!passed) failures.push("Expected " + required.count + " " + required.feature_type
      + " feature(s), found " + observed + ".");
  }

  for (const forbidden of contract.intent.forbidden_features || []) {
    const observed = featureInstances({ features }, forbidden.feature_type).length;
    const maximum = forbidden.max_count ?? 0;
    const passed = observed <= maximum;
    checks.push({
      id: "forbidden:" + forbidden.feature_type,
      status: passed ? "passed" : "failed",
      maximum,
      observed,
    });
    if (!passed) failures.push("Forbidden feature " + forbidden.feature_type
      + " occurs " + observed + " time(s); maximum is " + maximum + ".");
  }

  for (const relation of contract.intent.relationships || []) {
    const result = evaluateRelationship(relation, { features });
    checks.push(result);
    if (result.status !== "passed") failures.push(result.message);
  }

  for (const preference of contract.part_preferences?.roles || []) {
    const matching = parts.filter((part) => part.roles?.includes(preference.role)
      || part.role === preference.role);
    const minimum = preference.min_count ?? 1;
    const rolePassed = matching.length >= minimum;
    checks.push({
      id: "part-role:" + preference.role,
      status: rolePassed ? "passed" : "failed",
      expected_minimum: minimum,
      observed: matching.length,
    });
    if (!rolePassed) failures.push("Required LEGO part role " + preference.role
      + " is represented " + matching.length + " time(s); expected at least " + minimum + ".");
    if (rolePassed && Array.isArray(preference.preferred_families)
        && preference.preferred_families.length) {
      const suitable = matching.filter((part) =>
        preference.preferred_families.includes(part.family));
      if (suitable.length < minimum) {
        const message = "No sufficient preferred-family coverage for role " + preference.role + ".";
        if (preference.require_preferred_family) failures.push(message);
        else warnings.push(message);
      }
    }
    if (rolePassed && Array.isArray(preference.preferred_part_ids)
        && preference.preferred_part_ids.length) {
      const suitable = matching.filter((part) =>
        preference.preferred_part_ids.includes(String(part.part_id)));
      if (suitable.length < minimum) {
        const message = "Dedicated preferred LEGO elements are not used for role "
          + preference.role + ".";
        if (preference.require_preferred_part) failures.push(message);
        else warnings.push(message);
      }
    }
  }

  const constraints = contract.construction_constraints || {};
  const checksRequired = [
    ["require_connected", "graph_connectivity"],
    ["require_no_collisions", "body_collision"],
    ["require_topology_preserved", "topology_preservation"],
  ];
  for (const [option, checkId] of checksRequired) {
    if (!constraints[option]) continue;
    const source = (reconstruction.validation?.checks || []).find((check) => check.id === checkId);
    const passed = source?.status === "passed";
    checks.push({
      id: checkId,
      status: passed ? "passed" : "failed",
      observed_status: source?.status || "not_assessed",
    });
    if (!passed) failures.push("Construction constraint " + checkId
      + " was not passed (status: " + (source?.status || "not_assessed") + ").");
  }

  const diagnosticMetrics = reconstruction.diagnostics || {};
  return {
    schema_version: 1,
    fixture_id: contract.fixture_id,
    status: failures.length ? "failed" : "passed",
    passed: failures.length === 0,
    checks,
    failures,
    warnings,
    diagnostics: diagnosticMetrics,
    limitations: [
      "Semantic feature recognition is only as reliable as the supplied feature annotations.",
      "Passing nominal construction checks does not certify physical clutch strength, stability or safe building technique.",
      "Geometric similarity metrics are diagnostic unless the contract explicitly makes them hard constraints.",
    ],
  };
}
