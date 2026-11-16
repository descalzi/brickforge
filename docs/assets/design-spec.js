const finite = (value) => typeof value === "number" && Number.isFinite(value);
const RELATIONSHIPS = new Set(["above","below","left_of","right_of","in_front_of","behind","attached_to","aligned_with","symmetric_to"]);
const ROOT_KEYS = new Set(["schema_version","design_id","name","units","components","relationships","constraints","appearance","assumptions"]);
const COMPONENT_KEYS = new Set(["id","label","role","function","geometry","geometry_parameters","dimensions_mm","position_mm","priority","required_features","forbidden_features","colour","confidence"]);
const hasOnlyKeys = (value, allowed) => Object.keys(value || {}).filter(key => !allowed.has(key));

export function validateDesignSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return { valid: false, errors: ["Design specification must be an object."] };
  for (const key of hasOnlyKeys(spec, ROOT_KEYS)) errors.push("Unknown design specification property: " + key + ".");
  if (spec.schema_version !== 1) errors.push("schema_version must be 1.");
  if (typeof spec.design_id !== "string" || !spec.design_id.trim()) errors.push("design_id is required.");
  if (spec.name !== undefined && (typeof spec.name !== "string" || !spec.name.trim())) errors.push("name must be a non-empty string when supplied.");
  if (spec.units !== "mm") errors.push("units must be mm.");
  if (!Array.isArray(spec.components) || !spec.components.length) errors.push("At least one component is required.");
  const ids = new Set();
  for (const [index, component] of (spec.components || []).entries()) {
    const path = "components[" + index + "]";
    if (!component || typeof component !== "object" || Array.isArray(component)) { errors.push(path + " must be an object."); continue; }
    for (const key of hasOnlyKeys(component, COMPONENT_KEYS)) errors.push(path + " has unknown property " + key + ".");
    if (typeof component.id !== "string" || !component.id.trim()) errors.push(path + ".id is required.");
    else if (ids.has(component.id)) errors.push(path + ".id must be unique.");
    else ids.add(component.id);
    if (typeof component.role !== "string" || !component.role.trim()) errors.push(path + ".role is required.");
    if (!["rectangular_prism","cylinder","sphere","extruded_profile"].includes(component.geometry)) errors.push(path + ".geometry is unsupported by design-spec v1.");
    const shape=component.geometry_parameters;
    if (component.geometry==="cylinder" && (!shape || !["x","y","z"].includes(shape.axis) || !finite(shape.diameter_mm) || shape.diameter_mm<=0)) errors.push(path + ".geometry_parameters must define a cylinder axis and positive diameter_mm.");
    if (component.geometry==="sphere" && (!shape || !finite(shape.radius_mm) || shape.radius_mm<=0)) errors.push(path + ".geometry_parameters must define a positive sphere radius_mm.");
    if (component.geometry==="extruded_profile" && (!shape || !finite(shape.depth_mm) || shape.depth_mm<=0 || !Array.isArray(shape.outline_mm) || shape.outline_mm.length<3 || shape.outline_mm.some(point=>!Array.isArray(point)||point.length!==2||!point.every(finite)))) errors.push(path + ".geometry_parameters must define a 2D outline and positive extrusion depth_mm.");
    if (shape && hasOnlyKeys(shape,new Set(["axis","diameter_mm","radius_mm","depth_mm","outline_mm"])).length) errors.push(path + ".geometry_parameters contains unknown properties.");
    for (const axis of ["width", "depth", "height"]) {
      if (!finite(component.dimensions_mm?.[axis]) || component.dimensions_mm[axis] <= 0) errors.push(path + ".dimensions_mm." + axis + " must be positive and finite.");
    }
    if (component.dimensions_mm && hasOnlyKeys(component.dimensions_mm, new Set(["width","depth","height"])).length) errors.push(path + ".dimensions_mm contains unknown properties.");
    for (const axis of ["x", "y", "z"]) {
      if (!finite(component.position_mm?.[axis])) errors.push(path + ".position_mm." + axis + " must be finite.");
    }
    if (component.position_mm && hasOnlyKeys(component.position_mm, new Set(["x","y","z"])).length) errors.push(path + ".position_mm contains unknown properties.");
    if (!["essential", "preferred", "optional"].includes(component.priority)) errors.push(path + ".priority is invalid.");
    for (const key of ["function","required_features","forbidden_features"]) {
      if (component[key] !== undefined && (!Array.isArray(component[key]) || component[key].some(value => typeof value !== "string" || !value.trim()))) errors.push(path + "." + key + " must be an array of non-empty strings.");
    }
    if (component.colour !== undefined && (!Number.isInteger(component.colour) || component.colour < 0)) errors.push(path + ".colour must be a non-negative integer.");
    if (component.confidence !== undefined && !["explicit","inferred","uncertain"].includes(component.confidence)) errors.push(path + ".confidence is invalid.");
  }
  if (!Array.isArray(spec.relationships)) errors.push("relationships must be an array.");
  else for (const [index, relationship] of spec.relationships.entries()) {
    if (!relationship || typeof relationship !== "object" || Array.isArray(relationship)) { errors.push("relationships[" + index + "] must be an object."); continue; }
    if (hasOnlyKeys(relationship,new Set(["id","type","from","to","tolerance_mm","required"])).length) errors.push("relationships[" + index + "] contains unknown properties.");
    if (!RELATIONSHIPS.has(relationship.type)) errors.push("relationships[" + index + "].type is unsupported.");
    if (!ids.has(relationship.from) || !ids.has(relationship.to)) errors.push("relationships[" + index + "] references an unknown component.");
    if (relationship.from === relationship.to) errors.push("relationships[" + index + "] cannot relate a component to itself.");
    if (relationship.tolerance_mm !== undefined && (!finite(relationship.tolerance_mm) || relationship.tolerance_mm < 0)) errors.push("relationships[" + index + "].tolerance_mm must be non-negative.");
    if (relationship.required !== undefined && typeof relationship.required !== "boolean") errors.push("relationships[" + index + "].required must be boolean.");
  }
  if (!spec.constraints || typeof spec.constraints !== "object" || typeof spec.constraints.require_connected !== "boolean" || typeof spec.constraints.allow_intersections !== "boolean") errors.push("constraints must define require_connected and allow_intersections.");
  else {
    if (hasOnlyKeys(spec.constraints,new Set(["require_connected","allow_intersections","max_parts","max_search_nodes","course_type"])).length) errors.push("constraints contains unknown properties.");
    if (spec.constraints.max_parts !== undefined && (!Number.isInteger(spec.constraints.max_parts)||spec.constraints.max_parts<1||spec.constraints.max_parts>10000)) errors.push("constraints.max_parts must be an integer from 1 to 10000.");
    if (spec.constraints.max_search_nodes !== undefined && (!Number.isInteger(spec.constraints.max_search_nodes)||spec.constraints.max_search_nodes<100||spec.constraints.max_search_nodes>1000000)) errors.push("constraints.max_search_nodes must be an integer from 100 to 1000000.");
    if (spec.constraints.course_type !== undefined && !["brick","plate"].includes(spec.constraints.course_type)) errors.push("constraints.course_type must be brick or plate.");
  }
  if (spec.appearance !== undefined) {
    if (!spec.appearance || typeof spec.appearance !== "object" || Array.isArray(spec.appearance)) errors.push("appearance must be an object.");
    else {
      if (hasOnlyKeys(spec.appearance,new Set(["preferred_colours","symmetry"])).length) errors.push("appearance contains unknown properties.");
      if (spec.appearance.preferred_colours !== undefined && (!Array.isArray(spec.appearance.preferred_colours)||spec.appearance.preferred_colours.some(value=>!Number.isInteger(value)||value<0))) errors.push("appearance.preferred_colours must contain non-negative integer colour codes.");
      if (spec.appearance.symmetry !== undefined && !["none","bilateral","radial"].includes(spec.appearance.symmetry)) errors.push("appearance.symmetry is invalid.");
    }
  }
  if (spec.assumptions !== undefined && (!Array.isArray(spec.assumptions)||spec.assumptions.some(value=>typeof value!=="string"))) errors.push("assumptions must be an array of strings.");
  return { valid: errors.length === 0, errors };
}

export function assertValidDesignSpec(spec) {
  const result = validateDesignSpec(spec);
  if (!result.valid) throw new TypeError("Invalid design specification: " + result.errors.join(" "));
  return spec;
}