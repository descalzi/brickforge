import { instructionJointNote } from "./assembly-instructions.js?v=c008cadea6e8";
import {rasterizeInstructionFaces} from './instruction-rasterizer.js?v=c008cadea6e8';
// Browser-native illustrated hybrid booklet. Diagrams and inventory share the canonical plan.
import { transformVector } from './specialist-placement.js?v=c008cadea6e8';
import { BRICK_COLOURS, colourHex as palette } from './brick-colours.js?v=c008cadea6e8';
const colourNames=new Map(BRICK_COLOURS.map(c=>[c.code,c.name.replace(/\b\w/g,l=>l.toUpperCase())]));
const clean=s=>String(s).normalize('NFKD').replace(/[^\x20-\x7e]/g,' ').replace(/[\\()]/g,'\\$&');
const n=v=>Number(v.toFixed(3));
const rgb=hex=>hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255);
const mix=(colour,amount)=>colour.map(v=>v*(1-amount)+amount);
const fill=c=>c.map(n).join(' ')+' rg\n';
const stroke=(c,width=.5)=>c.map(n).join(' ')+` RG ${width} w\n`;
const ink=rgb('#20343c'),muted=rgb('#60737b'),accent=rgb('#ba4b24'),paper=rgb('#eef3f5');
const text=(x,y,size,value,colour=ink)=>fill(colour)+`BT /F1 ${size} Tf ${n(x)} ${n(y)} Td (${clean(value)}) Tj ET\n`;
const rect=(x,y,w,h,colour)=>fill(colour)+`${n(x)} ${n(y)} ${n(w)} ${n(h)} re f\n`;
const line=(a,b,colour=muted,width=.5)=>stroke(colour,width)+`${n(a[0])} ${n(a[1])} m ${n(b[0])} ${n(b[1])} l S\n`;
function wrap(value,max=65){const rows=[];let row='';for(const word of String(value).split(/\s+/)){if((row+' '+word).trim().length>max&&row){rows.push(row);row='';}row+=(row?' ':'')+word;}if(row)rows.push(row);return rows;}
function lines(x,y,size,value,max=65,colour=ink){return wrap(value,max).map((v,i)=>text(x,y-i*(size+4),size,v,colour)).join('');}
function triangles(profile){
 if(profile.preview_triangles_mm){const a=profile.preview_triangles_mm,r=[];for(let i=0;i<a.length;i+=9)r.push([a.slice(i,i+3),a.slice(i+3,i+6),a.slice(i+6,i+9)]);return r;}
 const w=profile.footprint_studs_x*8/2,d=profile.footprint_studs_z*8/2,h=profile.body_height_ldu*.4,p=[[-w,0,-d],[w,0,-d],[w,0,d],[-w,0,d],[-w,h,-d],[w,h,-d],[w,h,d],[-w,h,d]],r=[];
 for(const ids of [[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]])r.push([p[ids[0]],p[ids[1]],p[ids[2]]],[p[ids[0]],p[ids[2]],p[ids[3]]]);
 for(const f of profile.features.filter(f=>f.kind==='stud')){const [x,y,z]=f.position_ldu.map(v=>v*.4);for(let i=0;i<12;i++){const a=i*Math.PI/6,b=(i+1)*Math.PI/6,pa=[x+2.4*Math.cos(a),y-1.6,z+2.4*Math.sin(a)],pb=[x+2.4*Math.cos(b),y-1.6,z+2.4*Math.sin(b)];r.push([[x,y-1.6,z],pa,pb],[pa,[pa[0],y,pa[2]],pb],[pb,[pa[0],y,pa[2]],[pb[0],y,pb[2]]]);}}
 return r;
}
const defaultYaw=-Math.PI+.7;
export function instructionViewYaw(direction){return direction&&Math.abs(direction[1])<1e-6&&Math.hypot(direction[0],direction[2])>.999?Math.atan2(-direction[0],direction[2])+.45:defaultYaw;}
function project([x,y,z],yaw=defaultYaw){const pitch=.55;return [x*Math.cos(yaw)+z*Math.sin(yaw),y*Math.cos(pitch)-(-x*Math.sin(yaw)+z*Math.cos(yaw))*Math.sin(pitch),y*Math.sin(pitch)+(-x*Math.sin(yaw)+z*Math.cos(yaw))*Math.cos(pitch)];}
const reproject=(faces,yaw)=>faces.map(f=>({...f,points:f.world_points.map(p=>project(p,yaw))}));
function sceneFaces(plan,profiles,yaw){
 const faces=[],cache=new Map();
 for(const part of plan.parts){const profile=profiles.get(part.part_id);if(!profile)throw new Error('No diagram profile for '+part.part_id);
  if(!cache.has(profile)){
   const mesh=triangles(profile),normals=mesh.map(tri=>{const a=tri[1].map((v,i)=>v-tri[0][i]),b=tri[2].map((v,i)=>v-tri[0][i]),c=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],l=Math.hypot(...c)||1;return c.map(v=>v/l);}),edges=new Map();
   const key=(a,b)=>[a,b].map(p=>p.map(v=>v.toFixed(3)).join(',')).sort().join('|');
   mesh.forEach((tri,i)=>tri.forEach((p,j)=>{const k=key(p,tri[(j+1)%3]);if(!edges.has(k))edges.set(k,[]);edges.get(k).push(i);}));
   cache.set(profile,mesh.map((tri,i)=>({tri,edges:tri.map((p,j)=>{const neighbours=edges.get(key(p,tri[(j+1)%3]));return neighbours.length===1||neighbours.some(k=>Math.abs(normals[i].reduce((s,v,a)=>s+v*normals[k][a],0))<.72);})})));
  }
  for(const {tri,edges} of cache.get(profile)){
   const world=tri.map(p=>transformVector(part.matrix,p).map((v,i)=>(v+part.translation_ldu[i]*.4)*(i===0?1:-1))),a=world[1].map((v,i)=>v-world[0][i]),b=world[2].map((v,i)=>v-world[0][i]),normal=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],len=Math.hypot(...normal)||1;
   const lighting=.62+.25*Math.abs(normal[1])/len+.13*Math.abs(normal[0])/len;
   faces.push({id:part.instance_id,colour:rgb(palette.get(part.colour_code??part.colour)||'#a9b8c2'),world_points:world,points:world.map(p=>project(p,yaw)),shade:lighting,edges});
  }
 }
 return faces;
}
const diagramBounds=faces=>{const min=[Infinity,Infinity],max=[-Infinity,-Infinity];for(const f of faces)for(const p of f.points)for(let i=0;i<2;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}return {min,max};};
function arrow(a,b){const angle=Math.atan2(b[1]-a[1],b[0]-a[0]),tip=(theta)=>[b[0]-7*Math.cos(theta),b[1]-7*Math.sin(theta)];const l=tip(angle-.45),r=tip(angle+.45);return line(a,b,accent,1.4)+fill(accent)+`${n(b[0])} ${n(b[1])} m ${n(l[0])} ${n(l[1])} l ${n(r[0])} ${n(r[1])} l h f\n`;}
function drawDiagram(faces,visible,current,box,{bounds=diagramBounds(faces),explode=null,previousFade=.32,background=paper,yaw=defaultYaw}={},images){
 const selected=faces.filter(f=>visible.has(f.id));if(!selected.length)return '';
 const margin=explode?12:0,b={min:bounds.min.map(v=>v-margin),max:bounds.max.map(v=>v+margin)},delta=explode?project(explode,yaw):[0,0,0];
 if(explode)for(const f of selected.filter(f=>current.has(f.id)))for(const p of f.points)for(let i=0;i<2;i++){b.min[i]=Math.min(b.min[i],p[i]+delta[i]);b.max[i]=Math.max(b.max[i],p[i]+delta[i]);}
 const scale=Math.min((box.w-20)/(b.max[0]-b.min[0]||1),(box.h-20)/(b.max[1]-b.min[1]||1)),map=p=>[box.x+box.w/2+(p[0]-(b.min[0]+b.max[0])/2)*scale,box.y+box.h/2+(p[1]-(b.min[1]+b.max[1])/2)*scale];
 const pixelWidth=Math.ceil(box.w*2),pixelHeight=Math.ceil(box.h*2);
 const centreX=(b.min[0]+b.max[0])/2,centreY=(b.min[1]+b.max[1])/2;
 const drawn=selected.map(face=>{
  const incoming=current.has(face.id),highlight=current.size===0||incoming;
  const colour=mix(face.colour.map(v=>v*face.shade),highlight?0:previousFade);
  const offset=explode&&incoming?delta:[0,0,0];
  const points=face.points.map(([x,y,z])=>[
   (box.x+box.w/2+(x+offset[0]-centreX)*scale-box.x)*2,
   (box.y+box.h-(box.y+box.h/2+(y+offset[1]-centreY)*scale))*2,
   z+offset[2]
  ]);
  return {points,edges:face.edges,colour,edgeColour:colour.map(v=>v*(highlight?.55:.78))};
 });
 const pixels=rasterizeInstructionFaces(drawn,pixelWidth,pixelHeight,background),imageIndex=images.length;images.push({width:pixelWidth,height:pixelHeight,pixels});
 let out=`q ${box.w} 0 0 ${box.h} ${box.x} ${box.y} cm /Im${imageIndex} Do Q\n`;
 if(explode){const points=selected.filter(f=>current.has(f.id)).flatMap(f=>f.points),centre=[0,1,2].map(i=>points.reduce((s,p)=>s+p[i],0)/points.length),a=map(centre.map((v,i)=>v+delta[i])),b=map(centre),distance=Math.hypot(a[0]-b[0],a[1]-b[1]);if(distance>12){const dir=a.map((v,i)=>(v-b[i])/distance);out+=arrow(a.map((v,i)=>v-dir[i]*9),b.map((v,i)=>v+dir[i]*5));}}
 return out;
}
const encode=value=>new TextEncoder().encode(value);
const joinBytes=chunks=>{const bytes=new Uint8Array(chunks.reduce((sum,c)=>sum+c.length,0));let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return bytes;};
async function pdfStream(bytes,attributes=''){
 const compressed=typeof CompressionStream==='function'?new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()):bytes;
 return joinBytes([encode(`<< ${attributes} /Length ${compressed.length}${compressed===bytes?'':' /Filter /FlateDecode'} >>\nstream\n`),compressed,encode('\nendstream')]);
}
async function documentBytes(streams,font,images){
 const objects=[encode('<< /Type /Catalog /Pages 2 0 R >>'),null,encode('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')],pages=[];
 if(font){
  const fileId=objects.length+1;objects.push(await pdfStream(Uint8Array.from(atob(font.font_base64),c=>c.charCodeAt(0))));
  const descriptor=objects.length+1;objects.push(encode(`<< /Type /FontDescriptor /FontName /${font.name} /Flags 32 /FontBBox [${font.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${font.ascent} /Descent ${font.descent} /CapHeight ${font.ascent} /StemV 80 /FontFile2 ${fileId} 0 R >>`));
  objects[2]=encode(`<< /Type /Font /Subtype /TrueType /BaseFont /${font.name} /FirstChar 32 /LastChar 126 /Widths [${font.widths.join(' ')}] /Encoding /WinAnsiEncoding /FontDescriptor ${descriptor} 0 R >>`);
 }
 const imageIds=[];for(const stream of images){imageIds.push(objects.length+1);objects.push(stream);}
 const imageResources=imageIds.map((id,i)=>`/Im${i} ${id} 0 R`).join(' ');
 for(const stream of streams){const id=objects.length+1;pages.push(id);objects.push(encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> /XObject << ${imageResources} >> >> /Contents ${id+1} 0 R >>`),await pdfStream(encode(stream)));}
 objects[1]=encode(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map(i=>i+' 0 R').join(' ')}] >>`);
 const chunks=[encode('%PDF-1.4\n')],offsets=[0];let length=chunks[0].length;
 objects.forEach((o,i)=>{offsets.push(length);const chunk=joinBytes([encode(`${i+1} 0 obj\n`),o,encode('\nendobj\n')]);chunks.push(chunk);length+=chunk.length;});
 chunks.push(encode(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(i=>String(i).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));return joinBytes(chunks);
}
export async function createInstructionPdf(plan,catalogue,spec={},onPage=()=>{}){
 if(plan.status!=='planned')throw new Error('A planned assembly is required for instruction export.');
 if(plan.parts.length>800||(plan.instructions?.steps?.length||0)>200)throw new Error('PDF diagrams are limited to 800 parts in 200 steps. Use the full assembly report and LDraw STEP export for larger plans.');
 const steps=plan.instructions?.steps;if(!steps?.length)throw new Error('No canonical assembly sequence is available.');
 const profiles=new Map(catalogue.profiles.map(p=>[p.part_id,p]));
 const sideStep=steps.find(s=>s.approach_direction&&Math.abs(s.approach_direction[1])<1e-6&&s.parts.some(id=>{const part=plan.parts.find(p=>p.instance_id===id);return profiles.get(part.part_id).features.some(f=>f.kind==='stud_receiver');})),overviewYaw=instructionViewYaw(sideStep?.approach_direction),faces=sceneFaces(plan,profiles,overviewYaw),bounds=diagramBounds(faces),all=new Set(plan.parts.map(p=>p.instance_id)),streams=[],title=spec.name||plan.design_id,items=plan.bom.items||plan.bom;
 const images=[],diagram=(...args)=>drawDiagram(...args,images);
 const pageCount=2+Math.ceil(items.length/12)+Math.ceil(steps.length/2);
 let packed=0;
 async function finishPage(content){
  streams.push(content);
  // Release the page's raw RGB buffers before rendering the next spread.
  for(;packed<images.length;packed++){
   const image=images[packed];
   images[packed]=await pdfStream(image.pixels,`/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8`);
  }
  onPage(streams.length,pageCount);
 }
 const header=section=>rect(0,797,595,45,ink)+text(34,815,12,'BRICKFORGE',rgb('#ffffff'))+text(295,815,8,section.slice(0,48),rgb('#dbe7eb'));
 const footer=(page,section)=>line([34,43],[561,43],rgb('#d7e0e4'))+text(34,25,8,section.slice(0,90),muted)+text(535,25,9,String(page));
 // Cover: full-colour overview and a compact guide to the visual language.
 let out=header('BUILDING GUIDE')+text(36,755,10,'DESIGN / ELEMENTS / ASSEMBLY',accent)+lines(36,714,25,title,38)+text(36,637,11,`${plan.parts.length} parts   /   ${steps.length} steps   /   ${items.length} inventory entries`,muted);
 out+=rect(36,257,523,352,paper)+diagram(faces,all,new Set(),{x:48,y:269,w:499,h:328},{bounds,previousFade:0});
 out+=text(36,220,15,'Before you build')+lines(36,196,10,'Gather the illustrated parts. Follow the numbered steps in order. New parts keep their full colour; previous parts are softened for clarity.',83);
 out+=lines(36,141,9,'Placement arrows show a nominal approach direction, not a certified insertion path. Check real connections, hand access and support as you build.',92,muted);const approximations=plan.component_reports?.filter(r=>r.approximation)||[];if(approximations.length)out+=lines(36,100,8,'Stepped rounded shape: declared radial allowance '+approximations.map(r=>r.approximation.shape_tolerance_mm+' mm').join(', ')+'. Inner/outer bounds are recorded in the full report.',96,accent);out+=footer(1,'Engine preview / nominal geometry / physical fit remains unverified');await finishPage(out);
 // Illustrated inventory, grouped by the exact part and colour instances.
 for(let start=0;start<items.length;start+=12){out=header('PARTS INVENTORY')+text(36,757,23,'Parts inventory')+text(36,735,10,'Match the part shape, identifier, colour and quantity before starting.',muted);
  items.slice(start,start+12).forEach((item,i)=>{const x=36+(i%3)*177,y=562-Math.floor(i/3)*155,part=plan.parts.find(p=>p.part_id===item.part_id&&(p.colour_code??p.colour)===item.colour_code),ids=new Set([part.instance_id]),pf=faces.filter(f=>ids.has(f.id));out+=rect(x,y,169,144,paper)+diagram(pf,ids,new Set(),{x:x+12,y:y+48,w:145,h:86},{bounds:diagramBounds(pf),previousFade:0});out+=text(x+10,y+120,12,`${item.quantity}x`,accent)+text(x+10,y+32,12,item.part_id)+text(x+10,y+16,9,colourNames.get(item.colour_code)||'Colour '+item.colour_code,muted);});
  out+=text(36,75,8,'LDraw source geometry. Authors and per-file licence notices:')+text(36,62,8,'github.com/descalzi/brickforge/tree/main/docs/data/part-meshes',muted)+footer(streams.length+1,'Inventory / exact model instances');await finishPage(out);
 }
 const built=new Set();
 for(const [index,step] of steps.entries()){
  if(index%2===0)out=header('ASSEMBLY / STEP-BY-STEP');const y=index%2===0?427:79,part=plan.parts.find(p=>p.instance_id===step.parts[0]),component=spec.components?.find(c=>c.id===part.component_id),current=new Set(step.parts),yaw=step.approach_direction&&Math.abs(step.approach_direction[1])<1e-6?instructionViewYaw(step.approach_direction):overviewYaw,stepFaces=yaw===overviewYaw?faces:reproject(faces,yaw),pf=stepFaces.filter(f=>current.has(f.id));for(const id of current)built.add(id);
  out+=rect(34,y,527,329,paper)+rect(34,y+280,527,49,rgb('#e1e9ed'))+text(48,y+298,20,'STEP '+step.step)+text(174,y+303,12,(component?.label||component?.id||step.title).slice(0,40))+text(174,y+286,9,`${step.parts.length} new part${step.parts.length===1?'':'s'} / ${step.part_id||part.part_id} / ${colourNames.get(part.colour_code??part.colour)||'see inventory'}`,muted);
  // A separate parts tray keeps the exact incoming element readable.
  out+=rect(438,y+185,109,85,rgb('#ffffff'))+diagram(pf,current,new Set(),{x:444,y:y+198,w:97,h:62},{bounds:diagramBounds(pf),previousFade:0,background:[1,1,1]})+text(445,y+191,9,`${step.parts.length}x  ${part.part_id}`,accent);
  const explode=step.nominal_approach_clear&&step.approach_direction?.some(v=>v)?step.approach_direction.map(v=>v*14):null;
  out+=diagram(stepFaces,built,current,{x:44,y:y+42,w:390,h:231},{bounds:diagramBounds(stepFaces.filter(f=>built.has(f.id))),explode,yaw});
  out+=text(48,y+31,8,index===0?'Start with this part in the shown orientation.':explode?'Follow the placement arrow; keep the shown orientation.':'Place the new part in the shown orientation. Review the approach.',muted);
  if(yaw!==overviewYaw)out+=text(310,y+31,7,'View turned toward the joint',accent);
  const jointNote=instructionJointNote(step);
  if(jointNote)out+=lines(445,y+172,8,jointNote,22,muted);
  if(step.support_guidance?.status==='hold_recommended')out+=text(48,y+19,7.5,'Hold / support this stage: nominal balance proxy flags limited support.',accent);
  out+=rect(48,y+8,494,3,rgb('#d8e2e7'))+rect(48,y+8,494*(index+1)/steps.length,3,accent);
  if(index%2===1||index===steps.length-1){out+=footer(streams.length+1,`Steps ${index-index%2+1}-${index+1} / full colour = new / softened = previous`);await finishPage(out);}
 }
 out=header('COMPLETE')+text(36,751,28,'Your model, assembled.')+text(36,722,11,`${plan.parts.length} real part instances / ${steps.length} canonical steps`,muted)+rect(36,260,523,428,paper)+diagram(faces,all,new Set(),{x:49,y:275,w:497,h:398},{bounds,previousFade:0});
 const d=plan.dimensions_mm;out+=text(36,223,15,'Check the result')+text(36,198,11,d?`Width ${n(d.width)} mm   /   depth ${n(d.depth)} mm   /   height ${n(d.height)} mm`:'Inspect the model against your design intent.');
 out+=lines(36,169,10,'Compare the shape, facing, empty spaces and connections with the design brief. Keep the LDraw model and full report with this booklet for exact instance and connection details.',83)+lines(36,108,9,'Nominal geometry only. Real clutch, physical insertion, rolling behaviour, loads and stability remain unverified.',95,muted)+footer(streams.length+1,'Surface transforms, triangulation and diagram projection by BrickForge.');await finishPage(out);
 return documentBytes(streams,catalogue.pdf_font,images);
}
