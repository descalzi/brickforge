import { discoverPartCandidates } from './part-catalogue.js';
import { translateComponentRequirements } from './design-translation.js';

const rotations = [[1,0,0,0,1,0,0,0,1],[0,0,1,0,1,0,-1,0,0],[-1,0,0,0,1,0,0,0,-1],[0,0,-1,0,1,0,1,0,0]];
export const transformVector = (m,p) => [0,1,2].map(i=>m[i*3]*p[0]+m[i*3+1]*p[1]+m[i*3+2]*p[2]);
const semanticPoint = (m,p) => transformVector(m,p).map((v,i)=>i===0?v:-v);
const close=(a,b)=>Math.abs(a-b)<1e-5;
function hull(points) {
 const unique=[...new Map(points.map(p=>[p.join(','),p])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
 const half=values=>{const h=[];for(const p of values){while(h.length>=2&&cross(h.at(-2),h.at(-1),p)<=1e-7)h.pop();h.push(p);}return h.slice(0,-1);};
 return [...half(unique),...half([...unique].reverse())];
}
function polygonMatches(a,b) {
 // Comparing hulls must not silently fill a concave requested profile.
 const area=p=>Math.abs(p.reduce((s,v,i)=>s+v[0]*p[(i+1)%p.length][1]-v[1]*p[(i+1)%p.length][0],0))/2;
 const ah=hull(a),bh=hull(b);
 return close(area(a),area(ah))&&ah.length===bh.length&&ah.every(p=>bh.some(q=>p.every((v,i)=>close(v,q[i]))));
}
export function worldBodyBounds(part,profile) {
 const points=profile.body_vertices_mm.map(p=>semanticPoint(part.matrix,p).map((v,i)=>v+part.translation_ldu[i]*.4*(i===0?1:-1)));
 return {min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i])))};
}
const intersects=(a,b)=>[0,1,2].every(i=>Math.min(a.max[i],b.max[i])-Math.max(a.min[i],b.min[i])>1e-6);

/** Rigid placements independent of object category. Constant-section elements
 * may repeat along an extrusion, whose cross-section must match exactly. */
export function specialistComponentCandidates(component,options,partCatalogue,mapping,specialists) {
 if(!specialists?.profiles?.length)return null;
 const translated=translateComponentRequirements(component,mapping);
 if(!translated.valid)return null;
 const search=discoverPartCandidates({roles:translated.part_roles,required_capabilities:translated.required_capabilities,forbidden_capabilities:translated.forbidden_capabilities,dimensions_mm:component.dimensions_mm},partCatalogue);
 const profiles=new Map(specialists.profiles.map(p=>[p.part_id,p]));
 const candidates=search.candidates.filter(c=>profiles.get(c.part_id)?.supported_geometry.includes(component.geometry));
 if(!candidates.length)return null;
 const alternatives=[];
 for(const candidate of candidates) {
  const profile=profiles.get(candidate.part_id);
  if(!profile.supported_geometry.includes(component.geometry))continue;
  for(const [rotationIndex,matrix] of rotations.entries()) {
   const vertices=profile.body_vertices_mm.map(p=>semanticPoint(matrix,p));
   const min=[0,1,2].map(i=>Math.min(...vertices.map(p=>p[i]))),max=[0,1,2].map(i=>Math.max(...vertices.map(p=>p[i]))),size=max.map((v,i)=>v-min[i]);
   const d=component.dimensions_mm;
   if(!close(size[0],d.width)||!close(size[1],d.height))continue;
   const repeats=component.geometry==='extruded_profile'?Math.round(d.depth/size[2]):1;
   if(repeats<1||repeats>options.maxParts||!close(repeats*size[2],d.depth))continue;
   if(component.geometry==='extruded_profile') {
    const shape=component.geometry_parameters.outline_mm;
    const shapeMin=[0,1].map(i=>Math.min(...shape.map(p=>p[i])));
    if(!polygonMatches(shape.map(p=>p.map((v,i)=>v-shapeMin[i])),vertices.map(p=>[p[0]-min[0],p[1]-min[1]])))continue;
    if(!profile.extrusion_axes_ldraw?.includes(Math.abs(matrix[8])===1?'z':'x'))continue;
   }
   const parts=[];
   for(let i=0;i<repeats;i++) {
    const origin=[component.position_mm.x,component.position_mm.y,component.position_mm.z+i*size[2]];
    const translation=origin.map((v,axis)=>v-min[axis]);
    parts.push({instance_id:`${component.id}-special-${i}`,component_id:component.id,part_id:profile.part_id,colour_code:component.colour??options.defaultColour,matrix:[...matrix],translation_ldu:translation.map((v,axis)=>v/.4*(axis===0?1:-1)),course_index:0});
   }
   // Conservative envelopes; cavity-aware narrow-phase collision is pending.
   if(parts.some(part=>(options.negativeSpaces||[]).some(space=>intersects(worldBodyBounds(part,profile),{min:[space.position_mm.x,space.position_mm.y,space.position_mm.z],max:[space.position_mm.x+space.dimensions_mm.width,space.position_mm.y+space.dimensions_mm.height,space.position_mm.z+space.dimensions_mm.depth]}))))continue;
   alternatives.push({parts,score:parts.length*1000,tiling:[[...parts.map(p=>p.part_id)]],specialist:true,rotation_index:rotationIndex});
  }
 }
 if(!alternatives.length)return {error:`Measured specialist candidates exist for ${component.id} (${candidates.map(c=>c.part_id).join(', ')}), but none preserves its dimensions, cross-section, extrusion direction and empty-space constraints. No bounding-box substitution was made.`};
 return {alternatives,semantic_candidates:search.candidates,search_nodes:0,combinations:alternatives.length};
}
