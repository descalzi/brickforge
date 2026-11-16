import {pdfContentStreams} from './pdf-test-utils.mjs';
import {fitAttachmentPoses} from "../docs/assets/attachment-fitting.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {planDesign} from '../docs/assets/design-engine.js';
import {validateDesignSpec} from '../docs/assets/design-spec.js';
import {interpretDescription,endpointProvider,buildInterpretationRequest} from '../docs/assets/text-design.js';
import {createInstructionPdf} from '../docs/assets/instruction-pdf.js';
import {analyzeAssembly} from '../docs/assets/assembly-analysis.js';
const read=async p=>JSON.parse(await readFile(new URL('../docs/data/'+p,import.meta.url)));
const cat=await read('connection-profiles/basic-bricks.json'),special=await read('specialist-profiles-v1.json'),fixtures=await read('design-spec-fixtures.json');
const options={specialistCatalogue:special,partCatalogue:await read('part-capabilities-v1.json'),designTranslation:await read('design-translation-v1.json')},spec=id=>structuredClone(fixtures.fixtures.find(f=>f.design_id===id));
const profileMap=new Map([...cat.profiles,...special.profiles].map(p=>[p.part_id,p]));
test('connector pose expansion obeys its alternative and attempt budgets',()=>{
 const moving=matrix=>({parts:[{instance_id:'moving',part_id:'3005',matrix,translation_ldu:[0,-24,0]}]}),target={parts:[{instance_id:'anchor',part_id:'3001',matrix:[1,0,0,0,1,0,0,0,1],translation_ldu:[0,0,0]}]};
 const input={components:[{id:'a',position_tolerance_mm:8},{id:'b'}],relationships:[{type:'attached_to',from:'a',to:'b'}]},sets=[[moving([1,0,0,0,1,0,0,0,1]),moving([0,0,1,0,1,0,-1,0,0])],[target]];
 const fitted=fitAttachmentPoses(input,sets,profileMap,{maxAlternatives:3,maxAttempts:1000});assert.equal(fitted.sets[0].length,3);assert.equal(fitted.budget_exhausted,true);
 const bounded=fitAttachmentPoses(input,sets,profileMap,{maxAlternatives:20,maxAttempts:1});assert.equal(bounded.attempts,1);assert.equal(bounded.budget_exhausted,true);
});
test('four wheels flatten into real rim/tyre inventories and four directional wheel-pin joints',()=>{
 const p=planDesign(spec('small-road-car'),cat,options);assert.equal(p.status,'planned',p.failures?.join(' '));
 assert.equal(p.parts.filter(p=>p.part_id==='3641').length,4);assert.equal(p.parts.filter(p=>p.part_id==='4624').length,4);assert.equal(p.parts.filter(p=>p.part_id==='4600').length,2);
 const wheelEdges=p.connections.flatMap(e=>e.mating_pairs).filter(m=>m.connection_type==='wheel_pin_bore'),seats=p.connections.flatMap(e=>e.mating_pairs).filter(m=>m.connection_type==='rim_tyre_seat');assert.equal(wheelEdges.length,4);assert.equal(seats.length,4);assert.ok(wheelEdges.every(e=>e.physical_connection_verified===false));
 assert.equal(p.analysis.body_envelope_collisions.length,0);assert.equal(p.analysis.support.projection_inside_support_hull,true);assert.ok(p.instructions.steps.every(s=>s.nominal_approach_clear));
 assert.equal(p.bom.items.reduce((n,p)=>n+p.quantity,0),p.parts.length);assert.ok(p.parts.every(p=>!p.part_id.includes('assembly')));
});
test('explicit uncertainty fits approximate wheels to real nominal joints and reports actual dimensions',()=>{
 const s=spec('approximate-road-car'),p=planDesign(s,cat,options);assert.equal(p.status,'planned',p.failures?.join(' '));assert.ok(p.search.pose_candidates_generated>0);const reports=p.component_reports.filter(r=>r.component_id.endsWith('wheel'));assert.equal(reports.length,4);for(const r of reports){assert.ok(r.position_adjustment_mm.every(v=>Math.abs(v)<=2));assert.ok(r.position_adjustment_mm.some(v=>Math.abs(v)>.1));assert.ok(Math.abs(r.realised_dimensions_mm.height-14.4)<1e-6);}
 assert.ok(Math.abs(p.dimensions_mm.width-30.4)<1e-6);assert.equal(p.requested_dimensions_mm.width,32);assert.equal(JSON.stringify(s).includes('part_id'),false);
 const strict=spec('small-road-car');strict.components.find(c=>c.id==='front-left-wheel').position_mm.x-=.5;assert.equal(planDesign(strict,cat,options).status,'blocked');strict.components.find(c=>c.id==='front-left-wheel').position_tolerance_mm=1;assert.equal(planDesign(strict,cat,options).status,'planned');
});
test('explicit component colour applies to every element of a compound wheel',()=>{const s=spec('small-road-car');s.components.find(c=>c.id==='front-left-wheel').colour=1;const p=planDesign(s,cat,options);assert.ok(p.parts.filter(p=>p.component_id==='front-left-wheel').every(p=>p.colour_code===1));});
test('a displaced wheel or wrong bore axis is rejected instead of a visually plausible floating wheel',()=>{
 const s=spec('small-road-car');s.components.find(c=>c.id==='front-left-wheel').position_mm.x-=.5;assert.equal(planDesign(s,cat,options).status,'blocked');
 const broken=structuredClone(special);broken.profiles.find(p=>p.part_id==='4624').features.find(f=>f.kind==='wheel_bore').axis=[0,1,0];assert.equal(planDesign(spec('small-road-car'),cat,{...options,specialistCatalogue:broken}).status,'blocked');
});
test('an incompatible rim seat family is rejected even when its centre and axis match',()=>{const broken=structuredClone(special);broken.profiles.find(p=>p.part_id==='3641').features.find(f=>f.kind==='tyre_seat').fit_key='other-seat-family';assert.equal(planDesign(spec('small-road-car'),cat,{...options,specialistCatalogue:broken}).status,'blocked');});
test('tapered wings remain dedicated mirrored source elements and connect through a bridge',()=>{const p=planDesign(spec('tapered-aircraft'),cat,options);assert.equal(p.status,'planned');assert.ok(['3933','3934'].every(id=>p.parts.some(p=>p.part_id===id)));assert.ok(p.parts.some(p=>p.part_id==='3006'));assert.equal(p.parts.length,4);});
test('declared dimension tolerance permits a bounded adjustment; exact intent remains exact',()=>{
 const s=spec('interlocked-structural-body');s.components[0].dimensions_mm.width+=1;s.components[0].dimensions_mm.depth+=1;assert.equal(planDesign(s,cat,options).status,'blocked');s.components[0].fit_tolerance_mm=1;const p=planDesign(s,cat,options);assert.equal(p.status,'planned',p.failures?.join(' '));const r=p.component_reports[0];assert.equal(r.allowed_deviation_mm,1);assert.equal(r.realised_dimensions_mm.width,r.requested_dimensions_mm.width-1);s.components[0].fit_tolerance_mm=5;assert.equal(validateDesignSpec(s).valid,false);
});
test('support projection is a heuristic and does not certify physical stability',()=>{const p=planDesign(spec('small-road-car'),cat,options);assert.match(p.analysis.support.evidence,/proxy/);assert.equal(p.validation.checks.find(c=>c.id==='structural_stability').status,'not_assessed');const moved=structuredClone(p.parts);moved.find(p=>p.part_id==='60592').translation_ldu[0]+=3000;const report=analyzeAssembly(moved,p.connections,profileMap);assert.equal(report.support.projection_inside_support_hull,false);});
test('provider-independent interpretation validates output, retains uncertainty and rejects part prescriptions',async()=>{
 const s=spec('small-road-car'),schema=await read('design-spec-schema-v1.json');let sent;
 const out=await interpretDescription('A small vehicle with four rotating wheels.',{responseSchema:schema,provider:async request=>{sent=request;return {specification:s};}});assert.equal(out.specification.design_id,s.design_id);assert.match(sent.input,/four rotating wheels/);assert.match(sent.instructions,/Never specify part IDs/);assert.equal(sent.response_schema.schema_version,undefined);
 await assert.rejects(()=>interpretDescription('Something unfamiliar.',{responseSchema:schema,provider:async()=>({...s,part_id:'3001'})}),/Unknown design specification property/);
 assert.throws(()=>buildInterpretationRequest('',schema),/description/);assert.throws(()=>endpointProvider('http://example.com'),/HTTPS/);
 const controller=new AbortController();controller.abort();await assert.rejects(()=>interpretDescription('Vehicle',{responseSchema:schema,signal:controller.signal,provider:async()=>s}),{name:'AbortError'});
});
test('gateway transport sends only the explicit interpretation request without browser credentials',async()=>{
 let call;const provider=endpointProvider('https://gateway.example/interpret',async(url,init)=>{call={url,init};return {ok:true,json:async()=>spec('small-road-car')};});await provider({input:'red vehicle'});assert.equal(call.init.credentials,'omit');assert.equal(call.init.referrerPolicy,'no-referrer');assert.equal(call.init.method,'POST');assert.equal(JSON.parse(call.init.body).input,'red vehicle');
});
test('instruction PDF has consistent xref offsets and an inventory derived from the plan',async()=>{
 const s=spec('small-road-car'),p=planDesign(s,cat,options),display={...cat,profiles:[...cat.profiles,...await Promise.all(special.profiles.map(async p=>({...p,preview_triangles_mm:(await read(p.mesh_file)).triangle_positions_mm})))],pdf_font:await read('pdf-font-v1.json')};
 const bytes=await createInstructionPdf(p,display,s),pdf=Buffer.from(bytes).toString('latin1'),content=pdfContentStreams(bytes).join('\n');assert.ok(pdf.startsWith('%PDF-1.4'));assert.match(pdf,/\/Type \/Pages \/Count 12/);assert.match(content,/Parts inventory/);assert.match(content,/STEP 17/);assert.match(content,/Hold \/ support this stage/);assert.match(content,/Your model, assembled/);assert.match(pdf,/\/Subtype \/Image/);assert.ok(bytes.length<3000000);assert.match(pdf,/FontFile2/);assert.match(content,/per-file licence notices/);
 const xref=Number(pdf.match(/startxref\n(\d+)/)[1]);assert.equal(pdf.slice(xref,xref+4),'xref');const offsets=pdf.slice(xref).match(/\d{10} 00000 n/g).map(x=>Number(x.slice(0,10)));offsets.forEach((offset,i)=>assert.ok(pdf.slice(offset).startsWith((i+1)+' 0 obj')));
});
test('published language schema is the canonical specification schema',async()=>{assert.deepEqual(await read('design-spec-schema-v1.json'),JSON.parse(await readFile(new URL('../schemas/design-spec-v1.schema.json',import.meta.url))));});
