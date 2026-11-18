// Description → intent → model evaluation over the frozen case set.
// Usage: node scripts/evaluate_intents.mjs [--write] [--images] [--check]
//   --write   refresh docs/data/intent-eval-results-v1.json and docs/intent-evaluation.md
//   --images  also render docs/eval/<case>.png previews
//   --check   fail if the committed results differ from a fresh run (timings excluded)
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {planIntent, intentCatalogue} from '../docs/assets/intent-engine.js';

const docs = new URL('../docs/', import.meta.url);
const read = path => JSON.parse(readFileSync(new URL('data/' + path, docs)));
const catalogue = intentCatalogue(read('connection-profiles/basic-bricks.json'), read('connection-profiles/standard-elements-v1.json'), read('specialist-profiles-v1.json'));
const evaluation = read('intent-eval-v1.json');
const args = new Set(process.argv.slice(2));

const results = [];
const plans = new Map();
for (const c of evaluation.cases) {
  const plan = planIntent(c.intent, catalogue);
  plans.set(c.id, plan);
  const r = plan.intent_report;
  const count = status => r.components.filter(x => x.status === status).map(x => x.component_id);
  results.push({
    id: c.id, category: c.category, description: c.description, status: plan.status,
    parts: plan.parts.length, steps: plan.instructions.steps.length,
    connected: r.connectivity.connected, shape_iou: r.shape_fidelity.soft_iou,
    footprint_studs: [Math.round(plan.dimensions_mm.width / 8), Math.round(plan.dimensions_mm.depth / 8)], height_plates: Math.round(plan.dimensions_mm.height / 3.2),
    real_wheels: r.wheels.filter(w => w.construction === 'real_wheel_assembly').length,
    slope_pieces: r.slopes.reduce((s, x) => s + (x.pieces || 0), 0),
    lost_components: count('lost'),
    lost_essential: r.components.filter(x => x.status === 'lost' && x.importance === 'essential').map(x => x.component_id),
    fragments_removed: r.connectivity.fragments_removed, gap_cells_filled: r.connectivity.gap_cells_filled,
    colour_bridges: r.connectivity.colour_bridges, visible_colour_bridges: r.connectivity.visible_colour_bridges,
    attachments_not_joined: r.attachments.filter(a => a.status === 'not_joined').map(a => `${a.from}→${a.to}`),
    elapsed_ms: r.elapsed_ms,
  });
}
const summary = {
  cases: results.length,
  built: results.filter(r => r.status === 'planned').length,
  connected: results.filter(r => r.connected).length,
  median_shape_iou: [...results.map(r => r.shape_iou)].sort((a, b) => a - b)[Math.floor(results.length / 2)],
  cases_losing_essential_components: results.filter(r => r.lost_essential.length).length,
  total_parts: results.reduce((s, r) => s + r.parts, 0),
};
const output = {schema_version: 1, evaluation: evaluation.evaluation, protocol: evaluation.protocol, interpreter: evaluation.interpreter, summary,
  limitations: ['The interpreter was a single model acting under the published instructions; other models will write different intents.',
    'Shape IoU compares the voxel grid with the intent, not with the real object; a wrong intent can score well.',
    'Connectivity is nominal stud/receiver alignment. Clutch, strength and stability are not assessed.',
    'No physical build trial has been run on these models.'],
  results};
const strip = o => JSON.stringify(o, (k, v) => k === 'elapsed_ms' ? undefined : v);

if (args.has('--check')) {
  const committed = read('intent-eval-results-v1.json');
  if (strip(committed) !== strip(output)) { console.error('Intent evaluation differs from docs/data/intent-eval-results-v1.json. Run node scripts/evaluate_intents.mjs --write and review.'); process.exit(1); }
}
if (args.has('--write')) {
  writeFileSync(new URL('data/intent-eval-results-v1.json', docs), JSON.stringify(output, null, 1) + '\n');
  const rows = results.map(r => `| [${r.id}](eval/${r.id}.png) | ${r.category} | ${r.parts} | ${r.steps} | ${r.connected ? 'yes' : '**no**'} | ${r.shape_iou.toFixed(2)} | ${r.real_wheels || '—'} | ${r.slope_pieces || '—'} | ${r.lost_essential.join(', ') || '—'} | ${r.visible_colour_bridges || '—'} |`);
  const md = `# Description → model evaluation

${summary.built} of ${summary.cases} descriptions produced a model; ${summary.connected} are a single stud-connected assembly. Median shape match (soft IoU against the intent) ${summary.median_shape_iou.toFixed(2)}. ${summary.cases_losing_essential_components} cases lose at least one essential component at their build size.

**Protocol.** ${evaluation.protocol} Interpreter: ${evaluation.interpreter}. The descriptions, intents and results are in [the case file](data/intent-eval-v1.json) and [the results file](data/intent-eval-results-v1.json).

**What this does not show.** ${output.limitations.join(' ')}

| Case | Category | Parts | Steps | Connected | Shape IoU | Real wheels | Slope elements | Essential parts lost | Visible colour joints |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | --- | ---: |
${rows.join('\n')}

${results.map(r => `### ${r.id}\n\n> ${r.description}\n\n![${r.id}](eval/${r.id}.png)\n`).join('\n')}
Reproduce with \`node scripts/evaluate_intents.mjs --check\`; refresh with \`--write --images\` after reviewing changes.
`;
  writeFileSync(new URL('intent-evaluation.md', docs), md);
}
if (args.has('--images')) {
  const {renderPlan} = await import('./lib/render-model.mjs');
  const profiles = new Map(catalogue.profiles.map(p => [p.part_id, p]));
  mkdirSync(new URL('eval/', docs), {recursive: true});
  for (const [id, plan] of plans) writeFileSync(new URL(`eval/${id}.png`, docs), renderPlan(plan, profiles, {dataDir: new URL('data', docs).pathname, size: 300, views: [-0.75, 2.3]}));
}
console.log(summary);
for (const r of results) console.log(`${r.id.padEnd(22)} parts ${String(r.parts).padStart(3)}  steps ${String(r.steps).padStart(3)}  connected ${r.connected ? 'yes' : 'NO '}  iou ${r.shape_iou.toFixed(2)}  lost ${r.lost_essential.join(',') || '-'}  ${r.elapsed_ms} ms`);
