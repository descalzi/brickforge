// Real road wheels: pairs of intent wheels become a 2x2 wheel-pin plate set into the
// body with rim and tyre assemblies, when the scaled wheels are close to the real
// assembly's size and track. Other wheels stay as voxel material.
const TYRE_DIAMETER_MM = 14.4, PIN_OFFSET_MM = 12, PIN_DROP_MM = 2, STUD = 8, PLATE = 3.2;
const RIGHT = [0, 0, -1, 0, 1, 0, 1, 0, 0], LEFT = [0, 0, 1, 0, 1, 0, -1, 0, 0], IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function planWheels(intent, scale, specialist, options = {}) {
  const replaced = new Set(), details = new Map(), pairs = [];
  const has = id => specialist?.profiles?.some(p => p.part_id === id);
  const none = {replaced, details, layout: () => ({reserved: [], warnings: [], failed: []})};
  if (options.realWheels === false || !has('4600') || !has('4624') || !has('3641')) return none;
  const solids = intent.components.filter(c => c.mode === 'solid' && c.role !== 'wheel');
  if (!solids.length) return none;
  const xs = solids.flatMap(c => [c.center_mm[0] - c.size_mm[0] / 2, c.center_mm[0] + c.size_mm[0] / 2]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2 * scale;
  const wheels = intent.components.filter(c => c.mode === 'solid' && c.role === 'wheel' && c.shape === 'cylinder' && c.axis === 'x' && !c.rotate_deg)
    .map(c => ({c, x: c.center_mm[0] * scale, y: c.center_mm[1] * scale, z: c.center_mm[2] * scale, d: Math.max(c.size_mm[1], c.size_mm[2]) * scale}));
  const used = new Set();
  for (const left of wheels.filter(w => w.x < cx)) {
    const right = wheels.filter(w => w.x > cx && !used.has(w.c.id) && Math.abs(w.z - left.z) < STUD && Math.abs(w.y - left.y) < 2 * PLATE)
      .sort((a, b) => Math.abs(a.z - left.z) - Math.abs(b.z - left.z))[0];
    if (!right || used.has(left.c.id)) continue;
    const size = ((left.d + right.d) / 2) / TYRE_DIAMETER_MM, halfTrack = (right.x - left.x) / 2;
    const reason = size < 0.6 ? 'wheels are much smaller than the real wheel assembly at this scale'
      : size > 1.5 ? 'wheels are much larger than the real wheel assembly at this scale'
      : Math.abs(halfTrack - PIN_OFFSET_MM) > 1.5 * STUD ? 'the track is too wide for a central wheel-pin plate' : null;
    for (const w of [left, right]) details.set(w.c.id, {component_id: w.c.id, construction: reason ? 'voxel_material' : 'real_wheel_assembly',
      reason, intended_diameter_mm: +w.d.toFixed(1), real_diameter_mm: TYRE_DIAMETER_MM, intended_half_track_mm: +halfTrack.toFixed(1), real_half_track_mm: PIN_OFFSET_MM + 3.2});
    if (reason) continue;
    used.add(left.c.id); used.add(right.c.id); replaced.add(left.c.id); replaced.add(right.c.id);
    pairs.push({left, right, x: (left.x + right.x) / 2, y: (left.y + right.y) / 2, z: (left.z + right.z) / 2, colour: left.c.colour,
      attach: left.c.attach_to[0] || right.c.attach_to[0]});
  }
  for (const w of wheels) if (!details.has(w.c.id)) details.set(w.c.id, {component_id: w.c.id, construction: 'voxel_material', reason: 'no opposite wheel to share an axle'});

  function layout(grid) {
    const reserved = [], warnings = [], failed = [];
    const {nx, ny, nz, origin, index, owner, colour} = grid;
    for (const pair of pairs) {
      const i0 = Math.round((pair.x - origin[0]) / STUD - 1), k0 = Math.round((pair.z - origin[2]) / STUD - 1);
      let jw = Math.round((pair.y + PIN_DROP_MM - origin[1]) / PLATE - 1);
      if (i0 < 0 || k0 < 0 || i0 + 2 > nx || k0 + 2 > nz) { failed.push(pair.left.c.id, pair.right.c.id); continue; }
      const footprint = j => [[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) => index(i0 + a, j, k0 + b));
      // The carrier needs body above it to clutch to; lower axles hang it under the body.
      const bodyAt = j => j >= 0 && j < ny && footprint(j).some(c => owner[c] >= 0);
      let lowest = -1;
      for (let j = 0; j < ny; j++) if (bodyAt(j)) { lowest = j; break; }
      if (lowest < 0) { failed.push(pair.left.c.id, pair.right.c.id); continue; }
      if (jw < lowest - 1) jw = lowest - 1;
      if (jw >= ny - 1) jw = ny - 2;
      if (jw < 0) jw = 0;
      if (!bodyAt(jw + 1) && !bodyAt(jw - 1)) { jw = lowest - 1 >= 0 ? lowest - 1 : lowest; }
      const X = origin[0] + STUD * (i0 + 1), Z = origin[2] + STUD * (k0 + 1), top = origin[1] + PLATE * (jw + 1), pinY = top - PIN_DROP_MM;
      // Carve wheel wells: anything within the tyre envelope (plus clearance) on either side.
      const r = TYRE_DIAMETER_MM / 2 + 0.8;
      for (const side of [-1, 1]) {
        const xa = X + side * STUD, xb = X + side * (PIN_OFFSET_MM + 3.2 + 0.8);
        const [lo, hi] = [Math.min(xa, xb), Math.max(xa, xb)];
        for (let j = Math.max(0, Math.floor((pinY - r - origin[1]) / PLATE)); j <= Math.min(ny - 1, Math.floor((pinY + r - origin[1]) / PLATE)); j++)
          for (let k = Math.max(0, Math.floor((Z - r - origin[2]) / STUD)); k <= Math.min(nz - 1, Math.floor((Z + r - origin[2]) / STUD)); k++)
            for (let i = Math.max(0, Math.floor((lo - origin[0]) / STUD)); i <= Math.min(nx - 1, Math.floor((hi - 1e-6 - origin[0]) / STUD)); i++) {
              // Nearest point of the cell to the axle line.
              const cy = Math.min(Math.max(pinY, origin[1] + PLATE * j), origin[1] + PLATE * (j + 1));
              const cz = Math.min(Math.max(Z, origin[2] + STUD * k), origin[2] + STUD * (k + 1));
              const cxMin = origin[0] + STUD * i, cxMax = cxMin + STUD;
              if (cxMax <= lo + 1e-6 || cxMin >= hi - 1e-6) continue;
              if (Math.hypot(cy - pinY, cz - Z) < r) { const c = index(i, j, k); owner[c] = -1; colour[c] = -1; }
            }
      }
      const cells = footprint(jw);
      const ownerIndex = (() => { for (const j of [jw + 1, jw, jw - 1]) if (j >= 0 && j < ny) for (const c of footprint(j)) if (owner[c] >= 0) return owner[c]; return 0; })();
      const plateColour = 0;
      for (const c of cells) { owner[c] = ownerIndex; colour[c] = plateColour; }
      const placements = [{part_id: '4600', colour_code: plateColour, matrix: [...IDENTITY], translation_ldu: [X / 0.4, -top / 0.4, -Z / 0.4]}];
      const rimColour = pair.colour === 0 ? 71 : pair.colour;
      for (const [side, matrix] of [[-1, LEFT], [1, RIGHT]]) {
        const pin = [X / 0.4 + side * 30, -top / 0.4 + 5, -Z / 0.4];
        placements.push({part_id: '4624', colour_code: rimColour, matrix: [...matrix], translation_ldu: [...pin]});
        placements.push({part_id: '3641', colour_code: 0, matrix: [...matrix], translation_ldu: [...pin]});
      }
      for (const w of [pair.left, pair.right]) Object.assign(details.get(w.c.id), {
        realised_axle_mm: {x: +(X - pair.x).toFixed(1), y: +(pinY - pair.y).toFixed(1), z: +(Z - pair.z).toFixed(1)}});
      reserved.push({cells, studTop: new Set(cells), receivers: new Set(cells), bottom_layer: jw, colour: plateColour,
        component_index: ownerIndex, component_id: pair.attach || grid.components[ownerIndex]?.id, placements, kind: 'wheel_carrier'});
    }
    return {reserved, warnings, failed};
  }
  return {replaced, details, layout};
}
