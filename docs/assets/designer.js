import { planDesign } from "./design-engine.js";
const editor=document.querySelector("#design-spec"),runButton=document.querySelector("#run-design"),status=document.querySelector("#engine-status");
const outputs={parts:document.querySelector("#engine-parts"),connections:document.querySelector("#engine-connections"),pairs:document.querySelector("#engine-pairs"),preview:document.querySelector("#engine-preview"),report:document.querySelector("#engine-report")};
const downloads={ldraw:document.querySelector("#download-ldraw"),bom:document.querySelector("#download-bom"),report:document.querySelector("#download-report")};
let catalogue=null,example=null,result=null;
function setStatus(message,state="info"){status.textContent=message;status.dataset.state=state;}
function download(name,data,type){const blob=new Blob([data],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
function renderPreview(plan){
  outputs.preview.replaceChildren();
  if(!plan.parts.length)return;
  const ns="http://www.w3.org/2000/svg",profileMap=new Map(catalogue.profiles.map(p=>[p.part_id,p]));
  const rectangles=plan.parts.map(part=>{const p=profileMap.get(part.part_id),rotated=Math.abs(part.matrix[0])<.5;return {x:part.translation_ldu[0]*.4,z:part.translation_ldu[2]*.4,w:(rotated?p.footprint_studs_z:p.footprint_studs_x)*8,d:(rotated?p.footprint_studs_x:p.footprint_studs_z)*8,y:part.translation_ldu[1]};});
  const minX=Math.min(...rectangles.map(r=>r.x-r.w/2)),maxX=Math.max(...rectangles.map(r=>r.x+r.w/2),minX+1),minZ=Math.min(...rectangles.map(r=>r.z-r.d/2)),maxZ=Math.max(...rectangles.map(r=>r.z+r.d/2),minZ+1);
  const scale=Math.min(360/(maxX-minX),175/(maxZ-minZ)),offsetX=(420-(maxX-minX)*scale)/2,offsetY=(230-(maxZ-minZ)*scale)/2;
  for(const r of rectangles){const rect=document.createElementNS(ns,"rect");rect.setAttribute("x",offsetX+(r.x-r.w/2-minX)*scale);rect.setAttribute("y",offsetY+(r.z-r.d/2-minZ)*scale);rect.setAttribute("width",Math.max(1,r.w*scale-1));rect.setAttribute("height",Math.max(1,r.d*scale-1));rect.setAttribute("rx","2");rect.setAttribute("fill",r.y<0?"#3c7895":"#d66a37");rect.setAttribute("stroke","#25475c");rect.setAttribute("stroke-width","1");outputs.preview.append(rect);}
}
function run(){
 try{
  const spec=JSON.parse(editor.value),plan=planDesign(spec,catalogue);result=plan;
  outputs.parts.textContent=String(plan.parts.length);outputs.connections.textContent=String(plan.connections.length);outputs.pairs.textContent=String(plan.total_mating_pairs||0);
  outputs.report.textContent=JSON.stringify({status:plan.status,failures:plan.failures||[],warnings:plan.warnings||[],component_reports:plan.component_reports||[],validation:plan.validation||null,bom:plan.bom||null},null,2);
  renderPreview(plan);
  setStatus(plan.status==="planned"?"Construction plan generated. Nominal geometric checks passed; see the limitations below.":(plan.failures||["Construction could not be planned."]).join(" " ),plan.status);
  for(const button of Object.values(downloads))button.disabled=plan.status!=="planned";
 }catch(error){result=null;setStatus(error.message,"blocked");outputs.report.textContent=error.stack||error;for(const button of Object.values(downloads))button.disabled=true;}
}
async function initialise(){
 try{
  const [cat,fixtures]=await Promise.all([fetch("./data/connection-profiles/basic-bricks.json").then(r=>{if(!r.ok)throw new Error("Part connection catalogue failed to load.");return r.json();}),fetch("./data/design-spec-fixtures.json").then(r=>{if(!r.ok)throw new Error("Design fixtures failed to load.");return r.json();})]);
  catalogue=cat;example=fixtures.fixtures[0];editor.value=JSON.stringify(example,null,2);runButton.disabled=false;setStatus("Catalogue ready. The specification is ready to plan.","ready");
  const params=new URLSearchParams(location.search);if(params.get("run")==="1")run();
 }catch(error){setStatus(error.message,"blocked");}
}
runButton.addEventListener("click",run);
document.querySelector("#reset-design").addEventListener("click",()=>{editor.value=JSON.stringify(example,null,2);});
downloads.ldraw.addEventListener("click",()=>result&&download(result.design_id+".ldr",result.ldraw,"text/plain"));
downloads.bom.addEventListener("click",()=>result&&download(result.design_id+".bom.json",JSON.stringify(result.bom,null,2),"application/json"));
downloads.report.addEventListener("click",()=>result&&download(result.design_id+".assembly.json",JSON.stringify({parts:result.parts,connections:result.connections,validation:result.validation,component_reports:result.component_reports},null,2),"application/json"));
initialise();
