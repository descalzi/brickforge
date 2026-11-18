import { createSvgDesignViewer } from "./design-svg-viewer.js?v=9b8d8e12b3f3";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { colourHex, isTransparent } from "./brick-colours.js?v=9b8d8e12b3f3";
export const colours = colourHex;

const geometryCache=new Map(),materialCache=new Map(),edgeCache=new Map();
function mergeGeometries(list){
  const parts=list.map(g=>g.index?g.toNonIndexed():g);let count=0;for(const g of parts)count+=g.attributes.position.count;
  const position=new Float32Array(count*3),normal=new Float32Array(count*3);let offset=0;
  for(const g of parts){position.set(g.attributes.position.array,offset*3);normal.set(g.attributes.normal.array,offset*3);offset+=g.attributes.position.count;}
  const merged=new THREE.BufferGeometry();merged.setAttribute('position',new THREE.BufferAttribute(position,3));merged.setAttribute('normal',new THREE.BufferAttribute(normal,3));return merged;
}
function regularGeometry(profile,light=false){
  const cacheKey=profile.part_id+(light?':light':'');
  if(geometryCache.has(cacheKey))return geometryCache.get(cacheKey);
  const w=profile.footprint_studs_x*8,d=profile.footprint_studs_z*8,h=profile.body_height_ldu*.4,list=[];
  const body=new THREE.BoxGeometry(w-.15,h-.1,d-.15);body.translate(0,h/2,0);list.push(body);
  if(profile.features.some(f=>f.kind==='stud'))for(let x=0;x<profile.footprint_studs_x;x++)for(let z=0;z<profile.footprint_studs_z;z++){const sx=(x+.5)*8-w/2,sz=(z+.5)*8-d/2;if(light){const side=new THREE.CylinderGeometry(2.4,2.4,1.6,6,1,true);side.translate(sx,-.8,sz);const cap=new THREE.CircleGeometry(2.4,6);cap.rotateX(-Math.PI/2);cap.translate(sx,-1.6,sz);list.push(side,cap);}else{const stud=new THREE.CylinderGeometry(2.4,2.4,1.6,10);stud.translate(sx,-.8,sz);list.push(stud);}}
  const merged=mergeGeometries(list);geometryCache.set(cacheKey,merged);return merged;
}
function edgeGeometry(profile){
  if(!edgeCache.has(profile.part_id)){const w=profile.footprint_studs_x*8,d=profile.footprint_studs_z*8,h=profile.body_height_ldu*.4,box=new THREE.BoxGeometry(w-.15,h-.1,d-.15);box.translate(0,h/2,0);edgeCache.set(profile.part_id,new THREE.EdgesGeometry(box));}
  return edgeCache.get(profile.part_id);
}
const INSTANCED_FROM=1200,white=new THREE.Color(1,1,1),highlight=new THREE.Color(1.5,1.15,.8),hidden=new THREE.Matrix4().makeScale(0,0,0);
function previewGeometry(profile){
  const key='preview:'+profile.part_id;
  if(!geometryCache.has(key)){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(profile.preview_triangles_mm,3));g.computeVertexNormals();geometryCache.set(key,g);}
  return geometryCache.get(key);
}
const edgeMaterial=new THREE.LineBasicMaterial({color:0x30404a,transparent:true,opacity:.24});
function sharedMaterial(colour,glass){const key=colour+(glass?'g':'');if(!materialCache.has(key))materialCache.set(key,new THREE.MeshStandardMaterial({color:colour,roughness:.35,metalness:.01,transparent:glass,opacity:glass?.55:1}));return materialCache.get(key);}

export function createDesignViewer(viewport) {
  if(!document.createElement("canvas").getContext("webgl2")) return createSvgDesignViewer(viewport);
  const renderer = new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setClearColor(0,0);
  viewport.append(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(36,1,.1,10000);
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;
  scene.add(new THREE.HemisphereLight(0xffffff,0x9bafbf,3));
  const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(80,150,100);scene.add(key);
  let instanced=null,model=new THREE.Group(),fitted=false,centre=new THREE.Vector3(),radius=50,selected=null,stepParts=null;
  scene.add(model);
  const grid=new THREE.GridHelper(256,32,0xb8c8d4,0xdde5eb);grid.position.y=-.15;scene.add(grid);
  const resize=new ResizeObserver(()=>{const w=viewport.clientWidth,h=viewport.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();});resize.observe(viewport);
  function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,camera);}animate();
  function clear(){
    model.traverse(object=>{if(object.isInstancedMesh){object.material.dispose();object.dispose();return;}if(object.userData.shared)return;object.geometry?.dispose();if(object.material)object.material.dispose();});instanced=null;scene.remove(model);model=new THREE.Group();scene.add(model);delete renderer.domElement.dataset.parts;delete renderer.domElement.dataset.visibleParts;delete renderer.domElement.dataset.worldBounds;
  }
  function fit(view="iso") {
    const direction=view==="top"?new THREE.Vector3(.001,1,0):view==="front"?new THREE.Vector3(0,.12,-1):new THREE.Vector3(1,.8,-1.2);
    const distance=radius/Math.sin(THREE.MathUtils.degToRad(camera.fov)/2)*1.2/Math.min(1,camera.aspect);
    camera.position.copy(centre).add(direction.normalize().multiplyScalar(distance));controls.target.copy(centre);camera.near=Math.max(.1,distance/1000);camera.far=Math.max(10000,distance*10);camera.updateProjectionMatrix();controls.update();fitted=true;
  }
  function select(componentId){selected=componentId;if(instanced){for(const e of instanced.entries)e.batch.mesh.setColorAt(e.index,componentId!==null&&e.componentId===componentId?highlight:white);for(const b of instanced.batches)b.mesh.instanceColor.needsUpdate=true;return;}model.traverse(object=>{if(!object.isMesh)return;const on=object.parent.userData.componentId===selected&&selected!==null;if(object.userData.shared){if(on&&!object.userData.own){object.material=object.material.clone();object.userData.own=true;}else if(!on&&object.userData.own){const m=object.material;object.material=sharedMaterial('#'+m.color.getHexString(),m.transparent);m.dispose();object.userData.own=false;}}object.material.emissive?.set(on?0x453012:0);});}
  // Large models: one InstancedMesh per part and colour keeps draw calls low.
  function showInstanced(plan,profiles){
    const batches=new Map(),entries=[],bounds=new THREE.Box3(),box=new THREE.Box3();
    for(const part of plan.parts){
      const profile=profiles.get(part.part_id);
      if(!profile)throw new Error("The nominal viewer has no profile for part "+part.part_id+". Download LDraw to inspect its source geometry.");
      const code=part.colour_code??part.colour,key=part.part_id+'|'+code;
      if(!batches.has(key))batches.set(key,{profile,code,list:[]});
      const m=part.matrix,t=part.translation_ldu.map(v=>v*.4),matrix=new THREE.Matrix4().set(m[0],m[1],m[2],t[0],-m[3],-m[4],-m[5],-t[1],-m[6],-m[7],-m[8],-t[2],0,0,0,1);
      const entry={id:part.instance_id,componentId:part.component_id,course:part.display_course_index??part.course_index??0,matrix};
      batches.get(key).list.push(entry);entries.push(entry);
    }
    for(const batch of batches.values()){
      const geometry=batch.profile.preview_triangles_mm?previewGeometry(batch.profile):regularGeometry(batch.profile,true);
      if(!geometry.boundingBox)geometry.computeBoundingBox();
      const glass=isTransparent(batch.code),material=new THREE.MeshStandardMaterial({color:colours.get(batch.code)||"#a9b8c2",roughness:.35,metalness:.01,transparent:glass,opacity:glass?.55:1,side:batch.profile.preview_triangles_mm?THREE.DoubleSide:THREE.FrontSide});
      const mesh=new THREE.InstancedMesh(geometry,material,batch.list.length);
      batch.list.forEach((entry,index)=>{entry.batch=batch;entry.index=index;mesh.setMatrixAt(index,entry.matrix);mesh.setColorAt(index,white);bounds.union(box.copy(geometry.boundingBox).applyMatrix4(entry.matrix));});
      mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere?.();mesh.frustumCulled=false;
      batch.mesh=mesh;model.add(mesh);
    }
    return {batches:[...batches.values()],entries,bounds};
  }
  function show(plan,catalogue) {
    const previousCentre=centre.clone();clear();
    const profiles=new Map(catalogue.profiles.map(p=>[p.part_id,p]));
    if(plan.parts.length>INSTANCED_FROM)instanced=showInstanced(plan,profiles);
    else for(const part of plan.parts) {
      const profile=profiles.get(part.part_id);
      if(!profile)throw new Error("The nominal viewer has no profile for part "+part.part_id+". Download LDraw to inspect its source geometry.");
      const w=profile.footprint_studs_x*8,d=profile.footprint_studs_z*8,h=profile.body_height_ldu*.4;
      const group=new THREE.Group();group.userData={instanceId:part.instance_id,componentId:part.component_id,course:part.display_course_index??part.course_index??0};
      const colour=colours.get(part.colour_code??part.colour)||"#a9b8c2";
      const glass=isTransparent(part.colour_code??part.colour),material=()=>new THREE.MeshStandardMaterial({color:colour,roughness:.35,metalness:.01,transparent:glass,opacity:glass?.55:1});
      if(profile.preview_triangles_mm){
        const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(profile.preview_triangles_mm,3));geometry.computeVertexNormals();
        const sourceMaterial=material();sourceMaterial.side=THREE.DoubleSide;
        group.add(new THREE.Mesh(geometry,sourceMaterial));
      }else{
      // One merged, cached geometry per regular profile: body plus studs.
      const body=new THREE.Mesh(regularGeometry(profile),sharedMaterial(colour,glass));body.userData.shared=true;group.add(body);
      if(plan.parts.length<=1500){const edges=new THREE.LineSegments(edgeGeometry(profile),edgeMaterial);edges.userData.shared=true;group.add(edges);}
      }
      const m=part.matrix,t=part.translation_ldu.map(v=>v*.4);
      group.matrixAutoUpdate=false;
      group.matrix.set(m[0],m[1],m[2],t[0],-m[3],-m[4],-m[5],-t[1],-m[6],-m[7],-m[8],-t[2],0,0,0,1);
      model.add(group);
    }
    model.updateMatrixWorld(true);
    const bounds=instanced?instanced.bounds:new THREE.Box3().setFromObject(model);
    renderer.domElement.dataset.worldBounds=JSON.stringify({min:bounds.min.toArray(),max:bounds.max.toArray()});bounds.getCenter(centre);radius=Math.max(12,bounds.getSize(new THREE.Vector3()).length()/2);grid.position.set(centre.x,bounds.min.y-.1,centre.z);
    if(!fitted)fit();else{const delta=centre.clone().sub(previousCentre);camera.position.add(delta);controls.target.add(delta);}
    select(selected);
    renderer.domElement.dataset.parts=String(plan.parts.length);renderer.domElement.dataset.visibleParts=String(plan.parts.length);
  }
  let courseCount=Infinity;
  function visibility(){if(instanced){let shown=0;for(const e of instanced.entries){const on=e.course<courseCount&&(!stepParts||stepParts.has(e.id));e.batch.mesh.setMatrixAt(e.index,on?e.matrix:hidden);if(on)shown++;}for(const b of instanced.batches)b.mesh.instanceMatrix.needsUpdate=true;renderer.domElement.dataset.visibleParts=String(shown);return;}for(const group of model.children)group.visible=group.userData.course<courseCount&&(!stepParts||stepParts.has(group.userData.instanceId));renderer.domElement.dataset.visibleParts=String(model.children.filter(g=>g.visible).length);}
  return {show:(...args)=>{courseCount=Infinity;stepParts=null;show(...args);},clear,fit,select,course:count=>{courseCount=count;visibility();},step:ids=>{stepParts=ids?new Set(ids):null;visibility();}};
}
