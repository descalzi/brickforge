// Software projection keeps the studio usable on browsers without WebGL.
import { colourHex as palette } from "./brick-colours.js?v=c008cadea6e8";
const ns="http://www.w3.org/2000/svg";
export function createSvgDesignViewer(viewport){
 const svg=document.createElementNS(ns,"svg");svg.setAttribute("viewBox","0 0 760 410");svg.setAttribute("role","img");svg.setAttribute("aria-label","Three-dimensional nominal brick assembly; drag to orbit");svg.style.cssText="width:100%;height:100%;touch-action:none";viewport.append(svg);
 let parts=[],profiles=new Map(),yaw=-Math.PI+.7,pitch=.55,zoom=1,selected=null,course=Infinity,centre=[0,0,0],scale=1,drag=null,stepParts=null;
 const rotate=(part,p)=>{const m=part.matrix,t=part.translation_ldu;return [m[0]*p[0]+m[1]*p[1]+m[2]*p[2]+t[0]*.4,-(m[3]*p[0]+m[4]*p[1]+m[5]*p[2]+t[1]*.4),-(m[6]*p[0]+m[7]*p[1]+m[8]*p[2]+t[2]*.4)];};
 function project(p){const [x,y,z]=p.map((v,i)=>v-centre[i]),xx=x*Math.cos(yaw)+z*Math.sin(yaw),zz=-x*Math.sin(yaw)+z*Math.cos(yaw);return [380+xx*scale*zoom,205+(-y*Math.cos(pitch)+zz*Math.sin(pitch))*scale*zoom,y*Math.sin(pitch)+zz*Math.cos(pitch)];}
 function draw(){
  svg.replaceChildren();const faces=[];svg.dataset.visibleParts=String(parts.filter(p=>(p.display_course_index??p.course_index??0)<course&&(!stepParts||stepParts.has(p.instance_id))).length);
  function face(part,points,shade){const projected=points.map(p=>project(rotate(part,p)));faces.push({part,points:projected,depth:projected.reduce((n,p)=>n+p[2],0)/projected.length,shade});}
  for(const part of parts){if((part.display_course_index??part.course_index??0)>=course||(stepParts&&!stepParts.has(part.instance_id)))continue;const p=profiles.get(part.part_id);if(!p)continue;if(p.preview_triangles_mm){
    const tri=p.preview_triangles_mm;
    for(let i=0;i<tri.length;i+=9){const points=[tri.slice(i,i+3),tri.slice(i+3,i+6),tri.slice(i+6,i+9)];
     const a=points[1].map((v,j)=>v-points[0][j]),b=points[2].map((v,j)=>v-points[0][j]),n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],len=Math.hypot(...n)||1;
     face(part,points,.72+.28*Math.abs(n[1])/len);
    }continue;
   }const w=p.footprint_studs_x*8,d=p.footprint_studs_z*8,h=p.body_height_ldu*.4,x=w/2,z=d/2;
   const points=[[-x,0,-z],[x,0,-z],[x,0,z],[-x,0,z],[-x,h,-z],[x,h,-z],[x,h,z],[-x,h,z]];
   for(const [ids,shade] of [[[0,1,2,3],1],[[4,7,6,5],.65],[[0,4,5,1],.72],[[1,5,6,2],.8],[[2,6,7,3],.86],[[3,7,4,0],.75]])face(part,ids.map(i=>points[i]),shade);
   for(let xx=0;xx<p.footprint_studs_x;xx++)for(let zz=0;zz<p.footprint_studs_z;zz++){
    const cx=(xx+.5)*8-x,cz=(zz+.5)*8-z,ring=Array.from({length:12},(_,i)=>[cx+2.4*Math.cos(i*Math.PI/6),-1.6,cz+2.4*Math.sin(i*Math.PI/6)]);
    face(part,ring,1.06);for(let i=0;i<12;i++){const a=ring[i],b=ring[(i+1)%12];face(part,[a,b,[b[0],0,b[2]],[a[0],0,a[2]]],.85);}
   }
  }
  faces.sort((a,b)=>a.depth-b.depth);
  for(const f of faces){const polygon=document.createElementNS(ns,"polygon"),colour=palette.get(f.part.colour_code??f.part.colour)||"#a9b8c2";const values=colour.slice(1).match(/../g).map(v=>Math.min(255,Math.round(parseInt(v,16)*f.shade)));polygon.setAttribute("points",f.points.map(p=>p.slice(0,2).join(",")).join(" "));polygon.setAttribute("fill",`rgb(${values.join(",")})`);polygon.setAttribute("stroke",f.part.component_id===selected?"#ed8d35":"#263d4e");polygon.setAttribute("stroke-opacity",f.part.component_id===selected?"1":".25");polygon.setAttribute("stroke-width",f.part.component_id===selected?"1.4":".5");svg.append(polygon);}
 }
 svg.addEventListener("pointerdown",e=>{drag=[e.clientX,e.clientY,yaw,pitch];svg.setPointerCapture(e.pointerId);});svg.addEventListener("pointermove",e=>{if(!drag)return;yaw=drag[2]+(e.clientX-drag[0])*.01;pitch=Math.max(-1.5,Math.min(1.5,drag[3]+(e.clientY-drag[1])*.01));draw();});svg.addEventListener("pointerup",()=>drag=null);svg.addEventListener("wheel",e=>{e.preventDefault();zoom=Math.max(.3,Math.min(4,zoom*Math.exp(-e.deltaY*.001)));draw();},{passive:false});
 return {show(plan,catalogue){parts=plan.parts;profiles=new Map(catalogue.profiles.map(p=>[p.part_id,p]));const points=[];for(const part of parts){const p=profiles.get(part.part_id);if(!p)throw new Error("No nominal display profile for "+part.part_id);if(p.body_vertices_mm){for(const vertex of p.body_vertices_mm)points.push(rotate(part,vertex));continue;}for(const x of [-p.footprint_studs_x*4,p.footprint_studs_x*4])for(const y of [0,p.body_height_ldu*.4])for(const z of [-p.footprint_studs_z*4,p.footprint_studs_z*4])points.push(rotate(part,[x,y,z]));}const min=[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),max=[0,1,2].map(i=>Math.max(...points.map(p=>p[i])));centre=min.map((v,i)=>(v+max[i])/2);scale=Math.min(540,260)/Math.max(1,Math.hypot(...max.map((v,i)=>v-min[i])));course=Infinity;stepParts=null;svg.dataset.parts=String(parts.length);draw();},clear(){parts=[];svg.replaceChildren();delete svg.dataset.parts;delete svg.dataset.visibleParts;},fit(view="iso"){yaw=view==="front"?-Math.PI:-Math.PI+.7;pitch=view==="top"?Math.PI/2:view==="front"?0:.55;zoom=1;draw();},select(id){selected=id;draw();},course(value){course=value;draw();},step(ids){stepParts=ids?new Set(ids):null;draw();}};
}
