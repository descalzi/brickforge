// Spatially indexed assembly analysis and sequencing for large models.
//
// Produces the same records as analyzeAssembly and createAssemblyInstructions,
// but tests each part only against nearby parts, so models of thousands of parts
// stay interactive. Sweeps and support guidance use the same nominal evidence.
import {partBodyBounds, createSupportTracker, clearApproach} from './assembly-analysis.js?v=c008cadea6e8';
import {nominalBodiesIntersect} from './nominal-collision.js?v=c008cadea6e8';
import {transformVector} from './specialist-placement.js?v=c008cadea6e8';

const BUCKET = 16;

/** Uniform 3D hash of axis-aligned bounds (mm). */
export function boundsIndex(items) {
  const buckets = new Map(), key = (x, y, z) => x + ',' + y + ',' + z, range = (lo, hi) => [Math.floor(lo / BUCKET), Math.floor(hi / BUCKET)];
  items.forEach((item, id) => {
    const [x0, x1] = range(item.min[0], item.max[0]), [y0, y1] = range(item.min[1], item.max[1]), [z0, z1] = range(item.min[2], item.max[2]);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const k = key(x, y, z);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(id);
    }
  });
  return {
    query(min, max) {
      const out = new Set(), [x0, x1] = range(min[0], max[0]), [y0, y1] = range(min[1], max[1]), [z0, z1] = range(min[2], max[2]);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (const id of buckets.get(key(x, y, z)) || []) out.add(id);
      return out;
    },
  };
}

export function analyzeLargeAssembly(parts, connections, profiles) {
  const bounds = parts.map(p => partBodyBounds(p, profiles.get(p.part_id))), index = boundsIndex(bounds);
  const coupled = new Set(connections.filter(e => e.mating_pairs?.some(p => p.connection_type === 'rim_tyre_seat')).map(e => [e.instance_a, e.instance_b].sort().join('|')));
  const collisions = [];
  bounds.forEach((b, i) => {
    for (const j of index.query(b.min, b.max)) {
      if (j <= i || coupled.has([parts[i].instance_id, parts[j].instance_id].sort().join('|'))) continue;
      if (nominalBodiesIntersect(parts[i], profiles.get(parts[i].part_id), parts[j], profiles.get(parts[j].part_id))) collisions.push([parts[i].instance_id, parts[j].instance_id]);
    }
  });
  const tracker = createSupportTracker(profiles);
  for (const part of parts) tracker.add(part);
  const min = [0, 1, 2].map(a => Math.min(...bounds.map(b => b.min[a]))), max = [0, 1, 2].map(a => Math.max(...bounds.map(b => b.max[a])));
  return {nominal_dimensions_mm: {width: max[0] - min[0], height: max[1] - min[1], depth: max[2] - min[2]}, body_envelope_collisions: collisions, support: tracker.snapshot()};
}

/** Small binary heap keyed by [priority, order]. */
function heap() {
  const a = [], less = (x, y) => x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
  return {
    get size() { return a.length; },
    push(v) { a.push(v); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (!less(a[i], a[p])) break; [a[i], a[p]] = [a[p], a[i]]; i = p; } },
    pop() { const top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && less(a[l], a[m])) m = l; if (r < a.length && less(a[r], a[m])) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } } return top; },
  };
}

/**
 * Bottom-up connected sequence: the next part is the lowest one joined to what is
 * already built. Approaches are swept only against built parts in the part's
 * axis-aligned corridors.
 */
export function createLargeAssemblyInstructions(parts, connections, profiles) {
  const bounds = parts.map(p => partBodyBounds(p, profiles.get(p.part_id)));
  const index = boundsIndex(bounds), byId = new Map(parts.map((p, i) => [p.instance_id, i]));
  const partsById = new Map(parts.map(p => [p.instance_id, p]));
  const lo = [0, 1, 2].map(a => Math.min(...bounds.map(b => b.min[a]))), hi = [0, 1, 2].map(a => Math.max(...bounds.map(b => b.max[a])));
  const joints = parts.map(() => []), neighbours = parts.map(() => new Set());
  for (const e of connections) {
    const a = byId.get(e.instance_a), b = byId.get(e.instance_b);
    joints[a].push(e); joints[b].push(e); neighbours[a].add(b); neighbours[b].add(a);
  }
  // Only the axes along which this part's joints let it move need a corridor.
  const jointAxes = (i, isBuilt) => {
    const axes = new Set(), part = parts[i], profile = profiles.get(part.part_id);
    for (const e of joints[i]) {
      const movingIsA = e.instance_a === part.instance_id, other = byId.get(movingIsA ? e.instance_b : e.instance_a);
      if (!isBuilt(other)) continue;
      for (const pair of e.mating_pairs || []) {
        const f = profile.features.find(x => x.feature_id === (movingIsA ? pair.feature_a : pair.feature_b));
        if (!f) continue;
        const v = transformVector(part.matrix, f.axis).map(Math.abs);
        axes.add(v.indexOf(Math.max(...v)));
      }
    }
    return axes.size ? [...axes] : [0, 1, 2];
  };
  const corridor = (i, axes) => {
    const b = bounds[i], out = new Set();
    for (const axis of axes) {
      const min = b.min.slice(), max = b.max.slice();
      min[axis] = lo[axis]; max[axis] = hi[axis];
      for (const j of index.query(min, max)) out.add(j);
    }
    return out;
  };
  const built = new Set(), builtIds = new Set(), steps = [], stepOf = new Map(), tracker = createSupportTracker(profiles);
  const order = parts.map((p, i) => i).sort((a, b) => bounds[a].min[1] - bounds[b].min[1] || bounds[a].min[0] - bounds[b].min[0] || bounds[a].min[2] - bounds[b].min[2]);
  const rank = new Map(order.map((i, r) => [i, r]));
  const queue = heap(), queued = new Set(), deferred = new Set();
  const enqueue = (i, penalty = 0) => { queue.push([bounds[i].min[1] + penalty, rank.get(i), i]); queued.add(i); };
  // Foundation: the broadest part on the lowest level.
  const floor = bounds[order[0]].min[1];
  const foundation = order.filter(i => bounds[i].min[1] - floor < 0.1).sort((a, b) => {
    const area = i => (bounds[i].max[0] - bounds[i].min[0]) * (bounds[i].max[2] - bounds[i].min[2]);
    return area(b) - area(a) || rank.get(a) - rank.get(b);
  })[0];
  enqueue(foundation);
  let cursor = 0;
  while (builtIds.size < parts.length) {
    if (!queue.size) { while (built.has(order[cursor])) cursor++; enqueue(order[cursor]); }
    const [, , i] = queue.pop();
    if (built.has(i)) continue;
    const part = parts[i];
    const nearby = new Set();
    for (const j of corridor(i, jointAxes(i, j => built.has(j)))) if (built.has(j)) nearby.add(parts[j].instance_id);
    for (const j of neighbours[i]) if (built.has(j)) nearby.add(parts[j].instance_id);
    const approach = builtIds.size ? clearApproach(part, nearby, partsById, joints[i], profiles) : {clear: true, direction: null, evidence: 'initial_part'};
    if (!approach.clear && !deferred.has(i) && queue.size) { deferred.add(i); enqueue(i, 1e6); continue; }
    const supports = [...neighbours[i]].filter(j => built.has(j)).map(j => parts[j].instance_id);
    built.add(i); builtIds.add(part.instance_id);
    const support = tracker.add(part);
    const step = {nominal_approach_clear: approach.clear, approach_direction: approach.direction, approach_evidence: approach.evidence, step: steps.length + 1,
      title: part.component_id, parts: [part.instance_id], part_id: part.part_id, colour_code: part.colour_code, connects_to: supports,
      connects_to_steps: supports.map(id => stepOf.get(id)).sort((a, b) => a - b),
      instruction: supports.length ? `Align ${part.part_id} with ${supports.join(', ')} at the reported nominal mating datums.` : `Start a subassembly with ${part.part_id}.`,
      insertion_path_verified: false, support_guidance: {status: support.projection_inside_support_hull ? 'no_hold_flag' : 'hold_recommended', ...support, physical_stability_verified: false}};
    if (approach.diagnostic) step.approach_diagnostic = {reason: approach.diagnostic.reason, joints: approach.diagnostic.joints.map(j => ({...j, step: stepOf.get(j.instance_id)})), blockers: approach.diagnostic.blockers.map(b => ({...b, step: stepOf.get(b.instance_id)}))};
    steps.push(step); stepOf.set(part.instance_id, step.step);
    for (const j of neighbours[i]) if (!built.has(j) && !queued.has(j)) enqueue(j);
  }
  return {schema_version: 1, evidence: 'nominal_connection_graph_sequence', foundation_selection: 'Broadest part on the lowest level, then the lowest part joined to the built assembly.',
    limitations: ['Large-model sequence: approaches are swept against built parts in the moving part\'s axis-aligned corridors. Studs, cavities and elastic deformation are excluded. Stage support guidance is a nominal envelope/volume proxy. Hand access, physical insertion and retention are not verified.'], steps};
}
