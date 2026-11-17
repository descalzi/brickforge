import {pruneUnsupportedPrismFaces} from './prism-face-pruning.js?v=d0896f9f9a9d';
import {orientationMatches} from './part-orientation.js?v=d0896f9f9a9d';
import {transformVector} from './specialist-placement.js?v=d0896f9f9a9d';
import {translateComponentRequirements} from './design-translation.js?v=d0896f9f9a9d';
import {discoverPartCandidates} from './part-catalogue.js?v=d0896f9f9a9d';
import {convexHull,polygonArea,pointInPolygon,clipConvex,triangulatePolygon} from './polygon-geometry.js?v=d0896f9f9a9d';
const EPS=1e-6,yaws=[[1,0,0,0,1,0,0,0,1],[0,0,1,0,1,0,-1,0,0],[-1,0,0,0,1,0,0,0,-1],[0,0,-1,0,1,0,1,0,0]];
const unique=values=>[...new Set(values.map(v=>+v.toFixed(7)))].sort((a,b)=>a-b);
const rect=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
const bodyVertices=p=>p.body_vertices_mm||[-1,1].flatMap(x=>[0,p.body_height_ldu*.4].flatMap(y=>[-1,1].map(z=>[x*p.footprint_studs_x*4,y,z*p.footprint_studs_z*4])));
/** Exact material arrangement for an upright polygonal extrusion. Lines from all
 * legal placements partition the cross-section into trapezoids; line crossings
 * split horizontal bands, so one interior sample represents each entire atom.
 * Exact-cover masks preserve material area/volume, concavities and keepouts. */
export function composeExtrudedProfile(component,catalogue,options,partCatalogue,mapping,specialists){
 if(component.geometry!=='extruded_profile')return null;
 const translated=translateComponentRequirements(component,mapping);if(!translated.valid)return null;
 const search=discoverPartCandidates({roles:translated.part_roles,required_capabilities:[],forbidden_capabilities:translated.forbidden_capabilities,dimensions_mm:component.dimensions_mm},partCatalogue),allowed=new Map(search.candidates.map(c=>[c.part_id,c]));
 const ext=component.geometry_parameters.extrusion_axis==='x'?0:2,u=ext===0?2:0,d=component.dimensions_mm,length=ext===0?d.width:d.depth,raw=component.geometry_parameters.outline_mm,min=[0,1].map(i=>Math.min(...raw.map(p=>p[i]))),outline=raw.map(p=>p.map((v,i)=>v-min[i])),width=Math.max(...outline.map(p=>p[0])),height=Math.max(...outline.map(p=>p[1]));
 if(Math.abs(width-(u===0?d.width:d.depth))>(component.fit_tolerance_mm||0)+EPS||Math.abs(height-d.height)>(component.fit_tolerance_mm||0)+EPS)return {error:'Profile material bounds differ from the declared dimensions without a sufficient explicit allowance.'};
 let targetTriangles;try{targetTriangles=triangulatePolygon(outline);}catch(e){return {error:e.message};}
 if(width>128||height>76.8||length>128)return {error:'Component '+component.id+' exceeds the profile composition envelope (128 mm across/extrusion, 76.8 mm high).'};
 const origin=[component.position_mm.x,component.position_mm.y,component.position_mm.z],spaces=(options.negativeSpaces||[]).map(s=>{const p=[s.position_mm.x,s.position_mm.y,s.position_mm.z],sz=[s.dimensions_mm.width,s.dimensions_mm.height,s.dimensions_mm.depth];return {polygon:rect(p[u]-origin[u],p[1]-origin[1],p[u]+sz[u]-origin[u],p[1]+sz[1]-origin[1]),lo:p[ext]-origin[ext],hi:p[ext]+sz[ext]-origin[ext]};});
 const sourceProfiles=[...catalogue.profiles,...(specialists?.profiles||[]).filter(p=>p.supported_geometry?.includes('extruded_profile'))].filter(p=>allowed.has(p.part_id));if(!sourceProfiles.length)return null;
 let candidates=[];const seen=new Set(),maxCandidates=6000;
 for(const profile of sourceProfiles){
  const semantic=allowed.get(profile.part_id);if(!semantic)continue;
  for(const matrix of yaws){
   const frame=profile.orientation_frame||{up:[0,-1,0]},orientation=profile.orientation_frame?component.orientation:component.orientation?.up?{up:component.orientation.up}:null;if(!orientationMatches(matrix,orientation,frame))continue;
   if(profile.extrusion_axes_ldraw&&!profile.extrusion_axes_ldraw.includes(['x','y','z'][matrix.slice(ext*3,ext*3+3).findIndex(v=>v)]))continue;
   const vs=bodyVertices(profile).map(p=>transformVector(matrix,p).map((v,i)=>v*(i===0?1:-1))),lo=[0,1,2].map(i=>Math.min(...vs.map(p=>p[i]))),hi=[0,1,2].map(i=>Math.max(...vs.map(p=>p[i]))),size=hi.map((v,i)=>v-lo[i]),poly=convexHull(vs.map(p=>[p[u]-lo[u],p[1]-lo[1]])),area=polygonArea(poly);
   for(let y=0;y+size[1]<=height+EPS;y+=3.2)for(let x=0;x+size[u]<=width+EPS;x+=8){const placed=poly.map(p=>[p[0]+x,p[1]+y]),inside=targetTriangles.reduce((s,t)=>s+polygonArea(clipConvex(placed,t)),0);if(Math.abs(inside-area)>EPS)continue;
    for(let z=0;z+size[ext]<=length+EPS;z+=8){if(spaces.some(s=>Math.min(s.hi,z+size[ext])-Math.max(s.lo,z)>EPS&&polygonArea(clipConvex(placed,s.polygon))>EPS))continue;
     const key=[profile.part_id,...placed.flat().map(v=>v.toFixed(6)),z,size[ext]].join(',');if(seen.has(key))continue;seen.add(key);
     const offset=[0,0,0];offset[u]=x;offset[1]=y;offset[ext]=z;const translation=origin.map((v,i)=>v+offset[i]-lo[i]);
     candidates.push({polygon:placed,lo:z,hi:z+size[ext],volume:area*size[ext],capabilities:semantic.capabilities||[],semantic_axes:Object.keys(profile.orientation_frame||{up:[0,-1,0]}),part:{instance_id:component.id+'-pack-'+candidates.length,part_id:profile.part_id,component_id:component.id,matrix:[...matrix],translation_ldu:translation.map((v,i)=>v/.4*(i===0?1:-1)),colour_code:component.colour??options.defaultColour,course_index:Math.round(y/3.2)}});
     if(candidates.length>=maxCandidates)return {error:'Profile composition placement budget reached for '+component.id+'.',composition:{budget_exhausted:true,placement_count:candidates.length}};
    }
   }
  }
 }
 if(!candidates.length)return {error:'No contained source-backed prism placements were found for '+component.id+'.'};
 const boundaryPruning=pruneUnsupportedPrismFaces(candidates,outline,length,spaces);candidates=boundaryPruning.candidates;
 if(!candidates.length)return {error:'No candidate prism has a fully supportable material boundary within the placement limits.'};
 const lines=[],lineKeys=new Set(),ys=[0,height];function addEdges(poly){for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];ys.push(a[1],b[1]);if(Math.abs(a[1]-b[1])<EPS)continue;const slope=(b[0]-a[0])/(b[1]-a[1]),intercept=a[0]-slope*a[1],low=Math.min(a[1],b[1]),high=Math.max(a[1],b[1]),key=[slope,intercept,low,high].map(v=>v.toFixed(6)).join(',');if(!lineKeys.has(key)){lineKeys.add(key);lines.push({a:slope,b:intercept,low,high});}}}
 addEdges(outline);for(const c of candidates)addEdges(c.polygon);for(const s of spaces)addEdges(s.polygon);
 if(lines.length>600)return {error:'Profile line arrangement budget reached.',composition:{budget_exhausted:true}};
 for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++){const a=lines[i],b=lines[j];if(Math.abs(a.a-b.a)<EPS)continue;const y=(b.b-a.b)/(a.a-b.a);if(y>Math.max(0,a.low,b.low)+EPS&&y<Math.min(height,a.high,b.high)-EPS)ys.push(y);}
 const bands=unique(ys.filter(y=>y>=-EPS&&y<=height+EPS)),slabs=unique([0,length,...candidates.flatMap(c=>[c.lo,c.hi]),...spaces.flatMap(s=>[s.lo,s.hi]).filter(z=>z>0&&z<length)]),atoms=[];
 for(let yi=0;yi<bands.length-1;yi++){const y0=bands[yi],y1=bands[yi+1],ym=(y0+y1)/2,active=lines.filter(l=>l.low<ym&&l.high>ym).sort((a,b)=>(a.a*ym+a.b)-(b.a*ym+b.b)),xs=[];for(const l of active)if(!xs.length||Math.abs((xs.at(-1).a-l.a)*ym+xs.at(-1).b-l.b)>EPS)xs.push(l);
  for(let i=0;i<xs.length-1;i++){const left=xs[i],right=xs[i+1],x=((left.a+right.a)*ym+left.b+right.b)/2;if(!pointInPolygon([x,ym],outline))continue;const area=(y1-y0)*((right.a-left.a)*(y0+y1)/2+right.b-left.b);if(area<EPS)continue;
   for(let zi=0;zi<slabs.length-1;zi++){const z=(slabs[zi]+slabs[zi+1])/2;if(spaces.some(s=>z>s.lo&&z<s.hi&&pointInPolygon([x,ym],s.polygon)))continue;atoms.push({point:[x,ym],z,volume:area*(slabs[zi+1]-slabs[zi])});}
  }
 }
 if(!atoms.length||atoms.length>4096)return {error:'Profile material arrangement is empty or exceeds 4096 atoms.',composition:{budget_exhausted:atoms.length>4096,atom_count:atoms.length}};
 const covering=atoms.map(()=>[]),placements=[];
 for(const c of candidates){let mask=0n,volume=0;for(const [i,a]of atoms.entries())if(a.z>c.lo-EPS&&a.z<c.hi+EPS&&pointInPolygon(a.point,c.polygon)){mask|=1n<<BigInt(i);volume+=a.volume;}if(Math.abs(volume-c.volume)>1e-4||!mask)continue;const index=placements.length;placements.push({...c,mask});for(let i=0;i<atoms.length;i++)if(mask&(1n<<BigInt(i)))covering[i].push(index);}
 if(covering.some(cs=>!cs.length))return {error:'Some required polygon material has no contained part placement on the stud/course grid.',composition:{atom_count:atoms.length,placement_count:placements.length,budget_exhausted:false}};
 const full=(1n<<BigInt(atoms.length))-1n,alternatives=[],chosen=[],maxAlternatives=options.maxComponentAlternatives||12;let nodes=0,combinations=0,exhausted=false;
 const required=translated.required_capabilities;
 function visit(covered){if(++nodes>options.maxSearchNodes||alternatives.length>=maxAlternatives){exhausted=true;return;}if(covered===full){combinations++;if(!required.every(cap=>chosen.some(i=>placements[i].capabilities.includes(cap)))||!Object.keys(component.orientation||{}).every(axis=>chosen.some(i=>placements[i].semantic_axes.includes(axis))))return;const parts=chosen.map(i=>placements[i].part);alternatives.push({parts,score:parts.length*1000,tiling:[parts.map(p=>p.part_id)],specialist:true,composition:true});return;}if(chosen.length>=options.maxParts)return;
  let choices=null;for(let i=0;i<atoms.length;i++)if(!(covered&(1n<<BigInt(i)))){const available=covering[i].filter(j=>!(placements[j].mask&covered));if(!available.length)return;if(!choices||available.length<choices.length)choices=available;if(choices.length===1)break;}
  choices.sort((a,b)=>placements[b].volume-placements[a].volume||placements[a].part.part_id.localeCompare(placements[b].part.part_id));for(const i of choices){chosen.push(i);visit(covered|placements[i].mask);chosen.pop();if(nodes>options.maxSearchNodes||alternatives.length>=maxAlternatives)break;}
 }
 visit(0n);const composition={method:'exact_prism_material_cover',boundary_candidates_pruned:boundaryPruning.removed,atom_count:atoms.length,placement_count:placements.length,target_volume_mm3:atoms.reduce((s,a)=>s+a.volume,0),budget_exhausted:exhausted||alternatives.length>=maxAlternatives,grid_mm:{horizontal:8,vertical:3.2},limitations:['Upright constant-section convex source prisms on a stud/plate grid; only source-measured faceted curves; no non-right-angle substitution.']};
 return alternatives.length?{alternatives,semantic_candidates:search.candidates,search_nodes:nodes,combinations,composition}:{error:'No exact multi-part prism cover was found within the component search limits.',composition};
}
