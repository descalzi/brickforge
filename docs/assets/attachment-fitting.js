import {nominalBodyIntersectsBox} from './nominal-collision.js?v=1dc028710f7c';
import { layoutTranslationProposals } from './layout-fitting.js?v=1dc028710f7c';
import { featureCompatibility, axesCompatible } from './connection-types.js?v=1dc028710f7c';
import { transformVector } from './specialist-placement.js?v=1dc028710f7c';
import { partBodyBounds } from './assembly-analysis.js?v=1dc028710f7c';
/** Propagate relation- and connector-derived translations only inside explicitly uncertain
 * component positions. Orientations and geometry come from catalogue candidates;
 * no fixture or object-category recipe participates in the search. */
export function fitAttachmentPoses(spec,sets,profiles,{maxAlternatives=48,maxAttempts=100000}={}){
 const index=new Map(spec.components.map((c,i)=>[c.id,i])),relations=spec.relationships.filter(r=>r.type==='attached_to'&&r.required!==false).map(r=>[index.get(r.from),index.get(r.to)]),result=sets.map(a=>[...a]);
 let attempts=0,generated=0,layoutGenerated=0,budgetExhausted=false;
 const signature=c=>c.parts.map(p=>p.instance_id+':'+p.matrix.join(',')+':'+p.translation_ldu.map(v=>v.toFixed(6)).join(',')).join('|');
 const seen=result.map(cs=>new Set(cs.map(signature)));
 const worldFeatures=c=>c.parts.flatMap(p=>profiles.get(p.part_id).features.map(f=>({...f,point:transformVector(p.matrix,f.position_ldu).map((v,i)=>v+p.translation_ldu[i]),direction:transformVector(p.matrix,f.axis)})));
 const cached=new WeakMap();const features=c=>{if(!cached.has(c))cached.set(c,worldFeatures(c));return cached.get(c);};
 const keepouts=(spec.negative_spaces||[]).map(s=>({min:[s.position_mm.x,s.position_mm.y,s.position_mm.z],max:[s.position_mm.x+s.dimensions_mm.width,s.position_mm.y+s.dimensions_mm.height,s.position_mm.z+s.dimensions_mm.depth]}));
 const resultReport=()=>({sets:result,attempts,generated,layout_generated:layoutGenerated,budget_exhausted:budgetExhausted});
 const insert=(moving,candidate,delta)=>{
  const tolerance=spec.components[moving].position_tolerance_mm||0,offset=delta.map((v,i)=>v+(candidate.pose_offset_ldu?.[i]||0));
  if(!tolerance||offset.some(v=>Math.abs(v*.4)>tolerance+1e-6))return false;
  const placed={...candidate,pose_offset_ldu:offset,parts:candidate.parts.map(p=>({...p,translation_ldu:p.translation_ldu.map((v,i)=>v+delta[i])}))};
  const key=signature(placed);if(seen[moving].has(key))return false;
  if(placed.parts.some(p=>keepouts.some(k=>nominalBodyIntersectsBox(p,profiles.get(p.part_id),k))))return false;
  seen[moving].add(key);result[moving].push(placed);generated++;return true;
 };
 const bounds=c=>{const bs=c.parts.map(p=>partBodyBounds(p,profiles.get(p.part_id)));return {min:[0,1,2].map(i=>Math.min(...bs.map(b=>b.min[i]))),max:[0,1,2].map(i=>Math.max(...bs.map(b=>b.max[i])))};};
 const layoutPairs=[...new Set(spec.relationships.filter(r=>r.required!==false&&r.axis&&['aligned_with','symmetric_to'].includes(r.type)).map(r=>[index.get(r.from),index.get(r.to)].sort((a,b)=>a-b).join(',')))].map(p=>p.split(',').map(Number));
 for(let round=0;round<Math.min(8,spec.components.length);round++){
  const before=generated;
  for(const [a,b] of layoutPairs)for(const [moving,reference] of [[a,b],[b,a]]){
   if(!spec.components[moving].position_tolerance_mm||result[moving].length>=maxAlternatives)continue;
   layoutCandidates:for(const candidate of [...result[moving]])for(const target of [...result[reference]]){
    for(const delta of layoutTranslationProposals(spec.relationships,spec.components[moving].id,spec.components[reference].id,bounds(candidate),bounds(target))){
     if(attempts>=maxAttempts){budgetExhausted=true;return resultReport();}attempts++;
     if(insert(moving,candidate,delta))layoutGenerated++;
     if(result[moving].length>=maxAlternatives){budgetExhausted=true;break layoutCandidates;}
    }
   }
  }
  for(const [a,b] of relations)for(const [moving,anchor] of [[a,b],[b,a]]){
   const tolerance=spec.components[moving].position_tolerance_mm||0;if(!tolerance||result[moving].length>=maxAlternatives)continue;
   candidatePairs: for(const candidate of [...result[moving]])for(const target of [...result[anchor]]){
    for(const from of features(candidate))for(const to of features(target)){
     if(attempts>=maxAttempts){budgetExhausted=true;return resultReport();}
     attempts++;const rule=featureCompatibility(from,to);if(!rule||!axesCompatible(from.direction,to.direction,rule))continue;
     const delta=to.point.map((v,i)=>v-from.point[i]);
     insert(moving,candidate,delta);
     if(result[moving].length>=maxAlternatives){budgetExhausted=true;break candidatePairs;}
    }
    if(result[moving].length>=maxAlternatives){budgetExhausted=true;break candidatePairs;}
   }
  }
  if(generated===before)break;
  if(round===Math.min(8,spec.components.length)-1)budgetExhausted=true;
 }
 return resultReport();
}
