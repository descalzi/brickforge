import { buildLayeredFootprintBlock } from "./construction-engine.js";

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
    if (component.base_course !== undefined
        && (!Number.isInteger(component.base_course) || component.base_course < 0)) {
      fail(at + ".base_course must be a non-negative integer.");
    }
    if (component.colour_code !== undefined
        && (!Number.isInteger(component.colour_code) || component.colour_code < 0)) {
      fail(at + ".colour_code must be a non-negative integer.");
    }
    if (component.priority !== undefined
        && !["essential", "preferred", "optional"].includes(component.priority)) {
      fail(at + ".priority is unsupported.");
    }
    if (component.provenance !== undefined
        && !["explicit", "inferred", "uncertain"].includes(component.provenance)) {
      fail(at + ".provenance is unsupported.");
    }
    if (component.functional_requirements !== undefined
        && (!Array.isArray(component.functional_requirements)
          || !component.functional_requirements.every((item) => typeof item === "string" && item.trim()))) {
      fail(at + ".functional_requirements must be an array of non-empty strings.");
    }
    if (component.required_interfaces !== undefined
        && (!Array.isArray(component.required_interfaces)
          || !component.required_interfaces.every((item) => item && typeof item.interface_type === "string"
            && item.interface_type.trim()
            && (item.count === undefined || (Number.isInteger(item.count) && item.count > 0))
            && (item.diameter_mm === undefined || (Number.isFinite(item.diameter_mm) && item.diameter_mm > 0))
            && (item.max_diameter_error_mm === undefined || (Number.isFinite(item.max_diameter_error_mm) && item.max_diameter_error_mm >= 0))
            && (item.position_tolerance_mm === undefined || (Number.isFinite(item.position_tolerance_mm) && item.position_tolerance_mm >= 0))
            && (item.positions_mm === undefined || (Array.isArray(item.positions_mm) && item.positions_mm.length > 0 && item.positions_mm.every((position) => Array.isArray(position)
              && position.length === 3 && position.every(Number.isFinite)) && (item.count === undefined || item.count === item.positions_mm.length)))
            && (item.axis_vector === undefined || (Array.isArray(item.axis_vector) && item.axis_vector.length === 3
              && item.axis_vector.every(Number.isFinite) && Math.hypot(...item.axis_vector) > 0))))) {
      fail(at + ".required_interfaces contains an invalid interface requirement.");
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
    if ((relation?.tolerance_studs ?? 0) > 0
        && !["attached_to", "above", "below", "aligned_with"].includes(relation?.type)) {
      fail("relationships[" + index + "].tolerance_studs is unsupported for this relationship type.");
    }
  }
  if (spec.negative_spaces !== undefined && !Array.isArray(spec.negative_spaces)) {
    fail("negative_spaces must be an array.");
  }
  const negativeIds = new Set();
  for (const [index, negativeSpace] of (Array.isArray(spec.negative_spaces) ? spec.negative_spaces : []).entries()) {
    const at = "negative_spaces[" + index + "]";
    if (!negativeSpace || typeof negativeSpace !== "object" || Array.isArray(negativeSpace)) {
      fail(at + " must be an object."); continue;
    }
    if (typeof negativeSpace.id !== "string" || !negativeSpace.id.trim()
        || ids.has(negativeSpace.id) || negativeIds.has(negativeSpace.id)) {
      fail(at + ".id must be unique and non-empty.");
    } else negativeIds.add(negativeSpace.id);
    if (typeof negativeSpace.name !== "string" || !negativeSpace.name.trim()) fail(at + ".name must be non-empty.");
    const geometry = negativeSpace.geometry;
    if (!geometry || geometry.type !== "orthogonal_prism"
        || !Number.isInteger(geometry.width_studs) || geometry.width_studs < 1
        || !Number.isInteger(geometry.depth_studs) || geometry.depth_studs < 1) {
      fail(at + ".geometry must be an orthogonal_prism with positive integer stud dimensions.");
    }
    if (!Array.isArray(negativeSpace.origin_studs) || negativeSpace.origin_studs.length !== 2
        || !negativeSpace.origin_studs.every(Number.isInteger)) {
      fail(at + ".origin_studs must be an integer [x, z] pair.");
    }
    if (!Number.isInteger(negativeSpace.height_courses) || negativeSpace.height_courses < 1) {
      fail(at + ".height_courses must be a positive integer.");
    }
    if (negativeSpace.base_course !== undefined
        && (!Number.isInteger(negativeSpace.base_course) || negativeSpace.base_course < 0)) {
      fail(at + ".base_course must be a non-negative integer.");
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
          && (!Array.isArray(preferences.colours) || preferences.colours.length === 0
            || !preferences.colours.every((code) => Number.isInteger(code) && code >= 0))) {
        fail("preferences.colours must be non-negative integer LDraw colour codes.");
      }
      if (preferences.max_parts !== undefined
          && (!Number.isInteger(preferences.max_parts) || preferences.max_parts < 1)) {
        fail("preferences.max_parts must be a positive integer.");
      }
      if (preferences.optimisation !== undefined
          && !["fidelity", "part-count", "balanced", "simplicity", "interlock"].includes(preferences.optimisation)) {
        fail("preferences.optimisation is unsupported.");
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function componentBounds(component) {
  const [x, z] = component.origin_studs;
  const y = component.base_course ?? 0;
  return {
    minX: x,
    maxX: x + component.geometry.width_studs,
    minY: y,
    maxY: y + component.height_courses,
    minZ: z,
    maxZ: z + component.geometry.depth_studs,
  };
}

function relationSatisfied(relation, componentsById) {
  const a = componentBounds(componentsById.get(relation.from));
  const b = componentBounds(componentsById.get(relation.to));
  const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const overlapY = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  const overlapZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  const tolerance = relation.tolerance_studs ?? 0;
  switch (relation.type) {
    case "attached_to":
      return (Math.abs(a.maxX - b.minX) <= tolerance && overlapY > 0 && overlapZ > 0)
        || (Math.abs(b.maxX - a.minX) <= tolerance && overlapY > 0 && overlapZ > 0)
        || (Math.abs(a.maxY - b.minY) <= tolerance && overlapX > 0 && overlapZ > 0)
        || (Math.abs(b.maxY - a.minY) <= tolerance && overlapX > 0 && overlapZ > 0)
        || (Math.abs(a.maxZ - b.minZ) <= tolerance && overlapX > 0 && overlapY > 0)
        || (Math.abs(b.maxZ - a.minZ) <= tolerance && overlapX > 0 && overlapY > 0);
    case "above": return a.minY >= b.maxY && a.minY - b.maxY <= tolerance;
    case "below": return a.maxY <= b.minY && b.minY - a.maxY <= tolerance;
    case "left_of": return a.maxX <= b.minX;
    case "right_of": return a.minX >= b.maxX;
    case "in_front_of": return a.maxZ <= b.minZ;
    case "behind": return a.minZ >= b.maxZ;
    case "aligned_with":
      return Math.abs((a.minX + a.maxX) - (b.minX + b.maxX)) <= tolerance * 2
        || Math.abs((a.minY + a.maxY) - (b.minY + b.maxY)) <= tolerance * 2
        || Math.abs((a.minZ + a.maxZ) - (b.minZ + b.maxZ)) <= tolerance * 2;
    default:
      throw new Error("Relationship type " + relation.type
        + " is not supported by the current 3D footprint planner.");
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


/**
 * Convert semantic component volumes into per-course target occupancy, then use
 * the deterministic variable-course LEGO assembly planner and its nominal validators.
 */
export function constructDesign(spec, catalogue, options = {}) {
  const validation = validateDesignSpec(spec);
  if (!validation.valid) throw new TypeError("Invalid design specification: " + validation.errors.join(" "));
  if ((spec.requirements?.forbidden_features || []).length) {
    throw new Error("Feature-level forbidden constraints are not supported by the current footprint planner.");
  }
  if (spec.requirements?.require_connected === false) {
    throw new Error("The current assembly planner only supports a single connected construction.");
  }
  if (spec.components.some((component) => (component.functional_requirements || []).length)) {
    throw new Error("Functional component requirements need a specialised-part planner and cannot yet be represented by solid footprints.");
  }
  if (spec.components.some((component) => (component.required_interfaces || []).length)) {
    throw new Error("Required functional interfaces can be ranked against curated part profiles, but specialised-part placement and assembly are not yet implemented.");
  }
  const relationshipWarnings = validateRelationships(spec);
  const layerCount = Math.max(...spec.components.map((component) =>
    (component.base_course ?? 0) + component.height_courses));
  const maxCourses = options.maxCourses ?? 64;
  if (!Number.isInteger(maxCourses) || maxCourses < 1 || layerCount > maxCourses) {
    throw new RangeError("Design height exceeds the configured " + maxCourses + "-course planning limit.");
  }
  for (const component of spec.components) {
    if (component.geometry.width_studs * component.geometry.depth_studs > 256) {
      throw new RangeError("Each semantic component footprint is limited to 256 stud cells.");
    }
  }
  const layerCells = Array.from({ length: layerCount }, () => new Map());
  for (const component of spec.components) {
    const baseCourse = component.base_course ?? 0;
    const cells = footprintFor(component);
    for (let course = baseCourse; course < baseCourse + component.height_courses; course += 1) {
      for (const [x, z] of cells) {
        const key = x + "," + z;
        const previous = layerCells[course].get(key);
        if (previous && previous.id !== component.id) {
          throw new Error("Component volumes overlap at stud " + key + " in course " + (course + 1) + ".");
        }
        layerCells[course].set(key, component);
        if (layerCells[course].size > 256) {
          throw new RangeError("Each occupied course is limited to 256 stud cells in the current browser planner.");
        }
      }
    }
  }
  const negativeSpaceCoverage = [];
  for (const negativeSpace of spec.negative_spaces || []) {
    const baseCourse = negativeSpace.base_course ?? 0;
    const endCourse = baseCourse + negativeSpace.height_courses;
    if (endCourse > layerCount) {
      throw new Error("Negative space " + negativeSpace.id + " extends beyond the positive design volume.");
    }
    if (negativeSpace.geometry.width_studs * negativeSpace.geometry.depth_studs > 256) {
      throw new RangeError("Each negative-space footprint is limited to 256 stud cells.");
    }
    const cells = footprintFor(negativeSpace);
    let removed = 0;
    for (let course = baseCourse; course < endCourse; course += 1) {
      for (const [x, z] of cells) {
        const key = x + "," + z;
        if (!layerCells[course].has(key)) {
          throw new Error("Negative space " + negativeSpace.id + " extends outside the positive design at course " + (course + 1) + ", stud " + key + ".");
        }
        layerCells[course].delete(key);
        removed += 1;
      }
    }
    negativeSpaceCoverage.push({
      negative_space_id: negativeSpace.id,
      purpose: negativeSpace.purpose || negativeSpace.name,
      cells_removed: removed,
      base_course: baseCourse,
      top_course_exclusive: endCourse,
      status: "subtracted_from_target_occupancy",
    });
  }
  const layerFootprints = layerCells.map((cells, index) => {
    if (!cells.size) {
      throw new Error("The design has an empty course " + (index + 1)
        + "; unsupported floating or fully voided vertical placement was rejected.");
    }
    return [...cells.keys()].map((key) => key.split(",").map(Number));
  });
  const requiredRoles = spec.requirements?.required_roles || [];
  const unsupportedRoles = requiredRoles.filter((role) =>
    !spec.components.some((component) => component.role === role));
  if (unsupportedRoles.length) {
    throw new Error("Required semantic roles have no component definition: " + unsupportedRoles.join(", "));
  }
  const preferredColours = options.colourCodes
    || spec.preferences?.colours
    || [options.defaultColourCode ?? 4, 1];
  if (!Array.isArray(preferredColours) || preferredColours.length === 0
      || !preferredColours.every((code) => Number.isInteger(code) && code >= 0)) {
    throw new RangeError("The preferred colour palette must contain non-negative LDraw colour codes.");
  }
  const courseColourCodes = layerCells.map((cells, course) => {
    const explicitColours = [...new Set([...cells.values()]
      .map((component) => component.colour_code)
      .filter(Number.isInteger))];
    if (explicitColours.length > 1) {
      throw new Error("Course " + (course + 1)
        + " contains multiple explicit component colours; the current course planner supports one colour per course.");
    }
    return explicitColours[0] ?? preferredColours[course % preferredColours.length];
  });
  const optimisation = spec.preferences?.optimisation ?? "balanced";
  const optimizationProfile = {
    "part-count": "economy",
    balanced: "balanced",
    simplicity: "simplicity",
    interlock: "interlock",
  }[optimisation];
  if (!optimizationProfile) {
    throw new Error("The fidelity optimisation objective is not yet implemented; choose balanced, part-count, simplicity or interlock.");
  }
  const result = buildLayeredFootprintBlock(layerFootprints, catalogue, {
    colourCodes: courseColourCodes,
    maxParts: spec.preferences?.max_parts ?? options.maxParts ?? 200,
    maxAlternatives: options.maxAlternatives ?? 3,
    optimizationProfile,
    courseType: "brick",
  });
  const componentCoverage = spec.components.map((component) => ({
    component_id: component.id,
    role: component.role,
    colour_code: component.colour_code ?? null,
    priority: component.priority ?? "essential",
    footprint_cells: footprintFor(component).length,
    base_course: component.base_course ?? 0,
    top_course_exclusive: (component.base_course ?? 0) + component.height_courses,
    status: "represented_in_layer_occupancy",
  }));
  const diagnostics = {
    strategy: "variable-course-footprint",
    fidelity_scope: "stud-grid-occupancy-and-course-height",
    component_coverage: componentCoverage,
    course_colour_codes: courseColourCodes,
    negative_space_coverage: negativeSpaceCoverage,
    relationship_warnings: relationshipWarnings,
    relationship_validation: "semantic component spatial bounds only; direct physical subassembly attachment is not yet mapped",
    role_validation: "semantic component presence only; role-aware candidate ranking exists separately but is not yet integrated into global assembly planning",
    unsupported_required_roles: unsupportedRoles,
    search: result.search,
    limitations: [
      "v1 supports orthogonal prism components on integer stud coordinates and integer brick-course heights.",
      "Semantic components are represented as per-course occupancy annotations, not separate physical subassemblies.",
      "Only the profiled rectangular brick/plate course families selected by the construction strategy are eligible.",
      "Nominal stud/receiver alignment and body-envelope checks are not proof of clutch force, physical strength, stability or legal building technique.",
      "Curved/sloped geometry, specialised part placement, Technic mechanisms, non-rectangular negative-space boundaries and physical assembly accessibility are not yet solved.",
      "The current layered course planner supports one explicit colour per course; distinct colours within the same course are rejected rather than merged.",
    ],
  };
  const alternatives = (result.alternatives || []).map((alternative) => ({
    ...alternative,
    design_id: spec.design_id,
    design_name: spec.name,
    design_diagnostics: diagnostics,
  }));
  return {
    ...result,
    design_id: spec.design_id,
    design_name: spec.name,
    design_diagnostics: diagnostics,
    alternatives,
  };
}
