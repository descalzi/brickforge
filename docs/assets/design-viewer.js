import { createSvgDesignViewer } from "./design-svg-viewer.js?v=b6ebc6c828d2";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
export const colours = new Map([[0,"#1b2a34"],[1,"#1e5aa8"],[2,"#00852b"],[4,"#b40000"],[7,"#8a928d"],[14,"#f2cd37"],[15,"#f4f4f4"],[19,"#e4cd9e"],[25,"#d66b24"]]);

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
  let model=new THREE.Group(),fitted=false,centre=new THREE.Vector3(),radius=50,selected=null,stepParts=null;
  scene.add(model);
  const grid=new THREE.GridHelper(256,32,0xb8c8d4,0xdde5eb);grid.position.y=-.15;scene.add(grid);
  const resize=new ResizeObserver(()=>{const w=viewport.clientWidth,h=viewport.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();});resize.observe(viewport);
  function animate(){requestAnimationFrame(animate);controls.update();renderer.render(scene,camera);}animate();
  function clear(){
    model.traverse(object=>{object.geometry?.dispose();if(object.material)object.material.dispose();});scene.remove(model);model=new THREE.Group();scene.add(model);delete renderer.domElement.dataset.parts;delete renderer.domElement.dataset.visibleParts;delete renderer.domElement.dataset.worldBounds;
  }
  function fit(view="iso") {
    const direction=view==="top"?new THREE.Vector3(.001,1,0):view==="front"?new THREE.Vector3(0,.12,-1):new THREE.Vector3(1,.8,-1.2);
    const distance=radius/Math.sin(THREE.MathUtils.degToRad(camera.fov)/2)*1.2/Math.min(1,camera.aspect);
    camera.position.copy(centre).add(direction.normalize().multiplyScalar(distance));controls.target.copy(centre);camera.near=Math.max(.1,distance/1000);camera.far=Math.max(10000,distance*10);camera.updateProjectionMatrix();controls.update();fitted=true;
  }
  function select(componentId){selected=componentId;model.traverse(object=>{if(object.isMesh){object.material.emissive?.set(object.parent.userData.componentId===selected?0x453012:0);}});}
  function show(plan,catalogue) {
    const previousCentre=centre.clone();clear();
    const profiles=new Map(catalogue.profiles.map(p=>[p.part_id,p]));
    for(const part of plan.parts) {
      const profile=profiles.get(part.part_id);
      if(!profile)throw new Error("The nominal viewer has no profile for part "+part.part_id+". Download LDraw to inspect its source geometry.");
      const w=profile.footprint_studs_x*8,d=profile.footprint_studs_z*8,h=profile.body_height_ldu*.4;
      const group=new THREE.Group();group.userData={instanceId:part.instance_id,componentId:part.component_id,course:part.display_course_index??part.course_index??0};
      const colour=colours.get(part.colour_code??part.colour)||"#a9b8c2";
      const material=()=>new THREE.MeshStandardMaterial({color:colour,roughness:.35,metalness:.01});
      if(profile.preview_triangles_mm){
        const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(profile.preview_triangles_mm,3));geometry.computeVertexNormals();
        const sourceMaterial=material();sourceMaterial.side=THREE.DoubleSide;
        group.add(new THREE.Mesh(geometry,sourceMaterial));
      }else{
      const body=new THREE.Mesh(new THREE.BoxGeometry(w-.15,h-.1,d-.15),material());body.position.y=h/2;group.add(body);
      const edges=new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry),new THREE.LineBasicMaterial({color:0x30404a,transparent:true,opacity:.24}));edges.position.copy(body.position);group.add(edges);
      for(let x=0;x<profile.footprint_studs_x;x++)for(let z=0;z<profile.footprint_studs_z;z++){
        const stud=new THREE.Mesh(new THREE.CylinderGeometry(2.4,2.4,1.6,16),material());stud.position.set((x+.5)*8-w/2,-.8,(z+.5)*8-d/2);group.add(stud);
      }
      }
      const m=part.matrix,t=part.translation_ldu.map(v=>v*.4);
      group.matrixAutoUpdate=false;
      group.matrix.set(m[0],m[1],m[2],t[0],-m[3],-m[4],-m[5],-t[1],-m[6],-m[7],-m[8],-t[2],0,0,0,1);
      model.add(group);
    }
    model.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(model);
    renderer.domElement.dataset.worldBounds=JSON.stringify({min:bounds.min.toArray(),max:bounds.max.toArray()});bounds.getCenter(centre);radius=Math.max(12,bounds.getSize(new THREE.Vector3()).length()/2);grid.position.set(centre.x,bounds.min.y-.1,centre.z);
    if(!fitted)fit();else{const delta=centre.clone().sub(previousCentre);camera.position.add(delta);controls.target.add(delta);}
    select(selected);
    renderer.domElement.dataset.parts=String(plan.parts.length);renderer.domElement.dataset.visibleParts=String(plan.parts.length);
  }
  let courseCount=Infinity;
  function visibility(){for(const group of model.children)group.visible=group.userData.course<courseCount&&(!stepParts||stepParts.has(group.userData.instanceId));renderer.domElement.dataset.visibleParts=String(model.children.filter(g=>g.visible).length);}
  return {show:(...args)=>{courseCount=Infinity;stepParts=null;show(...args);},clear,fit,select,course:count=>{courseCount=count;visibility();},step:ids=>{stepParts=ids?new Set(ids):null;visibility();}};
}
