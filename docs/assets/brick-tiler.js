// Layered brick/plate/tile tiling of a voxel grid with interlocking and connectivity.
//
// Each plate layer is covered greedily with real elements. Candidates are scored by
// covered volume, joining previously separate assemblies, binding to several parts
// below and avoiding seams over seams. Hidden cells (not reachable from outside
// air) may take any colour, which lets a part reach into a neighbouring component
// to join it. Several randomised trials per layer keep the best layer.

const W = {volume: 1, merge: 40, bind: 2, float: 30, seam: 1.5, part: 1.5, jitter: 0.6};

/** Element types from regular catalogue profiles. */
export function elementTypes(profiles) {
  const types = [];
  for (const p of profiles) {
    const kind = p.element_kind || (p.description.toLowerCase().includes('plate') ? 'plate' : 'brick');
    const h = p.body_height_ldu === 24 ? 3 : p.body_height_ldu === 8 ? 1 : null;
    if (!h || (kind === 'brick') !== (h === 3)) continue;
    const studs = p.features.some(f => f.kind === 'stud');
    if ((kind === 'tile') === studs) continue;
    for (const rotated of p.footprint_studs_x === p.footprint_studs_z ? [false] : [false, true])
      types.push({part_id: p.part_id, kind, h, rotated,
        fx: rotated ? p.footprint_studs_z : p.footprint_studs_x, fz: rotated ? p.footprint_studs_x : p.footprint_studs_z});
  }
  // Larger first so ties favour fewer parts.
  return types.sort((a, b) => b.fx * b.fz * b.h - a.fx * a.fz * a.h || a.part_id.localeCompare(b.part_id));
}

function mulberry32(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/**
 * grid: {nx, ny, nz, index, colour (Int16, -1 empty), visible (Uint8), tileTop (Uint8), noBrick (Uint8)}
 * reserved: pre-placed parts [{cells:[...], studTop:Set(cells), receivers:Set(cells), colour}]
 */
export function tileGrid(grid, types, reserved = [], {seed = 1, trials = 6} = {}) {
  const {nx, ny, nz, index, colour, visible} = grid, total = nx * ny * nz, layerSize = nx * nz;
  const tileTop = grid.tileTop || new Uint8Array(total), noBrick = grid.noBrick || new Uint8Array(total);
  const owner = new Int32Array(total).fill(-1), studTop = new Uint8Array(total), receiver = new Uint8Array(total);
  const parts = [];
  let parent = [];
  const find = (p, par = parent) => { while (par[p] !== p) { par[p] = par[par[p]]; p = par[p]; } return p; };
  const union = (a, b, par = parent) => { a = find(a, par); b = find(b, par); if (a !== b) par[Math.max(a, b)] = Math.min(a, b); return a !== b; };
  for (const r of reserved) {
    const id = parts.length;
    parts.push({...r, reserved: true});
    parent.push(id);
    for (const c of r.cells) owner[c] = id;
    for (const c of r.studTop) studTop[c] = 1;
    for (const c of r.receivers) receiver[c] = 1;
  }
  // Reserved parts join whatever regular part or reserved part they rest on, later.
  const rnd = mulberry32(seed);
  const brickTypes = types.filter(t => t.kind === 'brick'), plateTypes = types.filter(t => t.kind === 'plate'), tileTypes = types.filter(t => t.kind === 'tile');
  const filled = c => colour[c] >= 0;
  const compatible = (c, C) => colour[c] === C || !visible[c];

  function connectBelow(cells, j, par, partId) {
    // cells: footprint cell indices at layer j; returns roots below.
    const roots = new Set(), below = new Set();
    let support = 0;
    if (j === 0) return {roots, below, support};
    for (const c of cells) {
      const d = c - layerSize, q = owner[d];
      if (q >= 0 && studTop[d]) { below.add(q); roots.add(find(q, par)); support++; }
    }
    return {roots, below, support};
  }

  // A brick is used only where its four sides look the same over its full height:
  // where the outline changes within a course, plates let neighbours bridge.
  function uniformSides(c) {
    const l = c % layerSize, i = l % nx, k = Math.floor(l / nx);
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nk = k + dk;
      if (ni < 0 || nk < 0 || ni >= nx || nk >= nz) continue;
      const n = c + dk * nx + di, a = filled(n), b = filled(n + layerSize), d = filled(n + 2 * layerSize);
      if (a !== b || b !== d) return false;
      if (a && (colour[n] !== colour[n + layerSize] || colour[n] !== colour[n + 2 * layerSize]) && visible[n]) return false;
    }
    return true;
  }
  let baseLayer = 0;
  for (let c = 0; c < total; c++) if (filled(c)) { baseLayer = Math.floor(c / layerSize); break; }
  for (let j = 0; j < ny; j++) {
    const region = [];
    for (let c = j * layerSize; c < (j + 1) * layerSize; c++) if (filled(c) && owner[c] < 0) region.push(c);
    if (region.length) tileLayer(j, region);
    // Reserved parts resting on this layer join the parts they sit on.
    for (const [rid, r] of parts.entries()) if (r.reserved && r.bottom_layer === j + 1)
      for (const c of r.receivers) { const q = owner[c - layerSize]; if (q >= 0 && studTop[c - layerSize]) union(rid, q); }
  }
  function tileLayer(j, region) {
    const brickable = new Uint8Array(layerSize);
    // Bricks start only on shared course boundaries so neighbouring stacks end at the
    // same height and a part above can bridge them; plates fill between courses.
    if (j + 2 < ny && (j - baseLayer) % 3 === 0) for (const c of region) {
      const up1 = c + layerSize, up2 = c + 2 * layerSize;
      if (!tileTop[c] && !noBrick[c] && filled(up1) && filled(up2) && owner[up1] < 0 && owner[up2] < 0 && !tileTop[up1] && !tileTop[up2] && !noBrick[up1] && !noBrick[up2]
        && uniformSides(c)) brickable[c - j * layerSize] = 1;
    }
    let best = null;
    for (let trial = 0; trial < trials; trial++) {
      const flipX = rnd() < 0.5, flipZ = rnd() < 0.5, xMajor = rnd() < 0.5;
      const taken = new Uint8Array(layerSize);
      const par = parent.slice();
      const placed = [];
      let objective = 0;
      const order = region.map(c => c - j * layerSize).sort((a, b) => {
        const [ai, ak, bi, bk] = [a % nx, Math.floor(a / nx), b % nx, Math.floor(b / nx)];
        const [pa, pb] = [flipX ? nx - 1 - ai : ai, flipX ? nx - 1 - bi : bi], [qa, qb] = [flipZ ? nz - 1 - ak : ak, flipZ ? nz - 1 - bk : bk];
        return xMajor ? (pa - pb || qa - qb) : (qa - qb || pa - pb);
      });
      const inRegion = new Uint8Array(layerSize);
      for (const c of region) inRegion[c - j * layerSize] = 1;
      for (const local of order) {
        if (taken[local]) continue;
        const ai = local % nx, ak = Math.floor(local / nx), anchor = j * layerSize + local;
        const candidates = tileTop[anchor] ? tileTypes : brickable[local] ? [...brickTypes, ...plateTypes] : plateTypes;
        let choice = null;
        for (const t of candidates) {
          const x0 = flipX ? ai - t.fx + 1 : ai, z0 = flipZ ? ak - t.fz + 1 : ak;
          if (x0 < 0 || z0 < 0 || x0 + t.fx > nx || z0 + t.fz > nz) continue;
          const cells = [];
          let ok = true, C = null;
          for (let dz = 0; dz < t.fz && ok; dz++) for (let dx = 0; dx < t.fx; dx++) {
            const l = (z0 + dz) * nx + x0 + dx, c = j * layerSize + l;
            if (!inRegion[l] || taken[l] || (t.kind === 'brick' && !brickable[l]) || (t.kind === 'tile') !== Boolean(tileTop[c])) { ok = false; break; }
            const stack = t.h === 3 ? [c, c + layerSize, c + 2 * layerSize] : [c];
            for (const s of stack) if (visible[s]) { if (C === null) C = colour[s]; else if (colour[s] !== C) { ok = false; break; } }
            cells.push(c);
          }
          if (!ok) continue;
          if (C === null) C = colour[anchor];
          if (t.h === 3 && !cells.every(c => compatible(c, C) && compatible(c + layerSize, C) && compatible(c + 2 * layerSize, C))) continue;
          if (!cells.every(c => compatible(c, C))) continue;
          const {roots, below, support} = connectBelow(cells, j, par);
          let seams = 0;
          if (j > 0) for (const c of cells) {
            const l = c - j * layerSize, i = l % nx, k = Math.floor(l / nx);
            for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const ni = i + di, nk = k + dk;
              if (ni < 0 || nk < 0 || ni >= nx || nk >= nz) continue;
              const nl = nk * nx + ni;
              if (ni >= x0 && ni < x0 + t.fx && nk >= z0 && nk < z0 + t.fz) continue;
              if (!inRegion[nl] && owner[j * layerSize + nl] < 0) continue;
              const a = owner[c - layerSize], b = owner[j * layerSize + nl - layerSize];
              if (a >= 0 && b >= 0 && a !== b) seams++;
            }
          }
          const score = cells.length * t.h * W.volume + Math.max(0, roots.size - 1) * W.merge + below.size * W.bind
            - (j > 0 && !support ? W.float : 0) - seams * W.seam - W.part + rnd() * W.jitter;
          if (!choice || score > choice.score) choice = {t, x0, z0, cells, C, score, roots};
        }
        if (!choice) throw new Error('No element covers cell ' + anchor + ' (missing 1x1 types?)');
        for (const c of choice.cells) taken[c - j * layerSize] = 1;
        placed.push(choice);
        objective += choice.score;
        // Simulate merges for later candidates in this trial.
        const rootList = [...choice.roots];
        for (let r = 1; r < rootList.length; r++) union(rootList[0], rootList[r], par);
      }
      if (!best || objective > best.objective) best = {objective, placed};
    }
    // Commit the best layer.
    for (const choice of best.placed) {
      const id = parts.length, {t, x0, z0, cells, C} = choice;
      parts.push({part_id: t.part_id, kind: t.kind, rotated: t.rotated, fx: t.fx, fz: t.fz, h: t.h, x0, z0, y0: j, colour: C, cells: []});
      parent.push(id);
      for (const c of cells) {
        for (let dy = 0; dy < t.h; dy++) { owner[c + dy * layerSize] = id; parts[id].cells.push(c + dy * layerSize); }
        receiver[c] = 1;
        if (t.kind !== 'tile') studTop[c + (t.h - 1) * layerSize] = 1;
      }
      if (j > 0) for (const c of cells) { const q = owner[c - layerSize]; if (q >= 0 && studTop[c - layerSize]) union(id, q); }
    }
  }
  // Regular parts resting on reserved parts were joined through connectBelow/union above.
  // Reserved parts with parts on top of them: joined when those parts were placed.
  const components = new Map();
  parts.forEach((p, id) => { const r = find(id); components.set(r, (components.get(r) || 0) + 1); });
  return {parts, owner, components: [...components.entries()].map(([root, count]) => ({root, count})).sort((a, b) => b.count - a.count),
    rootOf: id => find(id)};
}
