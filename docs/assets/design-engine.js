import { assertValidDesignSpec } from "./design-spec.js?v=68f40f52a849";
import { discoverPartCandidates, validatePartCapabilityCatalogue } from "./part-catalogue.js?v=68f40f52a849";
import { translateComponentRequirements } from "./design-translation.js?v=68f40f52a849";
import { planTechnicBeamJoint } from "./technic-planner.js?v=68f40f52a849";
import { specialistComponentCandidates } from "./specialist-placement.js?v=68f40f52a849";
import { partBodyBounds, analyzeAssembly } from "./assembly-analysis.js?v=68f40f52a849";
import { createAssemblyInstructions } from "./assembly-instructions.js?v=68f40f52a849";

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

function candidateProfiles(catalogue, component, courseType, candidateIds, candidateScores) {
  const allowedHeight = courseType === "plate" ? PLATE_HEIGHT_MM : BRICK_HEIGHT_MM;
  return catalogue.profiles.filter(profile =>
    candidateIds.has(profile.part_id)
    && close(profile.body_height_ldu * LDU_TO_MM, allowedHeight)
    && profile.features?.some(feature => feature.kind === "stud")
    && profile.features?.some(feature => feature.kind === "stud_receiver")
  ).map(profile => {
    const family = profile.description.toLowerCase().includes("plate") ? "plate" : "brick";
    return { profile, family, semanticScore:candidateScores.get(profile.part_id)||0, area: profile.footprint_studs_x * profile.footprint_studs_z };
  }).sort((a,b) => b.semanticScore-a.semanticScore || b.area-a.area || compare(a.profile.part_id,b.profile.part_id));
}

function enumerateTilings(width, depth, candidates, maxResults, maxNodes, excluded = []) {
  const occupied = new Uint8Array(width*depth);
  for (const index of excluded) occupied[index] = 1;
  const results = [];
  let nodes = 0;
  const placed = [];
  const perRootBranchQuota = Math.max(1, Math.ceil(maxResults / Math.max(1, candidates.length * 2)));
  function visit(rootBranch = null, rootResultsStart = results.length) {
    if (++nodes > maxNodes || results.length >= maxResults
        || (rootBranch !== null && results.length - rootResultsStart >= perRootBranchQuota)) return;
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
        const isRootBranch = rootBranch === null;
        const nextRootBranch = isRootBranch ? candidate.profile.part_id + ":" + rotated : rootBranch;
        const resultsBeforeBranch = results.length;
        placed.push({candidate,rotated,x,z,sx,sz});
        visit(nextRootBranch, isRootBranch ? resultsBeforeBranch : rootResultsStart);
        placed.pop();
        for(let dz=0;dz<sz;dz++) for(let dx=0;dx<sx;dx++) occupied[(z+dz)*width+x+dx]=0;
        if(isRootBranch && results.length-resultsBeforeBranch>=perRootBranchQuota) continue;
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
      -(origin.y/LDU_TO_MM)-(course+1)*courseHeightLdu,
      -(origin.z+cz*LDU_TO_MM)/LDU_TO_MM
    ],
    component_id:component.id,course_index:course
  };
}

function matingPairs(profileA, a, profileB, b, tolerance=0.25, worldA, worldB) {
  const candidates=[];
  for(const fa of worldA) for(const fb of worldB) {
    const studPair=new Set([fa.kind,fb.kind]);
    const isStud=studPair.has('stud')&&studPair.has('stud_receiver');
    const isWheel=studPair.has('wheel_pin')&&studPair.has('wheel_bore');
    const isTyre=studPair.has('rim_seat')&&studPair.has('tyre_seat');
    if(!isStud&&!isWheel&&!isTyre)continue;
    const pa=fa.position, pb=fb.position;
    const error=Math.hypot(...pa.map((v,i)=>v-pb[i]));
    if(error>tolerance) continue;
    const aa=fa.direction, ab=fb.direction;
    if((isStud||isWheel)?dot(aa,ab)>-0.999999:Math.abs(dot(aa,ab))<0.999999)continue;
    candidates.push({feature_a:fa.feature_id,feature_b:fb.feature_id,position_error_ldu:error,connection_type:isStud?"stud_receiver":isWheel?"wheel_pin_bore":"rim_tyre_seat",physical_connection_verified:false});
  }
  candidates.sort((a,b)=>a.position_error_ldu-b.position_error_ldu||compare(a.feature_a,b.feature_a)||compare(a.feature_b,b.feature_b));
  const usedA=new Set(),usedB=new Set(),matches=[];
  for(const item of candidates) if(!usedA.has(item.feature_a)&&!usedB.has(item.feature_b)){usedA.add(item.feature_a);usedB.add(item.feature_b);matches.push(item);}
  return matches;
}

function assemble(parts, profileMap, requireConnected) {
  const connections=[];
  const world=parts.map(part=>profileMap.get(part.part_id).features.map(feature=>({...feature,position:point(part,feature.position_ldu),direction:transform(part.matrix,feature.axis)})));
  const bounds=world.map(features=>({min:[0,1,2].map(axis=>Math.min(...features.map(f=>f.position[axis]))),max:[0,1,2].map(axis=>Math.max(...features.map(f=>f.position[axis])))}));
  for(let i=0;i<parts.length;i++) for(let j=i+1;j<parts.length;j++) {
    if([0,1,2].some(axis=>bounds[i].min[axis]>bounds[j].max[axis]+0.25 || bounds[j].min[axis]>bounds[i].max[axis]+0.25))continue;
    const pairs=matingPairs(profileMap.get(parts[i].part_id),parts[i],profileMap.get(parts[j].part_id),parts[j],0.25,world[i],world[j]);
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

function componentCandidates(component,catalogue,options,partCatalogue,designTranslation) {
  if(options.courseType==='auto'){
    const h=component.dimensions_mm.height,t=component.fit_tolerance_mm||0;
    options={...options,courseType:Math.abs(h-Math.round(h/9.6)*9.6)<=Math.max(t,1e-6)?'brick':'plate'};
  }
  if(component.geometry==='rectangular_prism'&&component.fit_tolerance_mm){
    const t=component.fit_tolerance_mm,step=options.courseType==='plate'?3.2:9.6,original=component;
    const snap=(v,p)=>{const n=Math.round(v/p)*p;return n>0&&Math.abs(n-v)<=t+1e-6?n:v;};
    component={...original,dimensions_mm:{width:snap(original.dimensions_mm.width,8),depth:snap(original.dimensions_mm.depth,8),height:snap(original.dimensions_mm.height,step)}};
  }
  const specialised=specialistComponentCandidates(component,options,partCatalogue,designTranslation,options.specialistCatalogue);
  if(specialised)return specialised;
  const translated=translateComponentRequirements(component,designTranslation);
  if(!translated.valid)return {error:translated.errors.join(" ")};
  const requirement={
    roles:translated.part_roles,
    required_capabilities:translated.required_capabilities,
    forbidden_capabilities:translated.forbidden_capabilities,
    dimensions_mm:component.dimensions_mm
  };
  const semanticSearch=discoverPartCandidates(requirement,partCatalogue);
  if(semanticSearch.status==="no_candidates") {
    const referenceSearch=discoverPartCandidates(requirement,partCatalogue,{includeReferenceOnly:true,allowUnknownDimensions:true});
    if(referenceSearch.candidates.length) return {error:"Reference-only parts exist for semantic role "+component.role+" ("+referenceSearch.candidates.map(candidate=>candidate.part_id).join(", ")+"), but their geometry and connector interfaces are not yet measured; they cannot be placed safely."};
    return {error:"No source-backed part candidates satisfy semantic role "+component.role+(component.required_features?.length?" and required design features "+component.required_features.join(", "):"")+"."};
  }
  if(component.geometry!=="rectangular_prism") {
    const nearest=semanticSearch.candidates[0];
    const dims=value=>value?value.width+"×"+value.depth+"×"+value.height+" mm":"unknown dimensions";
    const error=nearest.dimension_error_mm===null?"":"; bounding-dimension error "+nearest.dimension_error_mm.toFixed(1)+" mm";
    return {error:"Source-backed candidates exist for "+component.role+" ("+semanticSearch.candidates.slice(0,5).map(candidate=>candidate.part_id).join(", ")+"). Nearest measured candidate "+nearest.part_id+" is "+dims(nearest.dimensions_mm)+" versus requested "+dims(component.dimensions_mm)+error+". Geometry primitive "+component.geometry+" is not yet supported by the placement solver; no rectangular-block substitution is attempted."};
  }
  const candidateIds=new Set(semanticSearch.candidates.map(candidate=>candidate.part_id));
  const candidateScores=new Map(semanticSearch.candidates.map(candidate=>[candidate.part_id,candidate.score]));
  const width=component.dimensions_mm.width/STUD_PITCH_MM;
  const depth=component.dimensions_mm.depth/STUD_PITCH_MM;
  const height=component.dimensions_mm.height;
  const courseHeight=options.courseType==="plate"?PLATE_HEIGHT_MM:BRICK_HEIGHT_MM;
  const courses=Math.round(height/courseHeight);
  if(!Number.isInteger(width)||!Number.isInteger(depth)||!close(height, courses*courseHeight, 1e-6)) {
    return {error:"Component "+component.id+" dimensions must align to 8 mm stud pitch and "+courseHeight+" mm "+options.courseType+" courses."};
  }
  if(width*depth>4096 || courses>128 || width*depth*courses>32768) return {error:"Component "+component.id+" exceeds the browser search envelope (4096 cells per course, 128 courses, 32768 cells total)."};
  const candidates=candidateProfiles(catalogue,component,options.courseType,candidateIds,candidateScores);
  if(!candidates.length) return {error:"Semantic candidates exist for "+component.role+" ("+[...candidateIds].join(", ")+"), but none has a verified course-placement connection profile in the construction catalogue."};
  const courseTilings=[];
  let nodes=0, remainingNodes=options.maxSearchNodes;
  const cached=new Map();
  for(let course=0;course<courses;course++) {
    const excluded=[];
    for(let z=0;z<depth;z++)for(let x=0;x<width;x++) {
      const cell={min:[component.position_mm.x+x*8,component.position_mm.y+course*courseHeight,component.position_mm.z+z*8],max:[component.position_mm.x+(x+1)*8,component.position_mm.y+(course+1)*courseHeight,component.position_mm.z+(z+1)*8]};
      for(const space of options.negativeSpaces) {
        const bounds=componentBounds(space);
        if(!overlaps(cell,bounds))continue;
        if(![0,1,2].every(axis=>bounds.min[axis]<=cell.min[axis]+1e-6 && bounds.max[axis]>=cell.max[axis]-1e-6))return {error:"Negative space "+space.id+" cuts a partial grid cell in component "+component.id+"; adjust its bounds to the selected stud/course grid."};
        excluded.push(z*width+x);break;
      }
    }
    const key=excluded.join(",");
    let search=cached.get(key);
    if(!search) {
      if(remainingNodes<=0)return {error:"Search node budget exhausted while tiling component "+component.id+"."};
      search=enumerateTilings(width,depth,candidates,options.maxTilings,remainingNodes,excluded);
      nodes+=search.nodes;remainingNodes-=search.nodes;cached.set(key,search);
    }
    if(!search.tilings.length)return {error:"No exact part tiling found for component "+component.id+" course "+(course+1)+" within the search budget."};
    courseTilings.push(search.tilings);
  }
  if(courseTilings.every(tilings=>tilings.every(tiling=>!tiling.length)))return {error:"Negative spaces remove the entire required component "+component.id+"."};
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
    for(const tiling of courseTilings[course]) {
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
  return unique.length?{alternatives:unique,semantic_candidates:semanticSearch.candidates,search_nodes:nodes,combinations}:{error:"No fully connected course arrangement found for component "+component.id+".",search_nodes:nodes,combinations};
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
    else if(relation.type==="attached_to") passed=true; // Verified against actual mating edges after placement, including connector spans.
    if(!passed) (relation.required===false?warnings:failures).push("Relationship "+relation.type+" between "+relation.from+" and "+relation.to+" is not satisfied.");
  }
  return {failures,warnings};
}

export function planDesign(spec,catalogue,overrides={}) {
  assertValidDesignSpec(spec);
  if(spec.constraints.allow_intersections) throw new Error("allow_intersections=true is not supported by the physical assembly planner; interpenetrating part placements are never accepted.");
  if(!catalogue||catalogue.schema_version!==1||!Array.isArray(catalogue.profiles)) throw new TypeError("A version-1 connection profile catalogue is required.");
  const partCatalogue=overrides.partCatalogue;
  const partCatalogueValidation=validatePartCapabilityCatalogue(partCatalogue);
  if(!partCatalogueValidation.valid) throw new TypeError("A valid version-1 semantic part catalogue is required: "+partCatalogueValidation.errors.join(" "));
  const designTranslation=overrides.designTranslation;
  if(!designTranslation||designTranslation.schema_version!==1) throw new TypeError("A version-1 design-to-catalogue translation map is required.");
  const options={
    courseType:spec.constraints.course_type||"auto",
    maxParts:spec.constraints.max_parts||500,
    maxSearchNodes:spec.constraints.max_search_nodes||100000,
    maxTilings:overrides.maxTilings||32,
    maxCombinations:overrides.maxCombinations||20000,
    defaultColour:(spec.appearance?.preferred_colours||[4])[0],
    negativeSpaces:spec.negative_spaces||[],
    specialistCatalogue:overrides.specialistCatalogue,
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
  const technicPlan=!(spec.negative_spaces||[]).length && planTechnicBeamJoint(spec,partCatalogue,designTranslation,overrides.connectorCatalogue);
  if(technicPlan)return technicPlan;
  options.maxComponentAlternatives=overrides.maxComponentAlternatives||12;
  options.maxGlobalCombinations=overrides.maxGlobalCombinations||5000;
  const allProfiles=[...catalogue.profiles,...(options.specialistCatalogue?.profiles||[])];
  const profileMap=new Map(allProfiles.map(profile=>[profile.part_id,profile]));
  const componentReports=[],candidateSets=[];
  for(const component of spec.components) {
    const result=componentCandidates(component,catalogue,options,partCatalogue,designTranslation);
    if(result.error) return {status:"blocked",design_id:spec.design_id,failures:[result.error],warnings:[],parts:[],connections:[],component_reports:[{component_id:component.id,status:"blocked",reason:result.error}]};
    candidateSets.push(result.alternatives);
    componentReports.push({component_id:component.id,status:"planned",semantic_candidate_count:result.semantic_candidates.length,specialist:result.alternatives.some(a=>a.specialist),top_part_candidates:result.semantic_candidates.slice(0,5).map(candidate=>({part_id:candidate.part_id,description:candidate.description,score:candidate.score,dimension_error_mm:candidate.dimension_error_mm})),candidate_layouts:result.alternatives.length,search_nodes:result.search_nodes,combinations_examined:result.combinations});
  }
  let best=null,globalCombinations=0,globalNodes=0,overBudget=false;
  const chosen=Array(candidateSets.length);
  const componentIndex=new Map(spec.components.map((c,i)=>[c.id,i]));
  const requiredAttachments=spec.relationships.filter(r=>r.type==='attached_to'&&r.required!==false).map(r=>[componentIndex.get(r.from),componentIndex.get(r.to)]);
  const degree=i=>requiredAttachments.filter(r=>r.includes(i)).length;
  const order=candidateSets.map((_,i)=>i).sort((a,b)=>degree(b)-degree(a)||candidateSets[a].length-candidateSets[b].length||a-b);
  const pairCache=new Map();
  function directConnection(a,ai,b,bi){
    const key=[a,ai,b,bi].join(':');if(pairCache.has(key))return pairCache.get(key);
    const left=candidateSets[a][ai].parts,right=candidateSets[b][bi].parts,ids=new Set(left.map(p=>p.instance_id));
    const graph=assemble([...left,...right],profileMap,false),ok=graph.connections.some(e=>ids.has(e.instance_a)!==ids.has(e.instance_b));pairCache.set(key,ok);return ok;
  }
  for(const [a,b] of requiredAttachments)if(!candidateSets[a].some((_,ai)=>candidateSets[b].some((_,bi)=>directConnection(a,ai,b,bi))))return {status:'blocked',design_id:spec.design_id,parts:[],connections:[],failures:['No candidate orientation can nominally attach '+spec.components[a].id+' to '+spec.components[b].id+'.'],warnings:[],component_reports:componentReports};
  const chosenIndices=Array(candidateSets.length).fill(-1);
  function chooseComponent(index) {
    if(globalCombinations>=options.maxGlobalCombinations||++globalNodes>options.maxSearchNodes)return;
    if(index===candidateSets.length) {
      globalCombinations++;
      const parts=chosen.flatMap(item=>item.parts);
      if(parts.length>options.maxParts){overBudget=true;return;}
      const realisedComponents=spec.components.map(c=>{
        const bs=parts.filter(p=>p.component_id===c.id).map(p=>partBodyBounds(p,profileMap.get(p.part_id)));
        const min=[0,1,2].map(i=>Math.min(...bs.map(b=>b.min[i]))),max=[0,1,2].map(i=>Math.max(...bs.map(b=>b.max[i])));
        return {...c,position_mm:{x:min[0],y:min[1],z:min[2]},dimensions_mm:{width:max[0]-min[0],height:max[1]-min[1],depth:max[2]-min[2]}};
      });
      if(evaluateRelationships({...spec,components:realisedComponents}).failures.length)return;
      const graph=assemble(parts,profileMap,spec.constraints.require_connected);
      if(!graph)return;
      const componentByInstance=new Map(parts.map(part=>[part.instance_id,part.component_id]));
      if(spec.relationships.some(relation=>relation.type==="attached_to" && relation.required!==false && !graph.connections.some(edge=>new Set([componentByInstance.get(edge.instance_a),componentByInstance.get(edge.instance_b)]).has(relation.from) && new Set([componentByInstance.get(edge.instance_a),componentByInstance.get(edge.instance_b)]).has(relation.to))))return;
      const score=parts.length*1000-graph.connections.length*5-graph.connections.reduce((sum,edge)=>sum+edge.mating_pairs.length,0);
      if(!best||score<best.score)best={parts,graph,score,chosen:chosen.map(item=>item.tiling)};
      return;
    }
    const component=order[index];
    for(const [ci,candidate] of candidateSets[component].entries()) {
      chosen[component]=candidate;chosenIndices[component]=ci;
      const compatible=requiredAttachments.every(([a,b])=>chosenIndices[a]<0||chosenIndices[b]<0||directConnection(a,chosenIndices[a],b,chosenIndices[b]));
      if(compatible)chooseComponent(index+1);
      chosenIndices[component]=-1;chosen[component]=null;
      if(globalCombinations>=options.maxGlobalCombinations||globalNodes>options.maxSearchNodes)break;
    }
  }
  chooseComponent(0);
  if(!best) return {status:"blocked",design_id:spec.design_id,failures:[overBudget?"No arrangement satisfies the max_parts budget of "+options.maxParts+".":"No globally connected arrangement satisfies the complete design."],warnings:[],parts:[],connections:[],component_reports:componentReports};
  const parts=best.parts,graph=best.graph;
  componentReports.forEach((report,index)=>{
    report.selected_course_layouts=best.chosen[index];const c=spec.components[index],bs=parts.filter(p=>p.component_id===c.id).map(p=>partBodyBounds(p,profileMap.get(p.part_id)));
    const min=[0,1,2].map(i=>Math.min(...bs.map(b=>b.min[i]))),max=[0,1,2].map(i=>Math.max(...bs.map(b=>b.max[i])));
    report.realised_dimensions_mm={width:max[0]-min[0],height:max[1]-min[1],depth:max[2]-min[2]};report.requested_dimensions_mm=c.dimensions_mm;report.allowed_deviation_mm=c.fit_tolerance_mm||0;
  });
  if(parts.length>options.maxParts) return {status:"blocked",design_id:spec.design_id,failures:["The plan exceeds the max_parts constraint."],warnings:[],parts:[],connections:[],component_reports:componentReports};
  const bomMap=new Map();
  for(const part of parts){const key=part.part_id+"|"+part.colour_code;bomMap.set(key,(bomMap.get(key)||0)+1);}
  const bom={schema_version:1,items:[...bomMap].map(([key,quantity])=>{const [part_id,colour]=key.split("|");return {part_id,colour_code:Number(colour),quantity};}).sort((a,b)=>compare(a.part_id,b.part_id)||a.colour_code-b.colour_code)};
  const ldraw=["0 "+(spec.name||spec.design_id),"0 Name: "+spec.design_id,"0 BrickForge deterministic design planner"];

  const warnings=[...new Set([...(catalogue.limitations||[]),...relationshipReport.warnings])];
  if(spec.components.some(component=>(component.function||[]).length)) warnings.push("Component function annotations are retained as design intent but are not yet physically simulated or verified.");
  if(spec.components.some(component=>component.priority!=="essential")) warnings.push("Component priority is descriptive in v1; all listed components are currently treated as required.");
  if(spec.appearance?.symmetry&&spec.appearance.symmetry!=="none") warnings.push("The requested global symmetry is not yet an optimisation constraint and has not been verified.");
  warnings.push("Connection edges represent nominal stud/receiver datum alignment only; clutch force, stability and structural strength are not verified.");
  if(options.negativeSpaces.length) warnings.push("Negative spaces are checked against nominal part bodies; stud protrusions, underside details and insertion clearances are not assessed.");
  if(componentReports.some(r=>r.specialist))warnings.push(...options.specialistCatalogue.limitations);
  const analysis=analyzeAssembly(parts,graph.connections,profileMap);
  if(analysis.body_envelope_collisions.length)return {status:'blocked',design_id:spec.design_id,parts:[],connections:[],failures:['Placed part body envelopes intersect outside a profiled rim/tyre seat.'],warnings:[],analysis};
  const instructions=createAssemblyInstructions(parts,graph.connections,profileMap);
  const partById=new Map(parts.map(part=>[part.instance_id,part]));
  for(const [index,step] of instructions.steps.entries()) {
    for(const id of step.parts){const part=partById.get(id);ldraw.push("1 "+part.colour_code+" "+part.translation_ldu.join(" ")+" "+part.matrix.join(" ")+" "+part.part_id+".dat");}
    if(index<instructions.steps.length-1)ldraw.push("0 STEP");
  }
  const validation={checks:[
    {id:'placed_body_envelopes',status:'passed',detail:'No overlaps outside explicitly matched rim/tyre seats; connector protrusions and cavity details are excluded.'},
    {id:'support_projection_proxy',status:analysis.support.projection_inside_support_hull?'passed':'not_assessed',detail:analysis.support.evidence},
    {id:'nominal_insertion_approaches',status:instructions.steps.every(s=>s.nominal_approach_clear)?'passed':'not_assessed',detail:'Straight connector-axis approaches checked against prior nominal body envelopes. Studs, cavities and deformation are excluded; this is not physical insertion certification.'},
    {id:"negative_space_body_clearance",status:"passed",detail:options.negativeSpaces.length+" rectangular keepouts preserved by exact nominal body tiling; stud protrusions and mesh-level clearance are not assessed."},
    {id:"design_spec",status:"passed",detail:"The catalogue-independent design specification is valid."},
    {id:"part_catalogue_coverage",status:"passed",detail:"Every placed part has a source profile in the supplied catalogue."},
    {id:"semantic_relationships",status:"passed",detail:"All required spatial relationships in the design specification are satisfied."},
    {id:"component_intersections",status:"passed",detail:"Semantic component volumes do not overlap."},
    {id:"exact_course_tiling",status:"passed",detail:"Rectangular components use exact course tiling; specialist components match their declared envelope or convex extruded cross-section without substitution."},
    {id:"nominal_connection_alignment",status:"passed",detail:"Graph edges match profiled stud/receiver, wheel-pin/bore or rim/tyre datums."},
    {id:"graph_connectivity",status:graph.connected?"passed":"failed",detail:graph.connected?"All part instances belong to one connected graph.":"The assembly contains disconnected components."},
    {id:"physical_clutch_strength",status:"not_assessed",detail:"The available catalogue contains nominal datums, not measured clutch geometry or force."},
    {id:"structural_stability",status:"not_assessed",detail:"No load, bending, tipping or material model is available."}
  ]};
  return {status:"planned",design_id:spec.design_id,parts,connections:graph.connections,search:{global_combinations:globalCombinations,global_nodes:globalNodes,budget_exhausted:globalNodes>options.maxSearchNodes||globalCombinations>=options.maxGlobalCombinations},total_mating_pairs:graph.connections.reduce((sum,edge)=>sum+edge.mating_pairs.length,0),bom,ldraw:ldraw.join("\n")+"\n",instructions,analysis,component_reports:componentReports,validation,warnings,dimensions_mm:designBounds(spec)};
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
