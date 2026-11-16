/** Bounded cross-course combination. Rank nominal cell contacts and keep root
 * layout diversity; actual profiled connections are still checked afterwards. */
export function combineCourseTilings(courseTilings,width,depth,{maxNodes=100000,beamWidth=48}={}){
 let beam=[{plans:[],parents:[],active:[],pattern:null,count:0,contacts:0,closed:0,groups:0,root:-1}],nodes=0,pruned=false;const cache=new WeakMap();
 const pattern=tiling=>{if(cache.has(tiling))return cache.get(tiling);const cells=new Int32Array(width*depth).fill(-1);tiling.forEach((t,i)=>{for(let z=t.z;z<t.z+t.sz;z++)for(let x=t.x;x<t.x+t.sx;x++)cells[z*width+x]=i;});cache.set(tiling,cells);return cells;};
 for(const [course,tilings]of courseTilings.entries()){
  const next=[];
  for(const state of beam)for(const [index,tiling]of tilings.entries()){
   if(++nodes>maxNodes)return {states:[],nodes,budget_exhausted:true,reason:'Cross-course beam node budget reached before completing every layer.'};
   const cells=pattern(tiling),parents=[...state.parents,...tiling.map((_,i)=>state.count+i)],active=tiling.map((_,i)=>state.count+i);let contacts=state.contacts;
   const root=i=>{let r=i;while(parents[r]!==r)r=parents[r];while(parents[i]!==i){const n=parents[i];parents[i]=r;i=n;}return r;};
   if(state.pattern)for(let cell=0;cell<cells.length;cell++)if(cells[cell]>=0&&state.pattern[cell]>=0){const a=root(state.active[state.pattern[cell]]),b=root(active[cells[cell]]);if(a!==b)parents[b]=a;contacts++;}
   const roots=new Set(parents.map((_,i)=>root(i))),exposed=new Set(active.map(root)),closed=[...roots].filter(r=>!exposed.has(r)).length;
   next.push({plans:[...state.plans,tiling],parents,active,pattern:cells,count:parents.length,contacts,groups:roots.size,closed,root:course===0?index:state.root});
  }
  next.sort((a,b)=>a.closed-b.closed||a.groups-b.groups||a.count-b.count||b.contacts-a.contacts);
  const roots=new Set(next.map(s=>s.root)),quota=Math.max(1,Math.ceil(beamWidth/Math.max(1,roots.size))),counts=new Map(),selected=[],deferred=[];
  for(const s of next){const count=counts.get(s.root)||0;if(count<quota&&selected.length<beamWidth){selected.push(s);counts.set(s.root,count+1);}else deferred.push(s);}
  for(const s of deferred)if(selected.length<beamWidth)selected.push(s);
  if(next.length>selected.length)pruned=true;beam=selected;
 }
 return {states:beam,nodes,budget_exhausted:pruned,method:'contact_ranked_course_beam',beam_width:beamWidth};
}
