// Windows and doors: real frames (with glass, or a door) set into wall faces where
// the intent marks a window or door, instead of a painted or cut-out patch.
//
// A window or door component is thin across the wall. The frame goes into the
// wall's outermost layer of cells over the component's width and from its bottom
// up, with its receivers on the wall below and the wall above on its studs.
const STUD = 8, PLATE = 3.2;
const ROLE = /\b(window|door|doorway)s?\b/;
const FRAME_ROLE = /\b(frame|sill|lintel|shutter)s?\b/;
// Frame recipes come from vocabulary frames that name the insert they hold (glass or
// a door) and its offset from the frame origin: width in studs, height in plates.
function frameRecipes(profileMap, role) {
  const recipes = [];
  for (const p of profileMap.values()) {
    if (!p.insert || !(p.roles || []).includes(role) || !profileMap.has(p.insert.part_id)) continue;
    const box = p.collision_boxes_mm.reduce((b, x) => ({min: b.min.map((v, a) => Math.min(v, x.min[a])), max: b.max.map((v, a) => Math.max(v, x.max[a]))}));
    const kind = (profileMap.get(p.insert.part_id).roles || []).includes('door') ? 'door' : 'glass';
    recipes.push({frame: p.part_id, width: p.footprint_studs_x, plates: Math.round((box.max[1] - box.min[1]) / PLATE), insert: {part: p.insert.part_id, offset: p.insert.offset_ldu, kind}});
  }
  return recipes.sort((a, b) => b.plates - a.plates || b.width - a.width);
}
const FRAME_COLOUR = 15, GLASS_COLOUR = 47;

export function planOpenings(intent, grid, profileMap, options = {}) {
  const {nx, ny, nz, owner, colour, origin, index, shapes, components} = grid, layer = nx * nz, total = nx * ny * nz;
  const claimed = options.claimed || new Uint8Array(total), air = options.exteriorAir;
  const reserved = [], warnings = [], summary = {windows: 0, doors: 0};
  const windows = frameRecipes(profileMap, 'window_frame'), doors = frameRecipes(profileMap, 'door_frame');
  if (!windows.length && !doors.length) return {reserved, warnings, summary};
  const centre = (a, n) => origin[a] + (n + 0.5) * (a === 1 ? PLATE : STUD);
  components.forEach((component, ci) => {
    if (component.mode === 'solid' || !ROLE.test(component.role) || FRAME_ROLE.test(component.role)) return;
    if (component.rotate_deg && component.rotate_deg.some(v => Math.abs(v) > 1)) return;
    const shape = shapes.get(component.id);
    if (!shape) return;
    const isDoor = /door/.test(component.role);
    // Cells whose centres the component covers, and its thin (wall-normal) axis.
    const range = [0, 1, 2].map(a => {
      const size = a === 1 ? PLATE : STUD;
      let lo = Math.ceil((shape.min[a] - origin[a]) / size - 0.5), hi = Math.floor((shape.max[a] - origin[a]) / size - 0.5);
      if (hi < lo) { const mid = Math.floor(((shape.min[a] + shape.max[a]) / 2 - origin[a]) / size); lo = hi = mid; }
      return [Math.max(0, lo), Math.min((a === 0 ? nx : a === 1 ? ny : nz) - 1, hi)];
    });
    const extent = [0, 1, 2].map(a => range[a][1] - range[a][0] + 1);
    const normal = extent[0] <= extent[2] ? 0 : 2, along = 2 - normal;
    const width = extent[along], height = extent[1];
    const recipes = (isDoor ? doors : windows).filter(r => r.plates <= height + Math.max(1, Math.round(height * 0.15)) && r.plates >= Math.min(height, 6) * 0.6);
    const recipe = recipes.find(r => r.width <= width);
    if (!recipe) { warnings.push(`${component.id}: no ${isDoor ? 'door' : 'window'} frame fits ${width}×${height} cells; kept as ${component.mode === 'void' ? 'an opening' : 'paint'}.`); return; }
    // Columns: as many frames side by side as fit, centred.
    const count = isDoor ? 1 : Math.floor(width / recipe.width), start = range[along][0] + Math.floor((width - count * recipe.width) / 2);
    const j0 = range[1][0], h = recipe.plates;
    if (j0 + h > ny) return;
    // Outward side and the wall's outer layer: walk in from the side with exterior air.
    const cellAt = (n, w, j) => normal === 0 ? index(n, j, w) : index(w, j, n);
    let placedAny = false;
    for (const side of [-1, 1]) {
      if (placedAny) break;
      const outside = side < 0 ? range[normal][0] - 1 : range[normal][1] + 1;
      const midW = Math.floor((range[along][0] + range[along][1]) / 2), midJ = Math.min(ny - 1, j0 + Math.floor(height / 2));
      // Beyond the grid is open air too.
      const beyond = outside < 0 || outside >= (normal === 0 ? nx : nz);
      if (!air || (!beyond && !air[cellAt(outside, midW, midJ)])) continue;
      // Outermost layer whose rectangle sits on wall material along its whole bottom.
      for (let n = side < 0 ? range[normal][0] : range[normal][1], steps = 0; steps < extent[normal] + 1 && n >= 0 && n < (normal === 0 ? nx : nz); n -= side, steps++) {
        if (j0 === 0) break;
        let seated = true;
        for (let w = start; w < start + count * recipe.width; w++) if (owner[cellAt(n, w, j0 - 1)] < 0 || claimed[cellAt(n, w, j0 - 1)]) seated = false;
        if (!seated) continue;
        for (let f = 0; f < count; f++) {
          const w0 = start + f * recipe.width, cells = [];
          let free = true;
          for (let w = w0; w < w0 + recipe.width && free; w++) for (let j = j0; j < j0 + h; j++) { const c = cellAt(n, w, j); if (claimed[c]) { free = false; break; } cells.push(c); }
          if (!free) continue;
          // Wall material behind the frame's layer stays; the frame's own cells take its colour.
          const wall = cells.map(c => owner[c]).find(o => o >= 0) ?? owner[cellAt(n, w0, j0 - 1)];
          for (const c of cells) { claimed[c] = 1; owner[c] = wall; colour[c] = FRAME_COLOUR; }
          // Frame axes: local x along the wall, local -z outward, y down. LDraw z = -world z.
          const out = normal === 0 ? [side, 0, 0] : [0, 0, -side];
          const ez = out.map(v => -v), ey = [0, 1, 0], ex = [ey[1] * ez[2] - ey[2] * ez[1], ey[2] * ez[0] - ey[0] * ez[2], ey[0] * ez[1] - ey[1] * ez[0]];
          const matrix = [ex[0], ey[0], ez[0], ex[1], ey[1], ez[1], ex[2], ey[2], ez[2]];
          const cx = normal === 0 ? centre(0, n) : origin[0] + (w0 + recipe.width / 2) * STUD;
          const cz = normal === 0 ? origin[2] + (w0 + recipe.width / 2) * STUD : centre(2, n);
          const top = origin[1] + (j0 + h) * PLATE;
          const t = [cx / 0.4, -top / 0.4, -cz / 0.4];
          const o = recipe.insert.offset, at = [0, 1, 2].map(r => t[r] + matrix[r * 3] * o[0] + matrix[r * 3 + 1] * o[1] + matrix[r * 3 + 2] * o[2]);
          const insertColour = recipe.insert.kind === 'door' ? component.colour : (/^Trans/i.test(String(component.colour_name || '')) ? component.colour : GLASS_COLOUR);
          const topRow = cells.filter(c => Math.floor(c / layer) === j0 + h - 1), bottomRow = cells.filter(c => Math.floor(c / layer) === j0);
          reserved.push({cells, studTop: new Set(topRow), receivers: new Set(bottomRow), bottom_layer: j0, colour: FRAME_COLOUR, component_index: wall, kind: recipe.insert.kind === 'door' ? 'door' : 'window',
            placements: [{part_id: recipe.frame, colour_code: FRAME_COLOUR, matrix, translation_ldu: t}, {part_id: recipe.insert.part, colour_code: insertColour, matrix: [...matrix], translation_ldu: at, mounted_in: recipe.frame}]});
          summary[recipe.insert.kind === 'door' ? 'doors' : 'windows']++;
          placedAny = true;
        }
        break;
      }
    }
    if (!placedAny) warnings.push(`${component.id}: no wall face to set a ${isDoor ? 'door' : 'window'} frame into; kept as ${component.mode === 'void' ? 'an opening' : 'paint'}.`);
  });
  return {reserved, warnings, summary};
}
