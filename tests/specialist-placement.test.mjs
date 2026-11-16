import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {planDesign} from '../docs/assets/design-engine.js';
import {worldBodyBounds} from '../docs/assets/specialist-placement.js';
const read=async p=>JSON.parse(await readFile(new URL('../docs/data/'+p,import.meta.url)));
const catalogue=await read('connection-profiles/basic-bricks.json'),fixtures=await read('design-spec-fixtures.json');
const options={partCatalogue:await read('part-capabilities-v1.json'),designTranslation:await read('design-translation-v1.json'),specialistCatalogue:await read('specialist-profiles-v1.json')};
const specimen=id=>structuredClone(fixtures.fixtures.find(f=>f.design_id===id));
test('window and opposed roof profiles compose with ordinary structural parts',()=>{
 const spec=specimen('windowed-pavilion'),plan=planDesign(spec,catalogue,options);
 assert.equal(plan.status,'planned',plan.failures?.join(' '));
 assert.ok(plan.parts.some(p=>p.part_id==='60592'));
 const slopes=plan.parts.filter(p=>p.component_id.includes('roof'));
 assert.ok(slopes.length>=2);assert.ok(slopes.every(p=>['3037','3039'].includes(p.part_id)));
 assert.notDeepEqual(slopes.find(p=>p.component_id==='left-roof').matrix,slopes.find(p=>p.component_id==='right-roof').matrix);
 const components=new Map(plan.parts.map(p=>[p.instance_id,p.component_id]));
 for(const relation of spec.relationships)assert.ok(plan.connections.some(e=>new Set([components.get(e.instance_a),components.get(e.instance_b)]).has(relation.from)&&new Set([components.get(e.instance_a),components.get(e.instance_b)]).has(relation.to)));
 for(const part of slopes){const profile=options.specialistCatalogue.profiles.find(p=>p.part_id===part.part_id),bounds=worldBodyBounds(part,profile),component=spec.components.find(c=>c.id===part.component_id);assert.ok(Math.abs(bounds.min[1]-component.position_mm.y)<1e-6);assert.ok(Math.abs(bounds.max[1]-(component.position_mm.y+component.dimensions_mm.height))<1e-6);}
});
test('repeated constant cross-sections cover a long, unseen extrusion and export real parts',()=>{
 const spec=specimen('sloped-canopy');spec.design_id='unseen-length';spec.components.forEach(c=>{c.dimensions_mm.depth=64;if(c.geometry_parameters)c.geometry_parameters.depth_mm=64;});
 const plan=planDesign(spec,catalogue,options);assert.equal(plan.status,'planned',plan.failures?.join(' '));
 const slopes=plan.parts.filter(p=>p.component_id==='ramp');assert.ok(slopes.length>=2);
 assert.equal(plan.bom.items.reduce((s,p)=>s+p.quantity,0),plan.parts.length);
 assert.equal(plan.ldraw.split('\n').filter(l=>l.startsWith('1 ')).length,plan.parts.length);
});
test('an equal bounding box cannot substitute for a different or concave roof cross-section',()=>{
 for(const outline of [[[0,0],[16,0],[8,9.6]],[[0,0],[16,0],[16,9.6],[8,4],[0,9.6]]]){
  const spec=specimen('sloped-canopy');spec.components[1].geometry_parameters.outline_mm=outline;
  const plan=planDesign(spec,catalogue,options);assert.equal(plan.status,'blocked');assert.match(plan.failures[0],/cross-section/);
 }
});
test('mismatched extrusion widths, forbidden features, and negative spaces fail closed',()=>{
 for(const modify of [s=>{s.components[1].dimensions_mm.depth=47;s.components[1].geometry_parameters.depth_mm=47;},s=>s.components[1].forbidden_features=['sloped'],s=>s.negative_spaces=[{id:'cut',position_mm:{x:0,y:10,z:0},dimensions_mm:{width:8,depth:8,height:8}}]]){
  const spec=specimen('sloped-canopy');modify(spec);assert.equal(planDesign(spec,catalogue,options).status,'blocked');
 }
});
test('assembly sequence covers each part once, connects to an earlier step, and matches LDraw STEP order',()=>{
 const plan=planDesign(specimen('windowed-pavilion'),catalogue,options),built=new Set();
 assert.equal(plan.instructions.steps.length,plan.parts.length);
 for(const step of plan.instructions.steps){assert.equal(step.insertion_path_verified,false);if(built.size)assert.ok(step.connects_to.some(id=>built.has(id)));for(const id of step.parts){assert.ok(!built.has(id));built.add(id);}}
 assert.equal(plan.ldraw.split('\n').filter(l=>l==='0 STEP').length,plan.parts.length-1);
 const records=plan.ldraw.split('\n').filter(l=>l.startsWith('1 '));
 plan.instructions.steps.forEach((step,i)=>assert.ok(records[i].endsWith(' '+step.part_id+'.dat')));
});
test('bundled surfaces retain pinned provenance and expose real frame voids and slope shape',async()=>{
 for(const profile of options.specialistCatalogue.profiles){const mesh=await read(profile.mesh_file);assert.equal(mesh.source_library_commit,profile.source_library_commit);assert.equal(mesh.part_id,profile.part_id);assert.ok(mesh.triangle_positions_mm.length>100);assert.equal(mesh.triangle_positions_mm.length%9,0);assert.ok(mesh.triangle_positions_mm.every(Number.isFinite));assert.ok(mesh.license.includes('CC BY'));}
});
test('body silhouette vertices are present in the independent resolved LDraw surfaces',async()=>{
 for(const profile of options.specialistCatalogue.profiles){
  const values=(await read(profile.mesh_file)).triangle_positions_mm;
  for(const vertex of profile.body_vertices_mm){let distance=Infinity;for(let i=0;i<values.length;i+=3)distance=Math.min(distance,Math.hypot(...vertex.map((v,j)=>v-values[i+j])));assert.ok(distance<1e-5,profile.part_id+' has an unsupported silhouette vertex '+vertex);}
 }
});
test('an open frame retains a clear centre ray in its actual source surface',async()=>{
 const values=(await read('part-meshes/60592.json')).triangle_positions_mm;
 let hits=0;const ray=[0,9.6];
 for(let i=0;i<values.length;i+=9){const a=values.slice(i,i+3),b=values.slice(i+3,i+6),c=values.slice(i+6,i+9),denom=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(denom)<1e-8)continue;const u=((b[1]-c[1])*(ray[0]-c[0])+(c[0]-b[0])*(ray[1]-c[1]))/denom,v=((c[1]-a[1])*(ray[0]-c[0])+(a[0]-c[0])*(ray[1]-c[1]))/denom;if(u>=0&&v>=0&&u+v<=1)hits++;}
 assert.equal(hits,0,'window centre must remain empty in the preview surface');
});
test('a half-stud shift cannot pass solely because component bodies touch',()=>{
 const spec=specimen('sloped-canopy');spec.components[1].position_mm.x+=4;
 const plan=planDesign(spec,catalogue,options);assert.equal(plan.status,'blocked');assert.match(plan.failures[0],/connected arrangement/);
});
