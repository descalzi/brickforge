import {planDesign} from './design-engine.js?v=8c466e17ba47';

// Choices correspond to a plate height, half a stud and one stud. The planner
// checks each complete candidate against the original features and relations.
function* candidateEdits(spec, failure) {
  const course = spec.constraints.course_type || 'auto';
  const auto = {field: 'course_type', before: course, after: 'auto'};
  if (course !== 'auto') yield [auto];

  const blocked = new Set((failure.component_reports || [])
    .filter(report => report.status === 'blocked')
    .map(report => report.component_id));
  const sorted = [...spec.components].sort((a, b) => Number(blocked.has(b.id)) - Number(blocked.has(a.id)));
  // A fixed misplaced component can have legal dimensions but no mating pose.
  // Try small translations for the moving ends of required relationships.
  const movingEnds = new Set(spec.relationships
    .filter(r => r.required !== false && r.type === 'attached_to')
    .map(r => r.from));
  if (!blocked.size) {
    for (const after of [1.6, 4, 8]) {
      for (const component of sorted.filter(c => movingEnds.has(c.id))) {
        const before = component.position_tolerance_mm || 0;
        if (after > before) yield [{component: component.id, field: 'position_tolerance_mm', before, after}];
      }
    }
  }
  // Repeated requirements often fail together. A single component edit cannot
  // resolve a second independent failure, so try matching blocked peers together.
  const visited = new Set();
  for (const component of sorted) {
    if (visited.has(component.id)) continue;
    const peers = blocked.has(component.id) ? sorted.filter(c =>
      blocked.has(c.id) && c.geometry === component.geometry && c.role === component.role &&
      ['width', 'depth', 'height'].every(axis => c.dimensions_mm[axis] === component.dimensions_mm[axis])) : [component];
    for (const peer of peers) visited.add(peer.id);
    if (component.role==='wheel' && component.geometry==='cylinder' && spec.relationships.some(r=>r.required!==false && r.type==='attached_to' && [r.from,r.to].includes(component.id))) {
      // A smaller rigid wheel changes the bore centre relative to the requested
      // bounding-box origin. Try size and mating-pose allowances together.
      for (const size of [0.8,1.6,3.2,4]) {
        const edits=[];
        for(const peer of peers)for(const [field,allowance] of [['fit_tolerance_mm',size],['position_tolerance_mm',size+0.4]]) {
          const before=peer[field]||0;
          if(before<allowance)edits.push({component:peer.id,field,before,after:+allowance.toFixed(2)});
        }
        if(course!=='auto')edits.push(auto);
        if(edits.length)yield edits;
      }
    }
    const rounded = ['sphere', 'cylinder'].includes(component.geometry);
    const field = rounded ? 'shape_tolerance_mm' : 'fit_tolerance_mm';

    const limits = rounded ? [3.2, 4, 4.8, 5.6, 6.4, 8] : [0.8, 1.6, 3.2, 4];
    for (const after of limits) {
      const edits = peers.filter(c => after > (c[field] || 0))
        .map(c => ({component: c.id, field, before: c[field] || 0, after}));
      if (!edits.length) continue;
      yield edits;
      if (course !== 'auto') yield [...edits, auto];
    }
  }
}

function revisedBrief(spec, edits) {
  const revised = structuredClone(spec);
  for (const edit of edits) {
    const target = edit.component ? revised.components.find(c => c.id === edit.component) : revised.constraints;
    target[edit.field] = edit.after;
  }
  return revised;
}

export function findTestedRevision(spec, catalogue, options, failure) {
  let attempts = 0;
  if (failure?.status !== 'blocked') return {attempts};
  for (const edits of candidateEdits(spec, failure)) {
    if (attempts >= 24) break;
    attempts++;
    const revised = revisedBrief(spec, edits);
    const plan = planDesign(revised, catalogue, {...options, stopOnFirstComponentFailure: true});
    if (plan.status === 'planned') {
      return {attempts, edits, specification: revised, parts: plan.parts.length,
        positions: (plan.component_reports || [])
          .filter(r => r.position_adjustment_mm?.some(value => Math.abs(value) > 1e-6))
          .map(r => ({component: r.component_id, delta: r.position_adjustment_mm})),
        dimensions: (plan.component_reports || [])
          .filter(r => r.realised_dimensions_mm && r.requested_dimensions_mm &&
            Object.keys(r.realised_dimensions_mm).some(k =>
              Math.abs(r.realised_dimensions_mm[k] - r.requested_dimensions_mm[k]) > 1e-5))
          .map(r => ({component: r.component_id, size: r.realised_dimensions_mm})),
        approximations: plan.component_reports?.filter(r => r.approximation).map(r => ({
          component: r.component_id, outer: r.approximation.outer_excess_bound_mm,
          inner: r.approximation.inner_missing_band_bound_mm
        })) || []};
    }
  }
  return {attempts};
}
