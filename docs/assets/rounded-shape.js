/** A rounded volume may use a stepped structural approximation only when the
 * brief explicitly allows shape error. Every kept cell fits the outer radius;
 * every cell touching the required inner core is kept, except declared voids.
 * This is not a smooth source-curve match or a bounding-box substitution. */
export function roundedShapeOccupancy(component,negativeSpaces=[],courseType='auto'){
 if(!['sphere','cylinder'].includes(component.geometry)||!(component.shape_tolerance_mm>0))return null;
 if(component.orientation)return {error:'Stepped rounded composition has no source-level semantic orientation frame.'};
 const unsupported=(component.required_features||[]).filter(f=>!['solid_volume','stud_connectable'].includes(f));if(unsupported.length)return {error:'Stepped rounded composition cannot certify required source features: '+unsupported.join(', ')+'.'};
 const step=courseType==='brick'?9.6:3.2,size=[component.dimensions_mm.width,component.dimensions_mm.height,component.dimensions_mm.depth],pitch=[8,step,8],counts=size.map((v,i)=>Math.round(v/pitch[i]));
 if(counts.some((n,i)=>n<1||Math.abs(n*pitch[i]-size[i])>1e-6))return {error:'Rounded composition bounds must align to the selected stud/course grid.'};
 if(counts.reduce((p,n)=>p*n,1)>32768)return {error:'Rounded composition exceeds the 32768-cell browser envelope.',approximation:{budget_exhausted:true}};
 const tolerance=component.shape_tolerance_mm,radius=component.geometry==='sphere'?component.geometry_parameters.radius_mm:component.geometry_parameters.diameter_mm/2,axial=component.geometry==='cylinder'?['x','y','z'].indexOf(component.geometry_parameters.axis):-1,radial=[0,1,2].filter(i=>i!==axial),origin=[component.position_mm.x,component.position_mm.y,component.position_mm.z],centre=size.map(v=>v/2),boxes=negativeSpaces.map(s=>({min:[s.position_mm.x,s.position_mm.y,s.position_mm.z],max:[s.position_mm.x+s.dimensions_mm.width,s.position_mm.y+s.dimensions_mm.height,s.position_mm.z+s.dimensions_mm.depth]}));
 if(tolerance>=radius)return {error:'Shape tolerance must remain below the rounded radius so the requested form retains a non-empty inner core.'};
 const excludedByCourse=Array.from({length:counts[1]},()=>[]),occupied=[],min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let outerError=0,innerError=0,voidCells=0;
 for(let y=0;y<counts[1];y++)for(let z=0;z<counts[2];z++)for(let x=0;x<counts[0];x++){
  const grid=[x,y,z],lo=grid.map((v,i)=>v*pitch[i]),hi=lo.map((v,i)=>v+pitch[i]),near=Math.sqrt(radial.reduce((s,i)=>s+Math.max(lo[i]-centre[i],centre[i]-hi[i],0)**2,0)),far=Math.sqrt(radial.reduce((s,i)=>s+Math.max(Math.abs(lo[i]-centre[i]),Math.abs(hi[i]-centre[i]))**2,0)),middle=Math.sqrt(radial.reduce((s,i)=>s+((lo[i]+hi[i])/2-centre[i])**2,0)),worldLo=lo.map((v,i)=>v+origin[i]),worldHi=hi.map((v,i)=>v+origin[i]);
  const touching=boxes.filter(b=>[0,1,2].every(i=>Math.min(worldHi[i],b.max[i])-Math.max(worldLo[i],b.min[i])>1e-6)),voided=touching.some(b=>[0,1,2].every(i=>b.min[i]<=worldLo[i]+1e-6&&b.max[i]>=worldHi[i]-1e-6)),core=near<radius-tolerance-1e-6,allowed=far<=radius+tolerance+1e-6;
  if(core&&!allowed&&!voided)return {error:'The selected part grid cannot preserve the rounded inner core and outer shape tolerance simultaneously.'};
  let keep=!voided&&allowed&&(core||middle<=radius+1e-6);
  if(keep&&touching.length)return {error:'A declared empty space cuts a partial rounded-composition cell; adjust the void to the stud/course grid.'};
  if(keep){occupied.push([x,y,z]);outerError=Math.max(outerError,far-radius);for(let i=0;i<3;i++){min[i]=Math.min(min[i],lo[i]);max[i]=Math.max(max[i],hi[i]);}}
  else{excludedByCourse[y].push(z*counts[0]+x);if(voided)voidCells++;else innerError=Math.max(innerError,radius-near);}
 }
 if(!occupied.length)return {error:'The rounded target contains no remaining material on the part grid.'};
 if(!negativeSpaces.length&&min.some((v,i)=>Math.abs(v)>1e-6||Math.abs(max[i]-size[i])>1e-6))return {error:'The rounded grid loses the requested external bounds; a larger scale or a different part grid is needed.'};
 if(occupied.length===counts.reduce((p,n)=>p*n,1))return {error:'The selected grid erases the rounded silhouette into a full box; a larger scale or dedicated curved parts are needed.'};
 const approximation={method:'bounded_rounded_cell_cover',requested_shape:component.geometry,shape_tolerance_mm:tolerance,outer_excess_bound_mm:Math.max(0,outerError),inner_missing_band_bound_mm:Math.max(0,innerError),inner_core_radius_mm:radius-tolerance,outer_radius_mm:radius+tolerance,occupied_cells:occupied.length,grid_mm:{x:8,y:step,z:8},declared_void_cells:voidCells,budget_exhausted:false,limitations:['Stepped structural approximation within explicit radial inner/outer bounds, excluding declared empty spaces. Smooth curved source surfaces, studs, clutch and physical stability are not certified.']};
 if(approximation.outer_excess_bound_mm>tolerance+1e-6||approximation.inner_missing_band_bound_mm>tolerance+1e-6)return {error:'Rounded material exceeds its declared shape-error bounds.',approximation};
 return {component:{...component,role:'structural',geometry:'rectangular_prism',geometry_parameters:undefined,orientation:undefined,shape_tolerance_mm:undefined,fit_tolerance_mm:undefined},occupancy:{excludedByCourse},courseType:step===3.2?'plate':'brick',approximation};
}
