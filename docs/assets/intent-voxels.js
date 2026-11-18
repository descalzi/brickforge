// Rasterise a normalised object intent onto the brick grid.
//
// Cells are one stud (8 mm) wide and deep and one plate (3.2 mm) tall. The engine
// chooses the scale; primitives are sampled 27 times per cell. Thin components keep
// at least one cell across their thin axes so wings, legs and sails survive.
export const STUD_MM = 8;
export const PLATE_MM = 3.2;
const CELL = [STUD_MM, PLATE_MM, STUD_MM];
const SAMPLES = [1 / 6, 3 / 6, 5 / 6];
const AXIS_INDEX = {x: 0, y: 1, z: 2};

function rotationMatrix([rx, ry, rz] = [0, 0, 0]) {
  const r = d => d * Math.PI / 180, [cx, sx, cy, sy, cz, sz] = [Math.cos(r(rx)), Math.sin(r(rx)), Math.cos(r(ry)), Math.sin(r(ry)), Math.cos(r(rz)), Math.sin(r(rz))];
  const X = [1, 0, 0, 0, cx, -sx, 0, sx, cx], Y = [cy, 0, sy, 0, 1, 0, -sy, 0, cy], Z = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  const mul = (a, b) => Array.from({length: 9}, (_, i) => [0, 1, 2].reduce((s, k) => s + a[Math.floor(i / 3) * 3 + k] * b[k * 3 + i % 3], 0));
  return mul(Z, mul(Y, X)); // x first, then y, then z
}
const apply = (m, v) => [0, 1, 2].map(i => m[i * 3] * v[0] + m[i * 3 + 1] * v[1] + m[i * 3 + 2] * v[2]);
const transpose = m => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

/** A point-membership test in model millimetres for one scaled component. */
export function componentShape(component, scale) {
  const centre = component.center_mm.map(v => v * scale), size = component.size_mm.map(v => v * scale), h = size.map(v => v / 2);
  const rotation = component.rotate_deg ? rotationMatrix(component.rotate_deg) : null, inverse = rotation && transpose(rotation);
  const local = p => { const d = p.map((v, i) => v - centre[i]); return inverse ? apply(inverse, d) : d; };
  const inBox = q => Math.abs(q[0]) <= h[0] && Math.abs(q[1]) <= h[1] && Math.abs(q[2]) <= h[2];
  let inside;
  switch (component.shape) {
    case 'box': inside = inBox; break;
    case 'sphere': inside = q => (q[0] / h[0]) ** 2 + (q[1] / h[1]) ** 2 + (q[2] / h[2]) ** 2 <= 1; break;
    case 'dome': inside = q => q[1] >= 0 && (q[0] / h[0]) ** 2 + (q[1] / size[1]) ** 2 + (q[2] / h[2]) ** 2 <= 1; break;
    case 'cylinder': case 'cone': {
      const a = AXIS_INDEX[component.axis || 'y'], [u, v] = [0, 1, 2].filter(i => i !== a);
      const top = component.shape === 'cone' ? component.top_scale : 1, widest = Math.max(1, top);
      inside = q => {
        if (Math.abs(q[a]) > h[a]) return false;
        const t = (q[a] + h[a]) / size[a], r = (1 + (top - 1) * t) / widest;
        return r > 0 && (q[u] / (h[u] * r)) ** 2 + (q[v] / (h[v] * r)) ** 2 <= 1;
      };
      break;
    }
    case 'wedge': {
      const [sign, axisName] = [component.slope.down_toward[0] === '+' ? 1 : -1, component.slope.down_toward[1]];
      const a = AXIS_INDEX[axisName], low = component.slope.low_fraction;
      inside = q => inBox(q) && q[1] <= -h[1] + size[1] * (1 - ((sign * q[a] + h[a]) / size[a]) * (1 - low));
      break;
    }
    case 'roof': {
      const u = component.ridge_axis === 'x' ? 2 : 0, eave = component.eave_fraction;
      inside = q => inBox(q) && q[1] <= -h[1] + size[1] * (1 - (Math.abs(q[u]) / h[u]) * (1 - eave));
      break;
    }
    default: throw new Error('Unknown shape ' + component.shape);
  }
  // Axis-aligned bounds of the (possibly rotated) component.
  const corners = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const c = [sx * h[0], sy * h[1], sz * h[2]];
    if (component.shape === 'dome') c[1] = sy < 0 ? 0 : size[1];
    corners.push((rotation ? apply(rotation, c) : c).map((v, i) => v + centre[i]));
  }
  const min = [0, 1, 2].map(i => Math.min(...corners.map(c => c[i]))), max = [0, 1, 2].map(i => Math.max(...corners.map(c => c[i])));
  const volume = ({box: 1, sphere: Math.PI / 6, dome: Math.PI / 3, cylinder: Math.PI / 4, cone: Math.PI / 4, wedge: 1, roof: 1})[component.shape] *
    size[0] * size[1] * size[2] * (component.shape === 'cone' ? (1 + component.top_scale + component.top_scale ** 2) / 3 / Math.max(1, component.top_scale) ** 2 : 1) *
    (component.shape === 'wedge' ? (1 + component.slope.low_fraction) / 2 : 1) * (component.shape === 'roof' ? (1 + component.eave_fraction) / 2 : 1);
  // Dominant world axis of each local axis, for thinness and grouping.
  const worldAxis = [0, 1, 2].map(a => { const e = [0, 0, 0]; e[a] = 1; const w = rotation ? apply(rotation, e) : e; return w.map(Math.abs).indexOf(Math.max(...w.map(Math.abs))); });
  return {inside: p => inside(local(p)), insideLocal: inside, local, h, min, max, size, volume, worldAxis};
}

/** Ideal bounds of the solid material at real scale (scale 1). */
export function intentBounds(intent, include = c => c.mode === 'solid') {
  const shapes = intent.components.filter(include).map(c => componentShape(c, 1));
  return {min: [0, 1, 2].map(i => Math.min(...shapes.map(s => s.min[i]))), max: [0, 1, 2].map(i => Math.max(...shapes.map(s => s.max[i])))};
}

/** Scale (model mm per real mm) that makes the longest extent `studs` studs. */
export function scaleForTarget(intent, studs, include) {
  const b = intentBounds(intent, include), longest = Math.max(...b.max.map((v, i) => v - b.min[i]));
  return studs * STUD_MM / longest;
}

/**
 * Rasterise components into a grid. Returns per-cell owner and colour, the
 * grid frame and per-component coverage evidence.
 * options.exclude(component) removes components handled by other construction
 * (for example real wheel assemblies) from the material union.
 */
export function rasteriseIntent(intent, scale, options = {}) {
  const exclude = options.exclude || (() => false);
  const solids = intent.components.filter(c => c.mode === 'solid' && !exclude(c));
  if (!solids.length) throw new Error('No solid components remain to rasterise.');
  const shapes = new Map(intent.components.map(c => [c.id, componentShape(c, scale)]));
  const min = [0, 1, 2].map(i => Math.min(...solids.map(c => shapes.get(c.id).min[i])));
  const max = [0, 1, 2].map(i => Math.max(...solids.map(c => shapes.get(c.id).max[i])));
  // Centre the grid on the object in x/z so symmetric objects stay symmetric; the
  // lowest solid point sits on the bottom of the first plate layer.
  const n = [0, 1, 2].map(i => Math.max(1, Math.round((max[i] - min[i]) / CELL[i])));
  const origin = [0, 1, 2].map(i => i === 1 ? min[1] : (min[i] + max[i]) / 2 - n[i] * CELL[i] / 2);
  // Allow up to one extra cell around for thin parts that round outward.
  for (const i of [0, 1, 2]) { origin[i] -= CELL[i]; n[i] += 2; }
  const [nx, ny, nz] = n, total = nx * ny * nz;
  if (total > 400000) throw new Error(`The grid (${nx}×${ny}×${nz}) is too large; reduce the build size.`);
  const index = (i, j, k) => (j * nz + k) * nx + i;
  const owner = new Int16Array(total).fill(-1);
  const reports = [];
  const cellRange = shape => [0, 1, 2].map(a => [
    Math.max(0, Math.floor((shape.min[a] - origin[a]) / CELL[a])),
    Math.min(n[a] - 1, Math.floor((shape.max[a] - origin[a]) / CELL[a]))]);

  function sampleComponent(component) {
    const shape = shapes.get(component.id), r = cellRange(shape), fractions = new Map(), masks = new Map(), overlapWeight = new Map();
    // Local axes thinner than 1.5 cells of the world axis they mostly follow: such
    // components keep one cell across, found by testing against their mid-plane.
    const thinLocal = [0, 1, 2].filter(a => shape.size[a] < 1.5 * CELL[shape.worldAxis[a]]);
    const thin = [...new Set(thinLocal.map(a => shape.worldAxis[a]))];
    const extentCells = shape.max.map((v, a) => (v - shape.min[a]) / CELL[a]);
    for (let j = r[1][0]; j <= r[1][1]; j++) for (let k = r[2][0]; k <= r[2][1]; k++) for (let i = r[0][0]; i <= r[0][1]; i++) {
      let hits = 0, bits = 0, bit = 0, coverage = 0, closeness = 0;
      for (const a of SAMPLES) for (const b of SAMPLES) for (const c of SAMPLES) {
        const p = [origin[0] + (i + a) * CELL[0], origin[1] + (j + b) * CELL[1], origin[2] + (k + c) * CELL[2]];
        if (shape.inside(p)) { hits++; bits |= 1 << bit; }
        if (thinLocal.length) {
          const q = shape.local(p);
          let near = true, score = 1;
          for (const a2 of thinLocal) {
            const reach = shape.h[a2] + CELL[shape.worldAxis[a2]] / 2;
            if (Math.abs(q[a2]) > reach) { near = false; break; }
            score *= 1 - Math.abs(q[a2]) / reach;
            q[a2] = 0;
          }
          if (near && shape.insideLocal(q)) { coverage++; closeness += score; }
        }
        bit++;
      }
      const f = thinLocal.length ? coverage / 27 : hits / 27;
      if (f) fractions.set(index(i, j, k), f);
      // Prefer the cell holding most of a thin component, not just any overlap.
      if (f && thinLocal.length) overlapWeight.set(index(i, j, k), closeness / 27 + hits / 270);
      if (hits) masks.set(index(i, j, k), bits);
    }
    const chosen = new Set(thin.length ? [] : [...fractions].filter(([, f]) => f >= 0.5).map(([c]) => c));
    let thickened = false;
    if (thin.length) {
      const groups = new Map();
      for (const [cell, f] of fractions) {
        const i = cell % nx, k = Math.floor(cell / nx) % nz, j = Math.floor(cell / (nx * nz)), coords = [i, j, k];
        const key = [0, 1, 2].filter(a => !thin.includes(a)).map(a => coords[a]).join(',');
        const group = groups.get(key) || {sum: 0, best: cell, bestF: -1};
        group.sum += f;
        const w = overlapWeight.get(cell) ?? f;
        if (w > group.bestF + 1e-9) { group.best = cell; group.bestF = w; }
        groups.set(key, group);
      }
      const keep = component.importance === 'detail' ? 0.35 : 0.25;
      // Keep the chosen cells of a thin component face-connected: where neighbouring
      // groups step by one cell across the thin axis, add the cell that joins them.
      const coordsOf = cell => [cell % nx, Math.floor(cell / (nx * nz)), Math.floor(cell / nx) % nz];
      const free = [0, 1, 2].filter(a => !thin.includes(a));
      const bestByKey = new Map();
      for (const [key, group] of groups) if (group.sum >= keep) bestByKey.set(key, group.best);
      for (const [key, cell] of bestByKey) {
        const c = coordsOf(cell), parts = key.split(',').map(Number);
        for (const [f, axis] of free.entries()) for (const d of [1, -1]) {
          const nk = parts.slice(); nk[f] += d;
          const other = bestByKey.get(nk.join(','));
          if (other === undefined) continue;
          const o = coordsOf(other);
          const gap = thin.reduce((g, a) => g + Math.abs(o[a] - c[a]), 0);
          if (gap === 0) continue;
          // The neighbour's position with this cell's thin coordinates.
          const bridge = o.slice(); for (const a of thin) bridge[a] = c[a];
          const b = index(bridge[0], bridge[1], bridge[2]);
          if (fractions.has(b) || gap <= 2) { chosen.add(b); thickened = true; }
        }
      }
      // Sheets thin only in y become two plates thick so their parts can interlock.
      const sheet = thin.length === 1 && thin[0] === 1;
      for (const group of groups.values()) if (group.sum >= keep) {
        if (!chosen.has(group.best)) { chosen.add(group.best); thickened = true; }
        if (sheet) {
          const inSheet = [...chosen].filter(c => c % (nx * nz) === group.best % (nx * nz));
          if (inSheet.length < 2) {
            const up = group.best + nx * nz, down = group.best - nx * nz;
            const pick = (fractions.get(up) || 0) >= (fractions.get(down) || 0) && up < total ? up : down >= 0 ? down : up;
            chosen.add(pick); thickened = true;
          }
        }
      }
    }
    return {fractions, masks, chosen, thickened, shape, extentCells};
  }

  const cellColour = new Int16Array(total).fill(-1);
  const order = intent.components;
  const sampled = new Map();
  for (const component of order) {
    if (component.mode === 'solid' && exclude(component)) continue;
    sampled.set(component.id, sampleComponent(component));
  }
  // Solids in order: later solids own shared cells.
  order.forEach((component, ci) => {
    if (component.mode !== 'solid' || exclude(component)) return;
    for (const cell of sampled.get(component.id).chosen) { owner[cell] = ci; cellColour[cell] = component.colour; }
  });
  // Voids remove material, but never pierce a wall they do not reach through: a
  // cell next to air or another component stays unless the void also covers it.
  const solidBeforeVoids = owner.slice();
  const voidFraction = new Float32Array(total);
  for (const component of order) if (component.mode === 'void') for (const [cell, f] of sampled.get(component.id).fractions) voidFraction[cell] = Math.max(voidFraction[cell], f);
  for (const component of order) if (component.mode === 'void') for (const cell of sampled.get(component.id).chosen) {
    if (solidBeforeVoids[cell] < 0) continue;
    const i = cell % nx, k = Math.floor(cell / nx) % nz, j = Math.floor(cell / (nx * nz));
    const sides = [[i - 1, j, k], [i + 1, j, k], [i, j, k - 1], [i, j, k + 1], [i, j - 1, k]];
    const pierces = sides.some(([a, b, d]) => {
      if (a < 0 || d < 0 || b < 0 || a >= nx || d >= nz) return true;
      const n = index(a, b, d);
      return (solidBeforeVoids[n] < 0 || solidBeforeVoids[n] !== solidBeforeVoids[cell]) && voidFraction[n] === 0;
    });
    if (pierces) continue;
    owner[cell] = -1; cellColour[cell] = -1;
  }
  // Ideal material as 27 samples per cell: union of solids minus voids (excluded parts omitted).
  const solidMask = new Uint32Array(total), voidMask = new Uint32Array(total);
  for (const component of order) {
    const s = sampled.get(component.id);
    if (!s || component.mode === 'paint') continue;
    const target = component.mode === 'solid' ? solidMask : voidMask;
    for (const [cell, bits] of s.masks) target[cell] |= bits;
  }
  const idealFraction = new Float32Array(total);
  for (let c = 0; c < total; c++) if (solidMask[c]) { let b = solidMask[c] & ~voidMask[c], n = 0; while (b) { b &= b - 1; n++; } idealFraction[c] = n / 27; }
  const filled = cell => owner[cell] >= 0;
  const neighbours = cell => {
    const i = cell % nx, k = Math.floor(cell / nx) % nz, j = Math.floor(cell / (nx * nz)), out = [];
    if (i > 0) out.push(cell - 1); if (i < nx - 1) out.push(cell + 1);
    if (k > 0) out.push(cell - nx); if (k < nz - 1) out.push(cell + nx);
    if (j > 0) out.push(cell - nx * nz); if (j < ny - 1) out.push(cell + nx * nz);
    return out.length === 6 ? out : [...out, -1];
  };
  const surface = cell => filled(cell) && neighbours(cell).some(c => c < 0 || !filled(c));
  const painted = new Int16Array(total).fill(-1);
  order.forEach((component, ci) => {
    if (component.mode !== 'paint') return;
    // Paint the surface cells it overlaps; paint that falls just outside the voxel
    // surface (grid rounding) is carried onto the adjacent surface cell.
    for (const [cell] of sampled.get(component.id).fractions) {
      const targets = filled(cell) ? [cell] : neighbours(cell).filter(n => n >= 0 && filled(n));
      for (const t of targets) if (surface(t)) { cellColour[t] = component.colour; painted[t] = ci; }
    }
  });
  for (const [ci, component] of order.entries()) {
    const s = sampled.get(component.id);
    if (!s) continue;
    const expected = s.shape.volume / (CELL[0] * CELL[1] * CELL[2]);
    let realised = 0;
    if (component.mode === 'solid') for (let c = 0; c < total; c++) { if (owner[c] === ci) realised++; }
    else if (component.mode === 'paint') for (let c = 0; c < total; c++) { if (painted[c] === ci) realised++; }
    else realised = [...s.chosen].length;
    reports.push({component_id: component.id, role: component.role, mode: component.mode, importance: component.importance,
      expected_cells: Math.round(expected * 10) / 10, realised_cells: realised, thickened: s.thickened,
      model_extent_mm: s.shape.size.map(v => Math.round(v * 10) / 10)});
  }
  return {nx, ny, nz, origin, scale, owner, colour: cellColour, index, reports, shapes, sampled, components: order, idealFraction};
}

/** Flood exterior air from outside the grid; cells next to it are visible. */
export function exteriorAir(grid) {
  const {nx, ny, nz, owner} = grid, total = nx * ny * nz, air = new Uint8Array(total), queue = [];
  const push = c => { if (owner[c] < 0 && !air[c]) { air[c] = 1; queue.push(c); } };
  for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++)
    if (i === 0 || j === ny - 1 || k === 0 || i === nx - 1 || k === nz - 1) push(grid.index(i, j, k));
  // The ground plane (below j = 0) is not air: a model resting on it hides its base.
  while (queue.length) {
    const c = queue.pop(), i = c % nx, k = Math.floor(c / nx) % nz, j = Math.floor(c / (nx * nz));
    if (i > 0) push(c - 1); if (i < nx - 1) push(c + 1); if (k > 0) push(c - nx); if (k < nz - 1) push(c + nx);
    if (j > 0) push(c - nx * nz); if (j < ny - 1) push(c + nx * nz);
  }
  return air;
}

/**
 * Remove hidden interior material, keeping a one-stud wall, a two-plate skin
 * over and under hollows and everything near openings. Returns removed count.
 */
export function hollowInterior(grid, keepMask = null) {
  const {nx, ny, nz, owner, colour, index} = grid, total = nx * ny * nz;
  const filled = (i, j, k) => j < 0 || (i >= 0 && k >= 0 && i < nx && k < nz && j < ny && owner[index(i, j, k)] >= 0);
  const remove = [];
  for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const c = index(i, j, k);
    if (owner[c] < 0) continue;
    let keep = Boolean(keepMask?.[c]);
    // Removable only if a 3x3 stud by 5 plate block around it is solid: walls and
    // floors of every component (and under where components meet) stay.
    for (let dj = -2; dj <= 2 && !keep; dj++) for (let dk = -1; dk <= 1 && !keep; dk++) for (let di = -1; di <= 1; di++) if (!filled(i + di, j + dj, k + dk)) { keep = true; break; }
    if (!keep) remove.push(c);
  }
  const restore = remove.map(c => [c, owner[c], colour[c]]);
  for (const c of remove) { owner[c] = -1; colour[c] = -1; }
  return {removed: remove.length, total, restore};
}
