import { clearApproach } from "./assembly-analysis.js?v=68f40f52a849";
/** A connected nominal assembly sequence. This is deliberately not described
 * as a collision-free insertion path or a structural buildability proof. */
export function createAssemblyInstructions(parts,connections,profiles) {
 const partsById=new Map(parts.map(p=>[p.instance_id,p]));
 const adjacency=new Map(parts.map(p=>[p.instance_id,new Set()]));
 for(const edge of connections){const a=edge.instance_a??edge.from,b=edge.instance_b??edge.to;adjacency.get(a)?.add(b);adjacency.get(b)?.add(a);}
 const bottom=part=>{
  const p=profiles.get(part.part_id);
  return -part.translation_ldu[1]*.4-(p?.body_height_ldu||0)*.4;
 };
 const remaining=[...parts].sort((a,b)=>bottom(a)-bottom(b)||a.instance_id.localeCompare(b.instance_id)),built=new Set(),steps=[];
 while(remaining.length){
  const connected=part=>built.size===0||[...adjacency.get(part.instance_id)].some(id=>built.has(id));
  let index=remaining.findIndex(part=>connected(part)&&clearApproach(part,built,partsById,connections,profiles).clear);
  if(index<0)index=remaining.findIndex(part=>built.size===0||[...adjacency.get(part.instance_id)].some(id=>built.has(id)));
  // An explicitly disconnected design starts another subassembly.
  const part=remaining.splice(index<0?0:index,1)[0],supports=[...adjacency.get(part.instance_id)].filter(id=>built.has(id));
  const approach=clearApproach(part,built,partsById,connections,profiles);
  steps.push({nominal_approach_clear:approach.clear,approach_direction:approach.direction,step:steps.length+1,title:part.component_id,parts:[part.instance_id],part_id:part.part_id,colour_code:part.colour_code??part.colour,connects_to:supports,instruction:supports.length?`Align ${part.part_id} with ${supports.join(', ')} at the reported nominal mating datums.`:`Start a subassembly with ${part.part_id}.`,insertion_path_verified:false});
  built.add(part.instance_id);
 }
 return {schema_version:1,evidence:'nominal_connection_graph_sequence',limitations:['Sequence follows nominal connection edges. Approach checks use body envelopes excluding studs, cavities and elastic deformation. Hand access, physical insertion, intermediate stability and retention are not verified.'],steps};
}
