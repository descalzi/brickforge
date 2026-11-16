import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {evaluateDesignRelationships} from '../docs/assets/design-relations.js';
import {validateDesignSpec} from '../docs/assets/design-spec.js';
import {planDesign} from '../docs/assets/design-engine.js';
const read=async p=>JSON.parse(await readFile(new URL('../docs/data/'+p,import.meta.url)));
const fixtures=await read('design-spec-fixtures.json'),catalogue=await read('connection-profiles/basic-bricks.json'),options={specialistCatalogue:await read('specialist-profiles-v1.json'),partCatalogue:await read('part-capabilities-v1.json'),designTranslation:await read('design-translation-v1.json')};
const brief=id=>structuredClone(fixtures.fixtures.find(f=>f.design_id===id));
const component=(id,x,y=0,z=0,w=8)=>({id,role:'structural',geometry:'rectangular_prism',dimensions_mm:{width:w,depth:8,height:9.6},position_mm:{x,y,z},priority:'essential'});
const report=(components,relationships)=>evaluateDesignRelationships({components,relationships});
test('alignment names a coordinate axis and anchors instead of accepting any common edge',()=>{
 const cs=[component('a',0),component('b',0,9.6,16)];
 assert.equal(report(cs,[{type:'aligned_with',from:'a',to:'b',axis:'z',anchor:'center',tolerance_mm:.01}]).failures.length,1);
 const legacy=report(cs,[{type:'aligned_with',from:'a',to:'b'}]);assert.equal(legacy.failures.length,0);assert.match(legacy.warnings[0],/legacy/);
 const aligned=report([component('a',18),component('b',0,0,0,16)],[{type:'aligned_with',from:'a',to:'b',axis:'x',from_anchor:'min',to_anchor:'max',offset_mm:2,tolerance_mm:.001}]);assert.equal(aligned.failures.length,0);assert.equal(aligned.checks[0].measured_mm,18);assert.equal(aligned.checks[0].expected_mm,18);
});
test('explicit mirror planes verify other coordinates and dimensions too',()=>{
 const relation={type:'symmetric_to',from:'a',to:'b',axis:'x',plane_mm:16,tolerance_mm:.01},cs=[component('a',0),component('b',24)];
 assert.equal(report(cs,[relation]).failures.length,0);cs[1].position_mm.z=1;assert.equal(report(cs,[relation]).failures.length,1);cs[1].position_mm.z=0;cs[1].dimensions_mm.height=19.2;assert.equal(report(cs,[relation]).failures.length,1);
});
test('opposed sloped roof outlines must actually mirror, not merely share bounds',()=>{
 const s=brief('windowed-pavilion'),left=s.components.find(c=>c.id==='left-roof'),right=s.components.find(c=>c.id==='right-roof'),r={type:'symmetric_to',from:left.id,to:right.id,axis:'x',plane_mm:16,tolerance_mm:.001};
 assert.equal(report([left,right],[r]).failures.length,0);right.geometry_parameters.outline_mm=structuredClone(left.geometry_parameters.outline_mm);assert.equal(report([left,right],[r]).failures.length,1);
});
test('the aircraft preserves its mirrored wings, bridge centres and declared proportion',()=>{
 const p=planDesign(brief('tapered-aircraft'),catalogue,options);assert.equal(p.status,'planned',p.failures?.join(' '));assert.equal(p.relationship_checks.length,4);assert.ok(p.relationship_checks.every(c=>c.status==='passed'));assert.ok(p.relationship_checks.find(c=>c.type==='dimension_ratio').measured_mm>31);
});
test('dimension proportions are rechecked after a permitted fitting adjustment',()=>{
 const s=brief('table'),top=[...s.components].sort((a,b)=>b.dimensions_mm.width-a.dimensions_mm.width)[0],leg=s.components.find(c=>c.id!==top.id),ratio=top.dimensions_mm.width/leg.dimensions_mm.width;
 top.dimensions_mm.width-=1;top.fit_tolerance_mm=1;s.relationships.push({type:'dimension_ratio',from:top.id,to:leg.id,from_axis:'width',to_axis:'width',ratio,tolerance_mm:.001});
 const p=planDesign(s,catalogue,options);assert.equal(p.status,'planned',p.failures?.join(' '));assert.ok(p.relationship_checks.every(c=>c.status==='passed'));const r=p.relationship_checks.find(c=>c.type==='dimension_ratio');assert.ok(Math.abs(r.measured_mm-r.expected_mm)<.001);
 s.relationships.at(-1).ratio+=1;const rejected=planDesign(s,catalogue,options);assert.equal(rejected.status,'blocked');assert.equal(rejected.parts.length,0);
});
test('optional unmet proportions stay visible without masquerading as required failures',()=>{
 const s=brief('rounded-mushroom');s.relationships[0].ratio=3;s.relationships[0].required=false;const p=planDesign(s,catalogue,options);assert.equal(p.status,'planned');assert.equal(p.relationship_checks[0].status,'warning');assert.match(p.warnings.join(' '),/dimension_ratio/);
});
test('malformed and irrelevant relationship parameters are rejected by the runtime contract',()=>{
 const s=brief('table'),[a,b]=s.components;
 for(const r of [{type:'dimension_ratio',ratio:0,from_axis:'width',to_axis:'width'},{type:'dimension_ratio',ratio:2,from_axis:'x',to_axis:'width'},{type:'aligned_with',axis:'north'},{type:'aligned_with',anchor:'center'},{type:'symmetric_to',plane_mm:0},{type:'above',ratio:2}]){s.relationships=[{...r,from:a.id,to:b.id}];assert.equal(validateDesignSpec(s).valid,false,JSON.stringify(r));}
});

test('round-element symmetry preserves cylinder axes and the direction of a dome',()=>{
 const a={...component('a',0),geometry:'cylinder',dimensions_mm:{width:8,height:8,depth:8},geometry_parameters:{axis:'y',diameter_mm:8}},b={...structuredClone(a),id:'b',position_mm:{x:24,y:0,z:0}};
 const relation={type:'symmetric_to',from:'a',to:'b',axis:'x',plane_mm:16,tolerance_mm:.001};
 assert.equal(report([a,b],[relation]).failures.length,0);b.geometry_parameters.axis='z';assert.equal(report([a,b],[relation]).failures.length,1);
 a.geometry=b.geometry='domed_cylinder';b.geometry_parameters.axis='y';assert.equal(report([a,b],[relation]).failures.length,0);
 b.position_mm={x:0,y:24,z:0};relation.axis='y';assert.equal(report([a,b],[relation]).failures.length,1);
});
