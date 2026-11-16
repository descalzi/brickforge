import {pdfContentStreams} from './pdf-test-utils.mjs';
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { createReadStream, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../docs");
const mime=new Map([[".html","text/html"],[".js","text/javascript"],[".json","application/json"],[".css","text/css"],[".svg","image/svg+xml"]]);
const server=http.createServer((req,res)=>{
 let pathname;try{pathname=decodeURIComponent(new URL(req.url,"http://localhost").pathname);}catch{res.writeHead(400).end();return;}
 const target=path.resolve(root,"."+pathname);if(!target.startsWith(root+path.sep)&&target!==root){res.writeHead(403).end();return;}
 if(!existsSync(target)){res.writeHead(404).end("Not found");return;}
 res.setHeader("Content-Type",mime.get(path.extname(target))||"application/octet-stream");createReadStream(target).pipe(res);
});
await new Promise(resolve=>server.listen(4174,"127.0.0.1",resolve));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
try{
 const page=await browser.newPage(),errors=[];
 page.on("pageerror",error=>errors.push(error.message));
 page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
 await page.goto("http://127.0.0.1:4174/designer.html?fixture=stacked-body&run=1",{waitUntil:"domcontentloaded"});
 await page.waitForFunction(()=>["planned","blocked"].includes(document.querySelector("#engine-status")?.dataset.state),null,{timeout:30000});
 const state=await page.locator("#engine-status").getAttribute("data-state");
 const message=await page.locator("#engine-status").innerText();
 assert.equal(state,"planned","Workbench did not produce a plan: "+message+"; browser errors: "+errors.join(" | "));
 assert.equal(await page.locator("#engine-parts").innerText(),"4");
 assert.equal(await page.locator("#engine-connections").innerText(),"4");
 assert.equal(await page.locator("#engine-pairs").innerText(),"16");
 assert.equal(await page.locator("#download-ldraw").isEnabled(),true);
 assert.equal(await page.locator("#studio-viewport [data-parts]").getAttribute("data-parts"),"4");
 await page.locator(".diagnostics-panel summary").click();
 const report=await page.locator("#engine-report").innerText();
 assert.match(report,/physical_clutch_strength/);
 assert.match(report,/not_assessed/);
 assert.equal(errors.length,0,errors.join(" | "));
 // Exercise the actual page controls, worker, keepouts and downloaded model.
 await page.selectOption("#fixture-select","two-opening-wall");
 assert.equal(await page.locator("#download-ldraw").isEnabled(),false);
 await page.click("#run-design");
 await page.waitForFunction(()=>document.querySelector("#engine-status").dataset.state==="planned");
 assert.equal(await page.locator("#component-list .component-row").count(),1);
 assert.match(await page.locator("#engine-report").innerText(),/negative_space_body_clearance/);
 const downloadPromise=page.waitForEvent("download");await page.click("#download-ldraw");const download=await downloadPromise;
 const stream=await download.createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);const ldraw=Buffer.concat(chunks).toString();
 assert.equal(ldraw.split("\n").filter(l=>l.startsWith("1 ")).length,Number(await page.locator("#engine-parts").innerText()));
 await page.locator("#course-slider").evaluate(el=>{el.value="2";el.dispatchEvent(new Event("input",{bubbles:true}));});assert.equal(await page.locator("#course-value").innerText(),"2/4");
 await page.click("#view-top");await page.click("#view-iso");
 await page.screenshot({path:process.env.STUDIO_SCREENSHOT||"/tmp/brickforge-studio.png",fullPage:true});
 await page.selectOption("#fixture-select","table");await page.click("#run-design");await page.waitForFunction(()=>document.querySelector("#engine-status").dataset.state==="planned");
 assert.equal(await page.locator("#component-list .component-row").count(),5);
 // Specialist selection, source-surface previews, and nominal assembly sequence.
 await page.selectOption("#fixture-select","windowed-pavilion");await page.click("#run-design");
 await page.waitForFunction(()=>["planned","blocked"].includes(document.querySelector("#engine-status").dataset.state));
 assert.equal(await page.locator("#engine-status").getAttribute("data-state"),"planned",await page.locator("#engine-status").innerText());
 const pavilion=JSON.parse(await page.locator("#engine-report").innerText());
 assert.ok(pavilion.parts.some(p=>p.part_id==="60592"));assert.ok(pavilion.parts.some(p=>p.part_id==="3037"||p.part_id==="3039"));
 assert.equal(await page.locator("#studio-viewport [data-parts]").getAttribute("data-parts"),String(pavilion.parts.length));
 assert.equal(await page.locator("#viewer-empty").isVisible(),false);
 // Framing must use placed world geometry, rather than each source mesh at
 // its local origin. The software viewer computes its own transformed bounds.
 const canvas=page.locator("#studio-viewport canvas");
 if(await canvas.count()){const worldBounds=await canvas.getAttribute("data-world-bounds");assert.ok(worldBounds,"WebGL viewer must report the actual fitted bounds");const {min,max}=JSON.parse(worldBounds);assert.ok(Math.abs(min[0])<.1&&Math.abs(min[2])<.1);assert.ok(Math.abs(max[0]-32)<.1&&Math.abs(max[2]-32)<.1);assert.ok(Math.abs(max[1]-49.6)<.1,"source studs and roof must be included in the fitted scene");}

 await page.locator("#instruction-slider").evaluate(el=>{el.value="1";el.dispatchEvent(new Event("input",{bubbles:true}));});
 assert.equal(await page.locator("#instruction-value").innerText(),"1/"+pavilion.parts.length);
 assert.match(await page.locator("#instruction-detail").innerText(),/Step 1/);
 assert.equal(await page.locator("#studio-viewport [data-parts]").getAttribute("data-visible-parts"),"1");
 const sequenceDownload=page.waitForEvent("download");await page.click("#download-instructions");const sequence=await sequenceDownload;
 const seqStream=await sequence.createReadStream(),seqChunks=[];for await(const chunk of seqStream)seqChunks.push(chunk);
 assert.equal(JSON.parse(Buffer.concat(seqChunks).toString()).steps.length,pavilion.parts.length);
 await page.locator("#instruction-slider").evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event("input",{bubbles:true}));});
 await page.click("#view-iso");
 await page.screenshot({path:process.env.SPECIALIST_SCREENSHOT||"/tmp/brickforge-pavilion.png",fullPage:true});
 // New functional families, PDF generation, editing and local revisions.
 await page.selectOption("#fixture-select","small-road-car");await page.click("#run-design");
 await page.waitForFunction(()=>document.querySelector("#engine-status").dataset.state==="planned",null,{timeout:30000});
 const car=JSON.parse(await page.locator("#engine-report").innerText());assert.equal(car.parts.filter(p=>p.part_id==="3641").length,4);assert.equal(car.parts.filter(p=>p.part_id==="4624").length,4);
 assert.equal(car.connections.flatMap(e=>e.mating_pairs).filter(p=>p.connection_type==="wheel_pin_bore").length,4);
 const heldStep=car.instructions.steps.find(s=>s.support_guidance.status==='hold_recommended');assert.ok(heldStep);await page.locator('#instruction-slider').evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},heldStep.step);assert.match(await page.locator('#instruction-detail').innerText(),/Hold or support this stage/);await page.locator('#instruction-slider').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('input',{bubbles:true}));});
 assert.equal(await page.locator("#viewer-empty").isVisible(),false);await page.click("#view-fit");
 await page.screenshot({path:"/tmp/brickforge-car.png",fullPage:true});
 const pdfPromise=page.waitForEvent("download");await page.click("#download-pdf");const pdf=await pdfPromise,pdfStream=await pdf.createReadStream(),pdfChunks=[];for await(const chunk of pdfStream)pdfChunks.push(chunk);const pdfBytes=Buffer.concat(pdfChunks);assert.ok(pdfBytes.toString('ascii',0,8).startsWith('%PDF-1.4'));assert.ok(pdfContentStreams(pdfBytes).some(s=>s.includes('Parts inventory')));assert.ok(pdfContentStreams(pdfBytes).some(s=>s.includes('Hold / support this stage')));assert.ok(pdfBytes.length<3000000);await writeFile('/tmp/brickforge-car.instructions.pdf',pdfBytes);
 // A facing edit rotates the requested cross-section, rather than merely changing the camera.
 await page.locator('#component-list .component-row').filter({hasText:'Bonnet'}).click();assert.equal(await page.locator('#component-facing').inputValue(),'-z');await page.selectOption('#component-facing','+x');await page.click('#apply-component');
 const editedBonnet=JSON.parse(await page.locator('#design-spec').inputValue()).components.find(c=>c.id==='bonnet');assert.equal(editedBonnet.orientation.forward,'+x');assert.equal(editedBonnet.geometry_parameters.extrusion_axis,'z');await page.click('#run-design');await page.waitForFunction(()=>document.querySelector('#engine-status').dataset.state==='planned');
 await page.selectOption('#fixture-select','rounded-mushroom');await page.click('#run-design');await page.waitForFunction(()=>document.querySelector('#engine-status').dataset.state==='planned');const mushroom=JSON.parse(await page.locator('#engine-report').innerText());assert.equal(mushroom.parts.length,3);assert.ok(mushroom.parts.some(p=>p.part_id==='11212'));assert.ok(mushroom.relationship_checks.every(c=>c.status==='passed'));await page.screenshot({path:'/tmp/brickforge-mushroom.png',fullPage:true});
 const mushroomDownload=page.waitForEvent('download');await page.click('#download-pdf');const mushroomPdf=await mushroomDownload,mushroomStream=await mushroomPdf.createReadStream(),mushroomChunks=[];for await(const chunk of mushroomStream)mushroomChunks.push(chunk);await writeFile('/tmp/brickforge-mushroom.instructions.pdf',Buffer.concat(mushroomChunks));
 await page.selectOption('#fixture-select','approximate-road-car');await page.click('#run-design');await page.waitForFunction(()=>document.querySelector('#engine-status').dataset.state==='planned');const fitted=JSON.parse(await page.locator('#engine-report').innerText());assert.ok(fitted.search.pose_candidates_generated>0);assert.ok(fitted.component_reports.some(r=>r.position_adjustment_mm?.some(v=>Math.abs(v)>.1)));
 await page.selectOption('#fixture-select','small-road-car');await page.click('#run-design');await page.waitForFunction(()=>document.querySelector('#engine-status').dataset.state==='planned');
 await page.locator("#component-list .component-row").filter({hasText:"Chassis"}).click();await page.selectOption("#component-colour","1");await page.click("#apply-component");assert.equal(await page.locator("#download-pdf").isEnabled(),false);assert.equal(JSON.parse(await page.locator("#design-spec").inputValue()).components[0].colour,1);
 await page.click("#save-revision");const revision=await page.locator("#revision-select option").nth(1).getAttribute('value');assert.ok(revision);
 await page.selectOption("#fixture-select","tapered-aircraft");await page.click("#run-design");await page.waitForFunction(()=>document.querySelector("#engine-status").dataset.state==="planned");
 const aircraft=JSON.parse(await page.locator("#engine-report").innerText());assert.ok(['3933','3934'].every(id=>aircraft.parts.some(p=>p.part_id===id)));assert.ok(aircraft.relationship_checks.every(c=>c.status==='passed'));assert.equal(aircraft.relationship_checks.filter(c=>c.type==='dimension_ratio').length,1);
 await page.selectOption('#fixture-select','aligned-table');await page.click('#run-design');await page.waitForFunction(()=>document.querySelector('#engine-status').dataset.state==='planned');
 const alignedTable=JSON.parse(await page.locator('#engine-report').innerText());assert.ok(alignedTable.search.layout_candidates_generated>0);assert.ok(alignedTable.relationship_checks.every(c=>c.status==='passed'));await page.screenshot({path:'/tmp/brickforge-aligned-table.png',fullPage:true});
 await page.selectOption("#revision-select",revision);assert.equal(JSON.parse(await page.locator("#design-spec").inputValue()).components[0].colour,1);
 // A gateway is mocked only as transport/contract evidence, not real LLM quality.
 await page.locator(".description-panel").evaluate(el=>el.open=true);await page.fill("#description-input","A small vehicle with four rotating wheels.");await page.fill("#interpretation-endpoint","https://brickforge-gateway.example/interpret");
 const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
 const authored=await page.evaluate(async()=>{const r=await fetch('./data/design-spec-fixtures.json');return (await r.json()).fixtures.find(f=>f.design_id==='small-road-car');});
 await page.route('https://brickforge-gateway.example/interpret',route=>route.fulfill({status:route.request().method()==='OPTIONS'?204:200,headers:cors,contentType:'application/json',body:route.request().method()==='OPTIONS'?'':JSON.stringify({specification:authored})}));
 await page.click('#analyse-description');await page.waitForFunction(()=>document.querySelector('#engine-status').textContent.startsWith('Interpretation ready'));
 assert.equal(JSON.parse(await page.locator('#design-spec').inputValue()).design_id,'small-road-car');
 await page.unroute('https://brickforge-gateway.example/interpret');await page.route('https://brickforge-gateway.example/interpret',route=>route.fulfill({status:200,headers:cors,contentType:'application/json',body:JSON.stringify({schema_version:1,part_id:'fake'})}));
 await page.click('#analyse-description');await page.waitForFunction(()=>document.querySelector('#engine-status').dataset.state==='blocked');assert.match(await page.locator('#engine-status').innerText(),/does not match the design contract/);
 await page.fill('#interpretation-endpoint','https://brickforge-gateway.example/slow');await page.route('https://brickforge-gateway.example/slow',async route=>{await new Promise(resolve=>setTimeout(resolve,500));try{await route.fulfill({status:200,headers:cors,contentType:'application/json',body:JSON.stringify(authored)});}catch{}});
 await page.click('#analyse-description');await page.click('#cancel-interpretation');assert.match(await page.locator('#engine-status').innerText(),/analysis cancelled/);
 await page.selectOption("#fixture-select","challenge-car");await page.click("#run-design");await page.waitForFunction(()=>document.querySelector("#engine-status").dataset.state==="blocked");assert.equal(await page.locator("#download-ldraw").isEnabled(),false);
 await page.locator("#spec-details").evaluate(el=>el.open=true);await page.locator("#design-spec").fill("{");await page.click("#run-design");assert.equal(await page.locator("#engine-status").getAttribute("data-state"),"blocked");
 // URL transport accepts arbitrary authored specifications, independently of fixtures.
 const spec=await page.evaluate(async()=>{const r=await fetch("./data/design-spec-fixtures.json");return (await r.json()).fixtures[3];});
 await page.goto("http://127.0.0.1:4174/designer.html#"+new URLSearchParams({spec:JSON.stringify(spec),run:"1"}));
 await page.waitForFunction(()=>document.querySelector("#engine-status").dataset.state==="planned");
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"mobile layout overflows horizontally");
 await page.screenshot({path:'/tmp/brickforge-mobile.png',fullPage:true});
 await page.setViewportSize({width:1280,height:900});await page.goto('http://127.0.0.1:4174/index.html',{waitUntil:'domcontentloaded'});await page.screenshot({path:'/tmp/brickforge-home.png',fullPage:true});
 await page.getByRole('link',{name:/Open the design studio/}).click();await page.waitForFunction(()=>document.querySelector('#engine-status')?.dataset.state==='planned');assert.equal(await page.locator('#engine-parts').innerText(),'17');
 await page.getByRole('link',{name:'Engineering tools',exact:true}).click();assert.match(await page.locator('h1').innerText(),/workbench/);
 assert.equal(errors.length,0,errors.join(" | "));
 console.log(JSON.stringify({browser:"Chromium headless",fixture:"interlocked-structural-body",parts:4,connections:4,matingPairs:16,consoleErrors:errors.length}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
