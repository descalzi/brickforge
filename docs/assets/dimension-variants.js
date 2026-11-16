/** Enumerate nominal structural grid sizes inside the user's per-dimension
 * allowance. Do not widen that interval or change the original specification. */
export function rectangularDimensionVariants(component,courseType='auto'){
 const t=component.fit_tolerance_mm||0,d=component.dimensions_mm;
 const grid=(value,pitch)=>{const out=[];for(let n=Math.max(1,Math.ceil((value-t-1e-7)/pitch));n<=Math.floor((value+t+1e-7)/pitch);n++)out.push(+(n*pitch).toFixed(7));return out;};
 const types=courseType==='auto'?['brick','plate']:[courseType],variants=[];
 for(const type of types)for(const width of grid(d.width,8))for(const depth of grid(d.depth,8))for(const height of grid(d.height,type==='brick'?9.6:3.2))variants.push({dimensions_mm:{width,depth,height},courseType:type,deviation_mm:{width:width-d.width,depth:depth-d.depth,height:height-d.height}});
 return variants.sort((a,b)=>Object.values(a.deviation_mm).reduce((s,v)=>s+Math.abs(v),0)-Object.values(b.deviation_mm).reduce((s,v)=>s+Math.abs(v),0)||a.dimensions_mm.width-b.dimensions_mm.width||a.dimensions_mm.depth-b.dimensions_mm.depth||a.dimensions_mm.height-b.dimensions_mm.height||a.courseType.localeCompare(b.courseType));
}
