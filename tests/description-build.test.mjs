import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {interpretPlate} from '../docs/assets/plate-description.js';
import {planDesign} from '../docs/assets/design-engine.js';
import {partBodyBounds} from '../docs/assets/assembly-analysis.js';
import {interpretDescription} from '../docs/assets/text-design.js';
import {deviceProvider,deviceModelState} from '../docs/assets/device-interpretation.js';
const read=async file=>JSON.parse(await readFile(new URL('../docs/data/'+file,import.meta.url)));
const catalogue=await read('connection-profiles/basic-bricks.json');
const options={specialistCatalogue:await read('specialist-profiles-v1.json'),partCatalogue:await read('part-capabilities-v1.json'),designTranslation:await read('design-translation-v1.json')};
const schema=await read('design-spec-schema-v1.json');

for(const [description,width,depth,holes,walls] of [
 ['a plate with 4 holes and 2 side walls',8,6,4,2],
 ['a blue 10 by 6 stud plate with four square through-holes and two side walls 2 bricks high',10,6,4,2],
 ['a red 6 x 4 plate',6,4,0,0],
 ['a 6 by 6 plate with four holes',6,6,4,0],
 ['please build me a 8 by 8 plate with nine openings and one side wall',8,8,9,1]
]){
 test('description constructs with the requested dimensions and clear openings: '+description,()=>{
  const spec=interpretPlate(description),plan=planDesign(spec,catalogue,options);
  assert.equal(plan.status,'planned',plan.failures?.join(' '));
  assert.equal(spec.components.length,1+walls);
  assert.equal(spec.negative_spaces.length,holes);
  assert.equal(plan.dimensions_mm.width,width*8);
  assert.equal(plan.dimensions_mm.depth,depth*8);
  const profiles=new Map(catalogue.profiles.map(p=>[p.part_id,p]));
  for(const part of plan.parts)for(const space of spec.negative_spaces){
   const b=partBodyBounds(part,profiles.get(part.part_id)),lo=[space.position_mm.x,space.position_mm.y,space.position_mm.z];
   const hi=[lo[0]+space.dimensions_mm.width,lo[1]+space.dimensions_mm.height,lo[2]+space.dimensions_mm.depth];
   assert.ok(![0,1,2].every(i=>Math.min(hi[i],b.max[i])-Math.max(lo[i],b.min[i])>1e-6));
  }
  assert.equal(plan.validation.checks.find(c=>c.id==='graph_connectivity').status,'passed');
 });
}
test('unsupported prose and impossible openings stay explicit',()=>{
 for(const text of ['a plate with round holes','a plate without holes','a plate with 4 holes and a propeller','a plate with 4 holes and 3 holes','a 3 x 3 plate with 4 holes','a 30 by 2 plate']){
  assert.throws(()=>interpretPlate(text));
 }
});

test('on-device adapter constrains output and releases the model after valid and invalid responses',async()=>{
 let destroyed=0;
 const model={async availability(){return 'available';},async create(settings){
  assert.ok(settings.initialPrompts[0].content.includes('Never specify part IDs'));
  return {async prompt(input,opts){assert.ok(opts.responseConstraint.properties.components.items.properties.geometry);return input==='bad'?'not json':JSON.stringify(interpretPlate('a plate'));},destroy(){destroyed++;}};
 }};
 assert.equal(await deviceModelState(model),'available');
 const provider=deviceProvider(model);
 const result=await interpretDescription('a plate',{provider,responseSchema:schema});
 assert.equal(result.specification.components[0].role,'base');
 await assert.rejects(interpretDescription('bad',{provider,responseSchema:schema}),/invalid JSON/);
 assert.equal(destroyed,2);
 assert.equal(await deviceModelState({}),'unavailable');
});

test('on-device cancellation during model creation disposes a late session and prevents inference',async()=>{
 const controller=new AbortController();
 let destroyed=false,prompted=false;
 const model={async create(){controller.abort();return {prompt(){prompted=true;},destroy(){destroyed=true;}};}};
 await assert.rejects(interpretDescription('a plate',{provider:deviceProvider(model),responseSchema:schema,signal:controller.signal}),{name:'AbortError'});
 assert.equal(destroyed,true);
 assert.equal(prompted,false);
});
