import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createSupportTracker} from '../docs/assets/assembly-analysis.js';import {planDesign} from '../docs/assets/design-engine.js';
const read=async p=>JSON.parse(await readFile(new URL('../docs/data/'+p,import.meta.url))),cat=await read('connection-profiles/basic-bricks.json'),special=await read('specialist-profiles-v1.json'),fixtures=await read('design-spec-fixtures.json'),options={specialistCatalogue:special,partCatalogue:await read('part-capabilities-v1.json'),designTranslation:await read('design-translation-v1.json')},profiles=new Map([...cat.profiles,...special.profiles].map(p=>[p.part_id,p]));
const identity=[1,0,0,0,1,0,0,0,1],part=(id,x,floor=0,part_id='3005')=>({instance_id:id,part_id,matrix:identity,translation_ldu:[x/.4,-(floor+9.6)/.4,0]});
test('a cantilever flags support when its independently calculated envelope centre leaves the footprint',()=>{
 const tracker=createSupportTracker(profiles),first=tracker.add(part('base',0));assert.equal(first.projection_inside_support_hull,true);const second=tracker.add(part('overhang',12,9.6,'3001'));assert.ok(Math.abs(second.uniform_envelope_volume_centre_mm[0]-12*8/9)<1e-6);assert.equal(second.projection_inside_support_hull,false);assert.equal(first.projection_inside_support_hull,true);assert.deepEqual(first.contact_hull_xz_mm,[[-4,-4],[4,-4],[4,4],[-4,4]]);
});
test('a gradually lower floor discards contacts that leave the nominal contact band',()=>{
 const tracker=createSupportTracker(profiles);tracker.add(part('a',0));tracker.add(part('b',20,-.05));const stage=tracker.add(part('c',40,-.11));assert.ok(Math.abs(stage.floor_mm+.11)<1e-6);assert.equal(Math.min(...stage.contact_hull_xz_mm.map(p=>p[0])),16);assert.equal(Math.max(...stage.contact_hull_xz_mm.map(p=>p[0])),44);
});
test('a completed table can pass its balance proxy while earlier stages need hand support',()=>{
 const p=planDesign(structuredClone(fixtures.fixtures.find(s=>s.design_id==='table')),cat,options);assert.equal(p.status,'planned');assert.equal(p.analysis.support.projection_inside_support_hull,true);assert.ok(p.instructions.steps.some(s=>s.support_guidance.status==='hold_recommended'));assert.equal(p.instructions.steps.at(-1).support_guidance.status,'no_hold_flag');assert.ok(p.instructions.steps.every(s=>s.support_guidance.physical_stability_verified===false));assert.equal(p.validation.checks.find(c=>c.id==='intermediate_support_guidance').status,'warning');
});

test('the car begins with its broad supported chassis rather than a loose rolling tyre',()=>{
 const p=planDesign(structuredClone(fixtures.fixtures.find(s=>s.design_id==='small-road-car')),cat,options);assert.equal(p.status,'planned');const first=p.parts.find(part=>part.instance_id===p.instructions.steps[0].parts[0]);assert.equal(first.component_id,'chassis');assert.match(p.instructions.foundation_selection,/broad/);assert.ok(p.instructions.steps.some(s=>s.support_guidance.status==='hold_recommended'));
});
