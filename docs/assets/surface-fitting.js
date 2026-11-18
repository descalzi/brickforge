// Surface fitting: replace stepped edges with real slopes, curved slopes, inverted
// slopes, cones and round parts wherever they match the intended surface better
// than whole cells do.
//
// Each part orientation has a precomputed cell occupancy pattern, sampled against
// its convex body. Around every cell the grid misrepresents, the fitter tries
// placements whose sloped cells cover it, scores the reduction in
// |occupancy - ideal| over the block, and keeps the best non-overlapping ones that
// clutch the model, keep one colour and leave nothing resting on a sloped face.
const STUD = 8, PLATE = 3.2, SAMPLES = [0.125, 0.375, 0.625, 0.875];
const ROTATIONS = [[1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 1, 0, 1, 0, -1, 0, 0], [-1, 0, 0, 0, 1, 0, 0, 0, -1], [0, 0, -1, 0, 1, 0, 1, 0, 0]];
const rot = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const rotT = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
const FAMILY_SHAPES = {cone: ['cone'], round: ['cylinder', 'tube', 'cone']};
export const SURFACE_FAMILIES = ['slope45', 'slope33', 'slope65', 'slope75', 'slope_low', 'curved', 'inverted', 'inverted_curved', 'cone', 'round'];

/** Cell patterns for every distinct upright orientation of every surface part. */
export function surfacePatterns(profiles, families = SURFACE_FAMILIES) {
  const patterns = [];
  for (const profile of profiles) {
    if (!families.includes(profile.family) || !profile.body_planes_mm) continue;
    const b = profile.body_bounds_mm, height = b.max[1] - b.min[1], h = Math.round(height / PLATE);
    if (h < 1 || Math.abs(h * PLATE - height) > 0.6) continue;
    const seen = new Set();
    for (const m of ROTATIONS) {
      // Part-local mm to world-aligned offsets (x, up, z) from the part origin.
      const world = p => { const r = rot(m, p); return [r[0], -r[1], -r[2]]; };
      const corners = [];
      for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) corners.push(world([x, y, z]));
      const lo = [0, 1, 2].map(a => Math.min(...corners.map(c => c[a]))), hi = [0, 1, 2].map(a => Math.max(...corners.map(c => c[a])));
      const fx = Math.round((hi[0] - lo[0]) / STUD), fz = Math.round((hi[2] - lo[2]) / STUD);
      if (!fx || !fz || Math.abs(fx * STUD - (hi[0] - lo[0])) > 0.8 || Math.abs(fz * STUD - (hi[2] - lo[2])) > 0.8) continue;
      const blockMin = [(lo[0] + hi[0] - fx * STUD) / 2, lo[1], (lo[2] + hi[2] - fz * STUD) / 2];
      // Vertical stud datums on cell centres: studs on the top layer, receivers on the bottom.
      const studs = [], receivers = [];
      for (const f of profile.features) {
        if (f.kind !== 'stud' && f.kind !== 'stud_receiver') continue;
        const axis = world(f.axis), p = world(f.position_ldu.map(v => v * 0.4));
        if (Math.abs(axis[1]) < 0.99) continue;
        const u = (p[0] - blockMin[0]) / STUD, w = (p[2] - blockMin[2]) / STUD, l = Math.round((p[1] - blockMin[1]) / PLATE);
        if (Math.abs(u % 1 - 0.5) > 0.15 || Math.abs(w % 1 - 0.5) > 0.15) continue;
        const i = Math.floor(u), k = Math.floor(w);
        if (i < 0 || k < 0 || i >= fx || k >= fz) continue;
        if (f.kind === 'stud' && axis[1] > 0 && l === h) studs.push(i + k * fx);
        if (f.kind === 'stud_receiver' && axis[1] < 0 && l === 0) receivers.push(i + k * fx);
      }
      if (!studs.length && !receivers.length) continue;
      const occupancy = new Float32Array(fx * fz * h), planes = profile.body_planes_mm;
      for (let l = 0; l < h; l++) for (let k = 0; k < fz; k++) for (let i = 0; i < fx; i++) {
        let inside = 0;
        for (const a of SAMPLES) for (const c of SAMPLES) for (const e of SAMPLES) {
          const q = rotT(m, [blockMin[0] + (i + a) * STUD, -(blockMin[1] + (l + c) * PLATE), -(blockMin[2] + (k + e) * STUD)]);
          if (planes.every(([px, py, pz, d]) => px * q[0] + py * q[1] + pz * q[2] <= d + 1e-3)) inside++;
        }
        occupancy[(l * fz + k) * fx + i] = inside / 64;
      }
      const uniqueStuds = [...new Set(studs)], uniqueReceivers = [...new Set(receivers)];
      const key = `${fx},${fz},${h}|${Array.from(occupancy, v => v.toFixed(2))}|${uniqueStuds.sort()}|${uniqueReceivers.sort()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sloped = [];
      for (let c = 0; c < occupancy.length; c++) if (occupancy[c] > 0.05 && occupancy[c] < 0.95) sloped.push(c);
      patterns.push({profile, matrix: m, fx, fz, h, blockMin, occupancy, sloped,
        volume: occupancy.reduce((s, v) => s + v, 0), studs: uniqueStuds, receivers: uniqueReceivers});
    }
  }
  return patterns;
}

/**
 * Place surface parts on the grid, editing owner/colour where they go. Returns
 * reserved parts in the tiler's format. blocked(c): cells other detailing claimed.
 */
export function fitSurfaces(grid, patterns, blocked, options = {}) {
  const {nx, ny, nz, owner, colour, idealFraction, origin, index} = grid, layer = nx * nz, total = nx * ny * nz;
  const minGain = options.minGain ?? 0.3, partCost = options.partCost ?? 0.35, maxParts = options.maxParts ?? Infinity;
  const filled = c => owner[c] >= 0;
  // Fractional fidelity of the surface (min/max soft IoU), before and after fitting.
  const fraction = new Float32Array(total).fill(-1);
  const fidelity = () => { let a = 0, b = 0; for (let c = 0; c < total; c++) { const r = fraction[c] >= 0 ? fraction[c] : filled(c) ? 1 : 0, f = idealFraction[c]; a += Math.min(r, f); b += Math.max(r, f); } return b ? a / b : 0; };
  const before = fidelity();
  const errorCells = [];
  for (let c = 0; c < total; c++) if (!blocked(c) && Math.abs((filled(c) ? 1 : 0) - idealFraction[c]) > 0.2) errorCells.push(c);
  // claimed: cells inside placed parts; anchors: the material placed parts clutch to,
  // which later placements must leave alone.
  const claimed = new Uint8Array(total), anchors = new Uint8Array(total);
  // Widest horizontal extent of each component, in cells (x, z).
  const span = new Int32Array(grid.components.length * 2);
  {
    const lo = new Int32Array(grid.components.length * 2).fill(1e9), hi = new Int32Array(grid.components.length * 2).fill(-1);
    for (let c = 0; c < total; c++) { const q = owner[c]; if (q < 0) continue; const i = c % nx, k = Math.floor(c / nx) % nz;
      lo[q * 2] = Math.min(lo[q * 2], i); hi[q * 2] = Math.max(hi[q * 2], i); lo[q * 2 + 1] = Math.min(lo[q * 2 + 1], k); hi[q * 2 + 1] = Math.max(hi[q * 2 + 1], k); }
    for (let a = 0; a < span.length; a++) span[a] = hi[a] >= 0 ? hi[a] - lo[a] + 1 : 0;
  }
  const debug = options.debug, no = reason => { if (debug) debug[reason] = (debug[reason] || 0) + 1; return null; };
  function evaluate(p, i0, j0, k0) {
    if (i0 < 0 || j0 < 0 || k0 < 0 || i0 + p.fx > nx || j0 + p.h > ny || k0 + p.fz > nz) return no('outside');
    let gain = 0, partColour = -2, component = -1;
    for (let l = 0; l < p.h; l++) for (let k = 0; k < p.fz; k++) for (let i = 0; i < p.fx; i++) {
      const o = p.occupancy[(l * p.fz + k) * p.fx + i], c = index(i0 + i, j0 + l, k0 + k);
      if (blocked(c) || claimed[c] || anchors[c]) { if (o > 0.02 || filled(c)) return no('taken'); continue; }
      const f = filled(c);
      if (f) {
        if (partColour === -2) { partColour = colour[c]; component = owner[c]; } else if (colour[c] !== partColour) return no('colour');
      }
      // Every stud joint the stepped material had stays a stud joint: nothing may rest
      // on the part except on its studs, and it may sit on material only at receivers.
      if (l === p.h - 1 && j0 + p.h < ny && filled(c + layer) && !(p.studs.includes(i + k * p.fx) && o > 0.5)) return no('covered');
      if (l === 0 && j0 > 0 && o > 0.02 && filled(c - layer) && !p.receivers.includes(i + k * p.fx)) return no('no_receiver');
      gain += Math.abs((f ? 1 : 0) - idealFraction[c]) - Math.abs(o - idealFraction[c]);
    }
    if (partColour === -2) return no('empty');
    // Cones only taper cone components; round parts only round off round components.
    // They must also span the component's whole cross-section (a post, a stalk, a tip);
    // scattered over a wide surface they read as spikes and pits.
    const fit = FAMILY_SHAPES[p.profile.family];
    if (fit && (!fit.includes(grid.components[component]?.shape) || span[component * 2] > p.fx || span[component * 2 + 1] > p.fz)) return no('shape');
    // It must clutch stepped material (not another fitted part): a receiver over it or a stud under it.
    const free = c => filled(c) && !blocked(c) && !claimed[c];
    const below = j0 > 0 && p.receivers.some(r => free(index(i0 + r % p.fx, j0 - 1, k0 + Math.floor(r / p.fx))));
    const above = j0 + p.h < ny && p.studs.some(s => free(index(i0 + s % p.fx, j0 + p.h, k0 + Math.floor(s / p.fx))));
    if (!below && !above) return no('unattached');
    return {gain, i0, j0, k0, colour: partColour, component};
  }
  const candidates = [];
  for (const [pi, p] of patterns.entries()) {
    const visited = new Set();
    for (const e of errorCells) {
      const ei = e % nx, ek = Math.floor(e / nx) % nz, ej = Math.floor(e / layer);
      for (const s of p.sloped) {
        const i = s % p.fx, k = Math.floor(s / p.fx) % p.fz, l = Math.floor(s / (p.fx * p.fz));
        const i0 = ei - i, j0 = ej - l, k0 = ek - k, anchor = (j0 * nz + k0) * nx + i0;
        if (visited.has(anchor)) continue;
        visited.add(anchor);
        const c = evaluate(p, i0, j0, k0);
        if (c && c.gain - partCost > minGain) candidates.push({...c, pi}); else if (c) no('low_gain');
      }
    }
  }
  candidates.sort((a, b) => (b.gain - partCost) - (a.gain - partCost) || patterns[b.pi].volume - patterns[a.pi].volume);
  // Material connectivity before fitting: stepped cells joined face to face.
  const before6 = labelComponents(grid, null);
  const placed = [], partOf = new Int32Array(total).fill(-1);
  for (const cand of candidates) {
    if (placed.length >= maxParts) break;
    const p = patterns[cand.pi];
    // Re-check against the grid as earlier placements changed it.
    const now = evaluate(p, cand.i0, cand.j0, cand.k0);
    if (!now || now.gain - partCost <= minGain) continue;
    const at = (i, l, k) => index(cand.i0 + i, cand.j0 + l, cand.k0 + k);
    const cells = [], undo = [];
    for (let l = 0; l < p.h; l++) for (let k = 0; k < p.fz; k++) for (let i = 0; i < p.fx; i++) {
      const c = at(i, l, k), o = p.occupancy[(l * p.fz + k) * p.fx + i];
      undo.push([c, owner[c], colour[c]]);
      // The part owns its whole block, empty corners included: its collision body is
      // the block, so nothing else may be placed in it.
      fraction[c] = o;
      claimed[c] = 1; partOf[c] = placed.length; owner[c] = now.component; colour[c] = now.colour; cells.push(c);
    }
    const studTop = p.studs.map(s => at(s % p.fx, p.h - 1, Math.floor(s / p.fx))), receivers = p.receivers.map(r => at(r % p.fx, 0, Math.floor(r / p.fx)));
    for (const c of receivers) if (c - layer >= 0 && filled(c - layer)) anchors[c - layer] = 1;
    for (const c of studTop) if (c + layer < total && filled(c + layer)) anchors[c + layer] = 1;
    placed.push({p, cand, now, cells, undo, studTop, receivers, active: true});
  }
  // A fitted part joins only through its studs and receivers. Undo parts that split
  // material which was one piece before fitting.
  let undone = 0;
  for (let round = 0; round < 6; round++) {
    const after = labelComponents(grid, {placed, partOf});
    const bad = new Set();
    const dominant = new Map(), tally = new Map();
    for (let c = 0; c < total; c++) {
      const b = before6.label[c];
      if (b < 0) continue;
      const a = partOf[c] >= 0 && placed[partOf[c]].active ? after.partLabel[partOf[c]] : after.label[c];
      if (a < 0) continue;
      const key = b * 1e7 + a;
      tally.set(key, (tally.get(key) || 0) + 1);
      if (!dominant.has(b) || tally.get(key) > tally.get(b * 1e7 + dominant.get(b))) dominant.set(b, a);
    }
    for (let c = 0; c < total; c++) {
      const b = before6.label[c];
      if (b < 0) continue;
      const own = partOf[c] >= 0 && placed[partOf[c]].active ? partOf[c] : -1;
      const a = own >= 0 ? after.partLabel[own] : after.label[c];
      if (a < 0 || a === dominant.get(b)) continue;
      // A stray fragment: undo the part it belongs to, or the parts next to it.
      if (own >= 0) { bad.add(own); continue; }
      const ci = c % nx, ck = Math.floor(c / nx) % nz, cj = Math.floor(c / layer);
      for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const i = ci + di, j = cj + dj, k = ck + dk;
        if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue;
        const q = partOf[index(i, j, k)];
        if (q >= 0 && placed[q].active) bad.add(q);
      }
    }
    if (!bad.size) break;
    // Undo in reverse placement order so restored cells are the ones each part took.
    for (const q of [...bad].sort((x, y) => y - x)) {
      const r = placed[q];
      r.active = false; undone++;
      for (const [c, o, col] of r.undo.slice().reverse()) {
        if (partOf[c] === q) { partOf[c] = -1; claimed[c] = 0; }
        if (partOf[c] >= 0) continue;
        owner[c] = o; colour[c] = col; fraction[c] = -1;
      }
    }
  }
  const reserved = [], summary = {};
  for (const {p, cand, now, cells, studTop, receivers, active} of placed) {
    if (!active) continue;
    const worldMin = [origin[0] + cand.i0 * STUD, origin[1] + cand.j0 * PLATE, origin[2] + cand.k0 * STUD];
    const o = [0, 1, 2].map(a => worldMin[a] - p.blockMin[a]);
    reserved.push({cells, studTop: new Set(studTop), receivers: new Set(receivers),
      bottom_layer: cand.j0, colour: now.colour, component_index: now.component, kind: 'surface_fit',
      placements: [{part_id: p.profile.part_id, colour_code: now.colour, matrix: [...p.matrix], translation_ldu: [o[0] / 0.4, -o[1] / 0.4, -o[2] / 0.4]}]});
    summary[p.profile.family] = (summary[p.profile.family] || 0) + 1;
  }
  return {reserved, summary, candidates: candidates.length, error_cells: errorCells.length, undone, iou_before: before, iou_after: fidelity()};
}

// Connected pieces of material. Without fitted parts: filled cells joined face to face.
// With them: stepped cells face to face, fitted parts only through their studs and receivers.
function labelComponents(grid, fitted) {
  const {nx, ny, nz, owner} = grid, layer = nx * nz, total = nx * ny * nz;
  const nParts = fitted ? fitted.placed.length : 0, parent = new Int32Array(total + nParts);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  const isPart = c => fitted && fitted.partOf[c] >= 0 && fitted.placed[fitted.partOf[c]].active;
  const free = c => owner[c] >= 0 && !isPart(c);
  for (let c = 0; c < total; c++) {
    if (!free(c)) continue;
    if (c % nx + 1 < nx && free(c + 1)) union(c, c + 1);
    if (Math.floor(c / nx) % nz + 1 < nz && free(c + nx)) union(c, c + nx);
    if (c + layer < total && free(c + layer)) union(c, c + layer);
  }
  if (fitted) fitted.placed.forEach((r, q) => {
    if (!r.active) return;
    const node = total + q;
    for (const c of r.receivers) if (c - layer >= 0 && owner[c - layer] >= 0) union(node, isPart(c - layer) ? total + fitted.partOf[c - layer] : c - layer);
    for (const c of r.studTop) if (c + layer < total && owner[c + layer] >= 0) union(node, isPart(c + layer) ? total + fitted.partOf[c + layer] : c + layer);
  });
  const label = new Int32Array(total).fill(-1), partLabel = new Int32Array(nParts).fill(-1);
  for (let c = 0; c < total; c++) if (free(c)) label[c] = find(c);
  for (let q = 0; q < nParts; q++) if (fitted.placed[q].active) partLabel[q] = find(total + q);
  return {label, partLabel};
}
