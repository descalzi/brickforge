const finite = (value) => typeof value === "number" && Number.isFinite(value);
const RELATIONSHIPS = new Set(["above","below","left_of","right_of","in_front_of","behind","attached_to","aligned_with","symmetric_to"]);

export function validateDesignSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return { valid: false, errors: ["Design specification must be an object."] };
  if (spec.schema_version !== 1) errors.push("schema_version must be 1.");
  if (typeof spec.design_id !== "string" || !spec.design_id.trim()) errors.push("design_id is required.");
  if (spec.units !== "mm") errors.push("units must be mm.");
  if (!Array.isArray(spec.components) || !spec.components.length) errors.push("At least one component is required.");
  const ids = new Set();
  for (const [index, component] of (spec.components || []).entries()) {
    const path = "components[" + index + "]";
    if (!component || typeof component !== "object") { errors.push(path + " must be an object."); continue; }
    if (typeof component.id !== "string" || !component.id.trim()) errors.push(path + ".id is required.");
    else if (ids.has(component.id)) errors.push(path + ".id must be unique.");
    else ids.add(component.id);
    if (typeof component.role !== "string" || !component.role.trim()) errors.push(path + ".role is required.");
    if (component.geometry !== "rectangular_prism") errors.push(path + ".geometry is unsupported by design-spec v1.");
    for (const axis of ["width", "depth", "height"]) {
      if (!finite(component.dimensions_mm?.[axis]) || component.dimensions_mm[axis] <= 0) errors.push(path + ".dimensions_mm." + axis + " must be positive and finite.");
    }
    for (const axis of ["x", "y", "z"]) {
      if (!finite(component.position_mm?.[axis])) errors.push(path + ".position_mm." + axis + " must be finite.");
    }
    if (!["essential", "preferred", "optional"].includes(component.priority)) errors.push(path + ".priority is invalid.");
  }
  if (!Array.isArray(spec.relationships)) errors.push("relationships must be an array.");
  else for (const [index, relationship] of spec.relationships.entries()) {
    if (!RELATIONSHIPS.has(relationship?.type)) errors.push("relationships[" + index + "].type is unsupported.");
    if (!ids.has(relationship?.from) || !ids.has(relationship?.to)) errors.push("relationships[" + index + "] references an unknown component.");
    if (relationship?.from === relationship?.to) errors.push("relationships[" + index + "] cannot relate a component to itself.");
  }
  if (!spec.constraints || typeof spec.constraints.require_connected !== "boolean" || typeof spec.constraints.allow_intersections !== "boolean") errors.push("constraints must define require_connected and allow_intersections.");
  return { valid: errors.length === 0, errors };
}

export function assertValidDesignSpec(spec) {
  const result = validateDesignSpec(spec);
  if (!result.valid) throw new TypeError("Invalid design specification: " + result.errors.join(" "));
  return spec;
}