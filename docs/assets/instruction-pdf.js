import {rasterizeInstructionFaces} from './instruction-rasterizer.js?v=9b8d8e12b3f3';
// Browser-native illustrated hybrid booklet. Diagrams and inventory share the canonical plan.
import { transformVector } from './connection-graph.js?v=9b8d8e12b3f3';
import { BRICK_COLOURS, colourHex as palette } from './brick-colours.js?v=9b8d8e12b3f3';
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
export const MAX_BOOKLET_PARTS=8000;
/** Merge consecutive engine steps into booklet steps: at most about 240 steps, and a
 * placement arrow only where every merged step agrees on one clear approach. */
export function bookletSteps(steps,partCount){
 const target=Math.max(1,Math.ceil(partCount/240)),out=[];
 for(const step of steps){
  const last=out.at(-1);
  if(last&&last.parts.size<target&&last.parts.size+step.parts.length<=Math.max(target,step.parts.length)*1.5){for(const id of step.parts)last.parts.add(id);last.directions.push(step.nominal_approach_clear?step.approach_direction:null);last.hold||=step.support_guidance?.status==='hold_recommended';continue;}
  out.push({parts:new Set(step.parts),directions:[step.nominal_approach_clear?step.approach_direction:null],hold:step.support_guidance?.status==='hold_recommended'});
 }
 for(const s of out){const d=s.directions[0];s.lift=d&&d.some(v=>v)&&s.directions.every(e=>e&&e.every((v,i)=>Math.abs(v-d[i])<1e-6))?d.map(v=>v*14):null;delete s.directions;}
 return out;
}
export function instructionViewYaw(direction){return direction&&Math.abs(direction[1])<1e-6&&Math.hypot(direction[0],direction[2])>.999?Math.atan2(-direction[0],direction[2])+.45:defaultYaw;}
function project([x,y,z],yaw=defaultYaw){const pitch=.55;return [x*Math.cos(yaw)+z*Math.sin(yaw),y*Math.cos(pitch)-(-x*Math.sin(yaw)+z*Math.cos(yaw))*Math.sin(pitch),y*Math.sin(pitch)+(-x*Math.sin(yaw)+z*Math.cos(yaw))*Math.cos(pitch)];}
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
async function documentBytes(streams,font,images,pageImages=[]){
 const objects=[encode('<< /Type /Catalog /Pages 2 0 R >>'),null,encode('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')],pages=[];
 if(font){
  const fileId=objects.length+1;objects.push(await pdfStream(Uint8Array.from(atob(font.font_base64),c=>c.charCodeAt(0))));
  const descriptor=objects.length+1;objects.push(encode(`<< /Type /FontDescriptor /FontName /${font.name} /Flags 32 /FontBBox [${font.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${font.ascent} /Descent ${font.descent} /CapHeight ${font.ascent} /StemV 80 /FontFile2 ${fileId} 0 R >>`));
  objects[2]=encode(`<< /Type /Font /Subtype /TrueType /BaseFont /${font.name} /FirstChar 32 /LastChar 126 /Widths [${font.widths.join(' ')}] /Encoding /WinAnsiEncoding /FontDescriptor ${descriptor} 0 R >>`);
 }
 const imageIds=[];for(const stream of images){imageIds.push(objects.length+1);objects.push(stream);}
 const imageResources=imageIds.map((id,i)=>`/Im${i} ${id} 0 R`).join(' ');
 for(const [p,stream] of streams.entries()){const id=objects.length+1;pages.push(id);const own=pageImages[p]?pageImages[p].map(i=>`/Im${i} ${imageIds[i]} 0 R`).join(' '):imageResources;objects.push(encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> /XObject << ${own} >> >> /Contents ${id+1} 0 R >>`),await pdfStream(encode(stream)));}
 objects[1]=encode(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map(i=>i+' 0 R').join(' ')}] >>`);
 const chunks=[encode('%PDF-1.4\n')],offsets=[0];let length=chunks[0].length;
 objects.forEach((o,i)=>{offsets.push(length);const chunk=joinBytes([encode(`${i+1} 0 obj\n`),o,encode('\nendobj\n')]);chunks.push(chunk);length+=chunk.length;});
 chunks.push(encode(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(i=>String(i).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));return joinBytes(chunks);
}
export async function createInstructionPdf(plan,catalogue,spec={},onPage=()=>{}){
 if(plan.status!=='planned')throw new Error('A planned assembly is required for instruction export.');
 if(plan.parts.length>MAX_BOOKLET_PARTS)throw new Error(`The booklet supports up to ${MAX_BOOKLET_PARTS} parts. Open the LDraw file in BrickLink Studio or LeoCAD for larger models.`);
 const steps=plan.instructions?.steps;if(!steps?.length)throw new Error('No canonical assembly sequence is available.');
 const partsById=new Map(plan.parts.map(p=>[p.instance_id,p])),bookSteps=bookletSteps(steps,plan.parts.length);
 const profiles=new Map(catalogue.profiles.map(p=>[p.part_id,p]));
 const overviewYaw=defaultYaw,faces=sceneFaces(plan,profiles,overviewYaw),bounds=diagramBounds(faces),all=new Set(plan.parts.map(p=>p.instance_id)),streams=[],title=spec.name||plan.design_id,items=plan.bom.items||plan.bom;
 const images=[],diagram=(...args)=>{const at=images.length,out=drawDiagram(...args,images);if(images.length>at)usedImages.add(at);return out;};
 const pageCount=2+Math.ceil(items.length/12)+Math.ceil(bookSteps.length/(bookSteps.length<=40?4:6));
 let usedImages=new Set();const pageImages=[];
 let packed=0;
 async function finishPage(content){
  streams.push(content);pageImages.push([...usedImages]);usedImages=new Set();
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
 let out=header('BUILDING GUIDE')+text(36,755,10,'DESIGN / ELEMENTS / ASSEMBLY',accent)+lines(36,714,25,title,38)+text(36,637,11,`${plan.parts.length} parts   /   ${bookSteps.length} steps   /   ${items.length} inventory entries`,muted);
 out+=rect(36,257,523,352,paper)+diagram(faces,all,new Set(),{x:48,y:269,w:499,h:328},{bounds,previousFade:0});
 out+=text(36,220,15,'Before you build')+lines(36,196,10,'Gather the illustrated parts. Follow the numbered steps in order. New parts keep their full colour; previous parts are softened for clarity.',83);
 out+=lines(36,141,9,'Placement arrows show a nominal approach direction, not a certified insertion path. Check real connections, hand access and support as you build.',92,muted);const approximations=plan.component_reports?.filter(r=>r.approximation)||[];if(approximations.length)out+=lines(36,100,8,'Stepped rounded shape: declared radial allowance '+approximations.map(r=>r.approximation.shape_tolerance_mm+' mm').join(', ')+'. Inner/outer bounds are recorded in the full report.',96,accent);out+=footer(1,'Engine preview / nominal geometry / physical fit remains unverified');await finishPage(out);
 // Illustrated inventory, grouped by the exact part and colour instances.
 for(let start=0;start<items.length;start+=12){out=header('PARTS INVENTORY')+text(36,757,23,'Parts inventory')+text(36,735,10,'Match the part shape, identifier, colour and quantity before starting.',muted);
  items.slice(start,start+12).forEach((item,i)=>{const x=36+(i%3)*177,y=562-Math.floor(i/3)*155,part=plan.parts.find(p=>p.part_id===item.part_id&&(p.colour_code??p.colour)===item.colour_code),ids=new Set([part.instance_id]),pf=faces.filter(f=>ids.has(f.id));out+=rect(x,y,169,144,paper)+diagram(pf,ids,new Set(),{x:x+12,y:y+48,w:145,h:86},{bounds:diagramBounds(pf),previousFade:0});out+=text(x+10,y+120,12,`${item.quantity}x`,accent)+text(x+10,y+32,12,item.part_id)+text(x+10,y+16,9,colourNames.get(item.colour_code)||'Colour '+item.colour_code,muted);});
  out+=text(36,75,8,'LDraw source geometry. Authors and per-file licence notices:')+text(36,62,8,'github.com/descalzi/brickforge/tree/main/docs/data/part-meshes',muted)+footer(streams.length+1,'Inventory / exact model instances');await finishPage(out);
 }
 // Building steps, booklet style: several parts per step and several steps per
 // page. The model view keeps one scale and angle throughout, so each step only
 // draws its new parts over the image of everything built before.
 const perPage=bookSteps.length<=40?4:6,cols=2,rows=perPage/cols,cellW=527/cols,cellH=(730-12)/rows,ratio=bookSteps.length>150?1.6:2;
 const viewW=cellW-16,viewH=cellH-78,pw=Math.ceil(viewW*ratio),ph=Math.ceil(viewH*ratio);
 const byId=new Map();for(const f of faces){if(!byId.has(f.id))byId.set(f.id,[]);byId.get(f.id).push(f);}
 const centreX=(bounds.min[0]+bounds.max[0])/2,centreY=(bounds.min[1]+bounds.max[1])/2,scale=Math.min((viewW-12)/(bounds.max[0]-bounds.min[0]||1),(viewH-12)/(bounds.max[1]-bounds.min[1]||1))*ratio;
 const toPixel=([x,y,z],o=[0,0,0])=>[pw/2+(x+o[0]-centreX)*scale,ph/2-(y+o[1]-centreY)*scale,z+o[2]];
 const view={pixels:new Uint8Array(pw*ph*3),depth:new Float64Array(pw*ph).fill(-Infinity)};
 for(let i=0;i<view.pixels.length;i+=3){view.pixels[i]=Math.round(paper[0]*255);view.pixels[i+1]=Math.round(paper[1]*255);view.pixels[i+2]=Math.round(paper[2]*255);}
 const drawParts=(ids,buffers,{fade=0,offset}={})=>{const list=[];for(const id of ids)for(const f of byId.get(id)||[]){const colour=mix(f.colour.map(v=>v*f.shade),fade);list.push({points:f.points.map(p=>toPixel(p,offset)),edges:f.edges,colour,edgeColour:fade?colour.map(v=>v*.78):accent});}rasterizeInstructionFaces(list,pw,ph,paper,buffers);};
 // Part callouts: one small image per part and colour, reused on every page.
 const icons=new Map();
 const icon=(partId,colour)=>{const key=partId+'/'+colour;if(!icons.has(key)){const part=plan.parts.find(p=>p.part_id===partId&&(p.colour_code??p.colour)===colour),ids=new Set([part.instance_id]),pf=faces.filter(f=>ids.has(f.id));icons.set(key,{pf,ids,bounds:diagramBounds(pf),index:null});}return icons.get(key);};
 for(let start=0;start<bookSteps.length;start+=perPage){
  out=header('ASSEMBLY / STEP-BY-STEP');
  for(let k=0;k<perPage&&start+k<bookSteps.length;k++){
   const index=start+k,step=bookSteps[index],x=34+(k%cols)*cellW,y=790-12-(Math.floor(k/cols)+1)*cellH,current=step.parts;
   out+=rect(x+3,y+3,cellW-6,cellH-6,paper)+text(x+12,y+cellH-30,20,String(index+1));
   // Callout: the new parts by type and colour, with quantities.
   const groups=new Map();for(const id of current){const part=partsById.get(id),key=part.part_id+'/'+(part.colour_code??part.colour);if(!groups.has(key))groups.set(key,{part,count:0});groups.get(key).count++;}
   const slots=cellW>200?5:4,callout=[...groups.values()].sort((a,b)=>b.count-a.count),shown=callout.slice(0,callout.length>slots?slots-1:slots),slotW=(cellW-70)/slots;
   out+=rect(x+52,y+cellH-62,cellW-62,52,rgb('#ffffff'));
   shown.forEach((g,i)=>{const ic=icon(g.part.part_id,g.part.colour_code??g.part.colour),bx=x+56+i*slotW,bw=slotW-4;
    if(ic.index===null){ic.index=images.length;drawDiagram(ic.pf,ic.ids,new Set(),{x:0,y:0,w:bw,h:32},{bounds:ic.bounds,previousFade:0,background:[1,1,1]},images);}
    usedImages.add(ic.index);out+=`q ${n(bw)} 0 0 32 ${n(bx)} ${n(y+cellH-46)} cm /Im${ic.index} Do Q\n`+text(bx,y+cellH-58,8,`${g.count}x`,accent);});
   if(callout.length>shown.length)out+=text(x+56+shown.length*slotW+2,y+cellH-34,8,`+${callout.length-shown.length} more`,muted)+text(x+56+shown.length*slotW+2,y+cellH-46,7,'see the view',muted);
   // Model view: previous parts softened, new parts in full colour (lifted along the approach when clear).
   const frame={pixels:view.pixels.slice(),depth:view.depth.slice()},delta=step.lift?project(step.lift,overviewYaw):null;
   drawParts(current,frame,{offset:delta||undefined});
   const imageIndex=images.length;images.push({width:pw,height:ph,pixels:frame.pixels});usedImages.add(imageIndex);
   out+=`q ${n(viewW)} 0 0 ${n(viewH)} ${n(x+8)} ${n(y+12)} cm /Im${imageIndex} Do Q\n`;
   if(delta){const ids=[...current],pts=ids.flatMap(id=>(byId.get(id)||[]).flatMap(f=>f.points)),c=[0,1,2].map(i=>pts.reduce((s,p)=>s+p[i],0)/(pts.length||1)),map=p=>[x+8+p[0]/ratio,y+12+viewH-p[1]/ratio],a=map(toPixel(c,delta)),b=map(toPixel(c));if(Math.hypot(a[0]-b[0],a[1]-b[1])>10)out+=arrow(a,b);}
   if(step.hold)out+=text(x+12,y+cellH-46,7,'Hold',accent);
   drawParts(current,view,{fade:.4});
  }
  out+=rect(48,52,494,3,rgb('#d8e2e7'))+rect(48,52,494*Math.min(1,(start+perPage)/bookSteps.length),3,accent);
  out+=footer(streams.length+1,`Steps ${start+1}-${Math.min(start+perPage,bookSteps.length)} of ${bookSteps.length} / full colour = new / softened = previous`);await finishPage(out);
 }
 out=header('COMPLETE')+text(36,751,28,'Your model, assembled.')+text(36,722,11,`${plan.parts.length} parts / ${bookSteps.length} steps`,muted)+rect(36,260,523,428,paper)+diagram(faces,all,new Set(),{x:49,y:275,w:497,h:398},{bounds,previousFade:0});
 const d=plan.dimensions_mm;out+=text(36,223,15,'Check the result')+text(36,198,11,d?`Width ${n(d.width)} mm   /   depth ${n(d.depth)} mm   /   height ${n(d.height)} mm`:'Inspect the model against your design intent.');
 out+=lines(36,169,10,'Compare the shape, facing, empty spaces and connections with the design brief. Keep the LDraw model and full report with this booklet for exact instance and connection details.',83)+lines(36,108,9,'Nominal geometry only. Real clutch, physical insertion, rolling behaviour, loads and stability remain unverified.',95,muted)+footer(streams.length+1,'Surface transforms, triangulation and diagram projection by BrickForge.');await finishPage(out);
 return documentBytes(streams,catalogue.pdf_font,images,pageImages);
}
