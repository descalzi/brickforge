import { assertValidDesignSpec } from "./design-spec.js";

const LDU_TO_MM = 0.4;
const STUD_PITCH_MM = 8;
const BRICK_HEIGHT_MM = 9.6;
const PLATE_HEIGHT_MM = 3.2;
const IDENTITY = [1,0,0,0,1,0,0,0,1];
const ROTATE_Y_90 = [0,0,1,0,1,0,-1,0,0];

const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const close = (a,b,tolerance=0.1) => Math.abs(a-b) <= tolerance;
const dot = (a,b) => a.reduce((sum,value,index)=>sum+value*b[index],0);
const transform = (m,p) => [m[0]*p[0]+m[1]*p[1]+m[2]*p[2],m[3]*p[0]+m[4]*p[1]+m[5]*p[2],m[6]*p[0]+m[7]*p[1]+m[8]*p[2]];
const point = (placement, local) => transform(placement.matrix,local).map((v,i)=>v+placement.translation_ldu[i]);

function candidateProfiles(catalogue, component, courseType) {
  const allowedHeight = courseType === "plate" ? PLATE_HEIGHT_MM : BRICK_HEIGHT_MM;
  return catalogue.profiles.filter(profile =>
    close(profile.body_height_ldu * LDU_TO_MM, allowedHeight)
    && profile.features?.some(feature => feature.kind === "stud")
    && profile.features?.some(feature => feature.kind === "stud_receiver")
  ).map(profile => {
    const roleText = (component.role + " " + (component.label || "") + " " + (component.function || []).join(" ")).toLowerCase();
    const family = profile.description.toLowerCase().includes("plate") ? "plate" : "brick";
    const preferred = (component.preferred_families || []).some(value => roleText.includes(value.toLowerCase()) || family === value.toLowerCase());
    return { profile, family, preferred, area: profile.footprint_studs_x * profile.footprint_studs_z };
  }).sort((a,b) => Number(b.preferred)-Number(a.preferred) || b.area-a.area || compare(a.profile.part_id,b.profile.part_id));
}

function enumerateTilings(width, depth, candidates, maxResults, maxNodes) {
  const occupied = new Uint8Array(width*depth);
  const results = [];
  let nodes = 0;
  const placed = [];
  function visit() {
    if (++nodes > maxNodes || results.length >= maxResults) return;
    let first = -1;
    for (let i=0;i<occupied.length;i++) if (!occupied[i]) { first=i; break; }
    if (first < 0) { results.push(placed.map(item=>({...item}))); return; }
    const x=first%width, z=Math.floor(first/width);
    for (const candidate of candidates) {
      for (const rotated of [false,true]) {
        if (rotated && candidate.profile.footprint_studs_x===candidate.profile.footprint_studs_z) continue;
        const sx=rotated?candidate.profile.footprint_studs_z:candidate.profile.footprint_studs_x;
        const sz=rotated?candidate.profile.footprint_studs_x:candidate.profile.footprint_studs_z;
        if (x+sx>width || z+sz>depth) continue;
        let fits=true;
        for(let dz=0;dz<sz&&fits;dz++) for(let dx=0;dx<sx;dx++) if(occupied[(z+dz)*width+x+dx]) {fits=false;break;}
        if(!fits) continue;
        for(let dz=0;dz<sz;dz++) for(let dx=0;dx<sx;dx++) occupied[(z+dz)*width+x+dx]=1;
        placed.push({candidate,rotated,x,z,sx,sz});
        visit();
        placed.pop();
        for(let dz=0;dz<sz;dz++) for(let dx=0;dx<sx;dx++) occupied[(z+dz)*width+x+dx]=0;
        if(results.length>=maxResults||nodes>maxNodes) return;
      }
    }
  }
  visit();
  results.sort((a,b)=>a.length-b.length || a.map(p=>p.candidate.profile.part_id).join(",").localeCompare(b.map(p=>p.candidate.profile.part_id).join(",")));
  return {tilings:results,nodes};
}

function placementFor(item, component, course, colour, instanceId, courseHeightLdu) {
  const profile=item.candidate.profile;
  const matrix=item.rotated?ROTATE_Y_90:IDENTITY;
  const cx=(item.x+item.sx/2)*20;
  const cz=(item.z+item.sz/2)*20;
  const origin=component.position_mm;
  return {
    instance_id:instanceId,part_id:profile.part_id,colour_code:colour,
    matrix:[...matrix],
    translation_ldu:[
      (origin.x+cx*LDU_TO_MM)/LDU_TO_MM,
      -(origin.y/LDU_TO_MM)-course*courseHeightLdu,
      -(origin.z+cz*LDU_TO_MM)/LDU_TO_MM
    ],
    component_id:component.id,course_index:course
  };
}

function matingPairs(profileA, a, profileB, b, tolerance=0.25) {
  const candidates=[];
  for(const fa of profileA.features) for(const fb of profileB.features) {
    if(fa.kind===fb.kind) continue;
    const pa=point(a,fa.position_ldu), pb=point(b,fb.position_ldu);
    const error=Math.hypot(...pa.map((v,i)=>v-pb[i]));
    if(error>tolerance) continue;
    const aa=transform(a.matrix,fa.axis), ab=transform(b.matrix,fb.axis);
    if(dot(aa,ab)>-0.999999) continue;
    candidates.push({feature_a:fa.feature_id,feature_b:fb.feature_id,position_error_ldu:error});
  }
  candidates.sort((a,b)=>a.position_error_ldu-b.position_error_ldu||compare(a.feature_a,b.feature_a)||compare(a.feature_b,b.feature_b));
  const usedA=new Set(),usedB=new Set(),matches=[];
  for(const item of candidates) if(!usedA.has(item.feature_a)&&!usedB.has(item.feature_b)){usedA.add(item.feature_a);usedB.add(item.feature_b);matches.push(item);}
  return matches;
}

function assemble(parts, profileMap, requireConnected) {
  const connections=[];
  for(let i=0;i<parts.length;i++) for(let j=i+1;j<parts.length;j++) {
    const pairs=matingPairs(profileMap.get(parts[i].part_id),parts[i],profileMap.get(parts[j].part_id),parts[j]);
    if(pairs.length) connections.push({instance_a:parts[i].instance_id,instance_b:parts[j].instance_id,mating_pairs:pairs});
  }
  const adjacency=new Map(parts.map(part=>[part.instance_id,new Set()]));
  for(const edge of connections){adjacency.get(edge.instance_a).add(edge.instance_b);adjacency.get(edge.instance_b).add(edge.instance_a);}
  const seen=new Set();
  if(parts.length){const queue=[parts[0].instance_id];seen.add(queue[0]);while(queue.length){for(const next of adjacency.get(queue.shift()))if(!seen.has(next)){seen.add(next);queue.push(next);}}}
  const connected=seen.size===parts.length;
  if(requireConnected&&!connected) return null;
  return {connections,connected};
}

function componentCandidates(component,catalogue,options) {
  const supportedRoles = new Set(["structural","chassis","body","wall","floor","base","platform","support","beam","block","solid","roof-support"]);
  if (!supportedRoles.has(component.role.toLowerCase())) {
    return {error:"The current verified catalogue cannot yet build the semantic role \"" + component.role + "\". It contains standard brick/plate geometry, not verified wheel, window, hinge, clip or other specialised capabilities."};
  }
  if ((component.required_features || []).length) {
    return {error:"Required semantic features are not yet represented in the verified connection catalogue: " + component.required_features.join(", ") + "."};
  }
  if ((component.forbidden_features || []).length) {
    return {error:"The current catalogue cannot prove the absence of forbidden semantic features: " + component.forbidden_features.join(", ") + "."};
  }
  const width=component.dimensions_mm.width/STUD_PITCH_MM;
  const depth=component.dimensions_mm.depth/STUD_PITCH_MM;
  const height=component.dimensions_mm.height;
  const courseHeight=options.courseType==="plate"?PLATE_HEIGHT_MM:BRICK_HEIGHT_MM;
  const courses=height/courseHeight;
  if(!Number.isInteger(width)||!Number.isInteger(depth)||!Number.isInteger(courses)) {
    return {error:"Component "+component.id+" dimensions must align to 8 mm stud pitch and "+courseHeight+" mm "+options.courseType+" courses."};
  }
  const candidates=candidateProfiles(catalogue,component,options.courseType);
  if(!candidates.length) return {error:"No catalogue parts have verified nominal interfaces for the requested course type."};
  const {tilings,nodes}=enumerateTilings(width,depth,candidates,options.maxTilings,options.maxSearchNodes);
  if(!tilings.length) return {error:"No exact part tiling found for component "+component.id+" ("+width+" × "+depth+" studs)."};
  const profileMap=new Map(catalogue.profiles.map(profile=>[profile.part_id,profile]));
  const alternatives=[];
  let combinations=0;
  const chosen=[];
  function search(course) {
    if(combinations>=options.maxCombinations) return;
    if(course===courses) {
      combinations++;
      const parts=[];
      for(let level=0;level<chosen.length;level++) chosen[level].forEach((item,index)=>{
        parts.push(placementFor(item,component,level,component.colour??options.defaultColour,""+component.id+"-"+level+"-"+index,courseHeight/LDU_TO_MM));
      });
      const graph=assemble(parts,profileMap,false);
      if(!graph) return;
      const score=parts.length*1000-graph.connections.length*5-graph.connections.reduce((sum,edge)=>sum+edge.mating_pairs.length,0);
      alternatives.push({parts,graph,score,tiling:chosen.map(layer=>layer.map(item=>item.candidate.profile.part_id))});
      return;
    }
    for(const tiling of tilings) {
      chosen.push(tiling);search(course+1);chosen.pop();
      if(combinations>=options.maxCombinations) break;
    }
  }
  search(0);
  alternatives.sort((a,b)=>a.score-b.score||a.tiling.flat().join(",").localeCompare(b.tiling.flat().join(",")));
  const unique=[];
  const signatures=new Set();
  for(const alternative of alternatives) {
    const signature=alternative.parts.map(part=>[part.part_id,part.translation_ldu.join(","),part.matrix.join(",")].join("@")).sort().join("|");
    if(signatures.has(signature)) continue;
    signatures.add(signature);unique.push(alternative);
    if(unique.length>=options.maxComponentAlternatives) break;
  }
  return unique.length?{alternatives:unique,search_nodes:nodes,combinations}:{error:"No fully connected course arrangement found for component "+component.id+".",search_nodes:nodes,combinations};
}

function componentBounds(component) {
  const p=component.position_mm,d=component.dimensions_mm;
  return {min:[p.x,p.y,p.z],max:[p.x+d.width,p.y+d.height,p.z+d.depth]};
}
function overlaps(a,b) {
  return [0,1,2].every(axis=>Math.min(a.max[axis],b.max[axis])-Math.max(a.min[axis],b.min[axis])>1e-6);
}
function evaluateRelationships(spec) {
  const byId=new Map(spec.components.map(component=>[component.id,component]));
  const failures=[],warnings=[];
  for(const relation of spec.relationships) {
    const a=componentBounds(byId.get(relation.from)),b=componentBounds(byId.get(relation.to));
    const tolerance=relation.tolerance_mm??0.5;
    let passed=true;
    if(relation.type==="above") passed=a.min[1]>=b.max[1]-tolerance;
    else if(relation.type==="below") passed=a.max[1]<=b.min[1]+tolerance;
    else if(relation.type==="left_of") passed=a.max[0]<=b.min[0]+tolerance;
    else if(relation.type==="right_of") passed=a.min[0]>=b.max[0]-tolerance;
    else if(relation.type==="in_front_of") passed=a.max[2]<=b.min[2]+tolerance;
    else if(relation.type==="behind") passed=a.min[2]>=b.max[2]-tolerance;
    else if(relation.type==="aligned_with") passed=[0,1,2].some(axis=>Math.abs(a.min[axis]-b.min[axis])<=tolerance);
    else if(relation.type==="symmetric_to") passed=close(a.min[0]+a.max[0],-(b.min[0]+b.max[0]),tolerance);
    else if(relation.type==="attached_to") passed=[0,1,2].some(axis=>close(a.max[axis],b.min[axis],tolerance)||close(b.max[axis],a.min[axis],tolerance));
    if(!passed) (relation.required===false?warnings:failures).push("Relationship "+relation.type+" between "+relation.from+" and "+relation.to+" is not satisfied.");
  }
  return {failures,warnings};
}

export function planDesign(spec,catalogue,overrides={}) {
  assertValidDesignSpec(spec);
  if(spec.constraints.allow_intersections) throw new Error("allow_intersections=true is not supported by the physical assembly planner; interpenetrating part placements are never accepted.");
  if(!catalogue||catalogue.schema_version!==1||!Array.isArray(catalogue.profiles)) throw new TypeError("A version-1 connection profile catalogue is required.");
  const options={
    courseType:spec.constraints.course_type||"brick",
    maxParts:spec.constraints.max_parts||500,
    maxSearchNodes:spec.constraints.max_search_nodes||100000,
    maxTilings:overrides.maxTilings||32,
    maxCombinations:overrides.maxCombinations||20000,
    defaultColour:(spec.appearance?.preferred_colours||[4])[0],
  };
  const relationshipReport=evaluateRelationships(spec);
  if(relationshipReport.failures.length) return {status:"blocked",design_id:spec.design_id,failures:relationshipReport.failures,warnings:relationshipReport.warnings,parts:[],connections:[],component_reports:[]};
  if(!spec.constraints.allow_intersections) {
    for(let i=0;i<spec.components.length;i++) for(let j=i+1;j<spec.components.length;j++) {
      if(overlaps(componentBounds(spec.components[i]),componentBounds(spec.components[j]))) {
        return {status:"blocked",design_id:spec.design_id,failures:["Semantic components "+spec.components[i].id+" and "+spec.components[j].id+" overlap in their specified volumes."],warnings:[],parts:[],connections:[],component_reports:[]};
      }
    }
  }
  options.maxComponentAlternatives=overrides.maxComponentAlternatives||12;
  options.maxGlobalCombinations=overrides.maxGlobalCombinations||5000;
  const profileMap=new Map(catalogue.profiles.map(profile=>[profile.part_id,profile]));
  const componentReports=[],candidateSets=[];
  for(const component of spec.components) {
    const result=componentCandidates(component,catalogue,options);
    if(result.error) return {status:"blocked",design_id:spec.design_id,failures:[result.error],warnings:[],parts:[],connections:[],component_reports:[{component_id:component.id,status:"blocked",reason:result.error}]};
    candidateSets.push(result.alternatives);
    componentReports.push({component_id:component.id,status:"planned",candidate_layouts:result.alternatives.length,search_nodes:result.search_nodes,combinations_examined:result.combinations});
  }
  let best=null,globalCombinations=0;
  const chosen=[];
  function chooseComponent(index) {
    if(globalCombinations>=options.maxGlobalCombinations)return;
    if(index===candidateSets.length) {
      globalCombinations++;
      const parts=chosen.flatMap(item=>item.parts);
      if(parts.length>options.maxParts)return;
      const graph=assemble(parts,profileMap,spec.constraints.require_connected);
      if(!graph)return;
      const score=parts.length*1000-graph.connections.length*5-graph.connections.reduce((sum,edge)=>sum+edge.mating_pairs.length,0);
      if(!best||score<best.score)best={parts,graph,score,chosen:chosen.map(item=>item.tiling)};
      return;
    }
    for(const candidate of candidateSets[index]) {
      chosen.push(candidate);chooseComponent(index+1);chosen.pop();
      if(globalCombinations>=options.maxGlobalCombinations)break;
    }
  }
  chooseComponent(0);
  if(!best) return {status:"blocked",design_id:spec.design_id,failures:["No globally connected arrangement satisfies the complete design and part budget."],warnings:[],parts:[],connections:[],component_reports:componentReports};
  const parts=best.parts,graph=best.graph;
  componentReports.forEach((report,index)=>{report.selected_course_layouts=best.chosen[index];});
  if(parts.length>options.maxParts) return {status:"blocked",design_id:spec.design_id,failures:["The plan exceeds the max_parts constraint."],warnings:[],parts:[],connections:[],component_reports:componentReports};
  const bomMap=new Map();
  for(const part of parts){const key=part.part_id+"|"+part.colour_code;bomMap.set(key,(bomMap.get(key)||0)+1);}
  const bom={schema_version:1,items:[...bomMap].map(([key,quantity])=>{const [part_id,colour]=key.split("|");return {part_id,colour_code:Number(colour),quantity};}).sort((a,b)=>compare(a.part_id,b.part_id)||a.colour_code-b.colour_code)};
  const ldraw=["0 "+(spec.name||spec.design_id),"0 Name: "+spec.design_id,"0 BrickForge deterministic design planner"];
  for(const part of parts) ldraw.push("1 "+part.colour_code+" "+part.translation_ldu.join(" ")+" "+part.matrix.join(" ")+" "+part.part_id+".dat");
  const warnings=[...new Set([...(catalogue.limitations||[]),...relationshipReport.warnings])];
  if(spec.components.some(component=>(component.function||[]).length)) warnings.push("Component function annotations are retained as design intent but are not yet physically simulated or verified.");
  if(spec.components.some(component=>component.priority!=="essential")) warnings.push("Component priority is descriptive in v1; all listed components are currently treated as required.");
  if(spec.appearance?.symmetry&&spec.appearance.symmetry!=="none") warnings.push("The requested global symmetry is not yet an optimisation constraint and has not been verified.");
  warnings.push("Connection edges represent nominal stud/receiver datum alignment only; clutch force, stability and structural strength are not verified.");
  const validation={checks:[
    {id:"design_spec",status:"passed",detail:"The catalogue-independent design specification is valid."},
    {id:"part_catalogue_coverage",status:"passed",detail:"Every placed part has a source profile in the supplied catalogue."},
    {id:"semantic_relationships",status:"passed",detail:"All required spatial relationships in the design specification are satisfied."},
    {id:"component_intersections",status:"passed",detail:"Semantic component volumes do not overlap."},
    {id:"exact_course_tiling",status:"passed",detail:"Every component course is exactly covered by non-overlapping catalogue footprints."},
    {id:"nominal_connection_alignment",status:"passed",detail:"Every graph edge has opposing, position-matched stud/receiver datums."},
    {id:"graph_connectivity",status:graph.connected?"passed":"failed",detail:graph.connected?"All part instances belong to one connected graph.":"The assembly contains disconnected components."},
    {id:"physical_clutch_strength",status:"not_assessed",detail:"The available catalogue contains nominal datums, not measured clutch geometry or force."},
    {id:"structural_stability",status:"not_assessed",detail:"No load, bending, tipping or material model is available."}
  ]};
  return {status:"planned",design_id:spec.design_id,parts,connections:graph.connections,total_mating_pairs:graph.connections.reduce((sum,edge)=>sum+edge.mating_pairs.length,0),bom,ldraw:ldraw.join("\n")+"\n",component_reports:componentReports,validation,warnings,dimensions_mm:designBounds(spec)};
}

function designBounds(spec) {
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const c of spec.components) {
    const p=c.position_mm,d=c.dimensions_mm;
    const lo=[p.x,p.y,p.z],hi=[p.x+d.width,p.y+d.height,p.z+d.depth];
    for(let i=0;i<3;i++){min[i]=Math.min(min[i],lo[i]);max[i]=Math.max(max[i],hi[i]);}
  }
  return {width:max[0]-min[0],height:max[1]-min[1],depth:max[2]-min[2]};
}
