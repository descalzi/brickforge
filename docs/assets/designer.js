import { instructionJointNote } from "./assembly-instructions.js?v=fc937bdf9465";
import {reorientExtrudedComponent} from './part-orientation.js?v=fc937bdf9465';
import { ASSET_VERSION } from "./release-version.js?v=fc937bdf9465";
import { buildInterpretationRequest, interpretDescription, endpointProvider } from "./text-design.js?v=fc937bdf9465";
import { buildInventory, inventoryCsv } from "./build-inventory.js?v=fc937bdf9465";
import { partBodyBounds } from "./assembly-analysis.js?v=fc937bdf9465";
import { validateDesignSpec } from "./design-spec.js?v=fc937bdf9465";
import { createDesignViewer, colours } from "./design-viewer.js?v=fc937bdf9465";
const $=id=>document.getElementById(id);
const editor=$("design-spec"),status=$("engine-status"),runButton=$("run-design"),selector=$("fixture-select");
const downloads=[$("download-ldraw"),$("download-bom"),$("download-report"),$("download-instructions"),$("download-pdf")];
let responseSchema,analysisController=null,analysisGeneration=0,selectedComponent=null;
let catalogue,displayCatalogue,options,fixtures=[],result=null,activeSpec=null,worker=null,timer=null,viewer=null,currentExample=null;
try{viewer=createDesignViewer($("studio-viewport"));}catch(error){$("viewer-empty").textContent="3D preview unavailable: "+error.message;}
function setStatus(message,state="ready"){status.textContent=message;status.dataset.state=state;}
function finishWorker(){worker?.terminate();worker=null;clearTimeout(timer);$("cancel-design").hidden=true;runButton.disabled=!catalogue;}
let testedRevision = null, previousBrief = null;
function invalidate(message="Brief changed. Plan again to update the assembly."){
  analysisController?.abort();analysisController=null;analysisGeneration++;$("cancel-interpretation").hidden=true;$("analyse-description").disabled=!$("interpretation-endpoint").value.trim()||!responseSchema;
  stopPdf();
  $("pick-list").hidden=true;
  $("pick-list").open=false;
  $("pick-rows").replaceChildren();
  testedRevision = null;
  previousBrief = null;
  $("brief-repair").hidden = true;
  $("cancel-revision").hidden = true;
  $("undo-revision").hidden = true;
  $("find-revision").disabled = false;
  $("use-revision").hidden = true;
  $("revision-preview").textContent = "";
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
  for(const report of plan.component_reports||[])if(plan.status==="planned" && report.dimension_search){const row=document.createElement('div');row.className='check';row.dataset.state='passed';const name=document.createElement('strong'),detail=document.createElement('small'),format=d=>['width','depth','height'].map(k=>+d[k].toFixed(3)).join(' × ');name.textContent='Dimension fit: '+report.component_id;detail.textContent=`Requested ${format(report.requested_dimensions_mm)} mm; realised ${format(report.realised_dimensions_mm)} mm. Allowance ±${report.allowed_deviation_mm} mm per dimension; joints and relationships checked.`;row.append(name,detail);$('validation-list').append(row);}
  for(const report of plan.component_reports||[])if(plan.status==="planned" && report.approximation){const a=report.approximation,row=document.createElement('div');row.className='check';row.dataset.state='warning';const name=document.createElement('strong'),detail=document.createElement('small');name.textContent='Stepped rounded shape: '+report.component_id;detail.textContent=`Allowed radial shape error ${a.shape_tolerance_mm} mm. Outer excess bound ${a.outer_excess_bound_mm.toFixed(2)} mm; inner missing-band bound ${a.inner_missing_band_bound_mm.toFixed(2)} mm, excluding declared voids.`;row.append(name,detail);$('validation-list').append(row);}
  for (const component of plan.component_reports || []) {
    if (component.status !== 'blocked') continue;
    const row = document.createElement('div');
    row.className = 'check';
    row.dataset.state = 'blocked';
    const name = document.createElement('strong'), reason = document.createElement('small');
    name.textContent = component.component_id;
    reason.textContent = component.reason;
    row.append(name, reason);
    $('validation-list').append(row);
  }
  const shownReasons = new Set((plan.component_reports || []).filter(r => r.status === "blocked").map(r => r.reason));
  const list=document.createElement("ul");for(const message of [...(plan.failures || []).filter(reason => !shownReasons.has(reason)),...plan.warnings||[]]){const li=document.createElement("li");li.textContent=message;list.append(li);}$("warning-list").append(list);
  $("engine-report").textContent=JSON.stringify(plan,null,2);
}
function run(){
  invalidate("Validating design specification…");
  let spec;try{spec=JSON.parse(editor.value);const validation=validateDesignSpec(spec);if(!validation.valid)throw new Error(validation.errors.join(" "));}catch(error){setStatus(error.message,"blocked");$("engine-report").textContent=error.message;return;}
  components(spec);activeSpec=spec;runButton.disabled=true;$("cancel-design").hidden=false;setStatus("Searching catalogue parts and connected layouts…","planning");
  const started=performance.now();worker=new Worker(new URL("./design-worker.js?v=fc937bdf9465",import.meta.url),{type:"module"});
  worker.onmessage=({data})=>{
    finishWorker();if(data.error){setStatus(data.error,"blocked");$("engine-report").textContent=data.error;return;}
    result=data.result;showEvidence(result);components(spec,result);
    if(result.status!=="planned"){$("brief-repair").hidden=false;const count=result.component_reports?.filter(r=>r.status==='blocked').length;
      setStatus(count>1 ? `${count} components could not be fitted. See the reasons below.` : (result.failures||["No plan found."]).join(" "),"blocked");return;}
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
    showPickList(result);
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
  $("instruction-detail").textContent=step?`Step ${count}: Add ${part?.part_id||'the element'} to ${component?.label||component?.id||'the assembly'}. ${instructionJointNote(step)} ${step.nominal_approach_clear?'Nominal approach is clear.':'Review the approach.'} ${step.support_guidance?.status==='hold_recommended'?'Hold or support this stage; its nominal balance proxy flags limited support. ':''}Physical insertion is unverified.`:"";
});
$("download-bom").addEventListener("click",()=>result&&download(result.design_id+".bom.json",JSON.stringify(result.bom,null,2)));
$("download-report").addEventListener("click",()=>result&&download(result.design_id+".assembly.json",JSON.stringify({specification:activeSpec,...result},null,2)));
$("share-design").addEventListener("click",async()=>{try{const spec=JSON.parse(editor.value),url=new URL(location.href);url.search="";url.hash=new URLSearchParams({spec:JSON.stringify(spec),run:"1"}).toString();const out=$("share-result");out.replaceChildren();out.hidden=false;try{await navigator.clipboard.writeText(url.href);out.textContent="Brief link copied. It includes the specification; recipients run the planner in their browser.";}catch{const a=document.createElement("a");a.href=url.href;a.textContent="Open this shareable design brief";out.append(a);}}catch(error){setStatus(error.message,"blocked");}});
for(const [id,view] of [["view-iso","iso"],["view-top","top"],["view-front","front"],["view-fit","iso"]])$(id).addEventListener("click",()=>viewer?.fit(view));
$("course-slider").addEventListener("input",()=>{const input=$("course-slider");$("course-value").textContent=input.value+"/"+input.max;viewer?.course(Number(input.value));});
initialise();

let pdfWorker = null;
function stopPdf(){
  pdfWorker?.terminate();
  pdfWorker = null;
  $("cancel-pdf").hidden = true;
  $("download-pdf").disabled = result?.status !== "planned";
}
$("cancel-pdf").addEventListener("click", () => {
  stopPdf();
  setStatus("Booklet export cancelled. Your assembly is ready.", "planned");
});
$("download-pdf").addEventListener("click", () => {
  if (result?.status !== "planned" || pdfWorker) return;
  const plan = result;
  $("download-pdf").disabled = true;
  $("cancel-pdf").hidden = false;
  setStatus("Preparing illustrated instruction booklet…", "exporting");
  try {
    const job = new Worker(new URL("./instruction-pdf-worker.js?v=fc937bdf9465", import.meta.url), {type:"module"});
    pdfWorker = job;
    job.onmessage = ({data}) => {
      if (job !== pdfWorker) return;
      if (data.page) {
        setStatus(`Rendering booklet · page ${data.page} of ${data.total}`, "exporting");
        return;
      }
      stopPdf();
      if (data.error) { setStatus(data.error, "export-error"); return; }
      download(plan.design_id + ".instructions.pdf", data.bytes, "application/pdf");
      setStatus("Instruction booklet downloaded. Your assembly is ready.", "planned");
    };
    job.onerror = event => {
      if (job !== pdfWorker) return;
      stopPdf();
      setStatus("Booklet export failed. " + event.message, "export-error");
    };
    const used = new Set(plan.parts.map(part => part.part_id));
    const profiles = displayCatalogue.profiles.filter(profile => used.has(profile.part_id));
    const {status, design_id, parts, instructions, bom, dimensions_mm, component_reports} = plan;
    job.postMessage({plan:{status, design_id, parts, instructions, bom, dimensions_mm, component_reports}, profiles, spec:activeSpec});
  } catch (error) {
    stopPdf();
    setStatus(error.message, "export-error");
  }
});

function showPickList(plan) {
  const inventory = buildInventory(plan);
  const update = () => {
    const gathered = Array.from($("pick-rows").querySelectorAll("input:checked"))
      .reduce((sum, input) => sum + Number(input.value), 0);
    $("pick-count").textContent = `${gathered} of ${plan.parts.length} parts gathered`;
  };
  for (const item of inventory) {
    const row = $("pick-rows").insertRow();
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = item.quantity;
    input.setAttribute("aria-label", `Gathered ${item.quantity} of part ${item.part_id}, colour ${item.colour_code}`);
    input.addEventListener("change", update);
    row.insertCell().append(input);
    for (const value of [item.part_id, item.colour_code, item.quantity, item.first_step]) row.insertCell().textContent = value;
  }
  $("download-csv").onclick = () => download(plan.design_id + ".parts.csv", inventoryCsv(inventory), "text/csv;charset=utf-8");
  $("pick-list").hidden = false;
  update();
}

function editComponent(c){
 selectedComponent=c?.id||null;$("component-editor").hidden=!c;if(!c)return;$("component-editor").open=true;$("component-editor-name").textContent=c.label||c.id;
 for(const axis of ['x','y','z'])$("component-"+axis).value=c.position_mm[axis];
 for(const axis of ['width','depth','height']){$("component-"+axis).value=c.dimensions_mm[axis];$("component-"+axis).disabled=c.geometry!=='rectangular_prism';}
 $("component-shape-tolerance").disabled=!['sphere','cylinder'].includes(c.geometry);$("component-shape-tolerance").value=c.shape_tolerance_mm||0;
 $("component-facing").disabled=c.geometry!=='extruded_profile';$("component-facing").value=c.orientation?.forward||'';
 $("component-colour").value=c.colour??4;$("component-tolerance").value=c.fit_tolerance_mm||0;$("component-position-tolerance").value=c.position_tolerance_mm||0;
}
$("apply-component").addEventListener('click',()=>{try{const spec=JSON.parse(editor.value),c=spec.components.find(c=>c.id===selectedComponent);if(!c)throw new Error('Select a component.');for(const a of ['x','y','z'])c.position_mm[a]=Number($("component-"+a).value);if(c.geometry==='rectangular_prism')for(const a of ['width','depth','height'])c.dimensions_mm[a]=Number($("component-"+a).value);c.colour=Number($("component-colour").value);c.fit_tolerance_mm=Number($("component-tolerance").value);c.position_tolerance_mm=Number($("component-position-tolerance").value);if(['sphere','cylinder'].includes(c.geometry))c.shape_tolerance_mm=Number($('component-shape-tolerance').value);if(c.geometry==='extruded_profile'){const facing=$('component-facing').value;if(facing)Object.assign(c,reorientExtrudedComponent(c,facing));else delete c.orientation;}const check=validateDesignSpec(spec);if(!check.valid)throw new Error(check.errors.join(' '));editor.value=JSON.stringify(spec,null,2);invalidate('Component changed. Plan again to check its fit.');components(spec);editComponent(c);}catch(error){setStatus(error.message,'blocked');}});
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

const revisionFieldNames = {position_tolerance_mm: 'position allowance per axis', fit_tolerance_mm: 'dimension allowance', shape_tolerance_mm: 'radial shape allowance'};
$("find-revision").addEventListener("click", () => {
  if (result?.status !== "blocked" || worker) return;
  const search = new Worker(new URL("./design-worker.js?v=fc937bdf9465", import.meta.url), {type: "module"});
  worker = search;
  const preview = $("revision-preview");
  $("find-revision").disabled = true;
  preview.textContent = "Testing course choices, positions and dimensional allowances against the complete brief…";
  function stop(message) {
    if (worker !== search) return;
    finishWorker();
    $("cancel-revision").hidden = true;
    preview.textContent = message;
  }
  $("cancel-revision").hidden = false;
  $("cancel-revision").onclick = () => { stop("Search cancelled."); $("find-revision").disabled = false; };
  search.onmessage = ({data}) => {
    if (worker !== search) return;
    const revision = data.revision;
    if (!revision?.specification) {
      stop(data.error || `Found no working revision in ${revision.attempts} trials.`);
      return;
    }
    testedRevision = revision.specification;
    const changes = revision.edits.map(edit => edit.field === 'course_type'
      ? `Course selection changes from ${edit.before} to ${edit.after}.`
      : `${edit.component} ${revisionFieldNames[edit.field]} changes from ${edit.before} to ${edit.after} mm.`);
    for (const {component, size} of revision.dimensions) {
      changes.push(`${component} builds at ${[size.width, size.depth, size.height].map(v => +v.toFixed(2)).join(' × ')} mm (width × depth × height).`);
    }
    for (const position of revision.positions) {
      changes.push(`${position.component} moves by (${position.delta.map(v => +v.toFixed(2)).join(', ')}) mm on X, Y and Z.`);
    }
    for (const evidence of revision.approximations) {
      changes.push(`${evidence.component} extends at most ${(Math.ceil(evidence.outer * 100) / 100).toFixed(2)} mm outside and misses at most ${(Math.ceil(evidence.inner * 100) / 100).toFixed(2)} mm inside the requested surface.`);
    }
    stop(`Tested a ${revision.parts}-part assembly. ` + changes.join(' '));
    $("use-revision").hidden = false;
  };
  search.onerror = event => stop(event.message);
  timer = setTimeout(() => stop("Revision search reached the 30-second limit."), 30000);
  search.postMessage({action: 'find_revision', spec: activeSpec, catalogue, options,
    failure: {status: result.status, component_reports: result.component_reports || []}});
});
$("use-revision").addEventListener("click", () => {
  if (!testedRevision) return;
  const previous = {text: editor.value, selected: selector.value};
  editor.value = JSON.stringify(testedRevision, null, 2);
  selector.selectedIndex = -1;
  run();
  previousBrief = previous;
  $("undo-revision").hidden = false;
});
$("undo-revision").addEventListener("click", () => {
  if (!previousBrief) return;
  editor.value = previousBrief.text;
  selector.value = previousBrief.selected;
  run();
});
