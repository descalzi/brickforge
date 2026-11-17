// Locate upright stud-grid carriers from the positions of their measured wheel pins.
// The final assembly planner checks actual rim bores, axes, fit keys and material.
export function chassisInserts(component, wheels, profiles) {
  if (component.role !== 'chassis' || component.geometry !== 'rectangular_prism' ||
      component.orientation || component.required_features?.length || component.forbidden_features?.length || !wheels?.length) return [];
  const origin = ['x','y','z'].map(key => component.position_mm[key]);
  const {width,depth,height} = component.dimensions_mm;
  const candidates = [];
  for (const profile of profiles) {
    const pins = profile.features.filter(feature => feature.kind === 'wheel_pin');
    if (!pins.length || profile.body_height_ldu !== 8 || !profile.features.some(f => f.kind === 'stud')) continue;
    const bounds = [0,1,2].map(axis => profile.body_vertices_mm.map(p => p[axis]));
    const size = bounds.map(values => Math.max(...values)-Math.min(...values));
    // placementFor uses an origin at the centre of the top face.
    if (Math.abs(Math.min(...bounds[0])+size[0]/2)>1e-6 || Math.abs(Math.min(...bounds[2])+size[2]/2)>1e-6 ||
        Math.abs(Math.min(...bounds[1]))>1e-6 || Math.abs(size[1]-3.2)>1e-6 ||
        !Number.isInteger(size[0]/8) || !Number.isInteger(size[2]/8)) continue;
    for (const rotated of [false,true]) {
      const sx = size[rotated?2:0]/8, sz = size[rotated?0:2]/8;
      const located = new Map();
      for (const pin of pins) {
        const [px,py,pz] = pin.position_ldu.map(v => v*.4);
        const offset = [sx*4+(rotated?pz:px), 3.2-py, sz*4+(rotated?px:-pz)];
        const axis = rotated ? [pin.axis[2],pin.axis[1],-pin.axis[0]] : pin.axis;
        for (const wheel of wheels) {
          const alignedAxis = ['x','y','z'].indexOf(wheel.geometry_parameters.axis);
          if (Math.abs(axis[alignedAxis])!==1) continue;
          const centre = ['x','y','z'].map((key,i) => wheel.position_mm[key]+wheel.dimensions_mm[['width','height','depth'][i]]/2);
          const pitch = [8,3.2,8];
          const tolerance = (wheel.position_tolerance_mm||0)+(wheel.fit_tolerance_mm||0)/2+1e-6;
          // Enumerate nearby cells within the allowed movement, including ties.
          const target = centre.map((v,i) => v-origin[i]-offset[i]);
          const last = [width/8-sx,height/3.2-1,depth/8-sz];
          const lo = target.map((v,i) => Math.max(0,Math.ceil((v-tolerance)/pitch[i])));
          const hi = target.map((v,i) => Math.min(Math.round(last[i]),Math.floor((v+tolerance)/pitch[i])));
          for (let x=lo[0]; x<=hi[0]; x++) for (let course=lo[1]; course<=hi[1]; course++) for (let z=lo[2]; z<=hi[2]; z++) {
            const key = [x,course,z].join(',');
            if (!located.has(key)) located.set(key, {x,z,sx,sz,course,rotated,candidate:{profile},matches:[]});
            const error = Math.hypot(x*8-target[0],course*3.2-target[1],z*8-target[2]);
            located.get(key).matches.push({wheel:wheel.id,pin:pin.feature_id,error});
          }
        }
      }
      for (const item of located.values()) {
        const wheelIds=new Set(), pinIds=new Set();
        let error=0;
        for (const match of item.matches.sort((a,b)=>a.error-b.error)) {
          if (wheelIds.has(match.wheel)||pinIds.has(match.pin)) continue;
          wheelIds.add(match.wheel); pinIds.add(match.pin); error+=match.error;
        }
        candidates.push({...item,wheelIds,error});
      }
    }
  }
  const chosen=[], assigned=new Set();
  for (const item of candidates.sort((a,b)=>b.wheelIds.size-a.wheelIds.size||a.error-b.error)) {
    if ([...item.wheelIds].some(id=>assigned.has(id))) continue;
    if (chosen.some(p=>p.course===item.course && p.x<item.x+item.sx && item.x<p.x+p.sx && p.z<item.z+item.sz && item.z<p.z+p.sz)) continue;
    chosen.push(item);
    for (const id of item.wheelIds) assigned.add(id);
    if (assigned.size===wheels.length) return chosen;
  }
  return [];
}
