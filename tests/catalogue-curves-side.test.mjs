import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {planDesign} from '../docs/assets/design-engine.js';import {nominalBodiesIntersect,nominalBodyIntersectsBox} from '../docs/assets/nominal-collision.js';import {pruneUnsupportedPrismFaces} from '../docs/assets/prism-face-pruning.js';import {orientationMatches} from '../docs/assets/part-orientation.js';
const read=async p=>JSON.parse(await readFile(new URL('../docs/data/'+p,import.meta.url))),cat=await read('connection-profiles/basic-bricks.json'),special=await read('specialist-profiles-v1.json'),fixtures=await read('design-spec-fixtures.json'),options={specialistCatalogue:special,partCatalogue:await read('part-capabilities-v1.json'),designTranslation:await read('design-translation-v1.json')},profiles=new Map([...cat.profiles,...special.profiles].map(p=>[p.part_id,p]));
const brief=id=>structuredClone(fixtures.fixtures.find(s=>s.design_id===id));const planned=s=>{const p=planDesign(s,cat,options);assert.equal(p.status,'planned',p.failures?.join(' '));return p;};
test('side panel uses a recessed horizontal interface and a rigidly rotated standard plate',()=>{
 const s=brief('side-mounted-panel'),before=JSON.stringify(s),p=planned(s),mount=p.parts.find(p=>p.component_id==='mount'),panel=p.parts.find(p=>p.component_id==='panel');assert.equal(JSON.stringify(s),before);assert.equal(mount.part_id,'4070');assert.equal(panel.part_id,'3024');assert.ok(orientationMatches(panel.matrix,{up:'+z'},{up:[0,-1,0]}));assert.equal(p.analysis.body_envelope_collisions.length,0);assert.ok(p.connections.some(e=>[e.instance_a,e.instance_b].includes(mount.instance_id)&&[e.instance_a,e.instance_b].includes(panel.instance_id)));assert.equal(p.instructions.steps.length,4);assert.equal(p.instructions.steps.at(-1).insertion_path_verified,false);
 const boundsOnly={...profiles.get('4070')};delete boundsOnly.body_boxes_mm;assert.equal(nominalBodiesIntersect(mount,boundsOnly,panel,profiles.get('3024')),true);assert.equal(nominalBodiesIntersect(mount,profiles.get('4070'),panel,profiles.get('3024')),false);
 const shifted=structuredClone(panel);shifted.translation_ldu[2]+=1;assert.equal(nominalBodiesIntersect(mount,profiles.get('4070'),shifted,profiles.get('3024')),true);
});
test('wrong recessed datum, panel face and side mount direction fail closed',()=>{
 for(const mutate of [s=>s.components[2].position_mm.z+=1.6,s=>s.components[2].orientation.up='-z',s=>s.components[1].orientation.forward='-z']){const s=brief('side-mounted-panel');mutate(s);const p=planDesign(s,cat,options);assert.equal(p.status,'blocked');assert.equal(p.parts.length,0);}
});
test('curved source keeps the measured arc and only the flat front receiver row',()=>{
 const profile=profiles.get('15068');assert.equal(profile.body_geometry_evidence,'source_silhouette_vertices');assert.equal(profile.features.length,2);assert.ok(profile.features.every(f=>f.kind==='stud_receiver'&&f.position_ldu[1]===0&&f.position_ldu[2]===-10));assert.ok(profile.body_vertices_mm.some(v=>Math.abs(v[1]+5.84144616)<1e-8&&Math.abs(v[2]-2.144)<1e-8));
 for(const width of [16,32,48]){const s=brief('curved-canopy');for(const c of s.components)c.dimensions_mm.width=width;s.components[1].geometry_parameters.depth_mm=width;const p=planned(s);assert.equal(p.parts.filter(p=>p.part_id==='15068').length,width/16);assert.equal(p.analysis.body_envelope_collisions.length,0);}
});
test('one concave curved material region composes a source curve and plinth without filling the rear recess',()=>{
 const s=brief('composed-curved-plinth'),p=planned(s);assert.deepEqual(p.parts.map(p=>p.part_id).sort(),['15068','3022']);assert.equal(p.component_reports[0].composition.method,'exact_prism_material_cover');assert.ok(Number.isInteger(p.component_reports[0].composition.boundary_candidates_pruned));
 const voidBox={min:[0,3.3,12],max:[16,4.5,15.9]};assert.ok(p.parts.every(part=>!nominalBodyIntersectsBox(part,profiles.get(part.part_id),voidBox)));
 s.components[0].forbidden_features=['curved'];assert.equal(planDesign(s,cat,options).status,'blocked');
});
test('a required curve cannot be replaced by straight slopes or a bounding box',()=>{
 const noCurve={...options,specialistCatalogue:{...special,profiles:special.profiles.filter(p=>p.part_id!=='15068')}};const p=planDesign(brief('curved-canopy'),cat,noCurve);assert.equal(p.status,'blocked');assert.equal(p.parts.length,0);
});
test('shallower source slope and 8 mm narrow roof extrusion preserve distinct measured profiles',()=>{
 const shallow=planned(brief('shallow-canopy'));assert.equal(shallow.parts.filter(p=>p.part_id==='3298').length,2);
 const thin=brief('composed-pitched-roof');for(const c of thin.components){c.dimensions_mm.depth=8;if(c.geometry_parameters)c.geometry_parameters.depth_mm=8;}const p=planned(thin);assert.equal(p.parts.filter(p=>p.part_id==='3040b').length,4);assert.ok(!p.parts.some(p=>['3037','3039'].includes(p.part_id)));
});
test('wider round column retains four top and bottom datums',()=>{
 const s=brief('curved-canopy');s.components[1]={id:'column',role:'support',geometry:'cylinder',geometry_parameters:{axis:'y',diameter_mm:16},dimensions_mm:{width:16,height:9.6,depth:16},position_mm:{x:0,y:3.2,z:0},required_features:['round_column'],priority:'essential'};s.relationships=[{type:'attached_to',from:'column',to:'base'}];const p=planned(s);assert.ok(p.parts.some(p=>p.part_id==='3941'));assert.equal(profiles.get('3941').features.length,8);
});
test('necessary face pruning retains a valid cover and removes an unsupported internal slope',()=>{
 const outline=[[0,0],[16,0],[16,8],[0,8]],a={polygon:[[0,0],[8,0],[8,8],[0,8]],lo:0,hi:8},b={polygon:[[8,0],[16,0],[16,8],[8,8]],lo:0,hi:8},bad={polygon:[[0,0],[8,0],[0,4]],lo:0,hi:8};const r=pruneUnsupportedPrismFaces([a,b,bad],outline,8);assert.deepEqual(r.candidates,[a,b]);assert.equal(r.removed,1);assert.deepEqual(pruneUnsupportedPrismFaces([{...a,polygon:[...a.polygon].reverse()},{...b,polygon:[...b.polygon].reverse()}],[...outline].reverse(),8).candidates.length,2);
});
