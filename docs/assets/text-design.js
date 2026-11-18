import { validateDesignSpec } from './design-spec.js?v=8b12d09c0019';
export const INTERPRETATION_INSTRUCTIONS=`Return one JSON object conforming to the supplied response_schema. Describe the intended object in millimetres, with named components, geometry, colours, functions, required features and spatial relationships. Never specify part IDs, catalogue recipes, source filenames, connection datums or brick placements. Resolve quantities into component instances and record unstated choices in assumptions. Preserve important empty spaces explicitly. A negative space with component_id cuts only that component, for example a window opening in a wall. Omit component_id for space that must remain clear throughout the assembly. Use fit_tolerance_mm only for genuinely approximate dimensions (0..4 mm); zero is exact. The fitter can consider different source-backed sizes within that interval to satisfy joints and relationships. Use position_tolerance_mm (0..8 mm per axis) to mark inferred positions the deterministic fitter may adjust to align real joints; zero fixes position. Use shape_tolerance_mm only when a stepped sphere/cylinder is acceptable (0..8 mm radial allowance, distinct from dimension tolerance); zero requires exact shape matching. Never add shape tolerance to a request for smooth curved source surfaces. Cylinders need an axis and diameter; domed_cylinder describes a round body with a dome top. extruded_profile defaults to an X/Y polygon extruded along Z; extrusion_axis=x uses a Z/Y polygon extruded along X and depth_mm then means its X length. Use orientation.up and orientation.forward signed world axes when the object needs a particular facing; forward on slopes points downhill. Keep that facing consistent with the outline; planar_profile uses an X/Z outline with the component height. Use dimension_ratio relationships to retain proportions (positive ratio, from_axis and to_axis). For aligned_with always provide an axis and explicit min/max/center anchors; offset_mm is from anchor minus to anchor. For symmetric_to provide the axis and plane_mm. The construction engine, not the interpreter, chooses real elements and checks their connections. Do not remove requested features because the current catalogue may not support them. Return unresolved requirements so the engine can explain its limits.`;
export function buildInterpretationRequest(description,responseSchema){
 if(typeof description!=='string'||!description.trim()||description.length>12000)throw new Error('Enter a description of up to 12,000 characters.');
 if(!responseSchema||typeof responseSchema!=='object')throw new Error('The canonical response schema is required.');
 return {schema_version:1,input:description.trim(),instructions:INTERPRETATION_INSTRUCTIONS,response_schema:responseSchema};
}
export async function interpretDescription(description,{provider,responseSchema,signal}={}){
 if(typeof provider!=='function')throw new Error('Choose an interpretation provider before analysing text.');
 const request=buildInterpretationRequest(description,responseSchema),response=await provider(request,{signal});
 if(signal?.aborted)throw new DOMException('Interpretation cancelled.','AbortError');
 const specification=response?.specification||response;
 if(JSON.stringify(specification).length>131072)throw new Error('The interpreted specification exceeds 128 KiB.');
 const check=validateDesignSpec(specification);if(!check.valid)throw new Error('The interpretation does not match the design contract: '+check.errors.join(' '));
 return {specification,request};
}
export function endpointProvider(address,fetcher=fetch){
 let url;try{url=new URL(address);}catch{throw new Error('Enter the full interpretation gateway URL.');}
 if(url.username||url.password||url.hash||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new Error('Use an HTTPS gateway, or HTTP on localhost, without credentials or a fragment in its URL.');
 return async(request,{signal}={})=>{
  const response=await fetcher(url.href,{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.any([signal,AbortSignal.timeout(60000)].filter(Boolean))});
  if(!response.ok)throw new Error('Interpretation gateway returned HTTP '+response.status+'.');
  return response.json();
 };
}
