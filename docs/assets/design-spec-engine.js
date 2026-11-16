import { buildFootprintBlock } from "./construction-engine.js";

/**
 * Validates the provider-independent design brief before any LEGO catalogue is consulted.
 * Geometry in v1 is deliberately explicit: integer stud footprints and brick courses.
 */
export function validateDesignSpec(spec) {
  const errors = [];
  const fail = (message) => errors.push(message);
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    return { valid: false, errors: ["Design specification must be an object."] };
  }
  if (spec.schema_version !== 1) fail("schema_version must be 1.");
  if (typeof spec.design_id !== "string" || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(spec.design_id)) {
    fail("design_id must be a stable lowercase identifier.");
  }
  if (typeof spec.name !== "string" || !spec.name.trim()) fail("name must be non-empty.");
  if (spec.units !== "studs-and-brick-courses") fail("units must be studs-and-brick-courses.");
  if (!Array.isArray(spec.components) || !spec.components.length) {
    fail("components must contain at least one component.");
    return { valid: false, errors };
  }
  const ids = new Set();
  for (const [index, component] of spec.components.entries()) {
    const at = "components[" + index + "]";
    if (!component || typeof component !== "object" || Array.isArray(component)) {
      fail(at + " must be an object."); continue;
    }
    if (typeof component.id !== "string" || !component.id.trim()) fail(at + ".id must be non-empty.");
    else if (ids.has(component.id)) fail(at + ".id must be unique.");
    else ids.add(component.id);
    if (typeof component.name !== "string" || !component.name.trim()) fail(at + ".name must be non-empty.");
    if (typeof component.role !== "string" || !component.role.trim()) fail(at + ".role must be non-empty.");
    const geometry = component.geometry;
    if (!geometry || geometry.type !== "orthogonal_prism"
        || !Number.isInteger(geometry.width_studs) || geometry.width_studs < 1
        || !Number.isInteger(geometry.depth_studs) || geometry.depth_studs < 1) {
      fail(at + ".geometry must be an orthogonal_prism with positive integer stud dimensions.");
    }
    if (!Array.isArray(component.origin_studs) || component.origin_studs.length !== 2
        || !component.origin_studs.every(Number.isInteger)) {
      fail(at + ".origin_studs must be an integer [x, z] pair.");
    }
    if (!Number.isInteger(component.height_courses) || component.height_courses < 1) {
      fail(at + ".height_courses must be a positive integer.");
    }
    if (component.colour_code !== undefined
        && (!Number.isInteger(component.colour_code) || component.colour_code < 0)) {
      fail(at + ".colour_code must be a non-negative integer.");
    }
  }
  if (spec.relationships !== undefined && !Array.isArray(spec.relationships)) {
    fail("relationships must be an array.");
  }
  for (const [index, relation] of (Array.isArray(spec.relationships) ? spec.relationships : []).entries()) {
    if (!relation || typeof relation !== "object"
        || !ids.has(relation.from) || !ids.has(relation.to) || relation.from === relation.to) {
      fail("relationships[" + index + "] must reference two different known components.");
    }
    if (!["attached_to","above","below","left_of","right_of","in_front_of","behind","aligned_with","symmetrical_to"].includes(relation?.type)) {
      fail("relationships[" + index + "].type is unsupported.");
    }
    if (relation?.required !== undefined && typeof relation.required !== "boolean") {
      fail("relationships[" + index + "].required must be a boolean.");
    }
    if (relation?.tolerance_studs !== undefined
        && (!Number.isFinite(relation.tolerance_studs) || relation.tolerance_studs < 0)) {
      fail("relationships[" + index + "].tolerance_studs must be non-negative.");
    }
  }
  if (spec.requirements !== undefined) {
    const requirements = spec.requirements;
    if (!requirements || typeof requirements !== "object" || Array.isArray(requirements)) {
      fail("requirements must be an object.");
    } else {
      if (requirements.required_roles !== undefined
          && (!Array.isArray(requirements.required_roles)
            || !requirements.required_roles.every((role) => typeof role === "string" && role.trim()))) {
        fail("requirements.required_roles must be an array of non-empty strings.");
      }
      if (requirements.forbidden_features !== undefined
          && (!Array.isArray(requirements.forbidden_features)
            || !requirements.forbidden_features.every((feature) => typeof feature === "string" && feature.trim()))) {
        fail("requirements.forbidden_features must be an array of non-empty strings.");
      }
      for (const key of ["require_connected", "allow_compromises"]) {
        if (requirements[key] !== undefined && typeof requirements[key] !== "boolean") {
          fail("requirements." + key + " must be a boolean.");
        }
      }
    }
  }
  if (spec.preferences !== undefined) {
    const preferences = spec.preferences;
    if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
      fail("preferences must be an object.");
    } else {
      if (preferences.colours !== undefined
          && (!Array.isArray(preferences.colours)
            || !preferences.colours.every((code) => Number.isInteger(code) && code >= 0))) {
        fail("preferences.colours must be non-negative integer LDraw colour codes.");
      }
      if (preferences.max_parts !== undefined
          && (!Number.isInteger(preferences.max_parts) || preferences.max_parts < 1)) {
        fail("preferences.max_parts must be a positive integer.");
      }
      if (preferences.optimisation !== undefined
          && !["fidelity", "part-count", "balanced"].includes(preferences.optimisation)) {
        fail("preferences.optimisation is unsupported.");
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function componentBounds(component) {
  const [x, z] = component.origin_studs;
  return {
    minX: x,
    maxX: x + component.geometry.width_studs,
    minZ: z,
    maxZ: z + component.geometry.depth_studs,
  };
}

function relationSatisfied(relation, componentsById) {
  const a = componentBounds(componentsById.get(relation.from));
  const b = componentBounds(componentsById.get(relation.to));
  const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const overlapZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  switch (relation.type) {
    case "attached_to":
      return ((a.maxX === b.minX || b.maxX === a.minX) && overlapZ > 0)
        || ((a.maxZ === b.minZ || b.maxZ === a.minZ) && overlapX > 0);
    case "left_of": return a.maxX <= b.minX;
    case "right_of": return a.minX >= b.maxX;
    case "in_front_of": return a.maxZ <= b.minZ;
    case "behind": return a.minZ >= b.maxZ;
    case "aligned_with":
      return (a.minX + a.maxX) === (b.minX + b.maxX)
        || (a.minZ + a.maxZ) === (b.minZ + b.maxZ);
    default:
      throw new Error("Relationship type " + relation.type
        + " is not supported by the current 2D footprint planner.");
  }
}

function validateRelationships(spec) {
  const byId = new Map(spec.components.map((component) => [component.id, component]));
  const failures = [];
  const warnings = [];
  for (const relation of spec.relationships || []) {
    const passed = relationSatisfied(relation, byId);
    if (!passed) {
      const message = "Spatial relationship " + relation.type + " is not satisfied between "
        + relation.from + " and " + relation.to + ".";
      if (relation.required === false) warnings.push(message);
      else failures.push(message);
    }
  }
  if (failures.length) throw new Error(failures.join(" "));
  return warnings;
}

function footprintFor(component) {
  const [originX, originZ] = component.origin_studs;
  const cells = [];
  for (let x = originX; x < originX + component.geometry.width_studs; x += 1) {
    for (let z = originZ; z < originZ + component.geometry.depth_studs; z += 1) {
      cells.push([x, z]);
    }
  }
  return cells;
}

function connected(cells) {
  const remaining = new Set(cells.map(([x,z]) => x + "," + z));
  const first = remaining.values().next().value;
  const visited = new Set([first]);
  const pending = [first];
  while (pending.length) {
    const [x,z] = pending.pop().split(",").map(Number);
    for (const key of [[x+1,z],[x-1,z],[x,z+1],[x,z-1]].map(([a,b])=>a+","+b)) {
      if (remaining.has(key) && !visited.has(key)) { visited.add(key); pending.push(key); }
    }
  }
  return visited.size === remaining.size;
}

/**
 * First production vertical slice: plans a connected, constant-height orthogonal
 * footprint using real catalogue profiles, then reuses the assembly validator/exporter.
 * It refuses varying-height geometry rather than flattening it silently.
 */
export function constructDesign(spec, catalogue, options = {}) {
  const validation = validateDesignSpec(spec);
  if (!validation.valid) throw new TypeError("Invalid design specification: " + validation.errors.join(" "));
  if ((spec.requirements?.forbidden_features || []).length) {
    throw new Error("Feature-level forbidden constraints are not supported by the current solid-footprint planner.");
  }
  const relationshipWarnings = validateRelationships(spec);
  const heights = new Set(spec.components.map((component) => component.height_courses));
  if (heights.size !== 1) {
    throw new Error("This construction strategy requires a shared component height; stepped-height planning is not yet supported.");
  }
  const cells = new Map();
  for (const component of spec.components) {
    for (const [x,z] of footprintFor(component)) {
      const key = x + "," + z;
      if (cells.has(key)) {
        const previous = cells.get(key);
        if (previous.id !== component.id) {
          throw new Error("Component footprints overlap at stud " + key + "; resolve the semantic overlap before construction.");
        }
      }
      cells.set(key, component);
    }
  }
  const footprint = [...cells.keys()].map((key) => key.split(",").map(Number));
  if (!connected(footprint)) {
    throw new Error("The design contains disconnected solid footprints; the current catalogue cannot bridge them safely.");
  }
  const colourCodes = options.colourCodes
    || [...new Set(spec.components.map((component) => component.colour_code).filter(Number.isInteger))];
  const result = buildFootprintBlock(footprint, heights.values().next().value, catalogue, {
    colourCodes: colourCodes.length ? colourCodes : [options.defaultColourCode ?? 4],
    maxParts: spec.preferences?.max_parts ?? options.maxParts ?? 200,
  });
  const componentCoverage = spec.components.map((component) => ({
    component_id: component.id,
    role: component.role,
    priority: component.priority ?? "essential",
    footprint_cells: footprintFor(component).length,
    status: "represented_in_shared_footprint",
  }));
  const requiredRoles = spec.requirements?.required_roles || [];
  const unsupportedRoles = requiredRoles.filter((role) =>
    !spec.components.some((component) => component.role === role));
  const diagnostics = {
    strategy: "connected-orthogonal-footprint",
    fidelity_scope: "footprint-and-course-count",
    component_coverage: componentCoverage,
    relationship_warnings: relationshipWarnings,
    role_validation: "semantic component presence only; catalogue part-role suitability is not yet implemented",
    unsupported_required_roles: unsupportedRoles,
    limitations: [
      "v1 supports orthogonal prism components with one shared height and a connected union footprint.",
      "Component geometry is currently represented by the shared solid footprint; semantic component boundaries are retained as annotations, not separate physical subassemblies.",
      "Only the brick profiles in the published connection catalogue are eligible in this strategy.",
      "Nominal stud/receiver alignment is not proof of clutch force, stability or legal building technique.",
    ],
  };
  if (unsupportedRoles.length) {
    throw new Error("Required semantic roles have no component definition: " + unsupportedRoles.join(", "));
  }
  return { ...result, design_id: spec.design_id, design_name: spec.name, design_diagnostics: diagnostics };
}
