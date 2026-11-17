// Draft explicit changes to the object brief. The same planner must subsequently
// fit every part, cutout and attachment before Studio offers a revision.
const epsilon=1e-6;
const near=(a,b)=>Math.abs(a-b)<epsilon;
const round=value=>+value.toFixed(6);

function frameOpening(spec,frame,wall,catalogue) {
  if (wall.geometry!=='rectangular_prism' || frame.geometry!=='rectangular_prism' || frame.orientation || wall.orientation) return;
  const across=wall.dimensions_mm.width>=wall.dimensions_mm.depth?'x':'z';
  const normal=across==='x'?'z':'x';
  const span=across==='x'?'width':'depth',thickness=across==='x'?'depth':'width';
  const hostSize=wall.dimensions_mm,requested=frame.dimensions_mm;
  const sizes=catalogue.parts.filter(p=>p.candidate_status==='geometry_measured' && p.capabilities.includes('window_frame'))
    .flatMap(p=>[p.dimensions_mm,{...p.dimensions_mm,width:p.dimensions_mm.depth,depth:p.dimensions_mm.width}])
    .filter(d=>near(d[thickness],hostSize[thickness]) && Object.keys(requested).every(k=>Math.abs(d[k]-requested[k])<=3.2+epsilon))
    .sort((a,b)=>['width','height','depth'].reduce((v,k)=>v+Math.abs(a[k]-requested[k])-Math.abs(b[k]-requested[k]),0));
  if (!sizes.length) return;
  const size=sizes[0],position={...frame.position_mm};
  const course=spec.constraints.course_type==='brick'?9.6:3.2;
  position[normal]=wall.position_mm[normal];
  for (const [axis,dim,pitch] of [[across,span,8],['y','height',course]]) {
    const start=wall.position_mm[axis],room=hostSize[dim]-size[dim];
    if(room<0) return;
    const offset=Math.round((position[axis]-start)/pitch);
    position[axis]=round(start+Math.max(0,Math.min(Math.floor((room+epsilon)/pitch),offset))*pitch);
  }
  if(Object.keys(position).some(k=>Math.abs(position[k]-frame.position_mm[k])>8+epsilon)) return;
  return {size,position};
}

function ridgeOutlines(roof,profiles) {
  const g=roof.geometry_parameters,outline=g?.outline_mm;
  if (roof.geometry!=='extruded_profile'||outline?.length!==3||roof.orientation) return [];
  const ordered=[...outline].sort((a,b)=>a[0]-b[0]);
  const [[x0,y0],[xm,ym],[x1,y1]]=ordered,span=x1-x0,height=ym-y0;
  if(!near(y0,y1)||!near(xm,(x0+x1)/2)||!near(height,roof.dimensions_mm.height)||height<=0) return [];
  const length=g.extrusion_axis==='x'?roof.dimensions_mm.width:roof.dimensions_mm.depth;
  const choices=[];
  for(const profile of profiles){
    if(!profile.supported_geometry.includes('extruded_profile') || !profile.orientation_frame?.forward || !profile.extrusion_axes_ldraw?.includes('x')) continue;
    const vertices=profile.body_vertices_mm;
    const depth=Math.max(...vertices.map(p=>p[0]))-Math.min(...vertices.map(p=>p[0]));
    if(!near(length/depth,Math.round(length/depth)))continue;
    const minZ=Math.min(...vertices.map(p=>p[2])),floor=Math.max(...vertices.map(p=>p[1]));
    const top=new Map();
    for(const [,y,z] of vertices)top.set(round(z-minZ),Math.max(top.get(round(z-minZ))??-Infinity,round(floor-y)));
    let side=[...top].sort((a,b)=>a[0]-b[0]);const run=side.at(-1)[0];
    if(side[0][1]>side.at(-1)[1])side=side.reverse().map(([x,y])=>[round(run-x),y]);
    // Keep two outward-facing pitches and a central ridge. A continuous plate
    // under the pitches provides a common attachment plane across the walls.
    if (side.some((p,i)=>i && p[1]<side[i-1][1]-epsilon) || side.at(-1)[1]+3.2>height+epsilon || 2*run>=span-epsilon)continue;
    const pitch=side.map(([x,y])=>[x,round(y+3.2)]);
    const half=[...pitch,[run,height],[span/2,height]];
    const error=Math.max(...half.map(([x,y])=>Math.abs(y-2*height*x/span)));
    if(error>Math.min(6.4,height/3)+epsilon)continue;
    const right=pitch.map(([x,y])=>[round(span-x),y]);
    const shape=[[0,0],[span,0],...right,[span-run,height],[run,height],...pitch.reverse()]
      .filter((p,i,array)=>i===0||!p.every((v,k)=>near(v,array[i-1][k])))
      .map(([x,y])=>[round(x+x0),round(y+y0)]);
    if(!choices.some(c=>JSON.stringify(c.after)===JSON.stringify(shape)))choices.push({component:roof.id,field:'outline_mm',before:outline,after:shape,vertical_error_mm:round(error)});
  }
  return choices.sort((a,b)=>a.vertical_error_mm-b.vertical_error_mm);
}

export function* architecturalEdits(spec,failure,options) {
  const blocked=new Set((failure.component_reports||[]).filter(r=>r.status==='blocked').map(r=>r.component_id));
  const edits=[],openings=[...(spec.negative_spaces||[])];
  let roofs=[];
  for(const c of spec.components.filter(c=>blocked.has(c.id))){
    if(c.role==='roof'){
      if(roofs.length)return;
      roofs=ridgeOutlines(c,options.specialistCatalogue?.profiles||[]);
      if(!roofs.length)return;
    }else if(c.role==='window'){
      const joint=spec.relationships.find(r=>r.type==='attached_to'&&r.required!==false&&[r.from,r.to].includes(c.id)&&
        spec.components.some(w=>w.role==='wall' && w.id===(r.from===c.id?r.to:r.from)));
      if(!joint)return;
      const wall=spec.components.find(w=>w.id===(joint.from===c.id?joint.to:joint.from));
      const frame=frameOpening(spec,c,wall,options.partCatalogue);
      if(!frame)return;
      const id=c.id+'-opening';
      if(openings.some(s=>s.id===id)||spec.components.some(part=>part.id===id))return;
      for(const [field,value] of [['dimensions_mm',frame.size],['position_mm',frame.position]]){
        if(Object.keys(value).some(k=>!near(value[k],c[field][k])))edits.push({component:c.id,field,before:c[field],after:value});
      }
      openings.push({id,component_id:wall.id,dimensions_mm:frame.size,position_mm:frame.position});
    }else return;
  }
  if(openings.length!==(spec.negative_spaces||[]).length)edits.push({field:'negative_spaces',before:spec.negative_spaces||[],after:openings});
  if(roofs.length)for(const roof of roofs)yield [...edits,roof];
  else if(edits.length)yield edits;
}
