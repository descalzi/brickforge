import { clearApproach,createSupportTracker,partBodyBounds } from "./assembly-analysis.js?v=7f74500584aa";
/** A connected nominal assembly sequence. This is deliberately not described
 * as a collision-free insertion path or a structural buildability proof. */
export function createAssemblyInstructions(parts,connections,profiles) {
 const supportTracker=createSupportTracker(profiles);
 const partsById=new Map(parts.map(p=>[p.instance_id,p]));
 const adjacency=new Map(parts.map(p=>[p.instance_id,new Set()]));
 for(const edge of connections){const a=edge.instance_a??edge.from,b=edge.instance_b??edge.to;adjacency.get(a)?.add(b);adjacency.get(b)?.add(a);}
 const bottom=part=>partBodyBounds(part,profiles.get(part.part_id)).min[1];
 const foundationScore=(part,floor=bottom(part))=>{const b=partBodyBounds(part,profiles.get(part.part_id)),size=b.max.map((v,i)=>v-b.min[i]),tracker=createSupportTracker(profiles),support=tracker.add(part);return support.projection_inside_support_hull?size[0]*size[2]/Math.max(size[1]+Math.max(0,b.min[1]-floor),.1):-1;};
 const remaining=[...parts].sort((a,b)=>bottom(a)-bottom(b)||a.instance_id.localeCompare(b.instance_id)),built=new Set(),steps=[];
 while(remaining.length){
  const connected=part=>built.size===0||[...adjacency.get(part.instance_id)].some(id=>built.has(id));
  const floor=built.size===0?Math.min(...remaining.map(bottom)):0;
  const foundation=built.size===0?[...remaining].sort((a,b)=>foundationScore(b,floor)-foundationScore(a,floor)||bottom(a)-bottom(b)||a.instance_id.localeCompare(b.instance_id))[0]:null;
  let index=foundation?remaining.indexOf(foundation):remaining.findIndex(part=>connected(part)&&clearApproach(part,built,partsById,connections,profiles).clear);
  if(index<0)index=remaining.findIndex(part=>built.size===0||[...adjacency.get(part.instance_id)].some(id=>built.has(id)));
  // An explicitly disconnected design starts another subassembly.
  const part=remaining.splice(index<0?0:index,1)[0],supports=[...adjacency.get(part.instance_id)].filter(id=>built.has(id));
  const approach=clearApproach(part,built,partsById,connections,profiles);
  steps.push({nominal_approach_clear:approach.clear,approach_direction:approach.direction,approach_evidence:approach.evidence,step:steps.length+1,title:part.component_id,parts:[part.instance_id],part_id:part.part_id,colour_code:part.colour_code??part.colour,connects_to:supports,instruction:supports.length?`Align ${part.part_id} with ${supports.join(', ')} at the reported nominal mating datums.`:`Start a subassembly with ${part.part_id}.`,insertion_path_verified:false});
  built.add(part.instance_id);const support=supportTracker.add(part);steps.at(-1).support_guidance={status:support.projection_inside_support_hull?'no_hold_flag':'hold_recommended',...support,physical_stability_verified:false};
 }
 return {schema_version:1,evidence:'nominal_connection_graph_sequence',foundation_selection:'Balance a broad, shallow supported nominal projection with low elevation, then follow compatible connection edges and clear nominal approaches.',limitations:['Sequence follows nominal connection edges. Continuous straight sweeps use profiled convex/compound nominal bodies, with conservative envelopes for other profiles. Studs, cavities and elastic deformation are excluded. Stage support guidance is a nominal envelope/volume proxy; no-hold flags do not certify stability. Hand access, physical insertion and retention are not verified.'],steps};
}
