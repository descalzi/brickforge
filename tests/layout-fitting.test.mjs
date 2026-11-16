import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {layoutTranslationProposals} from '../docs/assets/layout-fitting.js';
import {fitAttachmentPoses} from '../docs/assets/attachment-fitting.js';
import {planDesign} from '../docs/assets/design-engine.js';
const read=async p=>JSON.parse(await readFile(new URL('../docs/data/'+p,import.meta.url)));
const catalogue=await read('connection-profiles/basic-bricks.json'),fixtures=await read('design-spec-fixtures.json'),options={specialistCatalogue:await read('specialist-profiles-v1.json'),partCatalogue:await read('part-capabilities-v1.json'),designTranslation:await read('design-translation-v1.json')};
const brief=id=>structuredClone(fixtures.fixtures.find(s=>s.design_id===id));
test('combined alignment axes and reverse offsets use world millimetres',()=>{
 const source={min:[.5,20,.7],max:[32.5,39.2,32.7]},target={min:[0,0,0],max:[8,19.2,8]};
 const rs=['x','y','z'].map(axis=>({type:'aligned_with',from:'top',to:'leg',axis,from_anchor:'min',to_anchor:axis==='y'?'max':'min'}));
 const ds=layoutTranslationProposals(rs,'top','leg',source,target);assert.ok(ds[0].every((v,i)=>Math.abs(v-[-1.25,2,1.75][i])<1e-6));
 const r={type:'aligned_with',from:'a',to:'b',axis:'z',anchor:'min',offset_mm:2};
 assert.deepEqual(layoutTranslationProposals([r],'b','a',target,source),[[0,0,3.25]]);
});
function displacedTable(){const s=brief('table'),top=s.components.find(c=>c.id==='top');top.position_mm={x:.5,y:19.6,z:-.7};top.position_tolerance_mm=1;s.relationships=['x','y','z'].map(axis=>({type:'aligned_with',from:'top',to:'leg-front-left',axis,from_anchor:'min',to_anchor:axis==='y'?'max':'min',tolerance_mm:.001}));return s;}
test('layout intent fits a displaced tabletop without prescribing an attachment edge',()=>{
 const s=displacedTable(),p=planDesign(s,catalogue,options);assert.equal(p.status,'planned',p.failures?.join(' '));assert.ok(p.search.layout_candidates_generated>0);assert.ok(p.relationship_checks.every(c=>c.status==='passed'));const top=p.component_reports.find(c=>c.component_id==='top');assert.ok(top.position_adjustment_mm.every((v,i)=>Math.abs(v-[-.5,-.4,.7][i])<1e-6));assert.ok(p.connections.length>0);
 s.components.find(c=>c.id==='top').position_tolerance_mm=.2;assert.equal(planDesign(s,catalogue,options).status,'blocked');
});
test('mirror-plane placement restores displaced wings and still verifies their actual joints',()=>{
 const s=brief('tapered-aircraft'),wing=s.components.find(c=>c.id==='right-wing');wing.position_mm.x+=.5;wing.position_mm.y+=.4;wing.position_mm.z-=.7;wing.position_tolerance_mm=1;
 const p=planDesign(s,catalogue,options);assert.equal(p.status,'planned',p.failures?.join(' '));assert.ok(p.search.layout_candidates_generated>0);assert.ok(p.relationship_checks.every(c=>c.status==='passed'));assert.ok(p.connections.some(e=>e.instance_a.startsWith('right-wing')||e.instance_b.startsWith('right-wing')));
});
test('layout suggestions cannot fill keepout volumes or exceed their shared attempt budget',()=>{
 const identity=[1,0,0,0,1,0,0,0,1],part=(id,x)=>({parts:[{instance_id:id,component_id:id,part_id:'3005',matrix:identity,translation_ldu:[x,-24,0]}]}),profiles=new Map(catalogue.profiles.map(p=>[p.part_id,p]));
 const s={components:[{id:'a',position_tolerance_mm:8},{id:'b'}],relationships:[{type:'aligned_with',from:'a',to:'b',axis:'x',anchor:'center'}],negative_spaces:[{position_mm:{x:-4,y:0,z:-4},dimensions_mm:{width:8,height:9.6,depth:8}}]},sets=[[part('a',10)],[part('b',0)]];
 const r=fitAttachmentPoses(s,sets,profiles);assert.equal(r.generated,0);s.negative_spaces=[];const limited=fitAttachmentPoses(s,sets,profiles,{maxAttempts:1});assert.equal(limited.attempts,1);assert.equal(limited.budget_exhausted,true);
});
