// Angled modules: an ear (or a fin) built as its own flat sub-assembly, smoothed
// with wedge plates, and stood up on a clip-and-bar hinge instead of being stepped
// out of the body in bricks.
//
// The head carries a plate with a bar on its side (48336). The module's base is a
// plate with two clips (60470b) that grip the bar; the module turns about the bar.
// Both parts were placed from LDCad clip and bar datums: with the clip plate turned
// 180 degrees and set two studs along, its clip axis lies on the bar axis.
const STUD = 8, PLATE = 3.2, LDU = 0.4;
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1], ROTATE_Y_90 = [0, 0, 1, 0, 1, 0, -1, 0, 0], ROTATE_Y_180 = [-1, 0, 0, 0, 1, 0, 0, 0, -1];
const ROLE = /\b(ear|ears|fin)\b/;
const mul = (a, b) => [0, 1, 2].flatMap(r => [0, 1, 2].map(c => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
const apply = (m, v) => [0, 1, 2].map(r => m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const rotX = a => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };

/**
 * tools: {types, tileGrid, fitSurfaces, patterns, smooth, partBodyBounds, connectionEdges}.
 * Returns reserved entries (the bar plate; its placements carry the whole module),
 * the main-grid cells the modules now replace, and cells to keep clear.
 */
export function planModules(intent, grid, profileMap, tools, options = {}) {
  const {nx, ny, nz, owner, colour, origin, index, shapes, components} = grid, layer = nx * nz, total = nx * ny * nz;
  const claimed = options.claimed || new Uint8Array(total), debug = options.debug, no = r => { if (debug) debug[r] = (debug[r] || 0) + 1; };
  const reserved = [], warnings = [], summary = {modules: 0, parts: 0};
  const bar = profileMap.get('48336'), clip = profileMap.get('60470b');
  if (!bar || !clip) return {reserved, warnings, summary};
  const barAxis = bar.other_connectors.find(c => c.type === 'M-R4' && Math.abs(c.axis[1]) < 0.5);
  const cellOf = p => { const i = Math.floor((p[0] - origin[0]) / STUD), j = Math.floor((p[1] - origin[1]) / PLATE), k = Math.floor((p[2] - origin[2]) / STUD); return i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : index(i, j, k); };
  const ijk = c => [c % nx, Math.floor(c / layer), Math.floor(c / nx) % nz];
  components.forEach((ear, ci) => {
    if (ear.mode !== 'solid' || !ROLE.test(ear.role) || ear.shape === 'tube') return;
    const shape = shapes.get(ear.id);
    if (!shape) return;
    // The ear's own axes (before rotation): height along y for cones and cylinders on
    // y, otherwise the longest; thickness the shortest; width the other.
    const rot = ear.rotate_deg ? rotation(ear.rotate_deg) : IDENTITY;
    const size = ear.size_mm.map(v => v * grid.scale);
    const order = [0, 1, 2].sort((a, b) => size[a] - size[b]);
    const hAxis = (ear.shape === 'cone' || ear.shape === 'cylinder') ? {x: 0, y: 1, z: 2}[ear.axis || 'y'] : order[2];
    const tAxis = order.find(a => a !== hAxis), wAxis = [0, 1, 2].find(a => a !== hAxis && a !== tAxis);
    const unit = a => apply(rot, [0, 1, 2].map(i => i === a ? 1 : 0));
    const eH = unit(hAxis), eW = unit(wAxis), eT = unit(tAxis);
    if (eH[1] < 0.6) { no('not_upright'); return; }
    const H = size[hAxis], W = size[wAxis], T = size[tAxis];
    if (H < 2 * STUD || W < 1.5 * STUD || T > Math.max(W, H) * 0.7) { no('shape'); return; }
    // Hinge axis: the ear's width axis snapped to a grid direction.
    const axisX = Math.abs(eW[0]) >= Math.abs(eW[2]);
    const centre = [0, 1, 2].map(a => (shape.min[a] + shape.max[a]) / 2);
    const base = centre.map((v, i) => v - eH[i] * H / 2);
    // Front: the side a paint component sits on (an inner ear), else -z.
    const paint = components.find(c => c.mode === 'paint' && ROLE.test(c.role) && shapes.get(c.id) && overlaps(shapes.get(c.id), shape));
    const pc = paint && shapes.get(paint.id), side0 = pc ? Math.sign(([0, 1, 2].map(a => (pc.min[a] + pc.max[a]) / 2)[axisX ? 2 : 0] - centre[axisX ? 2 : 0]) || -1) : -1;
    // Bar plate on the head, in front of the ear base (else behind it), its bar toward
    // the ear: the lowest layer where both its cells are free with body under one.
    const ei = Math.floor((base[0] - origin[0]) / STUD), ek = Math.floor((base[2] - origin[2]) / STUD);
    const earCells = [];
    for (let c = 0; c < total; c++) if (owner[c] === ci) earCells.push(c);
    const isEar = new Set(earCells), solid = c => owner[c] >= 0 && !isEar.has(c);
    const baseJ = Math.floor((base[1] - origin[1]) / PLATE);
    // Candidate seats, lowest first on the front side, then behind.
    const seats = [];
    for (const f of [side0, -side0]) {
      const fi = axisX ? ei : ei + f, fk = axisX ? ek + f : ek;
      const cc = axisX ? [[fi - 1, fk], [fi, fk]] : [[fi, fk - 1], [fi, fk]];
      if (cc.some(([i, k]) => i < 0 || k < 0 || i >= nx || k >= nz)) continue;
      for (let j = Math.max(1, baseJ - 4); j <= Math.min(ny - 1, baseJ + 8); j++) {
        const cells = cc.map(([i, k]) => index(i, j, k));
        if (cells.some(c => solid(c) || claimed[c])) continue;
        // Seat it on solid body: at least one cell over material four layers deep.
        if (!cells.some(c => j >= 4 && [1, 2, 3, 4].every(d => solid(c - d * layer)))) continue;
        seats.push({front: f, cols: cc, top: j - 1});
      }
    }
    if (!seats.length) { no('bar_blocked'); return; }
    // The first seat whose module stands clear of the body.
    for (const seat of seats) if (attempt(seat)) return;
    function attempt({front, cols, top}) {
      const barCells = cols.map(([i, k]) => index(i, top + 1, k));
      // Bar plate placement: length along the hinge axis, bar (local -z) toward the ear.
      const toEar = axisX ? [0, 0, -front] : [-front, 0, 0]; // world-up direction from bar plate to ear
      const ldrawToEar = [toEar[0], 0, -toEar[2]];
      const barTurn = [IDENTITY, ROTATE_Y_90, ROTATE_Y_180, mul(ROTATE_Y_90, ROTATE_Y_180)].find(m => {
        const side = apply(m, [0, 0, -1]), length = apply(m, [1, 0, 0]);
        return side.every((v, i) => Math.abs(v - ldrawToEar[i]) < 1e-6) && Math.abs(length[axisX ? 0 : 2]) > 0.99;
      });
      if (!barTurn) { no('turn'); return false; }
      const barCentre = [(cols[0][0] + cols[1][0] + 1) / 2, 0, (cols[0][1] + cols[1][1] + 1) / 2].map((v, a) => a === 1 ? 0 : origin[a] + v * STUD);
      const barTop = origin[1] + (top + 2) * PLATE;
      const under = barCells.map(c => c - layer).find(c => [0, 1, 2, 3].every(d => solid(c - d * layer)));
      const barPlacement = {part_id: '48336', colour_code: colour[under], matrix: barTurn, translation_ldu: [barCentre[0] / LDU, -barTop / LDU, -barCentre[2] / LDU]};
      // Module grid (local up frame): x across the ear, y its thickness in plates
      // (studs facing front), z up the ear from the hinge.
      const mcols = Math.max(2, Math.round(W / STUD)), mrows = Math.max(2, Math.round(H / STUD)), mlayers = 3;
      const mtotal = mcols * mlayers * mrows, mindex = (i, j, k) => (j * mrows + k) * mcols + i;
      const mOwner = new Int32Array(mtotal).fill(-1), mColour = new Int32Array(mtotal).fill(-1), ideal = new Float32Array(mtotal);
      // The ear outline: sample its shape across its thickness at each (x, z).
      const S = [1 / 6, 0.5, 5 / 6];
      for (let k = 0; k < mrows; k++) for (let i = 0; i < mcols; i++) {
        let hits = 0;
        for (const u of S) for (const v of S) {
          const x = ((i + u) - mcols / 2) * STUD * (W / (mcols * STUD)), z = (k + v) * STUD * (H / (mrows * STUD));
          const p = base.map((b, a) => b + eW[a] * x + eH[a] * z);
          let inside = false;
          for (const t of [-0.3, 0, 0.3]) if (shape.inside(p.map((q, a) => q + eT[a] * t * T))) inside = true;
          if (inside) hits++;
        }
        for (let j = 0; j < mlayers; j++) {
          const c = mindex(i, j, k);
          ideal[c] = hits / 9;
          if (hits >= 5) {
            mOwner[c] = ci;
            // The front layer takes the paint colour where the paint covers it.
            const p = base.map((b, a) => b + eW[a] * ((i + 0.5) - mcols / 2) * STUD + eH[a] * (k + 0.5) * STUD + eT[a] * front * (axisX ? Math.sign(eT[2]) || 1 : Math.sign(eT[0]) || 1) * T * 0.45);
            mColour[c] = j === mlayers - 1 && paint && pc.inside(p) ? paint.colour : ear.colour;
          }
        }
      }
      // The clip plate sits in the bottom layer of the base row, centred.
      const c0 = Math.floor(mcols / 2) - 1, clipCells = [mindex(c0, 0, 0), mindex(c0 + 1, 0, 0)];
      if (clipCells.some(c => mOwner[c] < 0)) { no('no_base'); return false; }
      const clipPlacementLocal = {part_id: '60470b', colour_code: ear.colour, matrix: ROTATE_Y_180, translation_ldu: [(c0 + 1) * STUD / LDU, -PLATE / LDU, -(0.5 * STUD) / LDU]};
      // Cross-laid plates bond whatever the outline: the bottom layer in rows (along x),
      // the top layer in columns (along z), so every column crosses the rows it covers.
      // Wedge and round-corner plates may smooth the top layer's outline first.
      const mgrid = {nx: mcols, ny: mlayers, nz: mrows, index: mindex, owner: mOwner, colour: mColour, idealFraction: ideal, origin: [0, 0, 0], components};
      const topLayer = c => Math.floor(c / (mcols * mrows)) === mlayers - 1;
      const fit = tools.patterns?.length ? tools.fitSurfaces(mgrid, tools.patterns.filter(p => p.h === 1 && (p.profile.family === 'wedge_plate' || p.profile.family === 'round_corner')), c => !topLayer(c), {minGain: 0.2}) : {reserved: []};
      const used = new Set(fit.reserved.flatMap(r => r.cells));
      const pieces = (kind, along) => tools.types.filter(t => t.kind === kind && (along === 'x' ? t.fz === 1 && t.fx >= 1 : t.fx === 1 && t.fz >= 1)).sort((a, b) => (along === 'x' ? b.fx - a.fx : b.fz - a.fz));
      // Lay one layer in lines; odd lines take a shorter first piece (stagger) so seams
      // in neighbouring lines do not line up. Returns pieces with their cells.
      const lay = (j, kind, along, stagger) => {
        const set = pieces(kind, along), out = [];
        const lines = along === 'x' ? mrows : mcols, length = along === 'x' ? mcols : mrows, len = t => along === 'x' ? t.fx : t.fz;
        for (let line = 0; line < lines; line++) {
          let run = [];
          const flush = () => {
            let at = 0, firstPiece = true;
            while (at < run.length) {
              const left = run.length - at, cap = line % 2 && firstPiece && stagger ? Math.min(stagger, left) : left;
              // Never leave a single cell at the end of a run: it would join only one piece.
              const t = set.find(t => len(t) <= cap && (left - len(t) !== 1 || left === 1)) || set.find(t => len(t) <= cap);
              if (!t) break;
              const n = len(t), first = run[at], [i0, k0] = along === 'x' ? [first, line] : [line, first];
              const cx = STUD * (i0 + t.fx / 2), topY = PLATE * (j + 1), cz = STUD * (k0 + t.fz / 2);
              out.push({cells: run.slice(at, at + n).map(p => along === 'x' ? p + line * mcols : line + p * mcols), placement: {part_id: t.part_id, colour_code: mColour[mindex(i0, j, k0)], matrix: [...(t.rotated ? ROTATE_Y_90 : IDENTITY)], translation_ldu: [cx / LDU, -topY / LDU, -cz / LDU]}});
              at += n; firstPiece = false;
            }
            run = [];
          };
          for (let p = 0; p <= length; p++) {
            const [i, k] = along === 'x' ? [p, line] : [line, p], c = p < length ? mindex(i, j, k) : -1;
            const free = c >= 0 && mOwner[c] >= 0 && !used.has(c) && !(j === 0 && clipCells.includes(c));
            // A run also breaks where the colour changes.
            if (free && run.length && mColour[c] !== mColour[along === 'x' ? mindex(run.at(-1), j, line) : mindex(line, j, run.at(-1))]) flush();
            if (free) run.push(p); else flush();
          }
        }
        return out;
      };
      // Layers cross: bottom and top one way, the middle the other, so the middle bridges
      // any seams (and colour changes) of the layers either side. Try staggers until the
      // whole module hangs together.
      const plan2d = c => c % (mcols * mrows);
      let placements0 = null;
      for (const [stagger, first] of [[0, 'x'], [1, 'x'], [2, 'x'], [0, 'z'], [1, 'z'], [2, 'z']]) {
        const second = first === 'x' ? 'z' : 'x';
        const layers = [];
        for (let j = 0; j < mlayers; j++) {
          const kind = j === mlayers - 1 && tools.smooth ? 'tile' : 'plate';
          const pcs = lay(j, kind, j % 2 ? second : first, stagger);
          if (j === 0) pcs.push({cells: clipCells.map(plan2d), placement: null});
          if (j === mlayers - 1) pcs.push(...fit.reserved.map(r => ({cells: r.cells.map(plan2d), placement: null})));
          layers.push(pcs);
        }
        const all = layers.flat(), parent = all.map((_, n) => n), find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
        let offset = 0;
        for (let j = 0; j + 1 < mlayers; j++) {
          const at = new Map();
          layers[j].forEach((b, n) => b.cells.forEach(c => at.set(c, offset + n)));
          const next = offset + layers[j].length;
          layers[j + 1].forEach((t, n) => t.cells.forEach(c => { if (at.has(c)) { const x = find(at.get(c)), y = find(next + n); if (x !== y) parent[Math.max(x, y)] = Math.min(x, y); } }));
          offset = next;
        }
        if (debug) (debug.variants ||= []).push(stagger + first + ':' + new Set(all.map((_, n) => find(n))).size);
        if (all.every((_, n) => find(n) === find(0))) {
          placements0 = [...all.filter(p => p.placement).map(p => p.placement), ...fit.reserved.flatMap(r => r.placements)];
          break;
        }
      }
      if (!placements0) {
        if (debug) { const rows = []; for (let k = mrows - 1; k >= 0; k--) { let r = ''; for (let i = 0; i < mcols; i++) r += mOwner[mindex(i, 0, k)] < 0 ? '.' : used.has(mindex(i, 1, k)) ? 'F' : mColour[mindex(i, 1, k)] === ear.colour ? '#' : 'p'; rows.push(r); } debug.bond = rows; debug.fitted = fit.reserved.map(r => r.placements[0].part_id + ':' + r.cells.map(plan2d)); }
        no('module_bond'); return false;
      }
      placements0.push(clipPlacementLocal);
      // Module frame in the bar plate's frame: the clip plate turned 180 degrees and two
      // studs along lies on the bar; then the module turns about the bar to stand up.
      const p0 = barAxis.position_ldu, clipAt = [0, 0, -40], tClip = clipPlacementLocal.translation_ldu;
      const tilt = -Math.PI / 2; // stand the module upright on its hinge
      const hinge = rotX(tilt), moduleOffset = sub(clipAt, tClip);
      // Local (module LDraw) → bar-plate frame: rotate about the bar line, after the offset.
      const toBar = pl => ({...pl, matrix: mul(hinge, pl.matrix), translation_ldu: add(p0, apply(hinge, sub(add(pl.translation_ldu, moduleOffset), p0)))});
      const toWorld = pl => ({...pl, matrix: mul(barPlacement.matrix, pl.matrix), translation_ldu: add(barPlacement.translation_ldu, apply(barPlacement.matrix, pl.translation_ldu))});
      const placements = placements0.map(pl => toWorld(toBar(pl)));
      // The clip plate first, so it follows the bar plate (a mounted joint).
      const clipIndex = placements.findIndex(p => p.part_id === '60470b');
      const [clipPart] = placements.splice(clipIndex, 1);
      const moduleParts = [{...clipPart, mounted_in: '48336', mount: 'clip_on_bar'}, ...placements];
      // Stud joints inside the module must hold it together.
      const check = moduleParts.map((p, n) => ({...p, instance_id: 'm' + n}));
      const parent = check.map((_, n) => n), find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
      for (const e of tools.connectionEdges(check, profileMap)) { const a = find(+e.instance_a.slice(1)), b = find(+e.instance_b.slice(1)); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); }
      if (check.some((_, n) => find(n) !== 0)) {
        if (debug) { const local = placements0.map((p, n) => ({...p, instance_id: 'l' + n})); debug.split = {parts: check.map(p => p.part_id + '@' + p.translation_ldu.map(v => v.toFixed(1)) + ' g' + find(check.indexOf(p))).slice(0, 40), localEdges: tools.connectionEdges(local, profileMap).length, n: local.length, local: local.map(p => p.part_id + '@' + p.translation_ldu.map(v => v.toFixed(1))).slice(0, 30)}; }
        no('module_split'); return false;
      }
      // The module's volume in the main grid must be free (apart from the ear itself).
      const volume = new Set();
      for (const p of [barPlacement, ...moduleParts]) {
        const b = tools.partBodyBounds(p, profileMap.get(p.part_id));
        for (let x = b.min[0] + 0.05; x < b.max[0]; x += STUD / 2) for (let y = b.min[1] + 0.05; y < b.max[1]; y += PLATE / 2) for (let z = b.min[2] + 0.05; z < b.max[2]; z += STUD / 2) {
          const m = cellOf([x, y, z]);
          if (m >= 0) volume.add(m);
        }
      }
      // Body material the module would pass through is carved away when it is a small
    // share of the module's space (the ear sat partly inside the head); claimed cells
    // (other detailing) always block.
    const blockedBy = [...volume].filter(m => owner[m] >= 0 && !isEar.has(m) && !barCells.includes(m));
    if ([...volume].some(m => claimed[m] && !barCells.includes(m)) || blockedBy.length > volume.size * 0.35) { no('volume_blocked'); return false; }
    for (const m of blockedBy) { owner[m] = -1; colour[m] = -1; }
    if (blockedBy.length) warnings.push(`${ear.id}: ${blockedBy.length} cell(s) of the body were cut away to let the hinged ${ear.role} stand.`);
      for (const c of earCells) { owner[c] = -1; colour[c] = -1; }
      // The bar plate's cells become body material, so the cells under it are covered
      // (studs, not tiles) and the tiler joins the plate to them.
      for (const c of barCells) { owner[c] = owner[under - 0] >= 0 ? owner[under] : ci; colour[c] = barPlacement.colour_code; }
      reserved.push({cells: barCells, studTop: new Set(barCells), receivers: new Set(barCells), bottom_layer: top + 1, colour: barPlacement.colour_code, component_index: ci, kind: 'module',
        clearance: [...volume].filter(m => !barCells.includes(m)), placements: [barPlacement, ...moduleParts]});
      summary.modules++; summary.parts += moduleParts.length;
      return true;
    }
  });
  return {reserved, warnings, summary};
}

function overlaps(a, b) { return [0, 1, 2].every(i => a.min[i] <= b.max[i] && b.min[i] <= a.max[i]); }
function rotation([rx, ry, rz]) {
  const r = v => v * Math.PI / 180, [cx, sx, cy, sy, cz, sz] = [Math.cos(r(rx)), Math.sin(r(rx)), Math.cos(r(ry)), Math.sin(r(ry)), Math.cos(r(rz)), Math.sin(r(rz))];
  const X = [1, 0, 0, 0, cx, -sx, 0, sx, cx], Y = [cy, 0, sy, 0, 1, 0, -sy, 0, cy], Z = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return mul(Z, mul(Y, X));
}
