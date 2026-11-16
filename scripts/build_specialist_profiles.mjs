// Offline catalogue ingestion only. The production planner is browser JavaScript.
// Usage: node scripts/build_specialist_profiles.mjs [local-pinned-ldraw-directory]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLDrawGeometryResolver } from '../docs/assets/ldraw-geometry.js';
const run=promisify(execFile),commit='c70360d1c588be894997b2168c61909bc8058c4d';
const base=`https://raw.githubusercontent.com/kulits/ldraw-parts/${commit}/ldraw/`;
const cache=process.argv[2],documents=new Map();
const resolver=createLDrawGeometryResolver({source:{geometry_base_url:base}},{fetchImpl:async url=>{
 const path=url.slice(base.length);
 try {
  const text=cache?await readFile(`${cache}/${path}`,'utf8'):(await run('curl',['-fsSL','--retry','2','--max-time','30',url],{maxBuffer:8e6})).stdout;
  documents.set(path,text);return {ok:true,text:async()=>text};
 }catch(error){if(error.code==='ENOENT'||error.stderr?.includes('404'))return {ok:false,status:404};throw error;}
}});
const definitions=[{id:'3039',width:16,depth:16,height:9.6,slope:true},{id:'3037',width:32,depth:16,height:9.6,slope:true},{id:'60592',width:16,depth:8,height:19.2}];
const functional=JSON.parse(await readFile(new URL('../docs/data/functional-part-definitions.json',import.meta.url)));
definitions.push(...functional.definitions);
const index={parts:definitions.map(d=>({part_id:d.id,filename:`parts/${d.id}.dat`}))};
const profiles=[],capabilities=JSON.parse(await readFile(new URL('../docs/data/part-capabilities-v1.json',import.meta.url)));
const out=new URL('../docs/data/part-meshes/',import.meta.url);await mkdir(out,{recursive:true});
for(const d of definitions){
 const measured=await resolver.resolvePart(d.id,index,{includeTrianglePositions:true}),root=documents.get(`parts/${d.id}.dat`);
 const description=root.split(/\r?\n/)[0].slice(2),author=root.match(/^0 Author: (.+)/m)?.[1].trim(),license=root.match(/^0 !LICENSE (.+)/m)?.[1].trim();
 const features=[];
 for(let i=0;i<d.width/8;i++)for(let z=0;z<d.depth/8;z++){
  const x=(i+.5)*8-d.width/2,zz=d.slope?-8+z*8:0;
  features.push({feature_id:`receiver-${i}-${z}`,kind:'stud_receiver',position_ldu:[x/.4,d.height/.4,zz/.4],axis:[0,1,0]});
  if(!d.slope||zz===0)features.push({feature_id:`stud-${i}-${z}`,kind:'stud',position_ldu:[x/.4,0,zz/.4],axis:[0,-1,0]});
 }
 const vertices=[];
 for(const x of [-d.width/2,d.width/2]){
  if(d.slope)for(const [y,z] of [[9.6,-12],[8,-12],[0,-4],[0,4],[9.6,4]])vertices.push([x,y,z]);
  else for(const y of [0,d.height])for(const z of [-4,4])vertices.push([x,y,z]);
 }
 const profile={part_id:d.id,description,features,body_vertices_mm:vertices,supported_geometry:[d.slope?'extruded_profile':'rectangular_prism'],extrusion_axes_ldraw:d.slope?['x']:[],body_height_ldu:d.height/.4,mesh_file:`part-meshes/${d.id}.json`,source_filename:`parts/${d.id}.dat`,source_library_commit:commit,connection_evidence:'BrickForge-authored nominal stud-grid datums checked against source top studs and underside envelope; physical clutch not verified.'};
 if(d.body_vertices_mm){Object.assign(profile,{body_vertices_mm:d.body_vertices_mm,features:d.features,supported_geometry:d.supported_geometry,extrusion_axes_ldraw:d.extrusion_axes_ldraw||[],cylinder_axis_ldraw:d.cylinder_axis_ldraw});}
 if(d.slope)profile.orientation_frame={up:[0,-1,0],forward:[0,0,-1]};
 if(d.orientation_frame)profile.orientation_frame=d.orientation_frame;
 if(d.connection_evidence)profile.connection_evidence=d.connection_evidence;
 profile.body_geometry_evidence=d.body_vertices_mm?'authored_nominal_envelope':'source_silhouette_vertices';
 profiles.push(profile);
 const part={part_id:d.id,description,roles:d.roles|| (d.slope?['roof','slope']:['window']),capabilities:d.capabilities|| (d.slope?['sloped_surface','top_studs','underside_stud_receivers']:['window_frame','top_studs','underside_stud_receivers']),dimensions_mm:{width:d.width,depth:d.depth,height:d.height},candidate_status:'geometry_measured',interfaces:profile.features.map(f=>({interface_id:f.feature_id,interface_type:f.kind,position_mm:f.position_ldu.map(v=>v*.4),axis_vector:f.axis,nominal_diameter_mm:null,evidence_status:'authored_nominal_grid_from_ldraw'})),source:{file:`parts/${d.id}.dat`,revision:root.match(/!LDRAW_ORG Part UPDATE (.+)/)?.[1].trim()||null,license,author,library_commit:commit},geometry_measurement:{source_library_commit:commit,triangle_count:measured.triangle_count,method:'recursive_ldraw_surface_bounds',bounds_mm:[measured.bounds_mm.minimum,measured.bounds_mm.maximum]}};
 const existing=capabilities.parts.findIndex(p=>p.part_id===d.id);if(existing<0)capabilities.parts.push(part);else capabilities.parts[existing]=part;
 await writeFile(new URL(`${d.id}.json`,out),JSON.stringify({schema_version:1,part_id:d.id,source_library_commit:commit,license,author,triangle_positions_mm:measured.triangle_positions_mm.map(v=>+v.toFixed(6))})+'\n');
}
const prior=JSON.parse(await readFile(new URL('sources.json',out)));
const oldSources=new Map(prior.sources.map(s=>[s.file,s]));
const sources=[...documents].sort(([a],[b])=>a.localeCompare(b)).map(([file,text])=>({file,author:text.match(/^0 Author: (.+)/m)?.[1].trim()||null,license:text.match(/^0 !LICENSE (.+)/m)?.[1].trim()||null}));
for(const item of sources)oldSources.set(item.file,item);
await writeFile(new URL('sources.json',out),JSON.stringify({source_repository:'https://github.com/kulits/ldraw-parts',source_library_commit:commit,notice:'Triangle meshes derived from the listed LDraw parts and recursively referenced subparts/primitives. Authors and licenses retained below. Nominal connection profiles are separately authored by BrickForge.',sources:[...oldSources.values()].sort((a,b)=>a.file.localeCompare(b.file))},null,2)+'\n');
capabilities.parts.sort((a,b)=>a.part_id.localeCompare(b.part_id));
await writeFile(new URL('../docs/data/part-capabilities-v1.json',import.meta.url),JSON.stringify(capabilities,null,2)+'\n');
await writeFile(new URL('../docs/data/specialist-profiles-v1.json',import.meta.url),JSON.stringify({schema_version:1,coordinate_system:'LDraw',profiles,assemblies:functional.assemblies,limitations:['Specialist body envelopes and stud datums are nominal. Detailed clutch, insertion paths, strength and cavity clearance are not verified.','Only explicitly profiled elements and proper right-angle orientations are eligible for placement.']},null,2)+'\n');
console.log(`Built ${profiles.length} source-backed profiles, meshes and attribution for ${sources.length} LDraw source files.`);
