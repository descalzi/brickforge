// Nominal connection graph: which placed parts mate, stud to receiver (and the
// wheel and tyre seats), within 0.25 LDU and with opposing axes.
import {featureCompatibility, axesCompatible} from './connection-types.js?v=059b51e9d8f0';

const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
export const transformVector = (m,p) => [0,1,2].map(i=>m[i*3]*p[0]+m[i*3+1]*p[1]+m[i*3+2]*p[2]);
const transform = transformVector;
const point = (placement, local) => transform(placement.matrix,local).map((v,i)=>v+placement.translation_ldu[i]);

function matingPairs(profileA, a, profileB, b, tolerance=0.25, worldA, worldB) {
  const candidates=[];
  for(const fa of worldA) for(const fb of worldB) {
    const rule=featureCompatibility(fa,fb);if(!rule)continue;
    const pa=fa.position, pb=fb.position;
    const error=Math.hypot(...pa.map((v,i)=>v-pb[i]));
    if(error>tolerance) continue;
    const aa=fa.direction, ab=fb.direction;
    if(!axesCompatible(aa,ab,rule))continue;
    candidates.push({feature_a:fa.feature_id,feature_b:fb.feature_id,position_error_ldu:error,connection_type:rule.type,physical_connection_verified:false});
  }
  candidates.sort((a,b)=>a.position_error_ldu-b.position_error_ldu||compare(a.feature_a,b.feature_a)||compare(a.feature_b,b.feature_b));
  const usedA=new Set(),usedB=new Set(),matches=[];
  for(const item of candidates) if(!usedA.has(item.feature_a)&&!usedB.has(item.feature_b)){usedA.add(item.feature_a);usedB.add(item.feature_b);matches.push(item);}
  return matches;
}

export function connectionEdges(parts, profileMap, split = null) {
  const connections=[];
  const world=parts.map(part=>profileMap.get(part.part_id).features.map(feature=>({...feature,position:point(part,feature.position_ldu),direction:transform(part.matrix,feature.axis)})));
  const bounds=world.map(features=>({min:[0,1,2].map(axis=>Math.min(...features.map(f=>f.position[axis]))),max:[0,1,2].map(axis=>Math.max(...features.map(f=>f.position[axis])))}));
  const near=(i,j)=>![0,1,2].some(axis=>bounds[i].min[axis]>bounds[j].max[axis]+0.25 || bounds[j].min[axis]>bounds[i].max[axis]+0.25);
  if(split===null&&parts.length>300){
    // Sweep and prune on x for large assemblies; edges keep the pairwise order.
    const order=parts.map((_,i)=>i).sort((a,b)=>bounds[a].min[0]-bounds[b].min[0]),pairs=[];
    for(let s=0;s<order.length;s++)for(let t=s+1;t<order.length&&bounds[order[t]].min[0]<=bounds[order[s]].max[0]+0.25;t++){const i=Math.min(order[s],order[t]),j=Math.max(order[s],order[t]);if(near(i,j))pairs.push([i,j]);}
    pairs.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    for(const [i,j] of pairs){const found=matingPairs(profileMap.get(parts[i].part_id),parts[i],profileMap.get(parts[j].part_id),parts[j],0.25,world[i],world[j]);if(found.length)connections.push({instance_a:parts[i].instance_id,instance_b:parts[j].instance_id,mating_pairs:found});}
    return connections;
  }
  for(let i=0;i<(split??parts.length);i++) for(let j=split??(i+1);j<parts.length;j++) {
    if(!near(i,j))continue;
    const pairs=matingPairs(profileMap.get(parts[i].part_id),parts[i],profileMap.get(parts[j].part_id),parts[j],0.25,world[i],world[j]);
    if(pairs.length) connections.push({instance_a:parts[i].instance_id,instance_b:parts[j].instance_id,mating_pairs:pairs});
  }
  return connections;
}
