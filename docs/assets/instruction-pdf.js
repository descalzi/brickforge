// Dependency-free vector PDF export: no server, external fonts or image service.
// Geometry and inventory come from the same plan as the browser workbench.
import { transformVector } from './specialist-placement.js?v=3233205dd5e1';
const palette=new Map([[0,'#26343b'],[1,'#1e5aa8'],[2,'#00852b'],[4,'#b40000'],[7,'#8a928d'],[14,'#f2cd37'],[15,'#eeeeee'],[19,'#e4cd9e'],[25,'#d66b24']]);
const clean=s=>String(s).normalize('NFKD').replace(/[^\x20-\x7e]/g,' ').replace(/[\\()]/g,'\\$&');
const n=v=>Number(v.toFixed(3));
function triangles(profile){
 if(profile.preview_triangles_mm){const a=profile.preview_triangles_mm,r=[];for(let i=0;i<a.length;i+=9)r.push([a.slice(i,i+3),a.slice(i+3,i+6),a.slice(i+6,i+9)]);return r;}
 const w=profile.footprint_studs_x*8/2,d=profile.footprint_studs_z*8/2,h=profile.body_height_ldu*.4,p=[[-w,0,-d],[w,0,-d],[w,0,d],[-w,0,d],[-w,h,-d],[w,h,-d],[w,h,d],[-w,h,d]],r=[];
 for(const ids of [[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]])r.push([p[ids[0]],p[ids[1]],p[ids[2]]],[p[ids[0]],p[ids[2]],p[ids[3]]]);
 for(const f of profile.features.filter(f=>f.kind==='stud')){const [x,y,z]=f.position_ldu.map(v=>v*.4);for(let i=0;i<12;i++){const a=i*Math.PI/6,b=(i+1)*Math.PI/6,pa=[x+2.4*Math.cos(a),y-1.6,z+2.4*Math.sin(a)],pb=[x+2.4*Math.cos(b),y-1.6,z+2.4*Math.sin(b)];r.push([[x,y-1.6,z],pa,pb],[pa,[pa[0],y,pa[2]],pb],[pb,[pa[0],y,pa[2]],[pb[0],y,pb[2]]]);}}
 return r;
}
function sceneFaces(plan,profiles){
 const faces=[];const yaw=-Math.PI+.7,pitch=.55;
 for(const part of plan.parts){const p=profiles.get(part.part_id);if(!p)throw new Error('No diagram profile for '+part.part_id);
  for(const tri of triangles(p)){
   const world=tri.map(p=>transformVector(part.matrix,p).map((v,i)=>(v+part.translation_ldu[i]*.4)*(i===0?1:-1)));
   const projected=world.map(([x,y,z])=>[x*Math.cos(yaw)+z*Math.sin(yaw),y*Math.cos(pitch)-(-x*Math.sin(yaw)+z*Math.cos(yaw))*Math.sin(pitch),y*Math.sin(pitch)+(-x*Math.sin(yaw)+z*Math.cos(yaw))*Math.cos(pitch)]);
   const a=world[1].map((v,i)=>v-world[0][i]),b=world[2].map((v,i)=>v-world[0][i]),normal=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],len=Math.hypot(...normal)||1;
   faces.push({id:part.instance_id,colour:palette.get(part.colour_code??part.colour)||'#a9b8c2',points:projected,depth:projected.reduce((s,p)=>s+p[2],0)/3,shade:.7+.3*Math.abs(normal[1])/len});
  }
 }
 return faces.sort((a,b)=>a.depth-b.depth);
}
function documentBytes(streams,font){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];const pages=[];
 if(font){
  const hex=Array.from(atob(font.font_base64),c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('')+'>';
  const fileId=objects.length+1;objects.push(`<< /Length ${hex.length} /Filter /ASCIIHexDecode >>\nstream\n${hex}\nendstream`);
  const descriptor=objects.length+1;objects.push(`<< /Type /FontDescriptor /FontName /${font.name} /Flags 32 /FontBBox [${font.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${font.ascent} /Descent ${font.descent} /CapHeight ${font.ascent} /StemV 80 /FontFile2 ${fileId} 0 R >>`);
  objects[2]=`<< /Type /Font /Subtype /TrueType /BaseFont /${font.name} /FirstChar 32 /LastChar 126 /Widths [${font.widths.join(' ')}] /Encoding /WinAnsiEncoding /FontDescriptor ${descriptor} 0 R >>`;
 }
 for(const stream of streams){const id=objects.length+1;pages.push(id);objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id+1} 0 R >>`,`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);}
 objects[1]=`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map(i=>i+' 0 R').join(' ')}] >>`;
 let pdf='%PDF-1.4\n',offsets=[0];objects.forEach((o,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});const start=pdf.length;pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(i=>String(i).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;return new TextEncoder().encode(pdf);
}
export function createInstructionPdf(plan,catalogue,spec={}){
 if(plan.status!=='planned')throw new Error('A planned assembly is required for instruction export.');
 if(plan.parts.length>120)throw new Error('PDF diagrams are limited to 120 parts. Use the full assembly report and LDraw STEP export for larger plans.');
 const steps=plan.instructions?.steps;if(!steps?.length)throw new Error('No canonical assembly sequence is available.');
 const profiles=new Map(catalogue.profiles.map(p=>[p.part_id,p])),faces=sceneFaces(plan,profiles),xs=faces.flatMap(f=>f.points.map(p=>p[0])),ys=faces.flatMap(f=>f.points.map(p=>p[1])),min=[Math.min(...xs),Math.min(...ys)],max=[Math.max(...xs),Math.max(...ys)];
 const streams=[],built=new Set();let stream='';const text=(x,y,size,value)=>`0.12 0.2 0.26 rg BT /F1 ${size} Tf ${n(x)} ${n(y)} Td (${clean(value)}) Tj ET\n`;
 const header=page=>text(36,806,16,'BRICKFORGE / '+(spec.name||plan.design_id).slice(0,58))+text(36,785,8,'Nominal geometric sequence. Real insertion, strength and stability are not certified.')+text(36,22,8,plan.design_id.slice(0,65)+'  |  '+page);
 function diagram(visible,current,x,y,w,h){const scale=Math.min((w-20)/(max[0]-min[0]||1),(h-20)/(max[1]-min[1]||1)),cx=x+w/2,cy=y+h/2;let out='';for(const f of faces){if(!visible.has(f.id))continue;const hex=current.has(f.id)?f.colour:'#c6ced2',rgb=hex.slice(1).match(/../g).map(v=>n(parseInt(v,16)/255*f.shade));out+=rgb.join(' ')+' rg\n';const ps=f.points.map(p=>[cx+(p[0]-(min[0]+max[0])/2)*scale,cy+(p[1]-(min[1]+max[1])/2)*scale]);out+=ps.map((p,i)=>`${n(p[0])} ${n(p[1])} ${i?'l':'m'}`).join(' ')+' h f\n';}return out;}
 steps.forEach((step,index)=>{
  if(index%2===0)stream=header(streams.length+1);const base=index%2===0?438:78;for(const id of step.parts)built.add(id);const part=plan.parts.find(p=>p.instance_id===step.parts[0]),component=spec.components?.find(c=>c.id===part?.component_id);
  stream+=text(36,base+308,13,`STEP ${step.step}  /  Add ${step.part_id||part?.part_id||'element'}`)+text(36,base+291,10,(component?.label||component?.id||step.title).slice(0,75));
  stream+=diagram(built,new Set(step.parts),36,base+35,523,245);
  stream+=text(36,base+20,8,'New element shown in its colour; previous elements shown in grey.')+text(36,base+7,8,step.nominal_approach_clear?'Nominal body-envelope approach is clear; check studs, clutch and hand access.':'Approach not established. Review this step before attempting a physical build.');
  if(index%2===1||index===steps.length-1)streams.push(stream);
 });
 const items=plan.bom.items||plan.bom;for(let start=0;start<items.length;start+=28){stream=header(streams.length+1)+text(36,746,18,'Parts inventory')+text(36,722,9,'Derived from the exact part instances used in the model and sequence.');items.slice(start,start+28).forEach((p,i)=>{const description=profiles.get(p.part_id)?.description||'';stream+=text(36,690-i*21,10,`${p.quantity} x ${p.part_id}  |  colour ${p.colour_code??'see model'}  |  ${description}`.slice(0,95));});stream+=text(36,88,8,'LDraw source geometry. Authors and per-file licence notices:')+text(36,73,8,'github.com/descalzi/brickforge/tree/main/docs/data/part-meshes')+text(36,58,8,'Surface transforms, triangulation and diagram projection by BrickForge.');streams.push(stream);}
 return documentBytes(streams,catalogue.pdf_font);
}
