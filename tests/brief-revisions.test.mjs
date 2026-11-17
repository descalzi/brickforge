import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {planDesign} from '../docs/assets/design-engine.js';
import {findTestedRevision} from '../docs/assets/brief-revisions.js';

const read = async path => JSON.parse(await readFile(new URL('../docs/data/' + path, import.meta.url)));
const catalogue = await read('connection-profiles/basic-bricks.json');
const fixtures = await read('design-spec-fixtures.json');
const options = {
  specialistCatalogue: await read('specialist-profiles-v1.json'),
  partCatalogue: await read('part-capabilities-v1.json'),
  designTranslation: await read('design-translation-v1.json')
};

function search(spec) {
  const original = structuredClone(spec);
  const blocked = planDesign(spec, catalogue, options);
  assert.equal(blocked.status, 'blocked');
  const revision = findTestedRevision(spec, catalogue, options, blocked);
  assert.deepEqual(spec, original);
  return revision;
}

test('the original exact sphere has a buildable, explicitly revised stepped option', () => {
  const original = fixtures.challenge_specs.find(s => s.design_id === 'challenge-organic-form');
  const revision = search(original);
  assert.deepEqual(revision.edits.map(e => e.field), ['shape_tolerance_mm', 'course_type']);
  const plan = planDesign(revision.specification, catalogue, options);
  assert.equal(plan.status, 'planned');
  assert.equal(revision.parts, plan.parts.length);
  assert.equal(revision.approximations.length, 1);
  assert.ok(revision.approximations[0].outer <= revision.edits[0].after);
  console.log('Tested sphere revision', revision.parts, revision.edits[0].after, revision.approximations);
});

test('a misplaced side panel offers a measured translation within its proposed allowance', () => {
  const spec = structuredClone(fixtures.fixtures.find(s => s.design_id === 'side-mounted-panel'));
  spec.components.at(-1).position_mm.z += 1.6;
  const revision = search(spec);
  assert.equal(revision.edits[0].field, 'position_tolerance_mm');
  assert.equal(revision.edits[0].component, 'panel');
  assert.ok(Math.abs(revision.positions[0].delta[2] + 1.6) < 1e-6);
});

test('search preserves an essential curved-surface requirement and refuses an unsupported revision', () => {
  const spec = structuredClone(fixtures.challenge_specs.find(s => s.design_id === 'challenge-organic-form'));
  spec.components[0].required_features = ['curved'];
  const revision = search(spec);
  assert.equal(revision.specification, undefined);
  assert.ok(revision.attempts > 0 && revision.attempts <= 24);
});

test('all independent wheel and house component failures are visible in one run', () => {
  for (const [id, expected] of [
    ['challenge-car', ['front-left-wheel', 'front-right-wheel', 'rear-left-wheel', 'rear-right-wheel']],
    ['challenge-house', ['front-window', 'roof']]
  ]) {
    const spec = fixtures.challenge_specs.find(s => s.design_id === id);
    const plan = planDesign(spec, catalogue, options);
    assert.deepEqual(plan.component_reports.filter(r => r.status === 'blocked').map(r => r.component_id), expected);
    assert.equal(plan.component_reports.length, spec.components.length);
    assert.ok(plan.component_reports.some(r => r.status === 'candidates_found'));
    assert.equal(plan.parts.length, 0);
  }
});

test('related blocked components can be revised together', () => {
  const spec = structuredClone(fixtures.fixtures.find(s => s.design_id === 'side-mounted-panel'));
  spec.components = [0, 1].map(i => ({id: 'layer-' + i, role: 'structural', geometry: 'rectangular_prism',
    dimensions_mm: {width: 15.5, depth: 16, height: 9.6}, position_mm: {x: 0, y: i * 9.6, z: 0}, priority: 'essential'}));
  spec.relationships = [{type:'attached_to', from:'layer-1', to:'layer-0'}];
  const revision = search(spec);
  assert.deepEqual(revision.edits.map(e => e.component), ['layer-0', 'layer-1']);
  assert.equal(revision.dimensions.length, 2);
  assert.equal(revision.parts, 2);
});

test('the car challenge can keep its chassis envelope and get four fitted rotating wheels', () => {
  const spec = fixtures.challenge_specs.find(s=>s.design_id==='challenge-car');
  const revision = search(spec);
  assert.ok(revision.specification);
  assert.deepEqual(revision.specification.relationships,spec.relationships);
  assert.deepEqual(revision.specification.components.map(c=>c.dimensions_mm),spec.components.map(c=>c.dimensions_mm));
  assert.equal(revision.dimensions.length,4);
  assert.equal(revision.positions.length,4);
  const plan = planDesign(revision.specification,catalogue,options);
  assert.equal(plan.status,'planned');
  assert.equal(plan.parts.filter(p=>p.part_id==='4600' && p.component_id==='chassis').length,2);
  const pairs = plan.connections.flatMap(c=>c.mating_pairs);
  assert.equal(pairs.filter(p=>p.connection_type==='wheel_pin_bore').length,4);
  assert.equal(pairs.filter(p=>p.connection_type==='rim_tyre_seat').length,4);
  assert.ok(plan.relationship_checks.every(r=>r.status==='passed'));
  assert.ok(plan.instructions.steps.every(s=>s.nominal_approach_clear));
});

test('integrated carriers also fit a rotated exact layout and respect fixed limits', () => {
  const spec=structuredClone(fixtures.fixtures.find(s=>s.design_id==='integrated-axle-car'));
  for (const c of spec.components) {
    if(c.role==='wheel'){
      c.position_mm.x+=.8;c.position_mm.y+=2;c.position_mm.z+=.8;
      c.dimensions_mm={width:14.4,height:14.4,depth:6.4};c.geometry_parameters={axis:'x',diameter_mm:14.4};
      delete c.fit_tolerance_mm;delete c.position_tolerance_mm;
    }
    [c.position_mm.x,c.position_mm.z]=[c.position_mm.z,c.position_mm.x];
    [c.dimensions_mm.width,c.dimensions_mm.depth]=[c.dimensions_mm.depth,c.dimensions_mm.width];
  }
  const p=planDesign(spec,catalogue,options);
  assert.equal(p.status,'planned',p.failures?.join(' '));
  assert.equal(p.component_reports[0].selected_construction_method,'integrated_wheel_carrier_courses');
  for (const [axis,value] of Object.entries(spec.components[0].dimensions_mm)) assert.ok(Math.abs(p.component_reports[0].realised_dimensions_mm[axis]-value)<1e-6);
  spec.constraints.course_type='brick';
  assert.equal(planDesign(spec,catalogue,options).status,'blocked');
  spec.constraints.course_type='auto';
  spec.negative_spaces=[{id:'empty-bay',position_mm:{x:0,y:0,z:0},dimensions_mm:{width:8,depth:8,height:3.2}}];
  assert.equal(planDesign(spec,catalogue,options).status,'blocked');
});

test('the house revision preserves its envelope and seats the frame in its host wall', () => {
  const original=fixtures.challenge_specs.find(s=>s.design_id==='challenge-house');
  const revision=search(original), spec=revision.specification;
  assert.ok(spec);
  assert.deepEqual(spec.relationships,original.relationships);
  assert.equal(revision.edits.find(e=>e.field==='outline_mm').vertical_error_mm,4.8);
  assert.deepEqual(spec.components.at(-1).dimensions_mm,original.components.at(-1).dimensions_mm);
  assert.equal(spec.negative_spaces[0].component_id,'front-wall');
  const plan=planDesign(spec,catalogue,options);
  assert.equal(plan.status,'planned');
  assert.equal(plan.analysis.body_envelope_collisions.length,0);
  assert.ok(plan.relationship_checks.every(c=>c.status==='passed'));
  assert.ok(plan.parts.some(p=>p.component_id==='front-window' && p.part_id==='60592'));
  const global=structuredClone(spec);
  delete global.negative_spaces[0].component_id;
  assert.equal(planDesign(global,catalogue,options).status,'blocked');
  spec.negative_spaces[0].component_id='missing-wall';
  assert.throws(()=>planDesign(spec,catalogue,options),/unknown host component/);
});
