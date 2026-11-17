import { discoverPartCandidates } from "./part-catalogue.js?v=8c466e17ba47";
import { translateComponentRequirements } from "./design-translation.js?v=8c466e17ba47";
import { interfacesForPartInstances, matchAssemblyConnectors } from "./connector-matcher.js?v=8c466e17ba47";

const RY90=[0,0,1,0,1,0,-1,0,0];
const IDENTITY=[1,0,0,0,1,0,0,0,1];
const add=(a,b)=>a.map((value,index)=>value+b[index]);
const subtract=(a,b)=>a.map((value,index)=>value-b[index]);
const dot=(a,b)=>a.reduce((sum,value,index)=>sum+value*b[index],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length=v=>Math.hypot(...v);
const normalize=v=>{const n=length(v);return n>1e-9?v.map(x=>x/n):null;};
const transform=(m,v)=>[m[0]*v[0]+m[1]*v[1]+m[2]*v[2],m[3]*v[0]+m[4]*v[1]+m[5]*v[2],m[6]*v[0]+m[7]*v[1]+m[8]*v[2]];
function rotationFromTo(from,to){
 const a=normalize(from),b=normalize(to);if(!a||!b)return null;
 const v=cross(a,b),s=length(v),c=Math.max(-1,Math.min(1,dot(a,b)));
 if(s<1e-8)return c>0?IDENTITY:null;
 const k=[0,-v[2],v[1],v[2],0,-v[0],-v[1],v[0],0];
 const k2=[
  k[0]*k[0]+k[1]*k[3]+k[2]*k[6],k[0]*k[1]+k[1]*k[4]+k[2]*k[7],k[0]*k[2]+k[1]*k[5]+k[2]*k[8],
  k[3]*k[0]+k[4]*k[3]+k[5]*k[6],k[3]*k[1]+k[4]*k[4]+k[5]*k[7],k[3]*k[2]+k[4]*k[5]+k[5]*k[8],
  k[6]*k[0]+k[7]*k[3]+k[8]*k[6],k[6]*k[1]+k[7]*k[4]+k[8]*k[7],k[6]*k[2]+k[7]*k[5]+k[8]*k[8]
 ];
 return IDENTITY.map((value,index)=>value+k[index]+k2[index]*(1-c)/(s*s));
}
function toLDrawTranslation(mm){return [mm[0]/0.4,-mm[1]/0.4,-mm[2]/0.4].map(value=>Math.round(value*1000)/1000);}
function ldrawLine(part){return "1 "+part.colour+" "+part.translation_ldu.join(" ")+" "+part.matrix.join(" ")+" "+part.part_id+".dat";}
function bom(parts){
 const counts=new Map();for(const part of parts)counts.set(part.part_id,(counts.get(part.part_id)||0)+1);
 return [...counts].map(([part_id,quantity])=>({part_id,quantity})).sort((a,b)=>a.part_id.localeCompare(b.part_id));
}

/**
 * Small capability-driven Technic solver: two semantic beam components joined
 * by a real friction-pin candidate. It searches catalogue candidates and
 * connector datums; it is not an object template.
 */
export function planTechnicBeamJoint(spec,partCatalogue,designTranslation,connectorCatalogue){
 const beams=spec.components.filter(component=>component.role==="beam");
 if(beams.length!==2||spec.components.length!==2||!spec.relationships.some(rel=>rel.type==="attached_to"&&new Set([rel.from,rel.to]).size===2))return null;
 if(!spec.constraints.require_connected||beams.some(component=>component.geometry!=="rectangular_prism"||!(component.required_features||[]).includes("pin_joint")))return null;
 if(!connectorCatalogue||connectorCatalogue.schema_version!==1||!Array.isArray(connectorCatalogue.rules))return {status:"blocked",design_id:spec.design_id,failures:["Technic beam joint planning requires the version-1 connector compatibility catalogue."],warnings:[],parts:[],connections:[]};
 const beamCandidates=beams.map(component=>{
  const translated=translateComponentRequirements(component,designTranslation);
  if(!translated.valid)return {component,error:translated.errors.join(" ")};
  const search=discoverPartCandidates({roles:translated.part_roles,required_capabilities:translated.required_capabilities,dimensions_mm:component.dimensions_mm},partCatalogue);
  return {component,search};
 });
 for(const item of beamCandidates)if(item.error||item.search.status==="no_candidates")return {status:"blocked",design_id:spec.design_id,failures:[item.error||"No catalogue beam satisfies the pin-joint requirement for "+item.component.id+"."],warnings:[],parts:[],connections:[]};
 const pinTranslation=translateComponentRequirements({role:"connector_pin",required_features:[],forbidden_features:[]},designTranslation);
 if(!pinTranslation.valid)return {status:"blocked",design_id:spec.design_id,failures:pinTranslation.errors,warnings:[],parts:[],connections:[]};
 const pinSearch=discoverPartCandidates({roles:pinTranslation.part_roles,required_capabilities:["technic_friction_pin"]},partCatalogue);
 if(pinSearch.status==="no_candidates")return {status:"blocked",design_id:spec.design_id,failures:["No source-backed friction-pin candidate is available."],warnings:[],parts:[],connections:[]};
 const beamPart=beamCandidates[0].search.candidates.find(candidate=>candidate.interfaces.some(iface=>iface.interface_type==="technic_pin_hole"));
 const beamPartB=beamCandidates[1].search.candidates.find(candidate=>candidate.part_id===beamPart?.part_id);
 const pinPart=pinSearch.candidates.find(candidate=>candidate.interfaces.filter(iface=>iface.interface_type==="technic_friction_pin").length>=2);
 if(!beamPart||!beamPartB||!pinPart)return {status:"blocked",design_id:spec.design_id,failures:["The selected beam/pin candidates do not expose the two compatible nominal interfaces required for this joint."],warnings:[],parts:[],connections:[]};
 const holes=beamPart.interfaces.filter(iface=>iface.interface_type==="technic_pin_hole");
 const centreHole=holes.find(iface=>Math.abs(iface.position_mm[0])<0.1)||holes[Math.floor(holes.length/2)];
 const pinEnds=pinPart.interfaces.filter(iface=>iface.interface_type==="technic_friction_pin").sort((a,b)=>a.position_mm[0]-b.position_mm[0]);
 const pinA=pinEnds[0],pinB=pinEnds[pinEnds.length-1];
 const pinAxis=normalize(subtract(pinB.position_mm,pinA.position_mm));
 if(!centreHole||!pinAxis)return {status:"blocked",design_id:spec.design_id,failures:["Could not derive a stable beam-hole/pin axis arrangement from catalogue datums."],warnings:[],parts:[],connections:[]};
 const beamRotation=rotationFromTo(centreHole.axis_vector,pinAxis);
 if(!beamRotation)return {status:"blocked",design_id:spec.design_id,failures:["Could not align beam hole axis with the selected pin."],warnings:[],parts:[],connections:[]};
 const pinRotation=IDENTITY;
 const localBounds=beamPart.geometry_measurement?.bounds_mm||[
  [-beamPart.dimensions_mm.width/2,-beamPart.dimensions_mm.height/2,-beamPart.dimensions_mm.depth/2],
  [beamPart.dimensions_mm.width/2,beamPart.dimensions_mm.height/2,beamPart.dimensions_mm.depth/2]
 ];
 const corners=[];
 for(const x of [localBounds[0][0],localBounds[1][0]])for(const y of [localBounds[0][1],localBounds[1][1]])for(const z of [localBounds[0][2],localBounds[1][2]])corners.push(transform(beamRotation,[x,y,z]));
 const rotatedMin=[0,1,2].map(axis=>Math.min(...corners.map(point=>point[axis])));
 const rotatedMax=[0,1,2].map(axis=>Math.max(...corners.map(point=>point[axis])));
 const realisedDimensions={width:rotatedMax[0]-rotatedMin[0],depth:rotatedMax[2]-rotatedMin[2],height:rotatedMax[1]-rotatedMin[1]};
 if(["width","depth","height"].some(axis=>Math.abs(realisedDimensions[axis]-beams[0].dimensions_mm[axis])>0.2)||["width","depth","height"].some(axis=>Math.abs(realisedDimensions[axis]-beams[1].dimensions_mm[axis])>0.2))return {status:"blocked",design_id:spec.design_id,failures:["The selected Technic beam orientation does not preserve the requested component bounding dimensions."],warnings:[],parts:[],connections:[],diagnostics:{realisedDimensions}};
 const beamATranslation=subtract([beams[0].position_mm.x,beams[0].position_mm.y,beams[0].position_mm.z],rotatedMin);
 const beamBTranslation=subtract([beams[1].position_mm.x,beams[1].position_mm.y,beams[1].position_mm.z],rotatedMin);
 const worldHoleA=add(beamATranslation,transform(beamRotation,centreHole.position_mm));
 const pinPlacementTranslation=subtract(worldHoleA,transform(pinRotation,pinA.position_mm));
 const instances=[
  {instance_id:"beam-a",part_id:beamPart.part_id},
  {instance_id:"beam-b",part_id:beamPartB.part_id},
  {instance_id:"pin",part_id:pinPart.part_id}
 ];
 const placements={
  "beam-a":{matrix:beamRotation,translation_mm:beamATranslation},
  "beam-b":{matrix:beamRotation,translation_mm:beamBTranslation},
  pin:{matrix:pinRotation,translation_mm:pinPlacementTranslation}
 };
 const interfaces=interfacesForPartInstances(partCatalogue,instances);
 const matches=matchAssemblyConnectors(interfaces,connectorCatalogue.rules,placements);
 if(matches.length<2)return {status:"blocked",design_id:spec.design_id,failures:["The selected pin and two beams did not produce two nominal coaxial connector matches."],warnings:[],parts:[],connections:[],diagnostics:{matches}};
 const parts=instances.map(instance=>{
  const placement=placements[instance.instance_id];
  return {instance_id:instance.instance_id,component_id:instance.instance_id==="pin"?"connector-pin":instance.instance_id==="beam-a"?beams[0].id:beams[1].id,part_id:instance.part_id,colour:7,matrix:placement.matrix,translation_mm:placement.translation_mm,translation_ldu:toLDrawTranslation(placement.translation_mm)};
 });
 const connections=matches.map(match=>({from:match.instance_male,to:match.instance_female,connector_type:"technic_friction_pin",rule_id:match.rule_id,centre_offset_mm:match.centre_offset_mm,axis_alignment_cosine:match.axis_alignment_cosine,diameter_delta_mm:match.diameter_delta_mm,physical_connection_verified:false}));
 const connected=new Set(parts.map(part=>part.instance_id));
 const adjacency=new Map(parts.map(part=>[part.instance_id,new Set()]));
 for(const edge of connections){adjacency.get(edge.from)?.add(edge.to);adjacency.get(edge.to)?.add(edge.from);}
 const visited=new Set(),queue=[parts[0].instance_id];while(queue.length){const id=queue.shift();if(visited.has(id))continue;visited.add(id);for(const next of adjacency.get(id)||[])queue.push(next);}
 const isConnected=visited.size===parts.length;
 if(!isConnected)return {status:"blocked",design_id:spec.design_id,failures:["Nominal connector graph is not fully connected."],warnings:[],parts,connections};
 const steps=[
  {step:1,title:"Place the first Technic beam",parts:["beam-a"],instruction:"Place the first beam with its pin holes facing along the joint axis"},
  {step:2,title:"Position the second beam",parts:["beam-b"],instruction:"Align the corresponding centre hole in the second beam with the first beam"},
  {step:3,title:"Insert the friction pin",parts:["pin"],instruction:"Insert the friction pin through both aligned beam holes"}
 ];
 const ldraw=["0 BrickForge Technic beam joint","0 Name: "+spec.design_id+".ldr","0 Generated from semantic design specification",...parts.map(ldrawLine),"0"];
 const warnings=["Connector alignment and nominal diameters are source-derived geometry matches only; physical friction, retention force, fatigue and structural strength have not been verified.","The joint solver currently handles a two-beam, one-friction-pin pattern; other Technic topologies fall through to the general planner."];
 return {
  status:"planned",design_id:spec.design_id,parts,connections,bom:bom(parts),instructions:steps,ldraw:ldraw.join("\n")+"\n",
  component_reports:beams.map((component,index)=>({component_id:component.id,status:"planned",selected_part_id:index===0?beamPart.part_id:beamPartB.part_id,top_candidates:beamCandidates[index].search.candidates.slice(0,4).map(candidate=>({part_id:candidate.part_id,dimension_error_mm:candidate.dimension_error_mm}))})),
  validation:{status:"passed_with_unverified_physics",connected:true,checks:[
   {id:"semantic_part_discovery",status:"passed",detail:"Beam and pin roles matched source-backed catalogue capabilities"},
   {id:"component_bounds",status:"passed",detail:"Measured part bounds preserve the requested oriented component dimensions"},
   {id:"connector_alignment",status:"passed",detail:connections.length+" nominal coaxial pin/hole interfaces matched"},
   {id:"assembly_connectivity",status:"passed",detail:"All three part instances belong to one connector graph"},
   {id:"physical_clutch_and_strength",status:"not_assessed",detail:"No physical retention or load testing has been performed"}
  ]},
  warnings
 };
}
