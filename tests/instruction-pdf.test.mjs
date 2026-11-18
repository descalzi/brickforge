import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planIntent, intentCatalogue} from '../docs/assets/intent-engine.js';
import {createInstructionPdf, bookletSteps} from '../docs/assets/instruction-pdf.js';
import {pdfContentStreams} from './pdf-test-utils.mjs';

const read = path => JSON.parse(readFileSync(new URL('../docs/data/' + path, import.meta.url)));
const vocabulary = read('connection-profiles/part-vocabulary-profiles-v1.json'), specialist = read('specialist-profiles-v1.json');
const catalogue = intentCatalogue(read('connection-profiles/basic-bricks.json'), read('connection-profiles/standard-elements-v1.json'), specialist, vocabulary);
const cases = [...read('intent-eval-v1.json').cases, ...read('intent-examples-v1.json').cases];
// The studio hands the booklet worker display profiles with mesh triangles.
function displayProfiles(plan) {
  const used = new Set(plan.parts.map(p => p.part_id)), byId = new Map(catalogue.profiles.map(p => [p.part_id, p]));
  return [...used].map(id => { const p = byId.get(id); return p.mesh_file ? {...p, preview_triangles_mm: read(p.mesh_file).triangle_positions_mm} : p; });
}
const booklet = async plan => createInstructionPdf(plan, {profiles: displayProfiles(plan)}, {name: plan.name});

test('booklet steps group several parts and keep every part exactly once', () => {
  const plan = planIntent(cases.find(c => c.id === 'cottage').intent, catalogue);
  const steps = bookletSteps(plan.instructions.steps, plan.parts.length);
  const ids = steps.flatMap(s => [...s.parts]);
  assert.equal(ids.length, plan.parts.length);
  assert.equal(new Set(ids).size, plan.parts.length);
  assert.ok(steps.length <= plan.instructions.steps.length);
  // A large model is folded to about 240 steps.
  const many = Array.from({length: 3000}, (_, i) => ({parts: [`p${i}`], nominal_approach_clear: true, approach_direction: [0, -1, 0]}));
  const folded = bookletSteps(many, 3000);
  assert.ok(folded.length <= 250 && folded.length >= 200, String(folded.length));
  assert.ok(folded.every(s => s.lift), 'a shared approach keeps its arrow');
});

test('the booklet puts several steps on each page', async () => {
  const plan = planIntent(cases.find(c => c.id === 'cottage').intent, catalogue);
  const bytes = await booklet(plan);
  const pages = pdfContentStreams(bytes);
  const stepPages = pages.filter(p => p.includes('ASSEMBLY / STEP-BY-STEP'));
  const steps = bookletSteps(plan.instructions.steps, plan.parts.length).length;
  assert.equal(stepPages.length, Math.ceil(steps / (steps <= 40 ? 4 : 6)));
  assert.match(stepPages[0], /Steps 1-[46] of/);
  assert.ok(pages[0].includes('BUILDING GUIDE') && pages.at(-1).includes('COMPLETE'));
});

test('a model of several thousand parts makes a booklet', async () => {
  const intent = structuredClone(cases.find(c => c.id === 'elephant-tubes').intent);
  const plan = planIntent(intent, catalogue);
  assert.ok(plan.parts.length > 1500, String(plan.parts.length));
  const started = Date.now();
  const bytes = await booklet(plan);
  const pages = pdfContentStreams(bytes).length;
  assert.ok(pages < 70, `${pages} pages`);
  assert.ok(Date.now() - started < 180000);
});
