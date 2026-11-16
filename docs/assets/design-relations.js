const coordinate={x:0,y:1,z:2};
const bounds=c=>({min:[c.position_mm.x,c.position_mm.y,c.position_mm.z],max:[c.position_mm.x+c.dimensions_mm.width,c.position_mm.y+c.dimensions_mm.height,c.position_mm.z+c.dimensions_mm.depth]});
const centre=(b,i)=>(b.min[i]+b.max[i])/2;
const anchor=(b,i,name)=>name==='min'?b.min[i]:name==='max'?b.max[i]:centre(b,i);
const close=(a,b,t)=>Math.abs(a-b)<=t+1e-7;
function mirroredOutlines(a,b,axis,plane,tolerance){
 if(a.geometry!==b.geometry)return false;
 if(['cylinder','domed_cylinder'].includes(a.geometry)&&a.geometry_parameters.axis!==b.geometry_parameters.axis)return false;
 if(a.geometry==='domed_cylinder'&&coordinate[a.geometry_parameters.axis]===axis)return false; // A dome is directional along its own axis.
 if(!['extruded_profile','planar_profile'].includes(a.geometry))return true;
 const axes=a.geometry==='planar_profile'?[0,2]:[0,1];
 function worldOutline(c){const outline=c.geometry_parameters.outline_mm,min=[0,1].map(i=>Math.min(...outline.map(p=>p[i]))),origin=[c.position_mm.x,c.position_mm.y,c.position_mm.z];return outline.map(p=>p.map((v,i)=>v-min[i]+origin[axes[i]]));}
 const pa=worldOutline(a).map(p=>p.map((v,i)=>axes[i]===axis?2*plane-v:v)),pb=worldOutline(b);
 const distance=(p,a,b)=>{const d=b.map((v,i)=>v-a[i]),n=d.reduce((s,v)=>s+v*v,0),t=n?Math.max(0,Math.min(1,p.reduce((s,v,i)=>s+(v-a[i])*d[i],0)/n)):0;return Math.hypot(...p.map((v,i)=>v-a[i]-t*d[i]));};
 const deviation=(ps,qs)=>Math.max(...ps.map(p=>Math.min(...qs.map((q,i)=>distance(p,q,qs[(i+1)%qs.length])))));
 return Math.max(deviation(pa,pb),deviation(pb,pa))<=tolerance+1e-6;
}
/** Evaluate object-layout constraints on either requested or realised geometry.
 * Connector attachment itself is checked by the planner's actual mating graph. */
export function evaluateDesignRelationships(spec){
 const byId=new Map(spec.components.map(c=>[c.id,c])),failures=[],warnings=[],checks=[];
 for(const [index,r]of spec.relationships.entries()){
  const ca=byId.get(r.from),cb=byId.get(r.to),a=bounds(ca),b=bounds(cb),t=r.tolerance_mm??.5;
  let passed=true,measured=null,expected=null;
  if(r.type==='above')passed=a.min[1]>=b.max[1]-t;
  else if(r.type==='below')passed=a.max[1]<=b.min[1]+t;
  else if(r.type==='left_of')passed=a.max[0]<=b.min[0]+t;
  else if(r.type==='right_of')passed=a.min[0]>=b.max[0]-t;
  else if(r.type==='in_front_of')passed=a.max[2]<=b.min[2]+t;
  else if(r.type==='behind')passed=a.min[2]>=b.max[2]-t;
  else if(r.type==='dimension_ratio'){
   measured=ca.dimensions_mm[r.from_axis];expected=cb.dimensions_mm[r.to_axis]*r.ratio;passed=close(measured,expected,t);
  }else if(r.type==='aligned_with'){
   if(r.axis){const i=coordinate[r.axis];measured=anchor(a,i,r.from_anchor||r.anchor||'center');expected=anchor(b,i,r.to_anchor||r.anchor||'center')+(r.offset_mm||0);passed=close(measured,expected,t);}
   else {passed=[0,1,2].some(i=>close(a.min[i],b.min[i],t));warnings.push('Alignment '+r.from+' / '+r.to+' uses the legacy shared-edge rule; specify axis and anchors for a precise constraint.');}
  }else if(r.type==='symmetric_to'){
   if(r.axis){const i=coordinate[r.axis],plane=r.plane_mm??0;measured=centre(a,i)+centre(b,i);expected=2*plane;
    passed=close(measured,expected,t)&&[0,1,2].every(j=>close(a.max[j]-a.min[j],b.max[j]-b.min[j],t))&&[0,1,2].filter(j=>j!==i).every(j=>close(centre(a,j),centre(b,j),t))&&mirroredOutlines(ca,cb,i,plane,t);
   }else {passed=close(a.min[0]+a.max[0],-(b.min[0]+b.max[0]),t);warnings.push('Symmetry '+r.from+' / '+r.to+' uses the legacy X-coordinate rule; specify axis and mirror plane to verify shape and layout.');}
  }
  const label=r.type==='dimension_ratio'?`${ca.label||ca.id} ${r.from_axis} = ${r.ratio} × ${cb.label||cb.id} ${r.to_axis}`:`${r.type.replaceAll('_',' ')}: ${ca.label||ca.id} / ${cb.label||cb.id}`;
  checks.push({id:r.id||'relation-'+index,type:r.type,from:r.from,to:r.to,required:r.required!==false,status:r.type==='attached_to'?'graph_checked':passed?'passed':r.required===false?'warning':'failed',detail:label,measured_mm:measured,expected_mm:expected,tolerance_mm:t});
  if(!passed)(r.required===false?warnings:failures).push('Relationship '+r.type+' between '+r.from+' and '+r.to+' is not satisfied.');
 }
 return {failures,warnings,checks};
}
