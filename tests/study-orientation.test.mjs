import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {planDesign} from '../docs/assets/design-engine.js';import {orientationMatches,reorientExtrudedComponent} from '../docs/assets/part-orientation.js';import {validateDesignSpec} from '../docs/assets/design-spec.js';import {rasterizeInstructionFaces} from '../docs/assets/instruction-rasterizer.js';import {partBodyBounds} from '../docs/assets/assembly-analysis.js';
const read=async p=>JSON.parse(await readFile(new URL('../docs/data/'+p,import.meta.url))),cat=await read('connection-profiles/basic-bricks.json'),special=await read('specialist-profiles-v1.json'),fixtures=await read('design-spec-fixtures.json'),options={specialistCatalogue:special,partCatalogue:await read('part-capabilities-v1.json'),designTranslation:await read('design-translation-v1.json')},profiles=new Map([...cat.profiles,...special.profiles].map(p=>[p.part_id,p])),brief=id=>structuredClone(fixtures.fixtures.find(s=>s.design_id===id));
test('mushroom uses the central base stud and true central dome receiver with concentric bounds',()=>{
 const s=brief('rounded-mushroom'),p=planDesign(s,cat,options);assert.equal(p.status,'planned',p.failures?.join(' '));assert.equal(p.parts.length,3);assert.ok(p.parts.some(p=>p.part_id==='11212'));
 const centres=p.parts.map(p=>{const b=partBodyBounds(p,profiles.get(p.part_id));return [0,2].map(i=>(b.min[i]+b.max[i])/2);});assert.ok(centres.every(c=>c.every((v,i)=>Math.abs(v-centres[0][i])<1e-6)));
 assert.ok(p.connections.some(e=>e.mating_pairs.some(m=>m.feature_a==='central-tube-receiver'||m.feature_b==='central-tube-receiver')));assert.ok(p.relationship_checks.every(c=>c.status==='passed'));
 const dome=profiles.get('30367');assert.equal(dome.features.filter(f=>f.kind==='stud').length,1);assert.deepEqual(dome.features.find(f=>f.kind==='stud').position_ldu,[0,0,0]);
 s.components.find(c=>c.id==='stem').position_mm.x-=4;assert.equal(planDesign(s,cat,options).status,'blocked');
});
test('both car slopes point downhill towards the front, independently of the camera',()=>{
 const s=brief('small-road-car'),p=planDesign(s,cat,options);assert.equal(p.status,'planned');for(const id of ['bonnet','roof']){const parts=p.parts.filter(p=>p.component_id===id);assert.ok(parts.length);for(const part of parts)assert.ok(orientationMatches(part.matrix,{up:'+y',forward:'-z'},profiles.get(part.part_id).orientation_frame));}
 const bonnet=s.components.find(c=>c.id==='bonnet');bonnet.orientation.forward='+x';assert.equal(planDesign(s,cat,options).status,'blocked');
});
test('the same shape can face the other direction when its outline and frame agree',()=>{
 const s=brief('small-road-car'),bonnet=s.components.find(c=>c.id==='bonnet');bonnet.orientation.forward='+z';bonnet.geometry_parameters.outline_mm=bonnet.geometry_parameters.outline_mm.map(([z,y])=>[16-z,y]);const p=planDesign(s,cat,options);assert.equal(p.status,'planned',p.failures?.join(' '));const part=p.parts.find(p=>p.component_id==='bonnet');assert.ok(orientationMatches(part.matrix,bonnet.orientation,profiles.get(part.part_id).orientation_frame));
});
test('source direction requirements reject unknown, parallel or unsupported axes',()=>{
 for(const orientation of [{up:'north'},{up:'+y',forward:'-y'},{side:'+x'},{}]){const s=brief('small-road-car');s.components[0].orientation=orientation;assert.equal(validateDesignSpec(s).valid,false);}
 const s=brief('small-road-car');s.components[0].orientation={forward:'+x'};assert.equal(planDesign(s,cat,options).status,'blocked');
});
test('depth buffering handles intersecting triangles independently of draw order',()=>{
 const far={points:[[0,0,0],[8,0,0],[0,8,0]],colour:[1,0,0]},crossing={points:[[0,0,3],[8,0,-3],[0,8,3]],colour:[0,0,1]};
 const pixels=rasterizeInstructionFaces([far,crossing],8,8),reverse=rasterizeInstructionFaces([crossing,far],8,8);assert.deepEqual(pixels,reverse);assert.deepEqual([...pixels.slice((1*8+1)*3,(1*8+1)*3+3)],[0,0,255]);assert.deepEqual([...pixels.slice((0*8+6)*3,(0*8+6)*3+3)],[255,0,0]);
});

test('facing edits rotate non-square shape bounds about their centre without changing the source brief',()=>{
 const s=brief('sloped-canopy'),c=s.components.find(c=>c.geometry==='extruded_profile'),copy=structuredClone(c),rotated=reorientExtrudedComponent(c,'-z');
 assert.deepEqual(c,copy);assert.equal(rotated.geometry_parameters.extrusion_axis,'x');assert.equal(rotated.dimensions_mm.width,c.dimensions_mm.depth);assert.equal(rotated.dimensions_mm.depth,c.dimensions_mm.width);assert.equal(rotated.position_mm.x+rotated.dimensions_mm.width/2,c.position_mm.x+c.dimensions_mm.width/2);
 const base=s.components.find(c=>c.geometry==='rectangular_prism'),d=base.dimensions_mm,p=base.position_mm,cx=p.x+d.width/2,cz=p.z+d.depth/2;[d.width,d.depth]=[d.depth,d.width];p.x=cx-d.width/2;p.z=cz-d.depth/2;s.components=[base,rotated];assert.equal(validateDesignSpec(s).valid,true);assert.equal(planDesign(s,cat,options).status,'planned');
 const reverse=reorientExtrudedComponent(rotated,'+z');assert.notDeepEqual(reverse.geometry_parameters.outline_mm,rotated.geometry_parameters.outline_mm);
});
