const axes={x:0,y:1,z:2};
const centre=(b,i)=>(b.min[i]+b.max[i])/2;
const anchor=(b,i,name)=>name==='min'?b.min[i]:name==='max'?b.max[i]:centre(b,i);
/** Numeric layout relations propose translations, not rotations or new shapes.
 * Values are in world millimetres; results are LDraw translation deltas. */
export function layoutTranslationProposals(relationships,moving,reference,source,target){
 const proposals=[],combined=[null,null,null];let conflicting=false;
 for(const r of relationships){
  if(r.required===false||!r.axis||!((r.from===moving&&r.to===reference)||(r.to===moving&&r.from===reference)))continue;
  const axis=axes[r.axis],delta=[null,null,null],forward=r.from===moving;
  if(r.type==='aligned_with'){
   const from=forward?source:target,to=forward?target:source;
   const difference=anchor(to,axis,r.to_anchor||r.anchor||'center')+(r.offset_mm||0)-anchor(from,axis,r.from_anchor||r.anchor||'center');
   delta[axis]=difference*(forward?1:-1);
  }else if(r.type==='symmetric_to'){
   for(let i=0;i<3;i++)delta[i]=i===axis?2*(r.plane_mm??0)-centre(source,i)-centre(target,i):centre(target,i)-centre(source,i);
  }else continue;
  proposals.push(delta);
  for(let i=0;i<3;i++)if(delta[i]!==null){if(combined[i]!==null&&Math.abs(combined[i]-delta[i])>1e-6)conflicting=true;else combined[i]=delta[i];}
 }
 // Combine independent axes first so three alignment constraints do not need
 // a Cartesian product of intermediate translations to reach their intersection.
 if(!conflicting&&proposals.length>1)proposals.unshift(combined);
 return [...new Map(proposals.map(d=>{const ldu=d.map((v,i)=>v?v/.4*(i===0?1:-1):0);return [ldu.map(v=>v.toFixed(6)).join(','),ldu];})).values()];
}
