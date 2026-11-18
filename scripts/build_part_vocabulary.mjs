// Offline catalogue ingestion: specialised parts for detailing (slopes, curves,
// inverted slopes, round parts, windows, doors, brackets).
//
// Geometry comes from the pinned LDraw mirror. Connection points come from the
// LDCad Shadow Library (snap metadata, CC BY-SA 4.0); where a part has no
// anti-stud metadata, receivers are placed on its measured flat underside.
// Usage: node scripts/build_part_vocabulary.mjs [ldraw-cache] [shadow-library-dir]
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile);
const LDRAW_COMMIT = 'c70360d1c588be894997b2168c61909bc8058c4d';
const SHADOW_REPOSITORY = 'https://github.com/RolandMelkert/LDCadShadowLibrary';
const base = `https://raw.githubusercontent.com/kulits/ldraw-parts/${LDRAW_COMMIT}/ldraw/`;
const cache = process.argv[2] || '/tmp/ldraw-cache', shadowDir = process.argv[3] || '/tmp/ldcad-shadow';
const vocabulary = JSON.parse(await readFile(new URL('../docs/data/part-vocabulary-v1.json', import.meta.url)));

const missing = new Set();
async function ldrawFile(path) {
  const local = `${cache}/${path}`;
  if (missing.has(path) || existsSync(`${local}.missing`)) return null;
  try { return await readFile(local, 'utf8'); } catch {}
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const text = (await run('curl', ['-fsSL', '--max-time', '30', base + path], {maxBuffer: 16e6})).stdout;
      await mkdir(dirname(local), {recursive: true}); await writeFile(local, text); return text;
    } catch (error) {
      if (/ 404|error: 404/.test(error.stderr || '')) { missing.add(path); await mkdir(dirname(local), {recursive: true}); await writeFile(`${local}.missing`, ''); return null; }
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw new Error(`Could not fetch ${path} after retries.`);
}
async function resolveRef(name, from) {
  const n = name.toLowerCase().replace(/\\/g, '/');
  const candidates = n.startsWith('s/') ? [`parts/${n}`] : n.startsWith('48/') || n.startsWith('8/') ? [`p/${n}`] : [`parts/${n}`, `p/${n}`, `parts/s/${n}`];
  if (from?.startsWith('parts/s/')) candidates.unshift(`parts/s/${n}`);
  for (const path of candidates) { const text = await ldrawFile(path); if (text !== null) return {path, text}; }
  throw new Error(`Cannot resolve ${name} (from ${from})`);
}
const shadowCache = new Map();
async function shadowFor(path) {
  if (shadowCache.has(path)) return shadowCache.get(path);
  const file = `${shadowDir}/${path}`;
  const text = existsSync(file) ? await readFile(file, 'utf8') : null;
  shadowCache.set(path, text);
  return text;
}

// 3x4 affine transforms: [a b c d e f g h i, x y z] with p' = R p + t.
const IDENTITY = {r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0]};
const mulR = (a, b) => Array.from({length: 9}, (_, i) => [0, 1, 2].reduce((s, k) => s + a[Math.floor(i / 3) * 3 + k] * b[k * 3 + i % 3], 0));
const applyR = (r, v) => [r[0] * v[0] + r[1] * v[1] + r[2] * v[2], r[3] * v[0] + r[4] * v[1] + r[5] * v[2], r[6] * v[0] + r[7] * v[1] + r[8] * v[2]];
const compose = (outer, inner) => ({r: mulR(outer.r, inner.r), t: applyR(outer.r, inner.t).map((v, i) => v + outer.t[i])});
const point = (tf, p) => applyR(tf.r, p).map((v, i) => v + tf.t[i]);

function parseMetaParams(line) {
  const params = {};
  for (const m of line.matchAll(/\[(\w+)=([^\]]*)\]/g)) params[m[1].toLowerCase()] = m[2].trim();
  return params;
}
function gridOffsets(spec) {
  if (!spec) return [[0, 0, 0]];
  const tokens = spec.split(/\s+/);
  const axis = () => { const centred = tokens[0].toUpperCase() === 'C'; if (centred) tokens.shift(); return {centred, count: Number(tokens.shift())}; };
  const x = axis(), z = axis(), sx = Number(tokens.shift()), sz = Number(tokens.shift()), out = [];
  for (let i = 0; i < x.count; i++) for (let k = 0; k < z.count; k++)
    out.push([(x.centred ? i - (x.count - 1) / 2 : i) * sx, 0, (z.centred ? k - (z.count - 1) / 2 : k) * sz]);
  return out;
}
// Snap metas of one shadow text, in that file's frame.
async function shadowSnaps(text, origin) {
  const snaps = [];
  let clear = false;
  for (const line of text.split(/\r?\n/)) {
    if (!/^0 !LDCAD /.test(line)) continue;
    // SNAP_CLEAR drops the snaps inherited from subfiles: all of them, or one ID.
    if (/SNAP_CLEAR/.test(line)) { const id = parseMetaParams(line).id?.toLowerCase(); if (id) { if (clear !== true) (clear ||= new Set()).add(id); } else clear = true; continue; }
    const p = parseMetaParams(line);
    const pos = p.pos ? p.pos.split(/\s+/).map(Number) : [0, 0, 0], ori = p.ori ? p.ori.split(/\s+/).map(Number) : IDENTITY.r;
    const local = {r: ori, t: pos};
    if (/SNAP_INCL/.test(line)) {
      const ref = p.ref.toLowerCase().replace(/\\/g, '/');
      const path = ref.startsWith('s/') ? `parts/${ref}` : existsSync(`${shadowDir}/p/${ref}`) ? `p/${ref}` : `parts/${ref}`;
      const included = await shadowFor(path);
      if (!included) continue;
      const inner = (await shadowSnaps(included, path)).snaps;
      for (const offset of gridOffsets(p.grid)) {
        const tf = compose({r: IDENTITY.r, t: applyR(ori, offset).map((v, i) => v + pos[i])}, {r: ori, t: [0, 0, 0]});
        for (const s of inner) snaps.push({...s, tf: compose(tf, s.tf)});
      }
      continue;
    }
    // Clips: a radius-4 grip around a bar, recorded with its centre and axis.
    if (/SNAP_CLP/.test(line)) {
      const length = Number(p.length || 8), centre = p.center === 'true';
      for (const offset of gridOffsets(p.grid)) {
        const tf = {r: ori, t: applyR(ori, offset).map((v, i) => v + pos[i])};
        if (!centre) tf.t = tf.t.map((v, i) => v + applyR(ori, [0, -length / 2, 0])[i]);
        snaps.push({gender: 'C', shape: 'CLP', radius: Number(p.radius || 4), length, sections: [], tf, origin, center: true, id: (p.id || p.group || '').toLowerCase() || null});
      }
      continue;
    }
    if (!/SNAP_CYL/.test(line)) continue;
    const secs = (p.secs || '').trim().split(/\s+/);
    for (const offset of gridOffsets(p.grid)) {
      const tf = {r: ori, t: applyR(ori, offset).map((v, i) => v + pos[i])};
      const sections = [];
      for (let i = 0; i + 2 < secs.length; i += 3) sections.push({shape: secs[i], radius: Number(secs[i + 1]), length: Number(secs[i + 2])});
      snaps.push({gender: (p.gender || '').toUpperCase(), shape: secs[0], radius: Number(secs[1]), length: sections.reduce((t, c) => t + c.length, 0), sections, tf, origin, center: p.center === 'true', id: (p.id || p.group || '').toLowerCase() || null});
    }
  }
  return {snaps, clear};
}

// Walk the part tree: triangles (stud primitives flagged) and snaps in part frame.
async function walk(path, text, tf, out, inStud = false) {
  const shadow = await shadowFor(path);
  let clear = false, own = [];
  if (shadow) {
    const s = await shadowSnaps(shadow, path);
    clear = s.clear; own = s.snaps;
    for (const snap of s.snaps) out.snaps.push({...snap, tf: compose(tf, snap.tf)});
  }
  // Only primitives that are studs (male snaps) are left out of the body; underside
  // tubes and flipped tube primitives can form the body itself (6141).
  const isStud = inStud || (/^p\/((48|8)\/)?stu[dg]/.test(path) && own.some(sn => sn.gender === 'M' && (sn.sections || []).some(c => Math.abs(c.radius - 6) < 0.6)));
  for (const raw of text.split(/\r?\n/)) {
    const f = raw.trim().split(/\s+/);
    if (f[0] === '1' && f.length >= 15) {
      const child = {r: f.slice(5, 14).map(Number), t: f.slice(2, 5).map(Number)};
      const ref = await resolveRef(f.slice(14).join(' '), path);
      const childTf = compose(tf, child);
      const before = out.snaps.length;
      await walk(ref.path, ref.text, childTf, out, isStud);
      // The parent's shadow replaces its children's snaps (all, or those with given IDs).
      if (clear === true) out.snaps.length = before;
      else if (clear) { const kept = out.snaps.slice(before).filter(sn => !clear.has(sn.id)); out.snaps.length = before; out.snaps.push(...kept); }
    } else if (f[0] === '3' && f.length >= 11) {
      const v = [f.slice(2, 5), f.slice(5, 8), f.slice(8, 11)].map(p => point(tf, p.map(Number)));
      out.triangles.push({v, stud: isStud});
    } else if (f[0] === '4' && f.length >= 14) {
      const v = [f.slice(2, 5), f.slice(5, 8), f.slice(8, 11), f.slice(11, 14)].map(p => point(tf, p.map(Number)));
      out.triangles.push({v: [v[0], v[1], v[2]], stud: isStud}, {v: [v[0], v[2], v[3]], stud: isStud});
    }
  }
}

// Convex hull (incremental). Returns {vertices, planes:[{n, d}]} with n·p <= d inside.
function convexHull(points) {
  const key = p => p.map(v => Math.round(v * 20)).join(',');
  const pts = [...new Map(points.map(p => [key(p), p])).values()];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const eps = 1e-6;
  // Initial tetrahedron.
  let i0 = 0, i1 = -1, i2 = -1, i3 = -1, best = 0;
  for (let i = 1; i < pts.length; i++) { const d = dot(sub(pts[i], pts[i0]), sub(pts[i], pts[i0])); if (d > best) { best = d; i1 = i; } }
  best = 0;
  for (let i = 0; i < pts.length; i++) { const c = cross(sub(pts[i1], pts[i0]), sub(pts[i], pts[i0])), d = dot(c, c); if (d > best) { best = d; i2 = i; } }
  best = 0;
  const n0 = cross(sub(pts[i1], pts[i0]), sub(pts[i2], pts[i0]));
  for (let i = 0; i < pts.length; i++) { const d = Math.abs(dot(n0, sub(pts[i], pts[i0]))); if (d > best) { best = d; i3 = i; } }
  if (i1 < 0 || i2 < 0 || i3 < 0 || best < eps) throw new Error('Degenerate hull');
  const centre = [i0, i1, i2, i3].reduce((c, i) => c.map((v, a) => v + pts[i][a] / 4), [0, 0, 0]);
  const face = (a, b, c) => {
    let n = cross(sub(pts[b], pts[a]), sub(pts[c], pts[a]));
    if (dot(n, sub(centre, pts[a])) > 0) { [b, c] = [c, b]; n = n.map(v => -v); }
    const l = Math.hypot(...n); n = n.map(v => v / l);
    return {i: [a, b, c], n, d: dot(n, pts[a])};
  };
  let faces = [face(i0, i1, i2), face(i0, i1, i3), face(i0, i2, i3), face(i1, i2, i3)];
  for (let p = 0; p < pts.length; p++) {
    const visible = faces.filter(f => dot(f.n, pts[p]) - f.d > 1e-7);
    if (!visible.length) continue;
    const edges = new Map();
    for (const f of visible) for (let e = 0; e < 3; e++) {
      const a = f.i[e], b = f.i[(e + 1) % 3], k = a < b ? a + ',' + b : b + ',' + a;
      if (edges.has(k)) edges.delete(k); else edges.set(k, [a, b]);
    }
    faces = faces.filter(f => !visible.includes(f));
    for (const [a, b] of edges.values()) faces.push(face(a, b, p));
  }
  const used = [...new Set(faces.flatMap(f => f.i))].map(i => pts[i]);
  const planes = [...new Map(faces.map(f => [f.n.map(v => v.toFixed(4)).join(',') + ',' + f.d.toFixed(3), {n: f.n, d: f.d}])).values()];
  return {vertices: used, planes};
}

// Bounding box for collision, clipped to the stud planes where a part has both: hinge
// pins and lips that sit inside a neighbour's stud space are not body material.
function collisionBox(lo, hi, features) {
  const top = features.filter(f => f.kind === 'stud' && f.axis[1] < -0.99).map(f => f.position_ldu[1]);
  const bottom = features.filter(f => f.kind === 'stud_receiver' && f.axis[1] > 0.99).map(f => f.position_ldu[1]);
  const y0 = top.length ? Math.max(lo[1], Math.min(...top)) : lo[1], y1 = bottom.length ? Math.min(hi[1], Math.max(...bottom)) : hi[1];
  // Snap x and z to the stud grid the vertical studs and anti-studs sit on (within
  // 3 LDU), so the box is the part's cell block even where a chamfer narrows the body.
  const vertical = features.filter(f => Math.abs(f.axis[1]) > 0.99);
  const snap = (v, a) => {
    if (!vertical.length) return v;
    const phases = vertical.map(f => ((f.position_ldu[a] - 10) % 20 + 30) % 20 - 10).sort((x, y) => x - y), o = phases[Math.floor(phases.length / 2)];
    const g = o + 20 * Math.round((v - o) / 20);
    return Math.abs(g - v) <= 3 ? g : v;
  };
  const x0 = snap(lo[0], 0), x1 = snap(hi[0], 0), z0 = snap(lo[2], 2), z1 = snap(hi[2], 2);
  return {min: [x0, y0 < y1 ? y0 : lo[1], z0].map(v => +(v * 0.4).toFixed(3)), max: [x1, y0 < y1 ? y1 : hi[1], z1].map(v => +(v * 0.4).toFixed(3))};
}
const profiles = [], report = [];
for (const entry of vocabulary.parts) {
  const id = entry.part_id;
  const root = await ldrawFile(`parts/${id}.dat`);
  if (!root) throw new Error(`Missing LDraw file for ${id}`);
  const out = {triangles: [], snaps: []};
  await walk(`parts/${id}.dat`, root, IDENTITY, out);
  const body = out.triangles.filter(t => !t.stud).flatMap(t => t.v);
  const all = out.triangles.flatMap(t => t.v);
  const hull = convexHull(body);
  const lo = [0, 1, 2].map(a => Math.min(...body.map(p => p[a]))), hi = [0, 1, 2].map(a => Math.max(...body.map(p => p[a])));
  const features = [];
  const round6 = c => Math.abs(c.radius - 6) < 0.6 && (c.shape === 'R' || c.shape === 'S' || c.shape === '_R');
  // LDCad cylinder sections run along -y of the snap frame. A stud is the radius-6
  // section of a male cylinder (often after a rim section); an anti-stud is a female
  // cylinder whose opening section is radius 6.
  const datum = s => {
    const sections = s.sections?.length ? s.sections : [s];
    if (s.gender === 'F') return round6(sections[0]) ? 0 : null;
    let offset = 0;
    for (const c of sections) { if (round6(c)) return offset; offset += c.length; }
    return null;
  };
  const r6 = s => datum(s) !== null;
  for (const s of out.snaps) {
    if (!['M', 'F'].includes(s.gender) || !r6(s)) continue;
    const kind = s.gender === 'M' ? 'stud' : 'stud_receiver';
    const position = applyR(s.tf.r, [0, -datum(s), 0]).map((v, i) => +(v + s.tf.t[i]).toFixed(3));
    const axis = applyR(s.tf.r, kind === 'stud' ? [0, -1, 0] : [0, 1, 0]).map(v => Math.round(v * 1e6) / 1e6 || 0);
    if (features.some(f => f.kind === kind && Math.hypot(...f.position_ldu.map((v, i) => v - position[i])) < 0.5)) continue;
    features.push({feature_id: `${kind}-${features.filter(f => f.kind === kind).length}`, kind, position_ldu: position, axis});
  }
  let receiverSource = 'ldcad_shadow';
  if (!features.some(f => f.kind === 'stud_receiver')) {
    // Flat underside: receivers on the stud grid wherever the convex body reaches the bottom plane.
    receiverSource = 'measured_flat_underside';
    const bottom = hi[1], inside = p => hull.planes.every(pl => pl.n[0] * p[0] + pl.n[1] * p[1] + pl.n[2] * p[2] <= pl.d + 1e-3);
    const nx = Math.round((hi[0] - lo[0]) / 20), nz = Math.round((hi[2] - lo[2]) / 20);
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
      const x = lo[0] + 10 + 20 * i, z = lo[2] + 10 + 20 * k;
      if ([[-6, 0], [6, 0], [0, -6], [0, 6], [0, 0]].every(([dx, dz]) => inside([x + dx, bottom - 0.5, z + dz])))
        features.push({feature_id: `stud_receiver-${features.filter(f => f.kind === 'stud_receiver').length}`, kind: 'stud_receiver', position_ldu: [+x.toFixed(3), +bottom.toFixed(3), +z.toFixed(3)], axis: [0, 1, 0]});
    }
  }
  // Other snaps (bar holders, hinge pins, clips) with their datums, for recipes that join them.
  const other = [];
  for (const s of out.snaps) if (!r6(s) && ['M', 'F', 'C'].includes(s.gender)) {
    // Datum: the cylinder's centre (bars and clips slide and turn about their axis).
    const axis = applyR(s.tf.r, [0, -1, 0]).map(v => Math.round(v * 1e6) / 1e6 || 0);
    const centre = s.center ? s.tf.t : s.tf.t.map((v, i) => v + axis[i] * s.length / 2);
    const type = `${s.gender}-${s.shape}${s.radius}`, position = centre.map(v => +v.toFixed(3));
    if (!other.some(o => o.type === type && Math.hypot(...o.position_ldu.map((v, i) => v - position[i])) < 0.5)) other.push({type, position_ldu: position, axis, length_ldu: s.length});
  }
  const description = root.split(/\r?\n/)[0].slice(2).replace(/\s+/g, ' ').trim();
  const meshFile = `part-meshes/${id}.json`;
  const triangles = all.map(p => p.map(v => +(v * 0.4).toFixed(3)));
  // Meshes already shipped for the viewer are kept as they are.
  const meshUrl = new URL(`../docs/data/${meshFile}`, import.meta.url);
  if (!existsSync(meshUrl)) await writeFile(meshUrl, JSON.stringify({schema_version: 1, part_id: id, source_library_commit: LDRAW_COMMIT,
    license: root.match(/^0 !LICENSE (.+)/m)?.[1].trim(), author: root.match(/^0 Author: (.+)/m)?.[1].trim(), triangle_positions_mm: triangles.flat()}) + '\n');
  profiles.push({
    part_id: id, description, family: entry.family, roles: entry.roles || [],
    source_filename: `parts/${id}.dat`, source_author: root.match(/^0 Author: (.+)/m)?.[1].trim(), source_license_notice: root.match(/^0 !LICENSE (.+)/m)?.[1].trim(), source_library_commit: LDRAW_COMMIT,
    connection_source: receiverSource, features,
    other_connectors: other,
    body_vertices_mm: hull.vertices.map(p => p.map(v => +(v * 0.4).toFixed(3))),
    body_planes_mm: hull.planes.map(pl => [...pl.n.map(v => +v.toFixed(6)), +(pl.d * 0.4).toFixed(4)]),
    body_bounds_mm: {min: lo.map(v => +(v * 0.4).toFixed(3)), max: hi.map(v => +(v * 0.4).toFixed(3))},
    // Collision uses the conservative bounding box: fitted parts fill their cell block,
    // and an exact test against hulls of hundreds of vertices is too slow to sequence with.
    collision_boxes_mm: [collisionBox(lo, hi, features)],
    footprint_studs_x: Math.round((hi[0] - lo[0]) / 20), footprint_studs_z: Math.round((hi[2] - lo[2]) / 20),
    body_height_ldu: +(hi[1] - lo[1]).toFixed(3), mesh_file: meshFile,
    ...(entry.insert ? {insert: entry.insert} : {}),
  });
  report.push(`${id.padEnd(7)} ${description.slice(0, 44).padEnd(44)} studs ${features.filter(f => f.kind === 'stud').length} receivers ${features.filter(f => f.kind === 'stud_receiver').length} (${receiverSource}) hull ${hull.vertices.length} footprint ${Math.round((hi[0] - lo[0]) / 20)}x${Math.round((hi[2] - lo[2]) / 20)} h ${(hi[1] - lo[1]).toFixed(1)}`);
}
// A frame's collision body is its border around the insert (glass, door) it holds,
// so the insert can sit inside it.
for (const frame of profiles.filter(p => p.insert)) {
  const insert = profiles.find(p => p.part_id === frame.insert.part_id);
  if (!insert) throw new Error(`Insert ${frame.insert.part_id} for ${frame.part_id} is not in the vocabulary`);
  const off = frame.insert.offset_ldu.map(v => v * 0.4), f = frame.collision_boxes_mm[0];
  const i = {min: insert.body_bounds_mm.min.map((v, a) => Math.max(f.min[a], v + off[a])), max: insert.body_bounds_mm.max.map((v, a) => Math.min(f.max[a], v + off[a]))};
  const box = (x0, x1, y0, y1) => ({min: [x0, y0, f.min[2]], max: [x1, y1, f.max[2]]});
  frame.collision_boxes_mm = [box(f.min[0], i.min[0], f.min[1], f.max[1]), box(i.max[0], f.max[0], f.min[1], f.max[1]),
    box(i.min[0], i.max[0], f.min[1], i.min[1]), box(i.min[0], i.max[0], i.max[1], f.max[1])].filter(b => b.max[0] - b.min[0] > 0.01 && b.max[1] - b.min[1] > 0.01);
}
const shadowCommit = existsSync(`${shadowDir}/.git`) ? (await run('git', ['-C', shadowDir, 'rev-parse', 'HEAD'])).stdout.trim() : null;
await writeFile(new URL('../docs/data/connection-profiles/part-vocabulary-profiles-v1.json', import.meta.url), JSON.stringify({
  schema_version: 1, coordinate_system: 'LDraw', length_unit: 'LDU',
  sources: {geometry: {repository: 'https://github.com/kulits/ldraw-parts', commit: LDRAW_COMMIT, licence: 'Per-file LDraw notices (CC BY 4.0 and earlier CCAL 2.0)'},
    connections: {repository: SHADOW_REPOSITORY, commit: shadowCommit, licence: 'CC BY-SA 4.0', note: 'Stud and anti-stud datums derived from LDCad Shadow Library snap metadata. This file is distributed under CC BY-SA 4.0.'}},
  limitations: ['Only radius-6 stud and anti-stud connections join parts in the engine; bars, clips, pins and hinges are listed as other connectors (centre datum, axis, length) and used only by fixed recipes (window glass, doors, clip-hinged modules).',
    'Bodies are convex hulls of each part without its studs; concave details are filled. Collision checks use the bounding box.', 'Nominal datums do not prove clutch force or stability.'],
  profiles,
}, null, 1) + '\n');
console.log(report.join('\n'));
