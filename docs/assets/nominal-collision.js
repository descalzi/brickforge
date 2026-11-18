// Convex nominal material narrow phase for solid boxes and source-backed slope
// prisms. Other profiles retain their conservative body envelope. Studs and
// underside cavities are outside this model; no physical clutch claim is made.
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const localCache=new WeakMap(),worldCache=new WeakMap();
const boxVertices=(min,max)=>[0,1].flatMap(x=>[0,1].flatMap(y=>[0,1].map(z=>[x?max[0]:min[0],y?max[1]:min[1],z?max[2]:min[2]])));
function uniqueAxes(vectors){const axes=new Map();for(const v of vectors){const length=Math.hypot(...v);if(length<1e-7)continue;let a=v.map(x=>x/length);if(a.find(x=>Math.abs(x)>1e-7)<0)a=a.map(x=>-x);axes.set(a.map(x=>x.toFixed(6)).join(','),a);}return [...axes.values()];}
function localShape(profile){if(localCache.has(profile))return localCache.get(profile);const boxes=profile.body_boxes_mm||profile.collision_boxes_mm;if(boxes){const children=boxes.map(box=>({vertices:boxVertices(box.min,box.max),exact:true,normals:[[1,0,0],[0,1,0],[0,0,1]],edges:[[1,0,0],[0,1,0],[0,0,1]]})),value={vertices:children.flatMap(c=>c.vertices),exact:true,children,normals:[],edges:[]};localCache.set(profile,value);return value;}const vertices=profile.body_vertices_mm||boxVertices([-profile.footprint_studs_x*4,0,-profile.footprint_studs_z*4],[profile.footprint_studs_x*4,profile.body_height_ldu*.4,profile.footprint_studs_z*4]),exact=!!profile.footprint_studs_x||profile.supported_geometry?.includes('extruded_profile')&&profile.extrusion_axes_ldraw?.length>0,normals=[],edges=[];
 if(exact)for(let i=0;i<vertices.length;i++)for(let j=i+1;j<vertices.length;j++){edges.push(sub(vertices[j],vertices[i]));for(let k=j+1;k<vertices.length;k++){const n=cross(sub(vertices[j],vertices[i]),sub(vertices[k],vertices[i]));if(Math.hypot(...n)<1e-7)continue;const ds=vertices.map(p=>dot(n,sub(p,vertices[i])));if(ds.every(d=>d>=-1e-6)||ds.every(d=>d<=1e-6))normals.push(n);}}
 const value={vertices,exact,normals:uniqueAxes(normals),edges:uniqueAxes(edges)};localCache.set(profile,value);return value;
}
function shape(part,profile){const signature=part.matrix.join(',')+':'+part.translation_ldu.join(',');if(worldCache.get(part)?.profile===profile&&worldCache.get(part)?.signature===signature)return worldCache.get(part).value;const local=localShape(profile),transform=p=>[0,1,2].map(i=>(part.matrix[i*3]*p[0]+part.matrix[i*3+1]*p[1]+part.matrix[i*3+2]*p[2])*(i===0?1:-1));const world=l=>{const vertices=l.vertices.map(p=>transform(p).map((v,i)=>v+part.translation_ldu[i]*.4*(i===0?1:-1)));return {vertices,exact:l.exact,normals:l.normals.map(transform),edges:l.edges.map(transform),children:l.children?.map(world),min:[0,1,2].map(i=>Math.min(...vertices.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...vertices.map(p=>p[i])))};};const value=world(local);worldCache.set(part,{profile,signature,value});return value;}
const boundsOverlap=(a,b)=>[0,1,2].every(i=>Math.min(a.max[i],b.max[i])-Math.max(a.min[i],b.min[i])>1e-5);
function intersect(a,b){if(!boundsOverlap(a,b))return false;if(a.children||b.children)return (a.children||[a]).some(x=>(b.children||[b]).some(y=>intersect(x,y)));if(!a.exact||!b.exact)return true;const axes=uniqueAxes([...a.normals,...b.normals,...a.edges.flatMap(e=>b.edges.map(f=>cross(e,f)))]);for(const axis of axes){const x=a.vertices.map(p=>dot(axis,p)),y=b.vertices.map(p=>dot(axis,p));if(Math.min(Math.max(...x),Math.max(...y))-Math.max(Math.min(...x),Math.min(...y))<=1e-5)return false;}return true;}
export const nominalBodiesIntersect=(a,ap,b,bp)=>intersect(shape(a,ap),shape(b,bp));
export function nominalBodyIntersectsBox(part,profile,box){return intersect(shape(part,profile),{...box,vertices:boxVertices(box.min,box.max),exact:true,normals:[[1,0,0],[0,1,0],[0,0,1]],edges:[[1,0,0],[0,1,0],[0,0,1]]});}

/** Continuous straight sweep of nominal bulk material, including the final
 * pose. Convex prisms sweep to a convex hull; compound bodies sweep each child.
 * Unprofiled shapes retain conservative swept envelopes. Studs/cavities remain
 * excluded, so a clear result is not a physical insertion certificate. */
export function nominalBodySweepIntersects(a,ap,direction,distance,b,bp){
 if(!Array.isArray(direction)||direction.length!==3||!direction.every(Number.isFinite)||Math.abs(Math.hypot(...direction)-1)>1e-6||!Number.isFinite(distance)||distance<0)throw new TypeError('A unit direction and non-negative finite sweep distance are required.');
 const delta=direction.map(v=>v*distance),sweep=s=>{const vertices=[...s.vertices,...s.vertices.map(p=>p.map((v,i)=>v+delta[i]))];return {vertices,exact:s.exact,children:s.children?.map(sweep),normals:uniqueAxes([...s.normals,...s.edges.map(e=>cross(e,direction))]),edges:uniqueAxes([...s.edges,direction]),min:s.min.map((v,i)=>v+Math.min(0,delta[i])),max:s.max.map((v,i)=>v+Math.max(0,delta[i]))};};
 return intersect(sweep(shape(a,ap)),shape(b,bp));
}
