import { featureCompatibility, axesCompatible } from './connection-types.js?v=c37e3f51f3b7';
import { transformVector } from './specialist-placement.js?v=c37e3f51f3b7';
import { partBodyBounds, bodiesOverlap } from './assembly-analysis.js?v=c37e3f51f3b7';
/** Propagate connector-derived translations only inside explicitly uncertain
 * component positions. Orientations and geometry come from catalogue candidates;
 * no fixture or object-category recipe participates in the search. */
export function fitAttachmentPoses(spec,sets,profiles,{maxAlternatives=48,maxAttempts=100000}={}){
 const index=new Map(spec.components.map((c,i)=>[c.id,i])),relations=spec.relationships.filter(r=>r.type==='attached_to'&&r.required!==false).map(r=>[index.get(r.from),index.get(r.to)]),result=sets.map(a=>[...a]);
 let attempts=0,generated=0,budgetExhausted=false;
 const signature=c=>c.parts.map(p=>p.instance_id+':'+p.matrix.join(',')+':'+p.translation_ldu.map(v=>v.toFixed(6)).join(',')).join('|');
 const seen=result.map(cs=>new Set(cs.map(signature)));
 const worldFeatures=c=>c.parts.flatMap(p=>profiles.get(p.part_id).features.map(f=>({...f,point:transformVector(p.matrix,f.position_ldu).map((v,i)=>v+p.translation_ldu[i]),direction:transformVector(p.matrix,f.axis)})));
 const cached=new WeakMap();const features=c=>{if(!cached.has(c))cached.set(c,worldFeatures(c));return cached.get(c);};
 const keepouts=(spec.negative_spaces||[]).map(s=>({min:[s.position_mm.x,s.position_mm.y,s.position_mm.z],max:[s.position_mm.x+s.dimensions_mm.width,s.position_mm.y+s.dimensions_mm.height,s.position_mm.z+s.dimensions_mm.depth]}));
 for(let round=0;round<Math.min(8,spec.components.length);round++){
  const before=generated;
  for(const [a,b] of relations)for(const [moving,anchor] of [[a,b],[b,a]]){
   const tolerance=spec.components[moving].position_tolerance_mm||0;if(!tolerance||result[moving].length>=maxAlternatives)continue;
   candidatePairs: for(const candidate of [...result[moving]])for(const target of [...result[anchor]]){
    for(const from of features(candidate))for(const to of features(target)){
     if(attempts>=maxAttempts){budgetExhausted=true;return {sets:result,attempts,generated,budget_exhausted:budgetExhausted};}
     attempts++;const rule=featureCompatibility(from,to);if(!rule||!axesCompatible(from.direction,to.direction,rule))continue;
     const delta=to.point.map((v,i)=>v-from.point[i]),offset=delta.map((v,i)=>v+(candidate.pose_offset_ldu?.[i]||0));
     if(offset.some(v=>Math.abs(v*.4)>tolerance+1e-6))continue;
     const placed={...candidate,pose_offset_ldu:offset,parts:candidate.parts.map(p=>({...p,translation_ldu:p.translation_ldu.map((v,i)=>v+delta[i])}))};
     const key=signature(placed);if(seen[moving].has(key))continue;
     if(placed.parts.some(p=>keepouts.some(k=>bodiesOverlap(partBodyBounds(p,profiles.get(p.part_id)),k))))continue;
     seen[moving].add(key);result[moving].push(placed);generated++;
     if(result[moving].length>=maxAlternatives){budgetExhausted=true;break candidatePairs;}
    }
    if(result[moving].length>=maxAlternatives){budgetExhausted=true;break candidatePairs;}
   }
  }
  if(generated===before)break;
  if(round===Math.min(8,spec.components.length)-1)budgetExhausted=true;
 }
 return {sets:result,attempts,generated,budget_exhausted:budgetExhausted};
}
