import { transformVector } from './specialist-placement.js?v=b6ebc6c828d2';
export function partBodyBounds(part,profile){
 const vertices=profile.body_vertices_mm||[-1,1].flatMap(x=>[0,profile.body_height_ldu*.4].flatMap(y=>[-1,1].map(z=>[x*profile.footprint_studs_x*4,y,z*profile.footprint_studs_z*4])));
 const points=vertices.map(p=>transformVector(part.matrix,p).map((v,i)=>(v+part.translation_ldu[i]*.4)*(i===0?1:-1)));
 return {min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i])))};
}
export const bodiesOverlap=(a,b)=>[0,1,2].every(i=>Math.min(a.max[i],b.max[i])-Math.max(a.min[i],b.min[i])>1e-5);
const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
function hull(points){const p=[...new Map(points.map(p=>[p.join(','),p])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const half=ps=>{const h=[];for(const v of ps){while(h.length>1&&cross(h.at(-2),h.at(-1),v)<=0)h.pop();h.push(v);}return h.slice(0,-1);};return [...half(p),...half([...p].reverse())];}
export function analyzeAssembly(parts,connections,profiles){
 const bounds=new Map(parts.map(p=>[p.instance_id,partBodyBounds(p,profiles.get(p.part_id))]));
 const collisions=[],coupled=new Set(connections.filter(e=>e.mating_pairs?.some(p=>p.connection_type==='rim_tyre_seat')).map(e=>[e.instance_a,e.instance_b].sort().join('|')));
 for(let i=0;i<parts.length;i++)for(let j=i+1;j<parts.length;j++)if(bodiesOverlap(bounds.get(parts[i].instance_id),bounds.get(parts[j].instance_id))&&!coupled.has([parts[i].instance_id,parts[j].instance_id].sort().join('|')))collisions.push([parts[i].instance_id,parts[j].instance_id]);
 const floor=Math.min(...[...bounds.values()].map(b=>b.min[1])),contacts=[];
 for(const p of parts){const b=bounds.get(p.instance_id);if(Math.abs(b.min[1]-floor)>.1)continue;const profile=profiles.get(p.part_id),axis=profile.cylinder_axis_ldraw&&['x','y','z'].indexOf(profile.cylinder_axis_ldraw);let horizontal=-1;if(typeof axis==='number')for(const i of [0,2])if(Math.abs(p.matrix[i*3+axis])===1)horizontal=i;
  if(horizontal<0)for(const x of [b.min[0],b.max[0]])for(const z of [b.min[2],b.max[2]])contacts.push([x,z]);
  else for(const end of [b.min[horizontal],b.max[horizontal]])contacts.push(horizontal===0?[end,(b.min[2]+b.max[2])/2]:[(b.min[0]+b.max[0])/2,end]);
 }
 const supportHull=hull(contacts);let volume=0,centre=[0,0,0];
 for(const b of bounds.values()){const v=b.max.reduce((p,x,i)=>p*(x-b.min[i]),1);volume+=v;centre=centre.map((n,i)=>n+v*(b.max[i]+b.min[i])/2);}
 centre=centre.map(n=>n/(volume||1));const inside=supportHull.length>=3&&supportHull.every((p,i)=>cross(p,supportHull[(i+1)%supportHull.length],[centre[0],centre[2]])>=-1e-5);
 const min=[0,1,2].map(i=>Math.min(...[...bounds.values()].map(b=>b.min[i]))),max=[0,1,2].map(i=>Math.max(...[...bounds.values()].map(b=>b.max[i])));
 return {nominal_dimensions_mm:{width:max[0]-min[0],height:max[1]-min[1],depth:max[2]-min[2]},body_envelope_collisions:collisions,support:{floor_mm:floor,contact_hull_xz_mm:supportHull,uniform_envelope_volume_centre_mm:centre,projection_inside_support_hull:inside,evidence:'Bounding-volume, uniform-density proxy only; hollow parts, material density, bending, clutch and intermediate build steps are not simulated.'}};
}
export function clearApproach(part,built,partsById,connections,profiles){
 const b=partBodyBounds(part,profiles.get(part.part_id)),directions=[];
 for(const e of connections){const isA=e.instance_a===part.instance_id,isB=e.instance_b===part.instance_id;if(!isA&&!isB)continue;const other=isA?e.instance_b:e.instance_a;if(!built.has(other))continue;
  for(const match of e.mating_pairs||[]){const id=isA?match.feature_a:match.feature_b,f=profiles.get(part.part_id).features.find(f=>f.feature_id===id);if(!f)continue;
   const axis=transformVector(part.matrix,f.axis).map((v,i)=>-v*(i===0?1:-1));directions.push(axis);if(match.connection_type==='rim_tyre_seat')directions.push(axis.map(v=>-v));
  }
 }
 for(const direction of directions){const sweep={min:[...b.min],max:[...b.max]},axis=direction.findIndex(v=>Math.abs(v)>.999);if(axis<0)continue;const length=Math.max(1,...[...built].map(id=>{const other=partBodyBounds(partsById.get(id),profiles.get(partsById.get(id).part_id));return Math.max(Math.abs(other.min[axis]-b.max[axis]),Math.abs(other.max[axis]-b.min[axis]));}))+1;if(direction[axis]>0)sweep.max[axis]+=length;else sweep.min[axis]-=length;
  const clear=[...built].every(id=>{
   const exempt=connections.some(e=>new Set([e.instance_a,e.instance_b]).has(id)&&new Set([e.instance_a,e.instance_b]).has(part.instance_id)&&e.mating_pairs?.some(m=>m.connection_type==='rim_tyre_seat'));
   return exempt||!bodiesOverlap(sweep,partBodyBounds(partsById.get(id),profiles.get(partsById.get(id).part_id)));
  });if(clear)return {clear:true,direction};
 }
 return {clear:built.size===0,direction:null};
}
