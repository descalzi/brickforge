// Side details with brackets (SNOT): an eye becomes a round tile facing outward on a
// 1x1 bracket set into the surface, instead of a painted cell.
//
// The bracket's plate takes one surface cell; its upright flange stands just outside
// the surface in open air, and the tile clips onto the flange's sideways stud.
const STUD = 8, PLATE = 3.2;
const ROLE = /\b(eye|eyes|pupil|nostril|button|headlight|headlamp|lamp|light)\b/;
// Tile on the bracket's side stud, in bracket axes: tile top faces the bracket's -z,
// its underside against the flange face (z = -14), centred on the stud (y = -2).
const TILE_MATRIX = [1, 0, 0, 0, 0, -1, 0, 1, 0], TILE_OFFSET = [0, -2, -22];
const mul = (a, b) => [0, 1, 2].flatMap(r => [0, 1, 2].map(c => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));

export function planBrackets(grid, profileMap, options = {}) {
  const {nx, ny, nz, owner, colour, origin, index, shapes, components} = grid, layer = nx * nz, total = nx * ny * nz;
  const claimed = options.claimed || new Uint8Array(total), air = options.exteriorAir;
  const reserved = [], warnings = [], summary = {eyes: 0};
  const bracket = profileMap.get('36840'), tile = profileMap.get('98138');
  if (!bracket || !tile || !air) return {reserved, warnings, summary};
  const maxSize = options.maxEyeMm ?? 2.5 * STUD;
  components.forEach(component => {
    if (component.mode !== 'paint' || !ROLE.test(component.role)) return;
    const shape = shapes.get(component.id);
    if (!shape) return;
    const size = [0, 1, 2].map(a => shape.max[a] - shape.min[a]), mid = [0, 1, 2].map(a => (shape.min[a] + shape.max[a]) / 2);
    // One eye, or a pair given as one box through the head (long on one horizontal axis).
    const long = [0, 2].filter(a => size[a] > maxSize);
    if (size[1] > maxSize || long.length > 1 || (long.length && size[2 - long[0]] > maxSize)) return; // big enough to read as paint
    const points = long.length ? [shape.min[long[0]], shape.max[long[0]]].map(v => mid.map((m, a) => a === long[0] ? v : m)) : [mid];
    const before = summary.eyes;
    for (const centre of points) placeEye(component, centre);
    // The tile is the eye now: the painted patch goes back to the body colour.
    if (summary.eyes > before) {
      const lo = [0, 1, 2].map(a => Math.max(0, Math.floor((shape.min[a] - origin[a]) / (a === 1 ? PLATE : STUD)) - 1));
      const hi = [0, 1, 2].map(a => Math.min((a === 0 ? nx : a === 1 ? ny : nz) - 1, Math.floor((shape.max[a] - origin[a]) / (a === 1 ? PLATE : STUD)) + 1));
      for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) for (let i = lo[0]; i <= hi[0]; i++) {
        const c = index(i, j, k), body = components[owner[c]];
        if (owner[c] >= 0 && colour[c] === component.colour && body && body.colour !== component.colour) colour[c] = body.colour;
      }
    }
  });
  function placeEye(component, centre) {
    // The surface cell nearest the eye whose side opens to the air, with room for the flange.
    let best = null;
    const ci = Math.floor((centre[0] - origin[0]) / STUD), cj = Math.floor((centre[1] - origin[1]) / PLATE), ck = Math.floor((centre[2] - origin[2]) / STUD);
    for (let j = cj - 3; j <= cj + 3; j++) for (let k = ck - 2; k <= ck + 2; k++) for (let i = ci - 2; i <= ci + 2; i++) {
      if (i < 0 || k < 0 || j < 1 || i >= nx || k >= nz || j + 2 >= ny) continue;
      const c = index(i, j, k);
      if (owner[c] < 0 || claimed[c]) continue;
      const below = c - layer, above = c + layer;
      if (owner[below] < 0 && owner[above] < 0) continue;
      for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const oi = i + di, ok = k + dk;
        const beyond = oi < 0 || ok < 0 || oi >= nx || ok >= nz; // beyond the grid is open air
        let open = true;
        for (let l = 0; l < 3 && open && !beyond; l++) { const o = index(oi, j + l, ok); if (!air[o] || claimed[o] || owner[o] >= 0) open = false; }
        if (!open) continue;
        const p = [origin[0] + (i + 0.5 + di * 0.5) * STUD, origin[1] + (j + 0.5) * PLATE, origin[2] + (k + 0.5 + dk * 0.5) * STUD];
        const d = Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]);
        if (!best || d < best.d) best = {d, c, i, j, k, di, dk};
      }
    }
    if (!best || best.d > STUD * 1.5) { warnings.push(`${component.id}: no open surface beside it for a bracket; kept as paint.`); return; }
    if (reserved.some(r => r.cells[0] === best.c)) return;
    const {c, i, j, k, di, dk} = best;
    const body = owner[c], bodyColour = components[body]?.colour ?? colour[c];
    claimed[c] = 1; colour[c] = bodyColour;
    const inGrid = i + di >= 0 && k + dk >= 0 && i + di < nx && k + dk < nz;
    const clearance = inGrid ? [0, 1, 2].map(l => index(i + di, j + l, k + dk)) : [];
    for (const o of clearance) claimed[o] = 1;
    // Bracket axes: local -z outward, y down. LDraw z = -world z.
    const out = [di, 0, -dk], ez = out.map(v => -v), ey = [0, 1, 0];
    const ex = [ey[1] * ez[2] - ey[2] * ez[1], ey[2] * ez[0] - ey[0] * ez[2], ey[0] * ez[1] - ey[1] * ez[0]];
    const matrix = [ex[0], ey[0], ez[0], ex[1], ey[1], ez[1], ex[2], ey[2], ez[2]];
    const top = origin[1] + (j + 1) * PLATE, cx = origin[0] + (i + 0.5) * STUD, cz = origin[2] + (k + 0.5) * STUD;
    const t = [cx / 0.4, -top / 0.4, -cz / 0.4];
    const at = [0, 1, 2].map(r => t[r] + matrix[r * 3] * TILE_OFFSET[0] + matrix[r * 3 + 1] * TILE_OFFSET[1] + matrix[r * 3 + 2] * TILE_OFFSET[2]);
    reserved.push({cells: [c], studTop: new Set([c]), receivers: new Set([c]), bottom_layer: j, colour: bodyColour, component_index: body, kind: 'bracket', clearance,
      placements: [{part_id: '36840', colour_code: bodyColour, matrix, translation_ldu: t},
        {part_id: '98138', colour_code: component.colour, matrix: mul(matrix, TILE_MATRIX), translation_ldu: at, mounted_in: '36840'}]});
    summary.eyes++;
  }
  return {reserved, warnings, summary};
}
