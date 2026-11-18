// Offline catalogue ingestion: regular bricks, plates and tiles for the massing engine.
// Measures each part's resolved LDraw surface at the pinned mirror commit and writes
// nominal stud/receiver datums on its measured footprint.
// Usage: node scripts/build_standard_profiles.mjs [ldraw-cache-directory]
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createLDrawGeometryResolver} from './lib/ldraw-geometry.js';

const run = promisify(execFile);
const commit = 'c70360d1c588be894997b2168c61909bc8058c4d';
const base = `https://raw.githubusercontent.com/kulits/ldraw-parts/${commit}/ldraw/`;
const cache = process.argv[2] || '/tmp/ldraw-cache';
const documents = new Map();
const resolver = createLDrawGeometryResolver({source: {geometry_base_url: base}}, {fetchImpl: async url => {
  const path = url.slice(base.length), local = `${cache}/${path}`;
  let text;
  try { text = await readFile(local, 'utf8'); } catch {
    try { text = (await run('curl', ['-fsSL', '--retry', '2', '--max-time', '30', url], {maxBuffer: 8e6})).stdout; }
    catch (error) { if (error.stderr?.includes('404')) return {ok: false, status: 404}; throw error; }
    await mkdir(dirname(local), {recursive: true});
    await writeFile(local, text);
  }
  documents.set(path, text);
  return {ok: true, text: async () => text};
}});

// Regular elements added for the massing engine. Kind decides datums.
const additions = [
  ['2456', 'brick'], ['6111', 'brick'], ['6112', 'brick'],
  ['3031', 'plate'], ['3032', 'plate'], ['3035', 'plate'], ['3030', 'plate'], ['3029', 'plate'],
  ['3958', 'plate'], ['3036', 'plate'], ['3033', 'plate'], ['3028', 'plate'],
  ['2445', 'plate'], ['4282', 'plate'], ['4477', 'plate'], ['60479', 'plate'],
  ['3070b', 'tile'], ['3069b', 'tile'], ['63864', 'tile'], ['2431', 'tile'], ['6636', 'tile'], ['4162', 'tile'], ['3068b', 'tile'], ['87079', 'tile'],
];
// Existing basic-bricks profiles, audited for orientation against the same source.
const basic = JSON.parse(await readFile(new URL('../docs/data/connection-profiles/basic-bricks.json', import.meta.url)));

const index = ids => ({parts: ids.map(id => ({part_id: id, filename: `parts/${id}.dat`}))});
async function measure(id) {
  const measured = await resolver.resolvePart(id, index([id]));
  if (measured.geometry_status !== 'resolved_ldraw_surface') throw new Error(`${id} did not resolve: ${measured.geometry_status}`);
  const root = documents.get(`parts/${id}.dat`);
  const {minimum, maximum} = measured.bounds_mm;
  const sx = (maximum[0] - minimum[0]) / 8, sz = (maximum[2] - minimum[2]) / 8, height = maximum[1];
  if (!Number.isInteger(Math.round(sx * 1000) / 1000) || !Number.isInteger(Math.round(sz * 1000) / 1000)) throw new Error(`${id} footprint is not on the stud grid`);
  if (Math.abs(minimum[0] + maximum[0]) > 1e-6 || Math.abs(minimum[2] + maximum[2]) > 1e-6) throw new Error(`${id} origin is not centred`);
  return {
    sx: Math.round(sx), sz: Math.round(sz), height_mm: Math.round(height * 1000) / 1000,
    description: root.split(/\r?\n/)[0].slice(2).replace(/\s+/g, ' ').trim(),
    author: root.match(/^0 Author: (.+)/m)?.[1].trim(),
    licence: root.match(/^0 !LICENSE (.+)/m)?.[1].trim(),
    bounds_mm: measured.bounds_mm,
  };
}

function profileFor(id, kind, m) {
  const features = [];
  const height = kind === 'brick' ? 24 : 8;
  if (Math.abs(m.height_mm - height * 0.4) > 1e-3) throw new Error(`${id} height ${m.height_mm} mm does not match a ${kind}`);
  for (let i = 0; i < m.sx; i++) for (let k = 0; k < m.sz; k++) {
    const x = (i - (m.sx - 1) / 2) * 20, z = (k - (m.sz - 1) / 2) * 20, tag = `x${x < 0 ? 'm' + -x : x}_z${z < 0 ? 'm' + -z : z}`;
    if (kind !== 'tile') features.push({feature_id: `top-stud-${tag}`, kind: 'stud', position_ldu: [x, 0, z], axis: [0, -1, 0]});
    features.push({feature_id: `underside-receiver-${tag}`, kind: 'stud_receiver', position_ldu: [x, height, z], axis: [0, 1, 0]});
  }
  return {
    part_id: id, description: m.description, element_kind: kind,
    source_filename: `parts/${id}.dat`, source_author: m.author, source_license_notice: m.licence,
    source_library_commit: commit,
    footprint_studs_x: m.sx, footprint_studs_z: m.sz, body_height_ldu: height,
    stud_pitch_ldu: 20, stud_projection_ldu: kind === 'tile' ? 0 : 4,
    measured_bounds_mm: m.bounds_mm,
    features,
  };
}

const profiles = [];
for (const [id, kind] of additions) profiles.push(profileFor(id, kind, await measure(id)));
const audit = [];
for (const p of basic.profiles) {
  const m = await measure(p.part_id);
  audit.push({part_id: p.part_id, measured_footprint_studs: [m.sx, m.sz], measured_height_mm: m.height_mm});
}
const catalogue = {
  schema_version: 1,
  coordinate_system: 'LDraw',
  length_unit: 'LDU',
  source: {repository: 'https://github.com/kulits/ldraw-parts', commit},
  authoring_notice: 'Footprints and heights are measured from resolved LDraw surfaces at the pinned commit. Stud and receiver datums are BrickForge-authored nominal grid locations on that footprint.',
  limitations: [
    'Receiver datums describe intended stud entry locations only, not the internal tube or clutch profile.',
    'Tiles expose receivers only; their smooth tops accept no studs.',
    'Geometric alignment does not prove clutch engagement, colour availability or structural stability.',
  ],
  profiles,
  basic_orientation_audit: audit,
};
const target = new URL('../docs/data/connection-profiles/standard-elements-v1.json', import.meta.url);
await writeFile(target, JSON.stringify(catalogue, null, 1) + '\n');
console.log(`Wrote ${profiles.length} profiles and audited ${audit.length} basic profiles.`);
for (const a of audit) {
  const p = basic.profiles.find(b => b.part_id === a.part_id);
  if (p.footprint_studs_x !== a.measured_footprint_studs[0]) console.log(`basic ${a.part_id} footprint ${p.footprint_studs_x}x${p.footprint_studs_z} disagrees with measured ${a.measured_footprint_studs.join('x')}`);
}
