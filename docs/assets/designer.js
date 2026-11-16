import {reorientExtrudedComponent} from './part-orientation.js?v=72fddf3032b8';
import { ASSET_VERSION } from "./release-version.js?v=72fddf3032b8";
import { buildInterpretationRequest, interpretDescription, endpointProvider } from "./text-design.js?v=72fddf3032b8";
import { createInstructionPdf } from "./instruction-pdf.js?v=72fddf3032b8";
import { partBodyBounds } from "./assembly-analysis.js?v=72fddf3032b8";
import { validateDesignSpec } from "./design-spec.js?v=72fddf3032b8";
import { createDesignViewer, colours } from "./design-viewer.js?v=72fddf3032b8";
const $=id=>document.getElementById(id);
const editor=$("design-spec"),status=$("engine-status"),runButton=$("run-design"),selector=$("fixture-select");
const downloads=[$("download-ldraw"),$("download-bom"),$("download-report"),$("download-instructions"),$("download-pdf")];
let responseSchema,analysisController=null,analysisGeneration=0,selectedComponent=null;
let catalogue,displayCatalogue,options,fixtures=[],result=null,activeSpec=null,worker=null,timer=null,viewer=null,currentExample=null;
try{viewer=createDesignViewer($("studio-viewport"));}catch(error){$("viewer-empty").textContent="3D preview unavailable: "+error.message;}
function setStatus(message,state="ready"){status.textContent=message;status.dataset.state=state;}
function finishWorker(){worker?.terminate();worker=null;clearTimeout(timer);$("cancel-design").hidden=true;runButton.disabled=!catalogue;}
function invalidate(message="Brief changed. Plan again to update the assembly."){
  analysisController?.abort();analysisController=null;analysisGeneration++;$("cancel-interpretation").hidden=true;$("analyse-description").disabled=!$("interpretation-endpoint").value.trim()||!responseSchema;
  editComponent(null);finishWorker();result=null;activeSpec=null;downloads.forEach(b=>b.disabled=true);$("share-design").disabled=!catalogue;
  for(const id of ["engine-parts","engine-connections","engine-pairs","engine-size"])$(id).textContent="—";
  viewer?.clear();if(viewer){$("viewer-empty").textContent="Plan this brief to inspect its assembly.";$("viewer-empty").hidden=false;}
  $("instruction-slider").disabled=true;$("instruction-value").textContent="—";$("instruction-detail").textContent="Plan an assembly to inspect its nominal connection sequence.";$("course-slider").disabled=true;$("course-value").textContent="—";$("validation-list").replaceChildren();$("warning-list").replaceChildren();$("engine-report").textContent="No current assembly. "+message;$("share-result").hidden=true;setStatus(message);
}
function download(name,data,type="application/json"){
  const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement("a");a.href=url;a.download=name.replace(/[^a-zA-Z0-9._-]/g,"-");a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function components(spec,plan){
  $("component-list").replaceChildren();
  for(const component of spec.components||[]){
    const button=document.createElement("button");button.className="component-row";button.setAttribute("aria-pressed","false");
    const swatch=document.createElement("span");swatch.className="swatch";const placedColours=[...new Set((plan?.parts||[]).filter(p=>p.component_id===component.id).map(p=>colours.get(p.colour_code??p.colour)||'#a9b8c2'))];swatch.style.background=placedColours.length>1?`linear-gradient(${placedColours.join(',')})`:placedColours[0]||colours.get(component.colour??spec.appearance?.preferred_colours?.[0]??4)||"#a9b8c2";
    const text=document.createElement("span"),name=document.createElement("span"),detail=document.createElement("small");name.className="component-name";name.textContent=component.label||component.id;
    const d=component.dimensions_mm;detail.textContent=`${component.role} · ${d?.width} × ${d?.depth} × ${d?.height} mm`;text.append(name,detail);
    const state=document.createElement("span");state.className="component-state";const count=plan?.parts?.filter(p=>p.component_id===component.id).length;state.textContent=plan?.status==="planned"?`${count} ${count===1?"part":"parts"}`:component.geometry;
    button.append(swatch,text,state);button.addEventListener("click",()=>{const on=button.getAttribute("aria-pressed")!=="true";for(const b of $("component-list").children)b.setAttribute("aria-pressed","false");button.setAttribute("aria-pressed",String(on));viewer?.select(on?component.id:null);editComponent(on?component:null);});$("component-list").append(button);
  }
  if(spec.negative_spaces?.length){const note=document.createElement("p");note.className="muted";note.textContent=spec.negative_spaces.length+" explicit empty-space requirements";$("component-list").append(note);}
}
function loadExample(id){
  const example=fixtures.find(f=>f.design_id===id);if(!example){invalidate("Unknown brief: "+id);setStatus("Unknown brief: "+id,"blocked");return false;}
  currentExample=example;selector.value=id;editor.value=JSON.stringify(example,null,2);invalidate("Brief ready. Plan construction to test it.");components(example);$("fixture-description").textContent=example.design_id.startsWith("challenge-")?"Challenge brief: contains requirements the planner may not yet support. The result should explain the gap.":"Authored engine test · editable object specification · no prescribed parts";return true;
}
function showEvidence(plan){
  $("validation-list").replaceChildren();$("warning-list").replaceChildren();
  for(const check of plan.validation?.checks||[]){const row=document.createElement("div");row.className="check";row.dataset.state=check.status;const name=document.createElement("strong"),detail=document.createElement("small");name.textContent=check.id.replaceAll("_"," ");detail.textContent=check.detail;row.append(name,detail);$("validation-list").append(row);}
  for(const check of plan.relationship_checks||[]){if(check.type==='attached_to')continue;const row=document.createElement('div');row.className='check';row.dataset.state=check.status;const name=document.createElement('strong'),detail=document.createElement('small');name.textContent=check.detail;detail.textContent=check.measured_mm===null?'Realised shape and layout checked.':`Measured ${+check.measured_mm.toFixed(3)} mm; target ${+check.expected_mm.toFixed(3)} mm ± ${check.tolerance_mm} mm`;row.append(name,detail);$('validation-list').append(row);}
  const list=document.createElement("ul");for(const message of [...plan.failures||[],...plan.warnings||[]]){const li=document.createElement("li");li.textContent=message;list.append(li);}$("warning-list").append(list);
  $("engine-report").textContent=JSON.stringify(plan,null,2);
}
function run(){
  invalidate("Validating design specification…");
  let spec;try{spec=JSON.parse(editor.value);const validation=validateDesignSpec(spec);if(!validation.valid)throw new Error(validation.errors.join(" "));}catch(error){setStatus(error.message,"blocked");$("engine-report").textContent=error.message;return;}
  components(spec);activeSpec=spec;runButton.disabled=true;$("cancel-design").hidden=false;setStatus("Searching catalogue parts and connected layouts…","planning");
  const started=performance.now();worker=new Worker(new URL("./design-worker.js?v=72fddf3032b8",import.meta.url),{type:"module"});
  worker.onmessage=({data})=>{
    finishWorker();if(data.error){setStatus(data.error,"blocked");$("engine-report").textContent=data.error;return;}
    result=data.result;showEvidence(result);components(spec,result);
    if(result.status!=="planned"){setStatus((result.failures||["No plan found."]).join(" "),"blocked");return;}
    $("engine-parts").textContent=result.parts.length;$("engine-connections").textContent=result.connections.length;$("engine-pairs").textContent=result.total_mating_pairs??"—";
    const d=result.dimensions_mm;$("engine-size").textContent=d?`${+d.width.toFixed(1)} × ${+d.depth.toFixed(1)} × ${+d.height.toFixed(1)}`:"See report";
    const pitch=spec.constraints.course_type==="brick"?9.6:3.2;
    const minY=Math.min(...spec.components.map(c=>c.position_mm.y));
    const profileMap=new Map(displayCatalogue.profiles.map(p=>[p.part_id,p]));
    const displayPlan={...result,parts:result.parts.map(part=>({...part,display_course_index:Math.max(0,Math.round((partBodyBounds(part,profileMap.get(part.part_id)).min[1]-minY)/pitch))}))};
    const courses=Math.max(...displayPlan.parts.map(p=>p.display_course_index))+1;$("course-slider").max=courses;$("course-slider").value=courses;$("course-slider").disabled=false;$("course-value").textContent=`${courses}/${courses}`;
    if(viewer){try{viewer.show(displayPlan,displayCatalogue);$("viewer-empty").hidden=true;}catch(error){viewer.clear();$("viewer-empty").hidden=false;$("viewer-empty").textContent=error.message;}}
    const steps=result.instructions?.steps||result.instructions||[];
    $("instruction-slider").max=steps.length;$("instruction-slider").value=steps.length;$("instruction-slider").disabled=!steps.length;$("instruction-value").textContent=steps.length?`All ${steps.length}`:"—";
    $("instruction-detail").textContent="Nominal connection order. Use the slider to inspect each addition. Insertion paths and stability are unverified.";
    downloads.forEach(b=>b.disabled=false);setStatus(`Plan found · ${result.parts.length} parts · ${((performance.now()-started)/1000).toFixed(2)} s. Nominal checks passed; physical stability remains unverified.`,"planned");
  };
  worker.onerror=event=>{finishWorker();setStatus("Planner error: "+event.message,"blocked");};
  timer=setTimeout(()=>{finishWorker();setStatus("Search stopped after 30 seconds. Reduce the design size or search budget and try again.","blocked");},30000);
  worker.postMessage({spec,catalogue,options});
}
async function initialise(){
  try{
    const load=async path=>{const response=await fetch("./data/"+path+"?v="+ASSET_VERSION);if(!response.ok)throw new Error("Could not load "+path+" ("+response.status+"). Reload to retry.");return response.json();};
    const [cat,partCatalogue,designTranslation,connectorCatalogue,briefs,specialistCatalogue,schema]=await Promise.all([load("connection-profiles/basic-bricks.json"),load("part-capabilities-v1.json"),load("design-translation-v1.json"),load("connector-compatibility-v1.json"),load("design-spec-fixtures.json"),load("specialist-profiles-v1.json"),load("design-spec-schema-v1.json")]);
    responseSchema=schema;
    const specialistProfiles=await Promise.all(specialistCatalogue.profiles.map(async profile=>({...profile,preview_triangles_mm:(await load(profile.mesh_file)).triangle_positions_mm})));
    displayCatalogue={...cat,profiles:[...cat.profiles,...specialistProfiles]};
    catalogue=cat;options={partCatalogue,designTranslation,connectorCatalogue,specialistCatalogue};fixtures=[...briefs.fixtures,...briefs.challenge_specs||[]];selector.replaceChildren();
    for(const [label,items] of [["Constructible test briefs",briefs.fixtures],["Unresolved challenge briefs",briefs.challenge_specs||[]]]){const group=document.createElement("optgroup");group.label=label;for(const fixture of items){const option=document.createElement("option");option.value=fixture.design_id;option.textContent=fixture.name;group.append(option);}selector.append(group);}
    selector.disabled=false;runButton.disabled=false;$("share-design").disabled=false;
    const params=new URLSearchParams(location.search),hash=new URLSearchParams(location.hash.slice(1));
    if(hash.has("spec")){const text=hash.get("spec");if(text.length>131072)throw new Error("Shared brief is too large (maximum 128 KiB).");editor.value=JSON.stringify(JSON.parse(text),null,2);selector.selectedIndex=-1;$("fixture-description").textContent="Shared design brief · review or edit before planning";invalidate("Shared brief loaded.");components(JSON.parse(editor.value));}
    else {const id=params.get("fixture")==="stacked-body"?fixtures[0].design_id:params.get("fixture")||fixtures[0].design_id;if(!loadExample(id))return;}
    if(params.get("run")==="1"||hash.get("run")==="1")run();
  }catch(error){setStatus(error.message,"blocked");}
}
selector.addEventListener("change",()=>loadExample(selector.value));runButton.addEventListener("click",run);
$("cancel-design").addEventListener("click",()=>{invalidate("Planning cancelled. Your brief is unchanged.");});
editor.addEventListener("input",()=>{invalidate();selector.selectedIndex=-1;try{components(JSON.parse(editor.value));}catch{$("component-list").replaceChildren();}});
$("reset-design").addEventListener("click",()=>loadExample(currentExample?.design_id||fixtures[0].design_id));
$("export-design").addEventListener("click",()=>{try{const spec=JSON.parse(editor.value);download((spec.design_id||"design")+".design.json",JSON.stringify(spec,null,2));}catch(error){setStatus(error.message,"blocked");}});
$("import-design").addEventListener("change",async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>131072)throw new Error("Brief exceeds the 128 KiB import limit.");const spec=JSON.parse(await file.text());editor.value=JSON.stringify(spec,null,2);invalidate("Imported brief loaded. Plan to validate it.");selector.selectedIndex=-1;components(spec);}catch(error){setStatus(error.message,"blocked");}event.target.value="";});
$("download-ldraw").addEventListener("click",()=>result&&download(result.design_id+".ldr",result.ldraw,"text/plain"));
$("download-instructions").addEventListener("click",()=>result&&download(result.design_id+".instructions.json",JSON.stringify(result.instructions,null,2)));
$("instruction-slider").addEventListener("input",()=>{
  if(!result)return;const input=$("instruction-slider"),count=Number(input.value),steps=result.instructions?.steps||result.instructions||[],step=steps[count-1];
  viewer?.step(steps.slice(0,count).flatMap(s=>s.parts));
  const course=$("course-slider");course.value=course.max;viewer?.course(Number(course.max));$("course-value").textContent=course.max+"/"+course.max;
  $("instruction-value").textContent=count+"/"+steps.length;
  const part=result.parts.find(p=>p.instance_id===step?.parts?.[0]),component=activeSpec?.components.find(c=>c.id===part?.component_id);
  $("instruction-detail").textContent=step?`Step ${count}: Add ${part?.part_id||'the element'} to ${component?.label||component?.id||'the assembly'}. ${step.nominal_approach_clear?'Nominal approach is clear.':'Review the approach.'} Physical insertion is unverified.`:"";
});
$("download-bom").addEventListener("click",()=>result&&download(result.design_id+".bom.json",JSON.stringify(result.bom,null,2)));
$("download-report").addEventListener("click",()=>result&&download(result.design_id+".assembly.json",JSON.stringify({specification:activeSpec,...result},null,2)));
$("share-design").addEventListener("click",async()=>{try{const spec=JSON.parse(editor.value),url=new URL(location.href);url.search="";url.hash=new URLSearchParams({spec:JSON.stringify(spec),run:"1"}).toString();const out=$("share-result");out.replaceChildren();out.hidden=false;try{await navigator.clipboard.writeText(url.href);out.textContent="Brief link copied. It includes the specification; recipients run the planner in their browser.";}catch{const a=document.createElement("a");a.href=url.href;a.textContent="Open this shareable design brief";out.append(a);}}catch(error){setStatus(error.message,"blocked");}});
for(const [id,view] of [["view-iso","iso"],["view-top","top"],["view-front","front"],["view-fit","iso"]])$(id).addEventListener("click",()=>viewer?.fit(view));
$("course-slider").addEventListener("input",()=>{const input=$("course-slider");$("course-value").textContent=input.value+"/"+input.max;viewer?.course(Number(input.value));});
initialise();

$("download-pdf").addEventListener("click",async()=>{
 if(!result)return;const plan=result,specification=activeSpec,message=status.textContent;$("download-pdf").disabled=true;setStatus('Preparing illustrated instruction booklet…','exporting');
 try{await new Promise(resolve=>setTimeout(resolve,0));if(!displayCatalogue.pdf_font){const font=await fetch(`./data/pdf-font-v1.json?v=${ASSET_VERSION}`);if(!font.ok)throw new Error("Could not load the instruction font.");displayCatalogue.pdf_font=await font.json();}if(result!==plan)return;const bytes=await createInstructionPdf(plan,displayCatalogue,specification);if(result!==plan)return;download(plan.design_id+".instructions.pdf",bytes,"application/pdf");setStatus(message,'planned');}catch(error){if(result===plan)setStatus(error.message,"blocked");}finally{if(result===plan)$("download-pdf").disabled=false;}
});

function editComponent(c){
 selectedComponent=c?.id||null;$("component-editor").hidden=!c;if(!c)return;$("component-editor").open=true;$("component-editor-name").textContent=c.label||c.id;
 for(const axis of ['x','y','z'])$("component-"+axis).value=c.position_mm[axis];
 for(const axis of ['width','depth','height']){$("component-"+axis).value=c.dimensions_mm[axis];$("component-"+axis).disabled=c.geometry!=='rectangular_prism';}
 $("component-facing").disabled=c.geometry!=='extruded_profile';$("component-facing").value=c.orientation?.forward||'';
 $("component-colour").value=c.colour??4;$("component-tolerance").value=c.fit_tolerance_mm||0;$("component-position-tolerance").value=c.position_tolerance_mm||0;
}
$("apply-component").addEventListener('click',()=>{try{const spec=JSON.parse(editor.value),c=spec.components.find(c=>c.id===selectedComponent);if(!c)throw new Error('Select a component.');for(const a of ['x','y','z'])c.position_mm[a]=Number($("component-"+a).value);if(c.geometry==='rectangular_prism')for(const a of ['width','depth','height'])c.dimensions_mm[a]=Number($("component-"+a).value);c.colour=Number($("component-colour").value);c.fit_tolerance_mm=Number($("component-tolerance").value);c.position_tolerance_mm=Number($("component-position-tolerance").value);if(c.geometry==='extruded_profile'){const facing=$('component-facing').value;if(facing)Object.assign(c,reorientExtrudedComponent(c,facing));else delete c.orientation;}const check=validateDesignSpec(spec);if(!check.valid)throw new Error(check.errors.join(' '));editor.value=JSON.stringify(spec,null,2);invalidate('Component changed. Plan again to check its fit.');components(spec);editComponent(c);}catch(error){setStatus(error.message,'blocked');}});
$("interpretation-endpoint").addEventListener('input',()=>{$("analyse-description").disabled=!responseSchema||!$("interpretation-endpoint").value.trim();});
$("analyse-description").addEventListener('click',async()=>{
 invalidate('Analysing the description using your selected gateway…');const generation=analysisGeneration;analysisController=new AbortController();$("analyse-description").disabled=true;$("cancel-interpretation").hidden=false;
 try{const {specification}=await interpretDescription($("description-input").value,{responseSchema,signal:analysisController.signal,provider:endpointProvider($("interpretation-endpoint").value)});if(generation!==analysisGeneration)return;editor.value=JSON.stringify(specification,null,2);invalidate('Interpretation ready. Review the components, then plan construction.');selector.selectedIndex=-1;components(specification);$("fixture-description").textContent='Interpreted object specification · review inferred choices before planning';}
 catch(error){if(error.name!=='AbortError'&&generation===analysisGeneration){setStatus(error.message,'blocked');$("cancel-interpretation").hidden=true;$("analyse-description").disabled=false;}}
});
$("cancel-interpretation").addEventListener('click',()=>invalidate('Description analysis cancelled.'));
$("export-interpretation").addEventListener('click',()=>{try{download('brickforge-interpretation-request.json',JSON.stringify(buildInterpretationRequest($("description-input").value,responseSchema),null,2));}catch(error){setStatus(error.message,'blocked');}});
const revisionKey='brickforge.design-revisions.v1';
function revisions(){try{const values=JSON.parse(localStorage.getItem(revisionKey)||'[]');return Array.isArray(values)?values.filter(r=>r&&typeof r.id==='string'&&r.specification):[];}catch{return [];}}
function showRevisions(){const select=$("revision-select");select.replaceChildren(new Option('Saved on this browser…',''));for(const revision of revisions())select.add(new Option(revision.name+' · '+new Date(revision.saved_at).toLocaleString(),revision.id));}
$("save-revision").addEventListener('click',()=>{try{const spec=JSON.parse(editor.value),check=validateDesignSpec(spec);if(!check.valid)throw new Error(check.errors.join(' '));const next=[{id:crypto.randomUUID(),name:spec.name||spec.design_id,saved_at:new Date().toISOString(),specification:spec},...revisions()].slice(0,20);localStorage.setItem(revisionKey,JSON.stringify(next));showRevisions();setStatus('Revision saved on this browser.');}catch(error){setStatus('Could not save revision: '+error.message,'blocked');}});
$("revision-select").addEventListener('change',()=>{const revision=revisions().find(r=>r.id===$("revision-select").value);if(!revision)return;editor.value=JSON.stringify(revision.specification,null,2);invalidate('Saved revision restored. Plan to regenerate its assembly.');selector.selectedIndex=-1;components(revision.specification);});
showRevisions();
