import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normaliseIntent, buildIntentRequest, INTENT_SCHEMA_ID} from '../docs/assets/object-intent.js';
import {resolveColour} from '../docs/assets/brick-colours.js';
import {rasteriseIntent, scaleForTarget, hollowInterior} from '../docs/assets/intent-voxels.js';
import {elementTypes, tileGrid} from '../docs/assets/brick-tiler.js';
import {planIntent, intentCatalogue} from '../docs/assets/intent-engine.js';
import {analyzeAssembly} from '../docs/assets/assembly-analysis.js';

const read = path => JSON.parse(readFileSync(new URL('../docs/data/' + path, import.meta.url)));
const basic = read('connection-profiles/basic-bricks.json'), standard = read('connection-profiles/standard-elements-v1.json'), specialist = read('specialist-profiles-v1.json');
const catalogue = intentCatalogue(basic, standard, specialist);
const cases = read('intent-eval-v1.json').cases;
const profilesById = new Map(catalogue.profiles.map(p => [p.part_id, p]));
const intent = (components, extra = {}) => ({schema: INTENT_SCHEMA_ID, name: 'Test', units: 'mm', components, ...extra});
const box = (id, center, size, more = {}) => ({id, role: 'body', shape: 'box', center, size, colour: 'red', ...more});

test('every frozen evaluation intent is valid', () => {
  for (const c of cases) {
    const r = normaliseIntent(c.intent);
    assert.ok(r.valid, c.id + ': ' + r.errors.join(' '));
  }
});

test('intent validation rejects malformed input with readable errors', () => {
  assert.match(normaliseIntent({...intent([box('a', [0, 0, 0], [1, 1, 1])]), schema: 'x'}).errors.join(), /schema must be/);
  assert.match(normaliseIntent(intent([box('a', [0, 0, 0], [1, 0, 1])])).errors.join(), /size must be three positive/);
  assert.match(normaliseIntent(intent([box('a', [0, 0, 0], [1, 1, 1], {attach_to: 'missing'})])).errors.join(), /unknown component "missing"/);
  assert.match(normaliseIntent(intent([box('a', [0, 0, 0], [1, 1, 1]), box('a', [0, 0, 0], [1, 1, 1])])).errors.join(), /repeated/);
  assert.match(normaliseIntent(intent([box('a', [0, 0, 0], [1, 1, 1], {mode: 'void'})])).errors.join(), /At least one component must be solid/);
  assert.match(normaliseIntent(intent([{...box('a', [0, 0, 0], [1, 1, 1]), shape: 'torus'}])).errors.join(), /shape must be one of/);
});

test('units convert to millimetres and colours resolve names and synonyms', () => {
  const r = normaliseIntent({...intent([box('a', [0, 1, 0], [2, 2, 2], {colour: 'Dark Gray'})]), units: 'm'});
  assert.deepEqual(r.intent.components[0].size_mm, [2000, 2000, 2000]);
  assert.equal(r.intent.components[0].colour, 72);
  assert.equal(resolveColour('transparent light blue'), 43);
  assert.equal(resolveColour('glass'), 47);
  assert.equal(resolveColour('dusty pink'), null);
  const near = normaliseIntent(intent([box('a', [0, 0, 0], [1, 1, 1], {colour: 'dusty pink'}), box('b', [0, 0, 0], [1, 1, 1], {colour: 'ivory'}), box('c', [0, 0, 0], [1, 1, 1], {colour: 'frosted glass'}), box('d', [0, 0, 0], [1, 1, 1], {colour: 'zzz'})]));
  assert.ok(near.valid);
  assert.deepEqual(near.intent.components.map(c => c.colour), [29, 19, 47, 71]);
  assert.match(near.warnings.join(), /the nearest, pink, is used/);
  assert.match(near.warnings.join(), /"zzz" is not in the palette; light grey is used/);
});

test('the interpretation request carries instructions and schema without parts', () => {
  const request = buildIntentRequest('A red car', read('object-intent-schema-v2.json'));
  assert.equal(request.schema_version, 2);
  assert.match(request.instructions, /Do not think about bricks/);
  assert.equal(request.response_schema.properties.schema.const, INTENT_SCHEMA_ID);
});

test('thin sheets keep two plates and thin posts keep one stud', () => {
  // A 1 mm board 64 mm wide on two 2 mm posts, at one model mm per mm.
  const r = normaliseIntent(intent([
    box('board', [0, 40, 0], [64, 1, 32]),
    box('post-a', [-24, 20, 0], [2, 40, 2], {attach_to: 'board'}),
    box('post-b', [24, 20, 0], [2, 40, 2], {attach_to: 'board'})]));
  const grid = rasteriseIntent(r.intent, 1);
  const cells = id => grid.reports.find(x => x.component_id === id).realised_cells;
  const boardIndex = grid.components.findIndex(c => c.id === 'board'), layers = new Set();
  for (let c = 0; c < grid.owner.length; c++) if (grid.owner[c] === boardIndex) layers.add(Math.floor(c / (grid.nx * grid.nz)));
  assert.equal(layers.size, 2, 'board is two plates thick');
  assert.ok(cells('board') >= 8 * 4 * 2 - 2, 'board covers its 8 x 4 stud footprint (posts own where they meet it)');
  assert.ok(cells('post-a') >= 12 && cells('post-a') <= 14, 'post keeps one stud column for its height');
});

test('a void removes material but does not pierce a wall it does not reach through', () => {
  const r = normaliseIntent(intent([
    {id: 'cup', role: 'body', shape: 'cylinder', axis: 'y', center: [0, 24, 0], size: [64, 48, 64], colour: 'white'},
    {id: 'inside', role: 'opening', shape: 'cylinder', axis: 'y', mode: 'void', center: [0, 30, 0], size: [54, 44, 54]},
    box('door', [0, 10, -32], [16, 20, 24], {mode: 'void', role: 'opening'})]));
  const grid = rasteriseIntent(r.intent, 1);
  const {nx, nz, ny} = grid;
  // Every layer above the floor still has a closed ring except where the door cuts through.
  for (let j = 6; j < ny - 2; j++) {
    let cells = 0;
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) if (grid.owner[grid.index(i, j, k)] >= 0) cells++;
    assert.ok(cells > 0, 'layer ' + j + ' keeps material');
  }
  const doorLayer = Math.floor((10 - grid.origin[1]) / 3.2);
  const front = Math.floor((-28 - grid.origin[2]) / 8), centre = Math.floor((0 - grid.origin[0]) / 8);
  assert.equal(grid.owner[grid.index(centre, doorLayer, front)], -1, 'the doorway, which extends outside the wall, is open');
});

test('tiling a solid sphere uses course-aligned bricks and stays connected', () => {
  const r = normaliseIntent(intent([{id: 'ball', role: 'body', shape: 'sphere', center: [0, 48, 0], size: [96, 96, 96], colour: 'red'}]));
  const grid = rasteriseIntent(r.intent, 1);
  const visible = new Uint8Array(grid.owner.length).fill(1);
  const tiled = tileGrid({...grid, visible}, elementTypes(catalogue.regular), [], {seed: 1});
  assert.equal(tiled.components.length, 1);
  const bricks = tiled.parts.filter(p => p.h === 3);
  assert.ok(bricks.length > 10);
  const base = Math.min(...tiled.parts.map(p => p.y0));
  for (const b of bricks) assert.equal((b.y0 - base) % 3, 0, 'bricks start on shared course boundaries');
});

test('hollowing keeps a shell and the voxel material it removed can be restored', () => {
  const r = normaliseIntent(intent([box('block', [0, 48, 0], [96, 96, 96])]));
  const grid = rasteriseIntent(r.intent, 1);
  const before = grid.owner.filter(o => o >= 0).length;
  const hollow = hollowInterior(grid);
  assert.ok(hollow.removed > before / 3);
  assert.equal(hollow.restore.length, hollow.removed);
});

test('the cottage is connected, uses real slopes and exports one LDraw line per part', () => {
  const plan = planIntent(cases.find(c => c.id === 'cottage').intent, catalogue);
  assert.equal(plan.status, 'planned');
  assert.ok(plan.intent_report.connectivity.connected);
  const slopes = plan.parts.filter(p => p.part_id === '3298');
  assert.ok(slopes.length >= 10, 'roof uses 33 degree slope elements');
  assert.equal(plan.ldraw.split('\n').filter(l => l.startsWith('1 ')).length, plan.parts.length);
  assert.equal(plan.bom.items.reduce((s, i) => s + i.quantity, 0), plan.parts.length);
  const profiles = new Map(catalogue.profiles.map(p => [p.part_id, p]));
  for (const p of plan.parts) assert.ok(profiles.has(p.part_id), 'profile for ' + p.part_id);
  assert.equal(analyzeAssembly(plan.parts, plan.connections, profiles).body_envelope_collisions.length, 0);
  const seen = plan.instructions.steps.flatMap(s => s.parts);
  assert.equal(new Set(seen).size, plan.parts.length, 'every part appears in exactly one step');
  assert.ok(plan.instructions.steps.every(s => s.parts.length <= 8));
  assert.ok(Math.min(...plan.parts.map(p => -p.translation_ldu[1])) >= -1e-6, 'model rests on y = 0');
});

test('wheels near the real assembly size become wheel-pin plates with rims and tyres', () => {
  const bus = planIntent(cases.find(c => c.id === 'double-decker-bus').intent, catalogue);
  const count = id => bus.parts.filter(p => p.part_id === id).length;
  assert.equal(count('4600'), 2);
  assert.equal(count('4624'), 4);
  assert.equal(count('3641'), 4);
  const pinJoints = bus.connections.flatMap(e => e.mating_pairs).filter(m => m.connection_type === 'wheel_pin_bore');
  assert.equal(pinJoints.length, 4, 'each rim seats on a wheel pin');
  // Wheels much larger than the assembly stay as brick-built material.
  const tractor = planIntent(cases.find(c => c.id === 'farm-tractor').intent, catalogue);
  assert.equal(tractor.parts.filter(p => p.part_id === '4600').length, 0);
  assert.ok(tractor.intent_report.wheels.every(w => w.construction === 'voxel_material'));
});

test('planning is deterministic', () => {
  const a = planIntent(cases.find(c => c.id === 'rocket-on-pad').intent, catalogue);
  const b = planIntent(cases.find(c => c.id === 'rocket-on-pad').intent, catalogue);
  assert.equal(a.ldraw, b.ldraw);
});

test('invalid intents are blocked with the validation errors', () => {
  const plan = planIntent({schema: 'nope'}, catalogue);
  assert.equal(plan.status, 'blocked');
  assert.ok(plan.failures.length);
});

test('regular catalogues match measured LDraw footprints', () => {
  const audit = new Map(standard.basic_orientation_audit.map(a => [a.part_id, a]));
  for (const p of basic.profiles) {
    const a = audit.get(p.part_id);
    assert.deepEqual([p.footprint_studs_x, p.footprint_studs_z], a.measured_footprint_studs, p.part_id + ' footprint orientation');
    const xs = new Set(p.features.map(f => f.position_ldu[0])), zs = new Set(p.features.map(f => f.position_ldu[2]));
    assert.equal(xs.size, p.footprint_studs_x); assert.equal(zs.size, p.footprint_studs_z);
  }
  for (const p of standard.profiles) {
    const b = p.measured_bounds_mm;
    assert.equal((b.maximum[0] - b.minimum[0]) / 8, p.footprint_studs_x, p.part_id);
    assert.equal((b.maximum[2] - b.minimum[2]) / 8, p.footprint_studs_z, p.part_id);
    if (p.element_kind === 'tile') assert.ok(!p.features.some(f => f.kind === 'stud'));
  }
});

test('a void cuts only the solids listed before it', () => {
  const r = normaliseIntent(intent([
    box('deck', [0, 8, 0], [64, 16, 64]),
    box('walk', [0, 14, 0], [48, 6, 48], {mode: 'void', role: 'opening'}),
    box('pole', [0, 20, 0], [4, 24, 4], {colour: 'black'})]));
  const grid = rasteriseIntent(r.intent, 1);
  const pole = grid.components.findIndex(c => c.id === 'pole');
  const layers = new Set();
  for (let c = 0; c < grid.owner.length; c++) if (grid.owner[c] === pole) layers.add(Math.floor(c / (grid.nx * grid.nz)));
  assert.ok(Math.min(...layers) * 3.2 + grid.origin[1] <= 9, 'the pole keeps its foot inside the walkway void');
});

test('extra-large and huge builds are accepted and scale the model', () => {
  const base = cases.find(c => c.id === 'rocket-on-pad').intent;
  for (const [size, studs] of [['xlarge', 64], ['huge', 128]]) {
    const r = normaliseIntent({...base, build: {size}});
    assert.ok(r.valid, r.errors.join(' '));
    assert.equal(r.intent.build.target_longest_studs, studs);
  }
  assert.match(normaliseIntent({...base, build: {target_longest_studs: 129}}).errors.join(), /6 to 128/);
  const plan = planIntent({...base, build: {size: 'xlarge'}}, catalogue);
  assert.ok(plan.intent_report.connectivity.connected);
  assert.ok(Math.max(plan.dimensions_mm.width, plan.dimensions_mm.depth, plan.dimensions_mm.height) > 60 * 8, 'longest side is about 64 studs');
});

test('tubes follow a curved, tapering path and stay connected', () => {
  // A trunk curling forward from a block, 3 mm thin at the tip.
  const r = normaliseIntent(intent([
    box('head', [0, 60, 0], [40, 40, 40], {colour: 'dark grey'}),
    {id: 'trunk', role: 'trunk', shape: 'tube', colour: 'dark grey', attach_to: 'head', points: [[0, 50, -18, 8], [0, 30, -26, 6], [0, 12, -24, 4], [0, 4, -34, 3], [0, 8, -44, 1.5]]}]));
  assert.ok(r.valid, r.errors.join(' '));
  assert.deepEqual(r.intent.components[1].size_mm.map(v => Math.round(v)), [16, 57, 36]);
  const plan = planIntent(intent([
    box('head', [0, 60, 0], [40, 40, 40], {colour: 'dark grey'}),
    {id: 'trunk', role: 'trunk', shape: 'tube', colour: 'dark grey', attach_to: 'head', points: [[0, 50, -18, 8], [0, 30, -26, 6], [0, 12, -24, 4], [0, 4, -34, 3], [0, 8, -44, 1.5]]}],
    {build: {target_longest_studs: 12, finish: 'smooth'}}), catalogue);
  assert.ok(plan.intent_report.connectivity.connected);
  assert.equal(plan.intent_report.connectivity.fragments_removed, 0);
  assert.ok(plan.parts.some(p => profilesById.get(p.part_id)?.element_kind === 'tile'), 'smooth finish uses tiles');
  assert.ok(plan.parts.filter(p => p.component_id === 'trunk').length > 3);
  assert.match(normaliseIntent(intent([{id: 't', role: 'tail', shape: 'tube', points: [[0, 0, 0, 1]]}])).errors.join(), /2 to 64 entries/);
});

// Part vocabulary: imported LDCad connections, surface fitting, frames and brackets.
const vocabulary = read('connection-profiles/part-vocabulary-profiles-v1.json');
const full = intentCatalogue(basic, standard, specialist, vocabulary);
const fullById = new Map(full.profiles.map(p => [p.part_id, p]));
const families = new Map(vocabulary.profiles.map(p => [p.part_id, p.family]));
const kindAt = (profile, kind) => profile.features.filter(f => f.kind === kind).map(f => f.position_ldu.map(Math.round).join(',')).sort();

test('imported vocabulary connections agree with the hand-checked specialist profiles', () => {
  for (const p of specialist.profiles) {
    const v = vocabulary.profiles.find(x => x.part_id === p.part_id);
    if (!v || p.part_id === '15068' || p.part_id === '3062b') continue; // these two also list recessed anti-studs
    for (const kind of ['stud', 'stud_receiver']) assert.deepEqual(kindAt(v, kind), kindAt(p, kind), `${p.part_id} ${kind}`);
  }
  // Round 1x1 plate: its stud is the radius-6 section after a rim; inverted slope: one receiver.
  assert.deepEqual(kindAt(vocabulary.profiles.find(p => p.part_id === '6141'), 'stud'), ['0,0,0']);
  assert.equal(kindAt(vocabulary.profiles.find(p => p.part_id === '3665b'), 'stud_receiver').length, 1);
  assert.equal(vocabulary.sources.connections.licence, 'CC BY-SA 4.0');
});

test('surface fitting smooths a sphere with real slopes and keeps it connected', () => {
  const plan = planIntent(intent([{id: 'ball', role: 'body', shape: 'sphere', center: [0, 60, 0], size: [120, 120, 120], colour: 'yellow'}], {build: {target_longest_studs: 16}}), full);
  const fit = plan.intent_report.surface_fitting;
  assert.ok(fit.parts >= 4, 'some slopes placed');
  assert.ok(fit.surface_iou_after > fit.surface_iou_before);
  assert.ok(plan.parts.filter(p => families.has(p.part_id)).length >= fit.parts);
  assert.ok(plan.intent_report.connectivity.connected);
  assert.equal(plan.analysis.body_envelope_collisions.length, 0);
  const off = planIntent(intent([{id: 'ball', role: 'body', shape: 'sphere', center: [0, 60, 0], size: [120, 120, 120], colour: 'yellow'}], {build: {target_longest_studs: 16}}), full, {surfaceFit: false});
  assert.equal(off.intent_report.surface_fitting.parts, 0);
});

test('windows and doors become frames with glass and a door set into the wall', () => {
  const house = intent([
    box('walls', [0, 100, 0], [240, 200, 160], {colour: 'tan'}),
    box('window', [-60, 120, -80], [16, 50, 4], {role: 'window', mode: 'paint', colour: 'light blue'}),
    box('door', [40, 70, -80], [64, 120, 4], {role: 'door', mode: 'paint', colour: 'dark red'})], {build: {target_longest_studs: 32}});
  const plan = planIntent(house, full);
  assert.deepEqual(plan.intent_report.openings, {windows: 1, doors: 1});
  const ids = plan.parts.map(p => p.part_id);
  assert.ok(ids.includes('60596') && ids.includes('60616b'), 'door frame and door');
  assert.ok(ids.some(id => ['60601', '60602'].includes(id)), 'window glass');
  const door = plan.parts.find(p => p.part_id === '60616b');
  assert.equal(door.colour_code, plan.parts.find(p => p.component_id === 'door' || p.part_id === '60616b').colour_code);
  assert.ok(plan.connections.some(e => e.kind === 'mounted' && e.instance_b === door.instance_id));
  assert.ok(plan.intent_report.connectivity.connected);
  assert.equal(plan.analysis.body_envelope_collisions.length, 0);
});

test('eyes become round tiles on brackets facing out of the head', () => {
  const plan = planIntent(intent([
    {id: 'head', role: 'head', shape: 'sphere', center: [0, 40, 0], size: [80, 80, 80], colour: 'yellow'},
    box('eyes', [0, 50, 0], [84, 6, 6], {role: 'eye', mode: 'paint', colour: 'black'})], {build: {target_longest_studs: 12}}), full);
  assert.equal(plan.intent_report.brackets.eyes, 2);
  const tiles = plan.parts.filter(p => p.part_id === '98138');
  assert.equal(tiles.length, 2);
  assert.ok(tiles.every(t => t.colour_code === 0));
  // Each tile faces sideways: its local up axis lies in the horizontal plane.
  for (const t of tiles) assert.equal(Math.abs(t.matrix[4]), 0);
  assert.ok(plan.intent_report.connectivity.connected);
  assert.equal(plan.analysis.body_envelope_collisions.length, 0);
});

test('a sideways bulge becomes a studs-out panel hung on side-stud bricks', () => {
  const plan = planIntent(intent([{id: 'ball', role: 'body', shape: 'sphere', center: [0, 120, 0], size: [240, 240, 240], colour: 'red'}], {build: {target_longest_studs: 30}}), full, {surfaceFit: false});
  const panels = plan.intent_report.panels;
  assert.ok(panels.panels >= 2 && panels.anchors >= 2, JSON.stringify(panels));
  assert.ok(plan.parts.some(p => p.part_id === '87087'), 'side-stud anchor bricks');
  // Panel parts are turned so their studs point sideways.
  assert.ok(plan.parts.some(p => Math.abs(p.matrix[4]) < 1e-6));
  assert.ok(plan.intent_report.connectivity.connected);
  assert.equal(plan.analysis.body_envelope_collisions.length, 0);
});

test('ears stand up as flat modules on clip-and-bar hinges', () => {
  const head = {id: 'head', role: 'head', shape: 'sphere', center: [0, 60, 0], size: [140, 120, 120], colour: 'light grey'};
  const ear = (id, x) => ({id, role: 'ear', shape: 'cone', axis: 'y', top_scale: 0, center: [x, 125, 0], size: [44, 60, 14], colour: 'light grey', attach_to: 'head'});
  const plan = planIntent(intent([head, ear('left-ear', -35), ear('right-ear', 35)], {build: {target_longest_studs: 32}}), full);
  assert.equal(plan.intent_report.modules.modules, 2, JSON.stringify(plan.intent_report.modules));
  assert.equal(plan.parts.filter(p => p.part_id === '48336').length, 2);
  assert.equal(plan.parts.filter(p => p.part_id === '60470b').length, 2);
  assert.equal(plan.connections.filter(e => e.kind === 'clip_on_bar').length, 2);
  assert.ok(plan.intent_report.connectivity.connected);
  assert.equal(plan.analysis.body_envelope_collisions.length, 0);
});

test('features smaller than the build resolution become surface detail', () => {
  const plan = planIntent(intent([
    {id: 'head', role: 'head', shape: 'sphere', center: [0, 40, 0], size: [80, 80, 80], colour: 'yellow'},
    {id: 'eye', role: 'eye', shape: 'sphere', center: [20, 50, -38], size: [8, 8, 4], colour: 'black'},
    {id: 'whiskers', role: 'whiskers', importance: 'detail', shape: 'tube', points: [[0, 40, -40, 0.3], [40, 42, -44, 0.2]], colour: 'white'}], {build: {target_longest_studs: 12}}), full);
  assert.match(plan.warnings.join(' '), /Shown as surface detail at this size: eye, whiskers/);
  assert.ok(plan.intent_report.brackets.eyes >= 1);
  assert.ok(!plan.parts.some(p => p.component_id === 'whiskers'));
});

test('a review request carries the description, intent, report and views', async () => {
  const {buildReviewRequest, reviewPromptText, REVIEW_INSTRUCTIONS} = await import('../docs/assets/object-intent.js');
  const i = intent([box('a', [0, 5, 0], [10, 10, 10])]);
  const r = buildReviewRequest('a red cube', i, {parts: 3}, {type: 'object'}, 'iVBORw0KGgo=');
  assert.equal(r.kind, 'review'); assert.equal(r.current_intent, i); assert.equal(r.image.media_type, 'image/png');
  assert.match(reviewPromptText('a red cube', i, {parts: 3}), /Current object intent/);
  assert.match(REVIEW_INSTRUCTIONS, /"Review:"/);
  assert.throws(() => buildReviewRequest('a red cube', null, {}, {}), /Build a model first/);
});
