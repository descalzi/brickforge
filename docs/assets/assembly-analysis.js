import {nominalBodiesIntersect,nominalBodySweepIntersects} from './nominal-collision.js?v=fc937bdf9465';
import { transformVector } from './specialist-placement.js?v=fc937bdf9465';
export function partBodyBounds(part,profile){
 const vertices=profile.body_vertices_mm||[-1,1].flatMap(x=>[0,profile.body_height_ldu*.4].flatMap(y=>[-1,1].map(z=>[x*profile.footprint_studs_x*4,y,z*profile.footprint_studs_z*4])));
 const points=vertices.map(p=>transformVector(part.matrix,p).map((v,i)=>(v+part.translation_ldu[i]*.4)*(i===0?1:-1)));
 return {min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i])))};
}
export const bodiesOverlap=(a,b)=>[0,1,2].every(i=>Math.min(a.max[i],b.max[i])-Math.max(a.min[i],b.min[i])>1e-5);
const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
function hull(points){const p=[...new Map(points.map(p=>[p.join(','),p])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const half=ps=>{const h=[];for(const v of ps){while(h.length>1&&cross(h.at(-2),h.at(-1),v)<=0)h.pop();h.push(v);}return h.slice(0,-1);};return [...half(p),...half([...p].reverse())];}
/** Incremental nominal balance proxy. Contact hull updates use only the floor
 * band and its hull vertices; adding a stage does not re-run collision analysis. */
export function createSupportTracker(profiles){
 let floor=Infinity,groups=[],supportHull=[],volume=0,weighted=[0,0,0];
 return {add(part){
  const profile=profiles.get(part.part_id),b=partBodyBounds(part,profile),v=b.max.reduce((p,x,i)=>p*(x-b.min[i]),1);volume+=v;weighted=weighted.map((n,i)=>n+v*(b.max[i]+b.min[i])/2);
  const points=[],axis=profile.cylinder_axis_ldraw&&['x','y','z'].indexOf(profile.cylinder_axis_ldraw);let horizontal=-1;
  if(typeof axis==='number')for(const i of [0,2])if(Math.abs(part.matrix[i*3+axis])===1)horizontal=i;
  if(horizontal<0)for(const x of [b.min[0],b.max[0]])for(const z of [b.min[2],b.max[2]])points.push([x,z]);
  else for(const end of [b.min[horizontal],b.max[horizontal]])points.push(horizontal===0?[end,(b.min[2]+b.max[2])/2]:[(b.min[0]+b.max[0])/2,end]);
  if(b.min[1]<floor-1e-8){floor=b.min[1];groups=groups.filter(g=>g.height-floor<=.1);groups.push({height:floor,points});supportHull=hull(groups.flatMap(g=>g.points));}
  else if(b.min[1]-floor<=.1){groups.push({height:b.min[1],points});supportHull=hull([...supportHull,...points]);}
  return this.snapshot();
 },snapshot(){const centre=weighted.map(n=>n/(volume||1)),inside=supportHull.length>=3&&supportHull.every((p,i)=>cross(p,supportHull[(i+1)%supportHull.length],[centre[0],centre[2]])>=-1e-5);return {floor_mm:floor,contact_hull_xz_mm:supportHull.map(p=>[...p]),uniform_envelope_volume_centre_mm:centre,projection_inside_support_hull:inside,evidence:'Bounding-volume, uniform-density proxy only; hollow parts, material density, bending, clutch and physical stability are not simulated.'};}};
}
export function findBodyCollisions(parts,connections,profiles,firstOnly=false){
 const collisions=[],coupled=new Set(connections.filter(e=>e.mating_pairs?.some(p=>p.connection_type==='rim_tyre_seat')).map(e=>[e.instance_a,e.instance_b].sort().join('|')));
 for(let i=0;i<parts.length;i++)for(let j=i+1;j<parts.length;j++)if(!coupled.has([parts[i].instance_id,parts[j].instance_id].sort().join('|'))&&nominalBodiesIntersect(parts[i],profiles.get(parts[i].part_id),parts[j],profiles.get(parts[j].part_id))){collisions.push([parts[i].instance_id,parts[j].instance_id]);if(firstOnly)return collisions;}
 return collisions;
}
export function analyzeAssembly(parts,connections,profiles){
 const bounds=new Map(parts.map(p=>[p.instance_id,partBodyBounds(p,profiles.get(p.part_id))])),collisions=findBodyCollisions(parts,connections,profiles);
 const tracker=createSupportTracker(profiles);for(const part of parts)tracker.add(part);const support=tracker.snapshot();
 const min=[0,1,2].map(i=>Math.min(...[...bounds.values()].map(b=>b.min[i]))),max=[0,1,2].map(i=>Math.max(...[...bounds.values()].map(b=>b.max[i])));
 return {nominal_dimensions_mm:{width:max[0]-min[0],height:max[1]-min[1],depth:max[2]-min[2]},body_envelope_collisions:collisions,support};
}
export function clearApproach(part,built,partsById,connections,profiles){
 if (!built.size) return {clear:true, direction:null, evidence:'initial_part'};
 const profile = profiles.get(part.part_id);
 const requirements = [];
 const seatPartners = new Set();
 const directions = new Map();
 for (const joint of connections) {
  const movingIsA = joint.instance_a === part.instance_id;
  if (!movingIsA && joint.instance_b !== part.instance_id) continue;
  const other = movingIsA ? joint.instance_b : joint.instance_a;
  if (!built.has(other)) continue;
  for (const pair of joint.mating_pairs || []) {
   const seat = pair.connection_type === 'rim_tyre_seat';
   if (seat) seatPartners.add(other);
   const featureId = movingIsA ? pair.feature_a : pair.feature_b;
   const feature = profile.features.find(f => f.feature_id === featureId);
   if (!feature) continue;
   const axis = transformVector(part.matrix,feature.axis).map((v,i) => (-v*(i===0?1:-1)) || 0);
   const allowed = seat ? [axis, axis.map(v => -v)] : [axis];
   requirements.push({instance_id:other, feature_id:featureId, allowed});
   for (const direction of allowed) directions.set(direction.join(','), direction);
  }
 }
 const compatible = [...directions.values()].filter(direction =>
  requirements.every(joint => joint.allowed.some(axis => axis.every((v,i) => Math.abs(v-direction[i])<1e-6)))
 );
 const moving = partBodyBounds(part,profile);
 const blockers = [];
 for (const direction of compatible) {
  const axis = direction.findIndex(v => Math.abs(v)>.999);
  if (axis<0) continue;
  let distance = 1;
  for (const id of built) {
   const other = partsById.get(id), bounds = partBodyBounds(other,profiles.get(other.part_id));
   distance = Math.max(distance, Math.abs(bounds.min[axis]-moving.max[axis]), Math.abs(bounds.max[axis]-moving.min[axis]));
  }
  const obstruction = [...built].find(id => {
   if (seatPartners.has(id)) return false;
   const other = partsById.get(id);
   return nominalBodySweepIntersects(part,profile,direction,distance+1,other,profiles.get(other.part_id));
  });
  if (obstruction === undefined) return {clear:true, direction, evidence:'continuous_nominal_body_sweep'};
  blockers.push({direction, instance_id:obstruction});
 }
 const reason = blockers.length ? 'obstructed_sweep' : !requirements.length ? 'no_profiled_joint' :
  compatible.length ? 'unsupported_sweep_axis' : 'conflicting_joint_axes';
 return {clear:false, direction:null, evidence:'no_clear_nominal_axis_sweep',
  diagnostic:{reason, joints:requirements, blockers}};
}
