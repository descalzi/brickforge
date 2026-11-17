import {cardinalDirections} from './part-orientation.js?v=76b0ed28438a';
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const RELATIONSHIPS = new Set(["above","below","left_of","right_of","in_front_of","behind","attached_to","aligned_with","symmetric_to","dimension_ratio"]);
const ROOT_KEYS = new Set(["schema_version","design_id","name","units","components","relationships","constraints","appearance","assumptions","negative_spaces"]);
const COMPONENT_KEYS = new Set(["id","label","role","function","geometry","geometry_parameters","dimensions_mm","position_mm","priority","required_features","forbidden_features","colour","confidence","fit_tolerance_mm","position_tolerance_mm","orientation","shape_tolerance_mm"]);
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
  for (const [index, component] of (Array.isArray(spec.components) ? spec.components : []).entries()) {
    const path = "components[" + index + "]";
    if (!component || typeof component !== "object" || Array.isArray(component)) { errors.push(path + " must be an object."); continue; }
    for (const key of hasOnlyKeys(component, COMPONENT_KEYS)) errors.push(path + " has unknown property " + key + ".");
    if (typeof component.id !== "string" || !component.id.trim()) errors.push(path + ".id is required.");
    else if (ids.has(component.id)) errors.push(path + ".id must be unique.");
    else ids.add(component.id);
    if (typeof component.role !== "string" || !component.role.trim()) errors.push(path + ".role is required.");
    if (!["rectangular_prism","cylinder","sphere","extruded_profile","planar_profile","domed_cylinder"].includes(component.geometry)) errors.push(path + ".geometry is unsupported by design-spec v1.");
    if(component.orientation!==undefined){
      const o=component.orientation;
      if(!o||typeof o!=='object'||Array.isArray(o)||!Object.keys(o).length||hasOnlyKeys(o,new Set(['up','forward'])).length||Object.values(o).some(v=>!cardinalDirections.includes(v)))errors.push(path+'.orientation requires up and/or forward signed world axes.');
      else if(o.up&&o.forward&&o.up.slice(1)===o.forward.slice(1))errors.push(path+'.orientation up and forward must be perpendicular.');
    }
    const shape=component.geometry_parameters;
    if (["cylinder","domed_cylinder"].includes(component.geometry)) {
      if (!shape || !["x","y","z"].includes(shape.axis) || !finite(shape.diameter_mm) || shape.diameter_mm<=0) errors.push(path + ".geometry_parameters must define a cylinder axis and positive diameter_mm.");
      else {
        const radialAxes=shape.axis==="x"?["depth","height"]:shape.axis==="y"?["width","depth"]:["width","height"];
        if (component.dimensions_mm && radialAxes.some(axis=>Math.abs(component.dimensions_mm[axis]-shape.diameter_mm)>0.1)) errors.push(path + ".dimensions_mm must agree with the cylinder diameter and axis.");
      }
    }
    if (component.geometry==="sphere") {
      if (!shape || !finite(shape.radius_mm) || shape.radius_mm<=0) errors.push(path + ".geometry_parameters must define a positive sphere radius_mm.");
      else if (component.dimensions_mm && ["width","depth","height"].some(axis=>Math.abs(component.dimensions_mm[axis]-2*shape.radius_mm)>0.1)) errors.push(path + ".dimensions_mm must equal the sphere diameter on all axes.");
    }
    if (component.geometry==="extruded_profile") {
      if (!shape || !finite(shape.depth_mm) || shape.depth_mm<=0 || !Array.isArray(shape.outline_mm) || shape.outline_mm.length<3 || shape.outline_mm.some(point=>!Array.isArray(point)||point.length!==2||!point.every(finite))) errors.push(path + ".geometry_parameters must define a 2D outline and positive extrusion depth_mm.");
      else {
        const xs=shape.outline_mm.map(point=>point[0]),ys=shape.outline_mm.map(point=>point[1]);
        const width=Math.max(...xs)-Math.min(...xs),height=Math.max(...ys)-Math.min(...ys);
        if (component.dimensions_mm && (Math.abs(width-component.dimensions_mm[shape.extrusion_axis==='x'?'depth':'width'])>0.1 || Math.abs(height-component.dimensions_mm.height)>0.1 || Math.abs(shape.depth_mm-component.dimensions_mm[shape.extrusion_axis==='x'?'width':'depth'])>0.1)) errors.push(path + ".dimensions_mm must match the extruded outline bounds and depth.");
      }
    }
    if(component.geometry==='planar_profile'){
      if(!shape||!Array.isArray(shape.outline_mm)||shape.outline_mm.length<3||shape.outline_mm.some(p=>!Array.isArray(p)||p.length!==2||!p.every(finite)))errors.push(path+'.geometry_parameters requires an X/Z outline.');
      else {const xs=shape.outline_mm.map(p=>p[0]),zs=shape.outline_mm.map(p=>p[1]);if(Math.abs(Math.max(...xs)-Math.min(...xs)-component.dimensions_mm?.width)>.1||Math.abs(Math.max(...zs)-Math.min(...zs)-component.dimensions_mm?.depth)>.1)errors.push(path+'.dimensions_mm must match the planar outline.');}
    }
    if(shape?.extrusion_axis!==undefined&&(component.geometry!=='extruded_profile'||!['x','z'].includes(shape.extrusion_axis)))errors.push(path+'.extrusion_axis must be x or z on an extruded profile.');
    if (shape && hasOnlyKeys(shape,new Set(["axis","diameter_mm","radius_mm","depth_mm","outline_mm","extrusion_axis"])).length) errors.push(path + ".geometry_parameters contains unknown properties.");
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
    if(component.shape_tolerance_mm!==undefined&&(!finite(component.shape_tolerance_mm)||component.shape_tolerance_mm<0||component.shape_tolerance_mm>8||!['sphere','cylinder'].includes(component.geometry)))errors.push(path+'.shape_tolerance_mm is supported only on sphere/cylinder and must be between 0 and 8 mm.');
    if(component.position_tolerance_mm!==undefined&&(!finite(component.position_tolerance_mm)||component.position_tolerance_mm<0||component.position_tolerance_mm>8))errors.push(path+'.position_tolerance_mm must be between 0 and 8 mm.');
    if(component.fit_tolerance_mm!==undefined&&(!finite(component.fit_tolerance_mm)||component.fit_tolerance_mm<0||component.fit_tolerance_mm>4))errors.push(path+'.fit_tolerance_mm must be between 0 and 4 mm.');
    if (component.colour !== undefined && (!Number.isInteger(component.colour) || component.colour < 0)) errors.push(path + ".colour must be a non-negative integer.");
    if (component.confidence !== undefined && !["explicit","inferred","uncertain"].includes(component.confidence)) errors.push(path + ".confidence is invalid.");
  }
  if (spec.negative_spaces !== undefined) {
    if (!Array.isArray(spec.negative_spaces)) errors.push("negative_spaces must be an array.");
    else for (const [index, space] of spec.negative_spaces.entries()) {
      const path="negative_spaces["+index+"]";
      if(!space || typeof space!=="object" || Array.isArray(space)) {errors.push(path+" must be an object.");continue;}
      if(hasOnlyKeys(space,new Set(["id","dimensions_mm","position_mm","component_id"])).length)errors.push(path+" contains unknown properties.");
      if(typeof space.id!=="string" || !space.id.trim() || ids.has(space.id))errors.push(path+" requires a unique id.");
      else ids.add(space.id);
      if(space.component_id!==undefined && !(Array.isArray(spec.components)&&spec.components.some(c=>c?.id===space.component_id)))errors.push(path+" references an unknown host component.");
      if(!space.dimensions_mm || hasOnlyKeys(space.dimensions_mm,new Set(["width","depth","height"])).length || ["width","depth","height"].some(axis=>!finite(space.dimensions_mm[axis])||space.dimensions_mm[axis]<=0))errors.push(path+" dimensions must be positive and finite.");
      if(!space.position_mm || hasOnlyKeys(space.position_mm,new Set(["x","y","z"])).length || ["x","y","z"].some(axis=>!finite(space.position_mm[axis])))errors.push(path+" position must be finite.");
    }
  }
  if (!Array.isArray(spec.relationships)) errors.push("relationships must be an array.");
  else for (const [index, relationship] of spec.relationships.entries()) {
    if (!relationship || typeof relationship !== "object" || Array.isArray(relationship)) { errors.push("relationships[" + index + "] must be an object."); continue; }
    if (hasOnlyKeys(relationship,new Set(["id","type","from","to","tolerance_mm","required","axis","anchor","from_anchor","to_anchor","offset_mm","plane_mm","ratio","from_axis","to_axis"])).length) errors.push("relationships[" + index + "] contains unknown properties.");
    if (!RELATIONSHIPS.has(relationship.type)) errors.push("relationships[" + index + "].type is unsupported.");
    if (!(Array.isArray(spec.components)?spec.components:[]).some(c=>c?.id===relationship.from) || !(Array.isArray(spec.components)?spec.components:[]).some(c=>c?.id===relationship.to)) errors.push("relationships[" + index + "] references an unknown component.");
    if (relationship.from === relationship.to) errors.push("relationships[" + index + "] cannot relate a component to itself.");
    if (relationship.tolerance_mm !== undefined && (!finite(relationship.tolerance_mm) || relationship.tolerance_mm < 0)) errors.push("relationships[" + index + "].tolerance_mm must be non-negative.");
    const optionalFields=relationship.type==='dimension_ratio'?['ratio','from_axis','to_axis']:relationship.type==='aligned_with'?['axis','anchor','from_anchor','to_anchor','offset_mm']:relationship.type==='symmetric_to'?['axis','plane_mm']:[];
    for(const field of ['axis','anchor','from_anchor','to_anchor','offset_mm','plane_mm','ratio','from_axis','to_axis'])if(relationship[field]!==undefined&&!optionalFields.includes(field))errors.push('relationships['+index+'].'+field+' is not used by '+relationship.type+'.');
    if(relationship.axis!==undefined&&!['x','y','z'].includes(relationship.axis))errors.push('relationships['+index+'].axis must be x, y or z.');
    for(const field of ['anchor','from_anchor','to_anchor'])if(relationship[field]!==undefined&&!['min','max','center'].includes(relationship[field]))errors.push('relationships['+index+'].'+field+' must be min, max or center.');
    for(const field of ['plane_mm','offset_mm'])if(relationship[field]!==undefined&&!finite(relationship[field]))errors.push('relationships['+index+'].'+field+' must be finite.');
    if(relationship.type==='dimension_ratio'){
      if(!finite(relationship.ratio)||relationship.ratio<=0)errors.push('relationships['+index+'].ratio must be positive.');
      for(const field of ['from_axis','to_axis'])if(!['width','depth','height'].includes(relationship[field]))errors.push('relationships['+index+'].'+field+' is required.');
    }
    if(relationship.type==='aligned_with'&&!relationship.axis&&['anchor','from_anchor','to_anchor','offset_mm'].some(field=>relationship[field]!==undefined))errors.push('relationships['+index+'] requires an axis for explicit anchors or an offset.');
    if(relationship.type==='symmetric_to'&&relationship.plane_mm!==undefined&&!relationship.axis)errors.push('relationships['+index+'] requires an axis for an explicit mirror plane.');
    if (relationship.required !== undefined && typeof relationship.required !== "boolean") errors.push("relationships[" + index + "].required must be boolean.");
  }
  if (!spec.constraints || typeof spec.constraints !== "object" || typeof spec.constraints.require_connected !== "boolean" || typeof spec.constraints.allow_intersections !== "boolean") errors.push("constraints must define require_connected and allow_intersections.");
  else {
    if (hasOnlyKeys(spec.constraints,new Set(["require_connected","allow_intersections","max_parts","max_search_nodes","course_type"])).length) errors.push("constraints contains unknown properties.");
    if (spec.constraints.max_parts !== undefined && (!Number.isInteger(spec.constraints.max_parts)||spec.constraints.max_parts<1||spec.constraints.max_parts>10000)) errors.push("constraints.max_parts must be an integer from 1 to 10000.");
    if (spec.constraints.max_search_nodes !== undefined && (!Number.isInteger(spec.constraints.max_search_nodes)||spec.constraints.max_search_nodes<100||spec.constraints.max_search_nodes>1000000)) errors.push("constraints.max_search_nodes must be an integer from 100 to 1000000.");
    if (spec.constraints.course_type !== undefined && !["brick","plate","auto"].includes(spec.constraints.course_type)) errors.push("constraints.course_type must be brick, plate or auto.");
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