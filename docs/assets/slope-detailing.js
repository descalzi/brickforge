// Real slopes for roof and wedge components.
//
// A sloped side is rebuilt in brick courses. Each course moves the slope row one
// (45°) or two (33°) studs uphill; the slope's sloped cells sit on the previous
// course's stud row. Pitches outside the slope families stay as stepped plates.
const STUD = 8, PLATE = 3.2, COURSE = 3;
const ROTATIONS = [[1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 1, 0, 1, 0, -1, 0, 0], [-1, 0, 0, 0, 1, 0, 0, 0, -1], [0, 0, -1, 0, 1, 0, 1, 0, 0]];
const rot = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
// World downhill direction as an LDraw vector (LDraw z = -world z).
const LDRAW_DIRECTION = {'+x': [1, 0, 0], '-x': [-1, 0, 0], '+z': [0, 0, -1], '-z': [0, 0, 1]};

/** Cell layout of a slope profile: depth (cells downhill), width (along ridge). */
function slopeShape(profile) {
  const receivers = profile.features.filter(f => f.kind === 'stud_receiver'), studs = profile.features.filter(f => f.kind === 'stud');
  const xs = [...new Set(receivers.map(f => f.position_ldu[0]))], zs = [...new Set(receivers.map(f => f.position_ldu[2]))];
  return {profile, width: xs.length, depth: zs.length, receivers, studs};
}

export function slopeFamilies(specialist) {
  const get = id => specialist?.profiles?.find(p => p.part_id === id);
  const family = (ids, depth, rise) => {
    const shapes = ids.map(get).filter(Boolean).map(slopeShape).filter(s => s.depth === depth && s.profile.orientation_frame);
    return shapes.length ? {depth, run_per_course: depth - 1, ratio: rise, pieces: shapes.sort((a, b) => b.width - a.width)} : null;
  };
  return {steep: family(['3037', '3039', '3040b'], 2, 1.2), medium: family(['3298'], 3, 0.6)};
}

/** Place one slope piece; returns LDraw placement and the cells it fills. */
function placePiece(shape, direction, cellCentres, studCentres, topY) {
  const target = LDRAW_DIRECTION[direction], forward = shape.profile.orientation_frame.forward;
  for (const m of ROTATIONS) {
    const f = rot(m, forward);
    if (f.some((v, i) => Math.abs(v - target[i]) > 1e-6)) continue;
    // World offsets (mm) of receivers and studs relative to the part origin.
    const off = shape.receivers.map(r => { const p = rot(m, r.position_ldu); return [p[0] * 0.4, -p[2] * 0.4]; });
    const studOff = shape.studs.map(r => { const p = rot(m, r.position_ldu); return [p[0] * 0.4, -p[2] * 0.4]; });
    const mean = list => [list.reduce((s, p) => s + p[0], 0) / list.length, list.reduce((s, p) => s + p[1], 0) / list.length];
    const [a, b] = [mean(cellCentres), mean(off)], t = [a[0] - b[0], a[1] - b[1]];
    const matches = (points, centres) => points.every(p => centres.some(c => Math.abs(p[0] + t[0] - c[0]) < 0.5 && Math.abs(p[1] + t[1] - c[1]) < 0.5));
    if (!matches(off, cellCentres) || !matches(studOff, studCentres)) continue;
    return {part_id: shape.profile.part_id, matrix: [...m], translation_ldu: [t[0] / 0.4, -topY / 0.4, -t[1] / 0.4]};
  }
  return null;
}

export function planSlopes(intent, grid, profileMap, specialist) {
  const reserved = [], warnings = [], summary = [];
  const families = slopeFamilies(specialist);
  const {nx, ny, nz, origin, index, owner, colour} = grid;
  grid.components.forEach((component, ci) => {
    if (component.mode !== 'solid' || !['roof', 'wedge'].includes(component.shape)) return;
    if (component.rotate_deg) { summary.push({component_id: component.id, construction: 'stepped', reason: 'rotated sloped components are rasterised as steps'}); return; }
    const cells = [];
    for (let c = 0; c < owner.length; c++) if (owner[c] === ci) cells.push(c);
    if (!cells.length) return;
    const coord = c => [c % nx, Math.floor(c / (nx * nz)), Math.floor(c / nx) % nz];
    const co = cells.map(coord), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of co) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
    const size = component.size_mm.map(v => v * grid.scale);
    const sides = component.shape === 'roof'
      ? (component.ridge_axis === 'x' ? ['-z', '+z'] : ['-x', '+x'])
      : [component.slope.down_toward];
    const along = sides[0][1] === 'z' ? 2 : 0, across = along === 2 ? 0 : 2;
    const run = component.shape === 'roof' ? size[along] / 2 : size[along];
    const rise = size[1] * (1 - (component.shape === 'roof' ? component.eave_fraction : component.slope.low_fraction));
    const ratio = rise / run;
    const family = ratio >= 1.0 && ratio <= 1.9 ? families.steep : ratio >= 0.45 && ratio < 1.0 ? families.medium : null;
    if (!family) { summary.push({component_id: component.id, construction: 'stepped', pitch_ratio: +ratio.toFixed(2), reason: 'pitch outside the profiled slope families'}); return; }
    const n = hi[along] - lo[along] + 1, jb = lo[1];
    const runCells = component.shape === 'roof' ? Math.floor(n / 2) : n;
    const coursesFor = family.depth === 2 ? runCells - 1 : Math.floor((runCells - 1) / 2);
    const courses = Math.min(coursesFor, Math.floor((ny - jb) / COURSE));
    if (courses < 1) { summary.push({component_id: component.id, construction: 'stepped', pitch_ratio: +ratio.toFixed(2), reason: 'too few studs along the slope for a slope element'}); return; }
    // b positions (across the slope) the component covers at its base.
    const acrossSet = [...new Set(co.filter(p => p[1] <= jb + 2).map(p => p[across]))].sort((a, b) => a - b);
    const otherOwned = c => owner[c] >= 0 && owner[c] !== ci;
    const cellAt = (u, side, b, j) => {
      const a = side[0] === '-' ? lo[along] + u : hi[along] - u;
      const ijk = [0, 0, 0]; ijk[along] = a; ijk[across] = b; ijk[1] = j;
      return ijk[0] < 0 || ijk[2] < 0 || ijk[0] >= nx || ijk[2] >= nz || j >= ny ? -1 : index(ijk[0], j, ijk[2]);
    };
    // Rebuild the component's material course by course.
    for (const c of cells) { owner[c] = -1; colour[c] = -1; }
    const realisedTop = jb + courses * COURSE;
    const step = family.run_per_course;
    const fill = (c) => { if (c >= 0 && !otherOwned(c)) { owner[c] = ci; colour[c] = component.colour; } };
    let pieces = 0;
    for (let course = 0; course < courses; course++) {
      const j0 = jb + course * COURSE, start = course * step;
      for (const b of acrossSet) for (let a = lo[along]; a <= hi[along]; a++) {
        const uFront = a - lo[along], uBack = hi[along] - a;
        const u = sides.length === 2 ? Math.min(uFront, uBack) : (sides[0][0] === '-' ? uFront : uBack);
        if (u < start) continue;
        for (let dj = 0; dj < COURSE; dj++) { const ijk = [0, 0, 0]; ijk[along] = a; ijk[across] = b; fill(index(ijk[0], j0 + dj, ijk[2])); }
      }
      // Slope pieces along each side's slope row.
      for (const side of sides) {
        let b = 0;
        while (b < acrossSet.length) {
          let placedPiece = false;
          for (const shape of family.pieces) {
            const run = acrossSet.slice(b, b + shape.width);
            if (run.length < shape.width || run.some((v, i) => v !== acrossSet[b] + i)) continue;
            const footprint = [], studCells = [], centres = [], studCentres = [];
            for (const bb of run) for (let d = 0; d < shape.depth; d++) {
              const c0 = cellAt(start + d, side, bb, j0);
              if (c0 < 0) { footprint.length = 0; break; }
              footprint.push(c0);
              const [i, , k] = coord(c0), centre = [origin[0] + STUD * (i + 0.5), origin[2] + STUD * (k + 0.5)];
              centres.push(centre);
              if (d === shape.depth - 1) { studCells.push(c0 + 2 * nx * nz); studCentres.push(centre); }
            }
            if (footprint.length !== shape.width * shape.depth) continue;
            const stack = footprint.flatMap(c => [c, c + nx * nz, c + 2 * nx * nz]);
            if (stack.some(c => c >= owner.length || otherOwned(c) || reserved.some(r => r.cellSet.has(c)))) continue;
            const placement = placePiece(shape, side, centres, studCentres, origin[1] + PLATE * (j0 + COURSE));
            if (!placement) continue;
            for (const c of stack) { owner[c] = ci; colour[c] = component.colour; }
            reserved.push({cells: stack, cellSet: new Set(stack), studTop: new Set(studCells), receivers: new Set(footprint), bottom_layer: j0,
              colour: component.colour, component_index: ci, component_id: component.id, kind: 'slope',
              placements: [{...placement, colour_code: component.colour}]});
            pieces++; b += shape.width; placedPiece = true; break;
          }
          if (!placedPiece) b++;
        }
      }
    }
    // The flat ridge or high edge above the last slope course stays as fill material.
    summary.push({component_id: component.id, construction: 'slope_elements', family: family.depth === 2 ? '45_degree' : '33_degree',
      pitch_ratio: +ratio.toFixed(2), element_ratio: family.ratio, courses, pieces,
      intended_rise_mm: +rise.toFixed(1), realised_rise_mm: +(courses * COURSE * PLATE).toFixed(1), top_layer: realisedTop});
  });
  return {reserved, warnings, summary};
}
