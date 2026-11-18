// Studs-out panels (SNOT): a bulge facing sideways (a haunch, a cheek, a flank) is
// rebuilt as its own small model whose "up" points out of the surface. Its plates
// then stack outward, so the bulge is drawn in 3.2 mm contours instead of 8 mm
// steps, and wedge and round-corner plates can smooth its outline in the face.
//
// The panel hangs on bricks with studs on one side set into the body behind it,
// at the rows where their side studs meet the panel's stud grid (every 5 plates).
import {connectionEdges} from './connection-graph.js?v=db3639e20a8c';

const STUD = 8, PLATE = 3.2, LDU = 0.4;
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1], ROTATE_Y_90 = [0, 0, 1, 0, 1, 0, -1, 0, 0];
const SHAPES = new Set(['sphere', 'dome']); // organic bulges; towers and posts stay studs-up
const DIRECTIONS = [{a: 0, s: 1}, {a: 0, s: -1}, {a: 2, s: 1}, {a: 2, s: -1}];
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const mul = (a, b) => [0, 1, 2].flatMap(r => [0, 1, 2].map(c => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
const apply = (m, v) => [0, 1, 2].map(r => m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2]);

/**
 * Plan panels. tools: {types, tileGrid, fitSurfaces, patterns, smooth}.
 * Returns reserved entries for the main tiler (panel cells plus anchor bricks).
 */
export function planPanels(grid, profileMap, tools, options = {}) {
  const {nx, ny, nz, owner, colour, origin, index, shapes, components} = grid, layer = nx * nz, total = nx * ny * nz;
  const claimed = options.claimed || new Uint8Array(total);
  const reserved = [], warnings = [], summary = {panels: 0, parts: 0, anchors: 0};
  const anchorProfile = profileMap.get('87087');
  if (!anchorProfile || !tools?.tileGrid) return {reserved, warnings, summary};
  const sideStud = anchorProfile.features.find(f => f.kind === 'stud' && Math.abs(f.axis[1]) < 0.01);
  // taken: cells a panel owns (region and anchors) or reaches into (clearance).
  const taken = new Uint8Array(total), debug = options.debug, no = r => { if (debug) debug[r] = (debug[r] || 0) + 1; };
  const dims = [nx, ny, nz];
  const cellOf = p => { const i = Math.floor((p[0] - origin[0]) / STUD), j = Math.floor((p[1] - origin[1]) / PLATE), k = Math.floor((p[2] - origin[2]) / STUD); return i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : index(i, j, k); };
  const ijk = c => [c % nx, Math.floor(c / layer), Math.floor(c / nx) % nz];

  components.forEach((component, ci) => {
    if (component.mode !== 'solid' || !SHAPES.has(component.shape)) return;
    const shape = shapes.get(component.id);
    if (!shape) return;
    const size = [0, 1, 2].map(a => (shape.max[a] - shape.min[a]) / (a === 1 ? PLATE : STUD));
    for (const {a, s} of DIRECTIONS) {
      const b = 2 - a;
      if (size[a] < 4 || size[b] < 5 || size[1] < 12) { no('small'); continue; }
      // The component's outermost cells along the normal, then the plane behind them.
      let outer = s > 0 ? -1 : dims[a];
      for (let c = 0; c < total; c++) if (owner[c] === ci) { const v = ijk(c)[a === 0 ? 0 : 2]; outer = s > 0 ? Math.max(outer, v) : Math.min(outer, v); }
      if (outer < 0 || outer >= dims[a]) continue;
      const depth = Math.max(2, Math.min(4, Math.round(size[a] * 0.3)));
      const first = outer - s * (depth - 1); // first panel index along the normal
      const beyond = v => s > 0 ? v >= first : v <= first;
      const along = c => ijk(c)[a === 0 ? 0 : 2], across = c => ijk(c)[a === 0 ? 2 : 0];
      // Region: material beyond the plane joined to this component's cells there.
      const seeds = [];
      for (let c = 0; c < total; c++) if (owner[c] === ci && beyond(along(c))) seeds.push(c);
      if (seeds.length < 20) { no('few_seeds'); continue; }
      const region = new Set(seeds), queue = [...seeds];
      let bad = seeds.some(c => claimed[c] || taken[c]);
      while (queue.length && !bad) {
        const c = queue.pop(), [i, j, k] = ijk(c);
        for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const x = i + di, y = j + dj, z = k + dk;
          if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
          const n = index(x, y, z);
          if (owner[n] < 0 || region.has(n) || !beyond(a === 0 ? x : z)) continue;
          if (claimed[n] || taken[n]) { bad = true; break; }
          region.add(n); queue.push(n);
        }
      }
      if (bad || region.size > 20000) { no(bad ? 'claimed' : 'large'); continue; }
      // Mostly this component's colour (overlapping body parts are one surface).
      let own = 0;
      for (const c of region) if (colour[c] === component.colour) own++;
      if (own < region.size * 0.97) { no("mixed"); continue; }
      let j0 = ny, j1 = -1, b0 = dims[b], b1 = -1;
      for (const c of region) { const [, j] = ijk(c), w = across(c); j0 = Math.min(j0, j); j1 = Math.max(j1, j); b0 = Math.min(b0, w); b1 = Math.max(b1, w); }
      const core = first - s;
      if (core < 0 || core >= dims[a]) continue;
      const at = (n, j, w) => a === 0 ? index(n, j, w) : index(w, j, n);
      // Anchor rows: a side stud sits 5.6 mm above its brick's bottom; panel rows are 8 mm.
      let bestPhase = null;
      for (let phase = 0; phase < 5; phase++) {
        const anchors = [];
        for (let L = j0 - 2 + ((phase - (j0 - 2)) % 5 + 5) % 5; L + 2 <= j1 + 1 && L + 2 < ny; L += 5) {
          if (L < 0) continue;
          const studY = origin[1] + L * PLATE + 5.6, row = Math.floor((studY - origin[1]) / PLATE);
          for (let w = b0; w <= b1; w++) {
            const cells = [0, 1, 2].map(d => at(core, L + d, w));
            if (cells.some(c => owner[c] < 0 || claimed[c] || taken[c] || region.has(c))) continue;
            // It must sit on, or carry, body material the main tiling will join to it.
            const below = L > 0 ? at(core, L - 1, w) : -1, above = L + 3 < ny ? at(core, L + 3, w) : -1;
            if (![below, above].some(c => c >= 0 && owner[c] >= 0 && !claimed[c] && !taken[c] && !region.has(c))) continue;
            if (!region.has(at(first, row, w))) continue;
            anchors.push({L, w, cells, studY});
          }
        }
        if (!bestPhase || anchors.length > bestPhase.anchors.length) bestPhase = {phase, anchors};
      }
      if (!bestPhase || bestPhase.anchors.length < 2) { no('anchors'); continue; }
      const panel = buildPanel({a, s, b, ci, region, first, j0, j1, b0, b1, anchors: bestPhase.anchors});
      if (!panel) { no('build'); continue; }
      for (const e of panel.entries) { for (const c of e.cells) taken[c] = 1; for (const c of e.clearance) taken[c] = 1; reserved.push(e); }
      summary.panels++; summary.parts += panel.parts; summary.anchors += panel.anchors;
    }
  });
  if (debug) Object.assign(debug, {entries: reserved, grid});
  return {reserved, warnings, summary};

  function buildPanel({a, s, b, ci, region, first, j0, j1, b0, b1, anchors}) {
    const d = [0, 0, 0]; d[a] = s;
    const ly = d, lz = [0, 1, 0], lx = cross(ly, lz);
    const planeW = origin[a] + (s > 0 ? first : first + 1) * STUD;
    // Rows: 8 mm, aligned so the anchors' side studs sit at row centres.
    const studY = anchors[0].studY, yLow = origin[1] + j0 * PLATE, yHigh = origin[1] + (j1 + 1) * PLATE;
    const rowBase = studY - STUD / 2 - STUD * Math.ceil((studY - STUD / 2 - yLow) / STUD);
    const rows = Math.ceil((yHigh - rowBase) / STUD);
    const cols = b1 - b0 + 1, depthCells = Math.abs((s > 0 ? Math.max(...[...region].map(c => ijk(c)[a === 0 ? 0 : 2])) : Math.min(...[...region].map(c => ijk(c)[a === 0 ? 0 : 2]))) - first) + 1;
    const layers = Math.ceil(depthCells * STUD / PLATE);
    const O = [0, 0, 0];
    O[a] = planeW; O[1] = rowBase; O[b] = lx[b] > 0 ? origin[b] + b0 * STUD : origin[b] + (b1 + 1) * STUD;
    const toWorld = q => [0, 1, 2].map(i => O[i] + lx[i] * q[0] + ly[i] * q[1] + lz[i] * q[2]);
    // Local grid: x along the face, y outward (plate layers), z up the face.
    const pnx = cols, pny = layers, pnz = rows, ptotal = pnx * pny * pnz, play = pnx * pnz;
    const pindex = (i, j, k) => (j * pnz + k) * pnx + i;
    const pOwner = new Int32Array(ptotal).fill(-1), pColour = new Int32Array(ptotal).fill(-1), ideal = new Float32Array(ptotal), blockedCell = new Uint8Array(ptotal);
    const S = [1 / 6, 3 / 6, 5 / 6];
    // Components that can reach the panel, in order (solids and the voids after them).
    const lo = toWorld([0, 0, 0]).map((v, i) => Math.min(v, toWorld([pnx * STUD, pny * PLATE, pnz * STUD])[i])), hi = toWorld([0, 0, 0]).map((v, i) => Math.max(v, toWorld([pnx * STUD, pny * PLATE, pnz * STUD])[i]));
    const near = components.map((comp, idx) => ({comp, idx, sh: shapes.get(comp.id)})).filter(({comp, sh}) => sh && comp.mode !== 'paint' && [0, 1, 2].every(i => sh.min[i] <= hi[i] && sh.max[i] >= lo[i]));
    const solidAt = p => {
      const c = cellOf(p);
      if (c < 0 || !region.has(c)) return -1;
      let o = -1;
      for (const {comp, idx, sh} of near) {
        if (p[0] < sh.min[0] || p[0] > sh.max[0] || p[1] < sh.min[1] || p[1] > sh.max[1] || p[2] < sh.min[2] || p[2] > sh.max[2] || !sh.inside(p)) continue;
        if (comp.mode === 'solid') o = idx; else if (comp.mode === 'void' && o >= 0) o = -1;
      }
      return o;
    };
    const P = [0.02, 0.5, 0.98], point = (x, y, z) => [O[0] + lx[0] * x + ly[0] * y + lz[0] * z, O[1] + lx[1] * x + ly[1] * y + lz[1] * z, O[2] + lx[2] * x + ly[2] * y + lz[2] * z];
    for (let j = 0; j < pny; j++) for (let k = 0; k < pnz; k++) for (let i = 0; i < pnx; i++) {
      const c = pindex(i, j, k);
      // Probe the cell's corners, edges and centre: it may not reach into material that
      // is not the panel's (another piece beyond the plane, or the body above or below
      // the region), and a cell with no probe in the region stays empty.
      let foreign = false, touches = false;
      for (const u of P) for (const v of P) for (const w of P) {
        const m = cellOf(point((i + u) * STUD, (j + v) * PLATE, (k + w) * STUD));
        if (m < 0) continue;
        if (region.has(m)) touches = true; else if (owner[m] >= 0 || taken[m]) foreign = true;
      }
      if (foreign) { blockedCell[c] = 1; continue; }
      if (!touches) continue;
      let inside = 0, last = -1;
      for (const u of S) for (const v of S) for (const w of S) {
        const o = solidAt(point((i + u) * STUD, (j + v) * PLATE, (k + w) * STUD));
        if (o >= 0) { inside++; last = o; }
      }
      ideal[c] = inside / 27;
      if (inside >= 14) {
        pOwner[c] = last;
        const m = cellOf(point((i + 0.5) * STUD, (j + 0.5) * PLATE, (k + 0.5) * STUD));
        pColour[c] = m >= 0 && colour[m] >= 0 ? colour[m] : components[last].colour;
      }
    }
    // Every anchor needs panel material on its stud.
    const anchorCells = anchors.map(an => {
      const w = lx[b] > 0 ? an.w - b0 : b1 - an.w, k = Math.floor((an.studY - rowBase) / STUD);
      return k >= 0 && k < pnz ? pindex(w, 0, k) : -1;
    });
    if (anchorCells.some(c => c < 0 || pOwner[c] < 0)) { no('anchor_material'); return null; }
    // Visibility and smooth tops inside the panel.
    const visible = new Uint8Array(ptotal), tileTop = new Uint8Array(ptotal);
    for (let j = 0; j < pny; j++) for (let k = 0; k < pnz; k++) for (let i = 0; i < pnx; i++) {
      const c = pindex(i, j, k);
      if (pOwner[c] < 0) continue;
      const open = (x, y, z) => y >= 0 && (x < 0 || z < 0 || x >= pnx || z >= pnz || y >= pny || pOwner[pindex(x, y, z)] < 0);
      visible[c] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) => open(i + dx, j + dy, k + dz)) ? 1 : 0;
      if (tools.smooth && open(i, j + 1, k)) tileTop[c] = 1;
    }
    const pgrid = {nx: pnx, ny: pny, nz: pnz, index: pindex, owner: pOwner, colour: pColour, idealFraction: ideal, origin: [0, 0, 0], components};
    // Smooth the panel's outline and contours with wedge, round-corner and slope parts.
    const fit = tools.patterns?.length ? tools.fitSurfaces(pgrid, tools.patterns, c => blockedCell[c] === 1, {minGain: 0.3}) : {reserved: []};
    // Panel parts in world LDraw coordinates.
    const Rl = [lx[0], ly[0], lz[0], lx[1], ly[1], lz[1], lx[2], ly[2], lz[2]];
    const SRS = mul(mul([1, 0, 0, 0, -1, 0, 0, 0, -1], Rl), [1, 0, 0, 0, -1, 0, 0, 0, -1]), shift = [O[0] / LDU, -O[1] / LDU, -O[2] / LDU];
    const world = pl => ({...pl, matrix: mul(SRS, pl.matrix), translation_ldu: apply(SRS, pl.translation_ldu).map((v, i) => v + shift[i])});
    const placementsOf = tiled => { const placements = [];
    for (const p of tiled.parts) {
      if (p.reserved) { for (const pl of p.placements) placements.push(world(pl)); continue; }
      const cx = STUD * (p.x0 + p.fx / 2), top = PLATE * (p.y0 + p.h), cz = STUD * (p.z0 + p.fz / 2);
      placements.push(world({part_id: p.part_id, colour_code: p.colour, matrix: [...(p.rotated ? ROTATE_Y_90 : IDENTITY)], translation_ldu: [cx / LDU, -top / LDU, -cz / LDU]}));
    }
    return placements; };
    // Anchor bricks: their side stud turned to face out of the body.
    const studAxis = sideStud.axis, target = [d[0], -d[1], -d[2]];
    const turn = [IDENTITY, ROTATE_Y_90, mul(ROTATE_Y_90, ROTATE_Y_90), mul(ROTATE_Y_90, mul(ROTATE_Y_90, ROTATE_Y_90))].find(m => apply(m, studAxis).every((v, i) => Math.abs(v - target[i]) < 1e-6));
    const anchorParts = anchors.map(an => {
      const cell = an.cells[0], [i, , k] = ijk(cell), top = origin[1] + (an.L + 3) * PLATE;
      const cx = origin[0] + (i + 0.5) * STUD, cz = origin[2] + (k + 0.5) * STUD;
      return {part_id: '87087', colour_code: colour[cell], matrix: [...turn], translation_ldu: [cx / LDU, -top / LDU, -cz / LDU]};
    });
    // The panel must hang together on its anchors: try a few tilings, keep the one
    // with the fewest loose parts and drop those if they are a small share.
    const looseOf = placements => {
      const parts = [...anchorParts, ...placements].map((p, n) => ({...p, instance_id: 'p' + n}));
      const edges = connectionEdges(parts, profileMap), parent = parts.map((_, n) => n);
      const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
      for (const e of edges) { const x = find(+e.instance_a.slice(1)), y = find(+e.instance_b.slice(1)); if (x !== y) parent[Math.max(x, y)] = Math.min(x, y); }
      const roots = new Set(anchorParts.map((_, n) => find(n)));
      return new Set(parts.map((_, n) => n).filter(n => !roots.has(find(n))).map(n => n - anchorParts.length));
    };
    let best = null;
    for (const seed of [1, 2, 3]) {
      const tiled = tools.tileGrid({nx: pnx, ny: pny, nz: pnz, index: pindex, colour: pColour, visible, tileTop, noBrick: new Uint8Array(ptotal)}, tools.types, fit.reserved, {seed, trials: 4});
      const placements = placementsOf(tiled), loose = looseOf(placements);
      if (!best || loose.size < best.loose.size) best = {placements, loose};
      if (!loose.size) break;
    }
    if (best.loose.size > Math.max(2, best.placements.length * 0.04)) { no('loose'); return null; }
    if (best.loose.size) warnings.push(`A studs-out panel on ${components[ci].id} left out ${best.loose.size} part(s) it could not hold.`);
    const placements = best.placements.filter((_, n) => !best.loose.has(n));
    // Keep as few anchors as hold every part: drop anchors one by one (spread out,
    // every other row first) while each panel part still reaches a remaining anchor.
    {
      const parts = [...anchorParts, ...placements].map((p, n) => ({...p, instance_id: 'p' + n}));
      const A = anchorParts.length, adjacency = parts.map(() => []);
      for (const e of connectionEdges(parts, profileMap)) { const x = +e.instance_a.slice(1), y = +e.instance_b.slice(1); adjacency[x].push(y); adjacency[y].push(x); }
      const keep = new Uint8Array(A).fill(1);
      const holds = () => {
        const seen = new Uint8Array(parts.length), queue = [];
        for (let n = 0; n < A; n++) if (keep[n]) { seen[n] = 1; queue.push(n); }
        while (queue.length) { const x = queue.pop(); for (const y of adjacency[x]) if (!seen[y] && (y >= A || keep[y])) { seen[y] = 1; queue.push(y); } }
        for (let n = A; n < parts.length; n++) if (!seen[n]) return false;
        return true;
      };
      // Anchors that hold nothing go first; then thin the rest, keeping at least two.
      for (let n = 0; n < A; n++) if (!adjacency[n].some(y => y >= A)) keep[n] = 0;
      const order = [...Array(A).keys()].filter(n => keep[n]).sort((x, y) => ((anchors[x].w + anchors[x].L) % 2) - ((anchors[y].w + anchors[y].L) % 2) || x - y);
      for (const n of order) {
        if (keep.reduce((t, v) => t + v, 0) <= 2) break;
        keep[n] = 0;
        if (!holds()) keep[n] = 1;
      }
      for (let n = A - 1; n >= 0; n--) if (!keep[n]) { anchors.splice(n, 1); anchorParts.splice(n, 1); }
      if (!anchors.length) { no('no_anchor_holds'); return null; }
    }
    // Main-grid cells the panel's parts reach into beyond its region (its rows are
    // 8 mm tall): later detail and repairs must leave them empty.
    const clearance = new Set();
    for (let c = 0; c < ptotal; c++) if (pOwner[c] >= 0) {
      const j = Math.floor(c / play), k = Math.floor(c / pnx) % pnz, i = c % pnx;
      for (const u of [0.02, 0.5, 0.98]) for (const v of [0.02, 0.5, 0.98]) for (const w of [0.02, 0.5, 0.98]) {
        const m = cellOf(toWorld([(i + u) * STUD, (j + v) * PLATE, (k + w) * STUD]));
        if (m >= 0 && !region.has(m)) clearance.add(m);
      }
    }
    // The main tiler sees each entry as one rigid piece, so split the panel into the
    // groups that hang together (each on its own anchors).
    const all = [...anchorParts, ...placements].map((p, n) => ({...p, instance_id: 'p' + n}));
    const group = all.map((_, n) => n), findG = x => { while (group[x] !== x) { group[x] = group[group[x]]; x = group[x]; } return x; };
    for (const e of connectionEdges(all, profileMap)) { const x = findG(+e.instance_a.slice(1)), y = findG(+e.instance_b.slice(1)); if (x !== y) group[Math.max(x, y)] = Math.min(x, y); }
    const groups = new Map();
    all.forEach((p, n) => { const g = findG(n); if (!groups.has(g)) groups.set(g, {anchors: [], placements: []}); if (n < anchorParts.length) { groups.get(g).anchors.push(anchors[n]); groups.get(g).placements.push(anchorParts[n]); } else groups.get(g).placements.push(placements[n - anchorParts.length]); });
    const entries = [...groups.values()].filter(g => g.anchors.length).map((g, n) => ({
      cells: [...(n === 0 ? region : []), ...g.anchors.flatMap(an => an.cells)], studTop: new Set(g.anchors.map(an => an.cells[2])), receivers: new Set(g.anchors.map(an => an.cells[0])),
      bottom_layer: Math.min(...g.anchors.map(an => an.L)), colour: components[ci].colour, component_index: ci, kind: 'panel', clearance: n === 0 ? [...clearance] : [], placements: g.placements}));
    return {parts: placements.length, anchors: anchors.length, entries};
  }
}
