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
