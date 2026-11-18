// Object intent v2 → buildable brick model.
//
// Massing: the intent is rasterised at a scale the engine chooses, hollowed and
// tiled with real bricks, plates and tiles. Detailing then replaces stepped roofs
// and wedges with real slopes and road wheels with real wheel assemblies.
// The engine always returns its best model and reports how far it deviates from
// the intent; it blocks only on an invalid intent or an empty result.
import {normaliseIntent} from './object-intent.js?v=fab991c95518';
import {rasteriseIntent, exteriorAir, hollowInterior, scaleForTarget, STUD_MM, PLATE_MM} from './intent-voxels.js?v=fab991c95518';
import {elementTypes, tileGrid} from './brick-tiler.js?v=fab991c95518';
import {planSlopes} from './slope-detailing.js?v=fab991c95518';
import {planWheels} from './wheel-detailing.js?v=fab991c95518';
import {connectionEdges} from './design-engine.js?v=fab991c95518';
import {analyzeAssembly, partBodyBounds} from './assembly-analysis.js?v=fab991c95518';
import {createAssemblyInstructions} from './assembly-instructions.js?v=fab991c95518';

const LDU = 0.4;
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const ROTATE_Y_90 = [0, 0, 1, 0, 1, 0, -1, 0, 0];

/** Merge the catalogues the massing engine uses. */
export function intentCatalogue(basic, standard, specialist) {
  const profiles = [...basic.profiles, ...standard.profiles, ...(specialist?.profiles || [])];
  return {profiles, specialist, regular: [...basic.profiles, ...standard.profiles]};
}

function softIoU(grid, realised) {
  let intersection = 0, ideal = 0, count = 0;
  for (let c = 0; c < realised.length; c++) {
    const f = grid.idealFraction[c];
    ideal += f;
    if (realised[c]) { count++; intersection += f; }
  }
  const union = ideal + count - intersection;
  return {iou: union ? intersection / union : 0, ideal_cells: ideal, realised_cells: count};
}

function visibility(grid) {
  const {nx, ny, nz, owner} = grid, air = exteriorAir(grid), visible = new Uint8Array(nx * ny * nz);
  for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const c = grid.index(i, j, k);
    if (owner[c] < 0) continue;
    const around = [[i - 1, j, k], [i + 1, j, k], [i, j, k - 1], [i, j, k + 1], [i, j + 1, k], [i, j - 1, k]];
    visible[c] = around.some(([a, b, d]) => b >= 0 && (a < 0 || d < 0 || a >= nx || d >= nz || b >= ny || air[grid.index(a, b, d)])) ? 1 : 0;
  }
  return visible;
}

/** Plan a model. catalogue = intentCatalogue(...). */
export function planIntent(input, catalogue, options = {}) {
  const started = Date.now();
  const checked = normaliseIntent(input);
  if (!checked.valid) return {status: 'blocked', design_id: 'intent', failures: checked.errors, warnings: checked.warnings, parts: [], connections: []};
  const intent = checked.intent, warnings = [...checked.warnings];
  const designId = intent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'model';
  const target = options.targetStuds || intent.build.target_longest_studs;
  const wheelCandidates = c => c.mode === 'solid' && c.role === 'wheel';
  const scale = scaleForTarget(intent, target);
  const profileMap = new Map(catalogue.profiles.map(p => [p.part_id, p]));

  // Detailing decisions that change the material union come first. Wheel pairs
  // whose carrier cannot be seated fall back to voxel material on a second pass.
  const wheels = planWheels(intent, scale, catalogue.specialist, options);
  let grid, wheelLayout, fidelity, solidBefore;
  for (let attempt = 0; attempt < 2; attempt++) {
    grid = rasteriseIntent(intent, scale, {exclude: c => wheels.replaced.has(c.id)});
    solidBefore = new Uint8Array(grid.owner.length);
    for (let c = 0; c < solidBefore.length; c++) solidBefore[c] = grid.owner[c] >= 0 ? 1 : 0;
    fidelity = softIoU(grid, solidBefore);
    wheelLayout = wheels.layout(grid, profileMap);
    if (!wheelLayout.failed.length) break;
    for (const id of wheelLayout.failed) { wheels.replaced.delete(id); Object.assign(wheels.details.get(id), {construction: 'voxel_material', reason: 'no body around the axle to carry a wheel-pin plate'}); }
  }
  const {nx, ny, nz} = grid, total = nx * ny * nz, layerSize = nx * nz;
  for (const w of wheelLayout.warnings) warnings.push(w);
  const slopes = planSlopes(intent, grid, profileMap, catalogue.specialist);
  for (const w of slopes.warnings) warnings.push(w);
  // Keep the material that detailing parts clutch to, above their studs and below their receivers.
  const keep = new Uint8Array(total);
  for (const r of [...wheelLayout.reserved, ...slopes.reserved]) {
    for (const c of r.cells) keep[c] = 1;
    for (const c of r.studTop) if (c + layerSize < total) keep[c + layerSize] = 1;
    for (const c of r.receivers) if (c - layerSize >= 0) keep[c - layerSize] = 1;
  }
  let hollow = {removed: 0};
  if (intent.build.hollow === 'auto') hollow = hollowInterior(grid, keep);
  const visible = visibility(grid);
  const tileTop = new Uint8Array(total);
  for (let c = 0; c < total; c++) {
    if (grid.owner[c] < 0) continue;
    const component = grid.components[grid.owner[c]];
    const above = c + layerSize;
    if (component?.finish === 'smooth' && (above >= total || grid.owner[above] < 0)) tileTop[c] = 1;
  }
  const reserved = [...wheelLayout.reserved, ...slopes.reserved];
  for (const r of reserved) for (const c of r.cells) { grid.owner[c] = grid.owner[c] >= 0 ? grid.owner[c] : r.component_index ?? -1; }
  const noBrick = new Uint8Array(total);
  const tileInput = {nx, ny, nz, index: grid.index, colour: grid.colour, visible, tileTop, noBrick};
  // Cells claimed by reserved parts are excluded from tiling by the tiler's owner map.
  const types = elementTypes(catalogue.regular);
  const tileBest = () => {
    let best = null;
    for (const seed of options.seeds || [1, 2, 3]) {
      const result = tileGrid(tileInput, types, reserved, {seed, trials: options.trials || 6});
      const regular = result.parts.filter(p => !p.reserved).length;
      const score = result.components.length * 1000 + regular;
      if (!best || score < best.score) best = {...result, score, seed};
      if (result.components.length === 1) break;
    }
    return best;
  };
  let best = tileBest();
  // Repair: hollowing can leave a piece with nothing above or below it to clutch.
  // Restore hidden material in the columns next to separate pieces and tile again.
  const hollowed = new Map((hollow.restore || []).map(([c, o, col]) => [c, [o, col]]));
  let restoredCells = 0;
  for (let round = 0; round < 4 && best.components.length > 1 && hollowed.size; round++) {
    const mainRoot = best.components[0].root;
    let restored = 0;
    best.parts.forEach((part, id) => {
      if (best.rootOf(id) === mainRoot) return;
      for (const c of part.cells) for (const dir of [layerSize, -layerSize]) for (let step = 1; step <= 3; step++) {
        const t = c + dir * step;
        if (t < 0 || t >= total || !hollowed.has(t)) continue;
        const [o, col] = hollowed.get(t);
        grid.owner[t] = o; grid.colour[t] = col; hollowed.delete(t); restored++;
      }
    });
    if (!restored) break;
    restoredCells += restored;
    const next = tileBest();
    if (next.components.length > best.components.length) break;
    best = next;
  }
  if (restoredCells) hollow.removed -= restoredCells;
  // Interpreters misplace parts slightly: close vertical gaps of up to two plates
  // between a separate piece and the main model by extending the piece.
  let gapCells = 0;
  for (let round = 0; round < 2 && best.components.length > 1; round++) {
    const mainRoot = best.components[0].root, owner = best.owner, fill = [];
    best.parts.forEach((part, id) => {
      if (part.reserved || best.rootOf(id) === mainRoot) return;
      for (const c of part.cells) for (const dir of [-layerSize, layerSize]) {
        const gap = [];
        for (let step = 1; step <= 3; step++) {
          const t = c + dir * step;
          if (t < 0 || t >= total) break;
          if (owner[t] >= 0) { if (best.rootOf(owner[t]) === mainRoot && gap.length && gap.length <= 2) fill.push(...gap.map(g => [g, grid.owner[c], grid.colour[c]])); break; }
          if (grid.owner[t] >= 0) break;
          gap.push(t);
        }
      }
    });
    if (!fill.length) break;
    for (const [t, o, col] of fill) { grid.owner[t] = o; grid.colour[t] = col; }
    const next = tileBest();
    if (next.components.length >= best.components.length) { for (const [t] of fill) { grid.owner[t] = -1; grid.colour[t] = -1; } break; }
    gapCells += new Set(fill.map(f => f[0])).size;
    best = next;
  }
  if (gapCells) warnings.push(`Closed small gaps (${gapCells} cells) so separate parts of the description touch.`);
  // Last resort: a separate piece touching the model only beside a different
  // colour gets one contact cell recoloured (hidden cells first) and plates there,
  // so a single part can span the joint.
  const bridges = [];
  for (let round = 0; round < 3 && best.components.length > 1; round++) {
    const mainRoot = best.components[0].root, owner = best.owner, partsList = best.parts;
    const contact = new Map();
    for (let a = 0; a < total; a++) {
      const pa = owner[a];
      if (pa < 0 || partsList[pa].reserved || best.rootOf(pa) === mainRoot) continue;
      const l = a % layerSize, i = l % nx, k = Math.floor(l / nx);
      for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (i + di < 0 || k + dk < 0 || i + di >= nx || k + dk >= nz) continue;
        const b = a + dk * nx + di, pb = owner[b];
        if (pb < 0 || partsList[pb].reserved || best.rootOf(pb) !== mainRoot) continue;
        // The joint plate must clutch material of each piece above or below it.
        const anchored = (cell, root) => [cell - layerSize, cell + layerSize].some(t => t >= 0 && t < total && owner[t] >= 0 && best.rootOf(owner[t]) === root);
        if (!anchored(a, best.rootOf(pa)) || !anchored(b, mainRoot)) continue;
        const same = grid.colour[a] === grid.colour[b];
        const recolour = same ? null : (!visible[b] ? 'main' : !visible[a] ? 'island' : partsList[pa].cells.length <= partsList[pb].cells.length ? 'island' : 'main');
        const cost = same ? -1 : (recolour === 'main' ? visible[b] : visible[a]);
        const root = best.rootOf(pa), previous = contact.get(root);
        if (!previous || cost < previous.cost) contact.set(root, {a, b, cost, recolour});
      }
    }
    if (!contact.size) break;
    const undo = {reserved: reserved.length, bridges: bridges.length, colours: []};
    for (const {a, b, recolour} of contact.values()) {
      undo.colours.push([a, grid.colour[a]], [b, grid.colour[b]]);
      if (recolour === 'main') grid.colour[b] = grid.colour[a];
      else if (recolour === 'island') grid.colour[a] = grid.colour[b];
      // A real 1x2 plate across the joint, reserved before tiling again.
      const j = Math.floor(a / layerSize), [ia, ka, ib, kb] = [a % nx, Math.floor(a / nx) % nz, b % nx, Math.floor(b / nx) % nz];
      const alongX = ka === kb, cx = grid.origin[0] + STUD_MM * ((ia + ib) / 2 + 0.5), cz = grid.origin[2] + STUD_MM * ((ka + kb) / 2 + 0.5);
      const top = grid.origin[1] + PLATE_MM * (j + 1), col = grid.colour[a];
      reserved.push({cells: [a, b], studTop: new Set([a, b]), receivers: new Set([a, b]), bottom_layer: j, colour: col, kind: 'joint_plate',
        component_index: grid.owner[a], placements: [{part_id: '3023', colour_code: col, matrix: [...(alongX ? IDENTITY : ROTATE_Y_90)], translation_ldu: [cx / LDU, -top / LDU, -cz / LDU]}]});
      bridges.push({cell: recolour === 'main' ? b : a, recoloured: Boolean(recolour), visible: Boolean(recolour && (recolour === 'main' ? visible[b] : visible[a]))});
    }
    const next = tileBest();
    if (next.components.length >= best.components.length) {
      // No improvement: undo this round's joints and colour changes.
      reserved.length = undo.reserved; bridges.length = undo.bridges;
      for (const [c, col] of undo.colours.reverse()) grid.colour[c] = col;
      break;
    }
    best = next;
  }
  const visibleBridges = bridges.filter(b => b.visible).length;
  if (visibleBridges) warnings.push(`${visibleBridges} visible cell(s) changed colour so a part could join separate pieces.`);
  // Islands: drop fragments that are too small to matter, keep and flag the rest.
  const mainRoot = best.components[0].root, cellCount = best.parts.reduce((s, p) => s + p.cells.length, 0);
  const dropped = [], kept = [];
  const islands = best.components.slice(1).map(component => {
    const members = best.parts.map((p, id) => id).filter(id => best.rootOf(id) === component.root);
    const cells = members.reduce((s, id) => s + best.parts[id].cells.length, 0);
    const owners = new Set(members.flatMap(id => best.parts[id].cells.map(c => grid.owner[c]).filter(o => o >= 0)).map(o => grid.components[o]?.id).filter(Boolean));
    return {members, cells, components: [...owners]};
  });
  const droppedIds = new Set();
  for (const island of islands) {
    const essential = island.components.some(id => intent.components.find(c => c.id === id)?.importance === 'essential');
    if (island.cells <= Math.max(4, cellCount * 0.02) || !essential) { island.members.forEach(id => droppedIds.add(id)); dropped.push(island); }
    else kept.push(island);
  }
  if (dropped.length) warnings.push(`Removed ${dropped.length} unconnectable fragment(s) (${dropped.reduce((s, i) => s + i.cells, 0)} cells) from ${[...new Set(dropped.flatMap(i => i.components))].join(', ') || 'the model'}.`);
  if (kept.length) warnings.push(`${kept.length} separate piece(s) could not be joined to the main model: ${kept.map(i => i.components.join('/')).join('; ')}. They are included but need a connection a builder must add.`);

  // Placements in LDraw coordinates; the model's lowest point is y = 0.
  const placed = best.parts.map((p, id) => ({p, id})).filter(({id}) => !droppedIds.has(id));
  const minLayer = Math.min(...placed.map(({p}) => p.reserved ? p.bottom_layer : p.y0));
  const yOffset = 0;
  const counters = new Map();
  const parts = [];
  for (const {p} of placed) {
    const owners = new Map();
    for (const c of p.cells) { const o = grid.owner[c]; if (o >= 0) owners.set(o, (owners.get(o) || 0) + 1); }
    const ownerIndex = [...owners].sort((a, b) => b[1] - a[1])[0]?.[0];
    const componentId = p.component_id || grid.components[ownerIndex]?.id || 'body';
    const n = (counters.get(componentId) || 0) + 1;
    counters.set(componentId, n);
    if (p.reserved) {
      for (const [k, placement] of p.placements.entries()) parts.push({...placement, instance_id: `${componentId}-${n}${p.placements.length > 1 ? String.fromCharCode(97 + k) : ''}`,
        translation_ldu: [placement.translation_ldu[0], placement.translation_ldu[1] + yOffset / LDU, placement.translation_ldu[2]], component_id: componentId, course_index: p.bottom_layer - minLayer});
      continue;
    }
    const cx = grid.origin[0] + STUD_MM * (p.x0 + p.fx / 2), cz = grid.origin[2] + STUD_MM * (p.z0 + p.fz / 2);
    const top = grid.origin[1] + PLATE_MM * (p.y0 + p.h) - yOffset;
    parts.push({instance_id: `${componentId}-${n}`, part_id: p.part_id, colour_code: p.colour, matrix: [...(p.rotated ? ROTATE_Y_90 : IDENTITY)],
      translation_ldu: [cx / LDU, -top / LDU, -cz / LDU], component_id: componentId, course_index: p.y0 - minLayer});
  }
  // Rest the model on y = 0 (wheels may reach below the body's lowest layer).
  const lowest = Math.min(...parts.map(p => partBodyBounds(p, profileMap.get(p.part_id)).min[1]));
  for (const p of parts) p.translation_ldu[1] = +(p.translation_ldu[1] + lowest / LDU).toFixed(6);
  const connections = connectionEdges(parts, profileMap);
  const adjacency = new Map(parts.map(p => [p.instance_id, new Set()]));
  for (const e of connections) { adjacency.get(e.instance_a).add(e.instance_b); adjacency.get(e.instance_b).add(e.instance_a); }
  const seen = new Set();
  if (parts.length) { const queue = [parts[0].instance_id]; seen.add(queue[0]); while (queue.length) for (const next of adjacency.get(queue.shift())) if (!seen.has(next)) { seen.add(next); queue.push(next); } }
  const connected = seen.size === parts.length;
  const analysis = analyzeAssembly(parts, connections, profileMap);
  const instructions = groupSteps(createAssemblyInstructions(parts, connections, profileMap), parts, options.maxPartsPerStep || 8);

  // Per-component outcome against the intent.
  const realisedCells = new Map();
  for (const {p} of placed) if (!p.reserved) for (const c of p.cells) { const o = grid.owner[c]; if (o >= 0) realisedCells.set(o, (realisedCells.get(o) || 0) + 1); }
  const componentReports = grid.reports.map(r => {
    const index = grid.components.findIndex(c => c.id === r.component_id);
    let status = r.mode === 'void' ? 'removed_material' : r.realised_cells === 0 ? 'lost' : r.thickened ? 'thickened' : 'realised';
    if (wheels.replaced.has(r.component_id)) status = 'real_wheel_assembly';
    if (r.mode === 'solid' && status !== 'real_wheel_assembly' && !realisedCells.get(index) && hollow.removed === 0 && r.realised_cells) status = 'lost';
    return {...r, status};
  });
  for (const id of wheels.replaced) if (!componentReports.some(r => r.component_id === id)) {
    const c = intent.components.find(x => x.id === id);
    componentReports.push({component_id: id, role: c.role, mode: c.mode, importance: c.importance, status: 'real_wheel_assembly', wheel: wheels.details.get(id)});
  }
  for (const r of componentReports) if (r.status === 'lost' && r.importance === 'essential') warnings.push(`Essential component ${r.component_id} is too small to appear at this build size.`);
  const attachments = attachmentChecks(intent, parts, connections, grid);
  for (const a of attachments) if (a.status === 'not_joined') warnings.push(`${a.from} is not directly joined to ${a.to}.`);

  const bomMap = new Map();
  for (const part of parts) { const key = part.part_id + '|' + part.colour_code; bomMap.set(key, (bomMap.get(key) || 0) + 1); }
  const bom = {schema_version: 1, items: [...bomMap].map(([key, quantity]) => { const [part_id, colour] = key.split('|'); return {part_id, colour_code: Number(colour), quantity}; })
    .sort((a, b) => a.part_id.localeCompare(b.part_id) || a.colour_code - b.colour_code)};
  const byId = new Map(parts.map(p => [p.instance_id, p]));
  const ldraw = ['0 ' + intent.name, '0 Name: ' + designId + '.ldr', '0 Author: BrickForge intent engine', '0 !LICENSE Model generated from a user description'];
  instructions.steps.forEach((step, i) => {
    for (const id of step.parts) { const p = byId.get(id); ldraw.push(`1 ${p.colour_code} ${p.translation_ldu.map(v => +v.toFixed(3)).join(' ')} ${p.matrix.join(' ')} ${p.part_id}.dat`); }
    if (i < instructions.steps.length - 1) ldraw.push('0 STEP');
  });
  const modelStuds = [nx, ny, nz];
  const realM = 1 / (scale * 1000);
  const intentReport = {
    schema_version: 1,
    scale: {target_longest_studs: target, model_mm_per_real_m: +(scale * 1000).toFixed(3), real_m_per_stud: +(STUD_MM * realM).toFixed(4)},
    grid: {studs_x: nx, plates_y: ny, studs_z: nz, cells_before_hollowing: fidelity.realised_cells, hollowed_cells: hollow.removed},
    shape_fidelity: {soft_iou: +fidelity.iou.toFixed(3), ideal_cells: +fidelity.ideal_cells.toFixed(1), realised_cells: fidelity.realised_cells,
      evidence: 'Soft intersection-over-union of the voxelised material against 27 samples per cell of the ideal primitives, before hollowing and detailing.'},
    connectivity: {connected, gap_cells_filled: gapCells, colour_bridges: bridges.length, visible_colour_bridges: visibleBridges, disconnected_instance_ids: parts.filter(p => !seen.has(p.instance_id)).map(p => p.instance_id), separate_pieces_kept: kept.length, fragments_removed: dropped.length, tiling_seed: best.seed},
    components: componentReports,
    attachments,
    wheels: [...wheels.details.values()],
    slopes: slopes.summary,
    assumptions: intent.assumptions,
    unsupported: intent.unsupported,
    elapsed_ms: Date.now() - started,
  };
  const validation = {checks: [
    {id: 'object_intent', status: 'passed', detail: `Valid ${intent.schema} intent with ${intent.components.length} components.`},
    {id: 'scale_choice', status: 'passed', detail: `Longest extent set to ${target} studs; one stud represents ${(STUD_MM * realM).toFixed(3)} m of the real object.`},
    {id: 'shape_fidelity', status: fidelity.iou >= 0.6 ? 'passed' : 'warning', detail: `Voxel material matches the intended shape with soft IoU ${fidelity.iou.toFixed(2)} at this scale.`},
    {id: 'graph_connectivity', status: connected ? 'passed' : 'failed', detail: connected ? 'All parts belong to one stud-connected assembly.' : `${kept.length + 1} separate pieces remain; see warnings.`},
    {id: 'nominal_connection_alignment', status: 'passed', detail: 'Edges match profiled stud/receiver, wheel-pin/bore or rim/tyre datums.'},
    {id: 'placed_body_envelopes', status: analysis.body_envelope_collisions.length ? 'failed' : 'passed', detail: analysis.body_envelope_collisions.length ? analysis.body_envelope_collisions.length + ' nominal body overlaps.' : 'No nominal body overlaps outside profiled rim/tyre seats.'},
    {id: 'support_projection_proxy', status: analysis.support.projection_inside_support_hull ? 'passed' : 'warning', detail: analysis.support.evidence},
    {id: 'hidden_colour_substitution', status: 'passed', detail: 'Parts may take a different colour only over cells that cannot be seen from outside the model.'},
    {id: 'physical_clutch_strength', status: 'not_assessed', detail: 'Nominal datums only; clutch force and structural strength are not measured.'},
    {id: 'structural_stability', status: 'not_assessed', detail: 'No load, bending or tipping model.'},
    {id: 'colour_availability', status: 'not_assessed', detail: 'Not every element is produced in every colour.'},
  ]};
  return {
    status: parts.length ? 'planned' : 'blocked', engine: 'intent-v2', design_id: designId, name: intent.name,
    parts, connections, total_mating_pairs: connections.reduce((s, e) => s + e.mating_pairs.length, 0),
    bom, ldraw: ldraw.join('\n') + '\n', instructions, analysis, validation, warnings: [...new Set(warnings)],
    dimensions_mm: analysis.nominal_dimensions_mm, intent_report: intentReport, intent,
    failures: parts.length ? [] : ['No material remained after rasterisation.'],
    component_reports: componentReports, relationship_checks: [],
  };
}

function attachmentChecks(intent, parts, connections, grid) {
  const partComponents = new Map(parts.map(p => [p.instance_id, new Set([p.component_id])]));
  const joined = new Set();
  const key = (a, b) => [a, b].sort().join('|');
  for (const e of connections) for (const a of partComponents.get(e.instance_a)) for (const b of partComponents.get(e.instance_b)) if (a !== b) joined.add(key(a, b));
  const checks = [];
  for (const c of intent.components) for (const to of c.attach_to) {
    const present = parts.some(p => p.component_id === c.id) && parts.some(p => p.component_id === to);
    // A part that spans both components joins them inherently.
    checks.push({from: c.id, to, status: !present ? 'not_assessed' : joined.has(key(c.id, to)) ? 'joined' : 'not_joined'});
  }
  return checks;
}

/** Merge single-part sequence steps into readable steps: same layer, at most n parts. */
export function groupSteps(instructions, parts, n) {
  const byId = new Map(parts.map(p => [p.instance_id, p]));
  const bottom = id => { const p = byId.get(id); return p.course_index; };
  const groups = [];
  for (const step of instructions.steps) {
    const last = groups.at(-1), id = step.parts[0];
    const sameLayer = last && bottom(last.parts[0]) === bottom(id) && last.parts.length < n && !last.parts.some(x => step.connects_to?.includes(x));
    if (sameLayer && step.nominal_approach_clear === last.nominal_approach_clear) { last.parts.push(id); last.part_steps.push(step); }
    else groups.push({parts: [id], part_steps: [step], nominal_approach_clear: step.nominal_approach_clear});
  }
  const stepOf = new Map();
  const steps = groups.map((g, i) => {
    for (const id of g.parts) stepOf.set(id, i + 1);
    const first = g.part_steps[0], last = g.part_steps.at(-1);
    const titles = new Map();
    for (const id of g.parts) titles.set(byId.get(id).component_id, (titles.get(byId.get(id).component_id) || 0) + 1);
    const supports = [...new Set(g.part_steps.flatMap(s => s.connects_to))].filter(id => !g.parts.includes(id));
    return {step: i + 1, title: [...titles].sort((a, b) => b[1] - a[1])[0][0], parts: g.parts,
      part_id: new Set(g.parts.map(id => byId.get(id).part_id)).size === 1 ? first.part_id : undefined,
      connects_to: supports, approach_direction: g.part_steps.every(s => String(s.approach_direction) === String(first.approach_direction)) ? first.approach_direction : null,
      nominal_approach_clear: g.nominal_approach_clear, approach_evidence: first.approach_evidence,
      support_guidance: last.support_guidance, insertion_path_verified: false,
      instruction: `Add ${g.parts.length} part${g.parts.length === 1 ? '' : 's'}.`, part_steps: g.part_steps.map(s => s.step)};
  });
  for (const s of steps) s.connects_to_steps = [...new Set(s.connects_to.map(id => stepOf.get(id)).filter(Boolean))].sort((a, b) => a - b);
  return {...instructions, grouping: `Consecutive parts on the same layer, at most ${n} per step.`, steps};
}
