const finite=value=>typeof value==="number"&&Number.isFinite(value);
const vector=value=>Array.isArray(value)&&value.length===3&&value.every(finite);
const dimensions=value=>value&&["width","depth","height"].every(key=>finite(value[key])&&value[key]>0);
export function validatePartCapabilityCatalogue(catalogue){
 const errors=[];
 if(!catalogue||catalogue.schema_version!==1||catalogue.units!=="mm"||!Array.isArray(catalogue.parts))return {valid:false,errors:["A version-1 millimetre part capability catalogue is required."]};
 const ids=new Set();
 for(const [index,part] of catalogue.parts.entries()){
  const path="parts["+index+"]";
  if(typeof part.part_id!=="string"||!part.part_id.trim())errors.push(path+".part_id is required.");
  else if(ids.has(part.part_id))errors.push(path+".part_id must be unique.");else ids.add(part.part_id);
  if(typeof part.description!=="string"||!part.description.trim())errors.push(path+".description is required.");
  if(!Array.isArray(part.roles)||!part.roles.length||part.roles.some(value=>typeof value!=="string"||!value.trim()))errors.push(path+".roles must contain non-empty strings.");
  if(!Array.isArray(part.capabilities)||part.capabilities.some(value=>typeof value!=="string"||!value.trim()))errors.push(path+".capabilities must contain strings.");
  if(part.dimensions_mm!==null&&!dimensions(part.dimensions_mm))errors.push(path+".dimensions_mm must be null or positive width/depth/height.");
  if(!["nominal_connection_profile","nominal_geometry_available","geometry_measured","reference_only"].includes(part.candidate_status))errors.push(path+".candidate_status is invalid.");
  if(part.geometry_measurement && (!Number.isInteger(part.geometry_measurement.triangle_count)||part.geometry_measurement.triangle_count<1||typeof part.geometry_measurement.source_library_commit!=="string"||part.geometry_measurement.method!=="recursive_ldraw_surface_bounds"))errors.push(path+".geometry_measurement is invalid.");
  if(!Array.isArray(part.interfaces))errors.push(path+".interfaces must be an array.");
  else for(const iface of part.interfaces)if(!iface||typeof iface.interface_id!=="string"||typeof iface.interface_type!=="string"||!vector(iface.position_mm)||!vector(iface.axis_vector))errors.push(path+" contains malformed connector interface geometry.");
  if(!part.source||typeof part.source.file!=="string"||typeof part.source.license!=="string")errors.push(path+".source provenance is required.");
 }
 return {valid:errors.length===0,errors};
}
function dimensionError(actual,requested){
 if(!dimensions(actual)||!dimensions(requested))return null;
 return Math.sqrt(["width","depth","height"].reduce((sum,key)=>sum+(actual[key]-requested[key])**2,0));
}
export function discoverPartCandidates(requirement,catalogue,options={}){
 if(!requirement||typeof requirement!=="object")throw new TypeError("A semantic part requirement is required.");
 const validation=validatePartCapabilityCatalogue(catalogue);
 if(!validation.valid)throw new TypeError("Invalid part capability catalogue: "+validation.errors.join(" "));
 const roles=(Array.isArray(requirement.roles)?requirement.roles:(typeof requirement.role==="string"?[requirement.role]:[])).map(value=>value.toLowerCase());
 const required=new Set(requirement.required_capabilities||[]);
 const forbidden=new Set(requirement.forbidden_capabilities||[]);
 const preferred=new Set(requirement.preferred_capabilities||[]);
 const maxError=Number.isFinite(options.maxDimensionErrorMm)?options.maxDimensionErrorMm:Infinity;
 const candidates=[];
 for(const part of catalogue.parts){
  if(part.candidate_status==="reference_only"&&!options.includeReferenceOnly)continue;
  if(roles.length&&!part.roles.some(value=>roles.includes(value.toLowerCase())))continue;
  if([...required].some(capability=>!part.capabilities.includes(capability)))continue;
  if([...forbidden].some(capability=>part.capabilities.includes(capability)))continue;
  const error=dimensionError(part.dimensions_mm,requirement.dimensions_mm);
  if(error!==null&&error>maxError)continue;
  if(requirement.dimensions_mm&&error===null&&!options.allowUnknownDimensions)continue;
  const preferredCount=[...preferred].filter(capability=>part.capabilities.includes(capability)).length;
  const score=(roles.length?100:0)+required.size*20+preferredCount*5-(error??0)*2+(part.candidate_status==="nominal_connection_profile"?3:0);
  candidates.push({part_id:part.part_id,description:part.description,roles:part.roles,capabilities:part.capabilities,dimensions_mm:part.dimensions_mm,candidate_status:part.candidate_status,dimension_error_mm:error,score,interfaces:part.interfaces,source:part.source});
 }
 candidates.sort((a,b)=>b.score-a.score||(a.dimension_error_mm??Infinity)-(b.dimension_error_mm??Infinity)||a.part_id.localeCompare(b.part_id));
 return {status:candidates.length?"candidates_found":"no_candidates",roles,required_capabilities:[...required],forbidden_capabilities:[...forbidden],candidates};
}
