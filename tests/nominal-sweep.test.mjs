import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {nominalBodySweepIntersects,nominalBodiesIntersect} from '../docs/assets/nominal-collision.js';import {planDesign} from '../docs/assets/design-engine.js';import {clearApproach} from '../docs/assets/assembly-analysis.js';
const read=async p=>JSON.parse(await readFile(new URL('../docs/data/'+p,import.meta.url))),cat=await read('connection-profiles/basic-bricks.json'),special=await read('specialist-profiles-v1.json'),options={specialistCatalogue:special,partCatalogue:await read('part-capabilities-v1.json'),designTranslation:await read('design-translation-v1.json')},profiles=new Map([...cat.profiles,...special.profiles].map(p=>[p.part_id,p])),fixtures=await read('design-spec-fixtures.json');
const part=(id,x,y,z)=>({instance_id:id,part_id:'3024',matrix:[1,0,0,0,1,0,0,0,1],translation_ldu:[x/.4,-y/.4,-z/.4]});
test('continuous sweep catches an obstacle between two clear endpoint poses',()=>{
 const p=profiles.get('3024'),moving=part('moving',0,0,0),obstacle=part('obstacle',0,10,0),end=part('end',0,20,0);assert.equal(nominalBodiesIntersect(moving,p,obstacle,p),false);assert.equal(nominalBodiesIntersect(end,p,obstacle,p),false);assert.equal(nominalBodySweepIntersects(moving,p,[0,1,0],20,obstacle,p),true);assert.equal(nominalBodySweepIntersects(moving,p,[1,0,0],20,obstacle,p),false);
});
test('sweep respects face contact, zero displacement and invalid directions',()=>{
 const p=profiles.get('3024'),a=part('a',0,0,0),b=part('b',8,0,0);assert.equal(nominalBodySweepIntersects(a,p,[0,1,0],20,b,p),false);assert.equal(nominalBodySweepIntersects(a,p,[1,0,0],0,b,p),false);assert.equal(nominalBodySweepIntersects(a,p,[1,0,0],.1,b,p),true);assert.throws(()=>nominalBodySweepIntersects(a,p,[1,1,0],20,b,p));assert.throws(()=>nominalBodySweepIntersects(a,p,[1,0,0],-1,b,p));
});
test('recessed side joint has a clear compound-body approach and a horizontal instruction arrow',()=>{
 const spec=fixtures.fixtures.find(s=>s.design_id==='side-mounted-panel'),p=planDesign(spec,cat,options);assert.equal(p.status,'planned',p.failures?.join(' '));const panel=p.parts.find(p=>p.component_id==='panel'),step=p.instructions.steps.find(s=>s.parts.includes(panel.instance_id));assert.equal(step.nominal_approach_clear,true);assert.deepEqual(step.approach_direction,[0,0,1]);assert.equal(step.approach_evidence,'continuous_nominal_body_sweep');assert.equal(step.insertion_path_verified,false);assert.equal(p.parts.find(q=>q.instance_id===p.instructions.steps[0].parts[0]).part_id,'3003');
 const built=new Set(p.parts.filter(x=>x!==panel).map(x=>x.instance_id)),map=new Map(p.parts.map(p=>[p.instance_id,p]));const blocker={...panel,instance_id:'blocker',translation_ldu:panel.translation_ldu.map((v,i)=>i===2?v-30:v)};built.add(blocker.instance_id);map.set(blocker.instance_id,blocker);assert.equal(clearApproach(panel,built,map,p.connections,profiles).clear,false);
});
test('swept convex prism keeps a source-profile clearance that its bounding box loses',()=>{
 const p=special.profiles.find(p=>p.part_id==='3039'),a={instance_id:'slope',part_id:'3039',matrix:[1,0,0,0,1,0,0,0,1],translation_ldu:[0,0,0]},b={...a,instance_id:'upper',translation_ldu:[0,-20,-25]};assert.equal(nominalBodySweepIntersects(a,p,[1,0,0],10,b,p),false);b.translation_ldu[2]+=5;assert.equal(nominalBodySweepIntersects(a,p,[1,0,0],10,b,p),true);
});
test('one straight approach must satisfy every already engaged interface axis',()=>{
 const base=profiles.get('3024'),custom={...base,features:[{feature_id:'down',axis:[0,1,0],kind:'stud_receiver'},{feature_id:'side',axis:[1,0,0],kind:'stud_receiver'}]},moving={...part('moving',0,0,0),part_id:'custom'},a=part('a',100,100,100),b=part('b',-100,100,100),map=new Map([moving,a,b].map(p=>[p.instance_id,p])),profileMap=new Map([...profiles,['custom',custom]]),edges=[{instance_a:'moving',instance_b:'a',mating_pairs:[{feature_a:'down'}]},{instance_a:'moving',instance_b:'b',mating_pairs:[{feature_a:'side'}]}];assert.equal(clearApproach(moving,new Set(['a','b']),map,edges,profileMap).clear,false);
});
import {instructionViewYaw} from '../docs/assets/instruction-pdf.js';
test('side-joint booklet view looks toward the incoming face and keeps a consistent upright view',()=>{
 for(const d of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]){const yaw=instructionViewYaw(d),view=[-Math.sin(yaw),0,Math.cos(yaw)];assert.ok(view.reduce((s,v,i)=>s+v*d[i],0)>.85);}assert.equal(instructionViewYaw([0,1,0]),instructionViewYaw(null));
});
