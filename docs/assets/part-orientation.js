const directions={'+x':[1,0,0],'-x':[-1,0,0],'+y':[0,1,0],'-y':[0,-1,0],'+z':[0,0,1],'-z':[0,0,-1]};
export const cardinalDirections=Object.keys(directions);
export function orientationMatches(matrix,orientation,frame){
 if(!orientation)return true;
 for(const [name,target] of Object.entries(orientation)){
  const local=frame?.[name];if(!local||!directions[target])return false;
  const world=[0,1,2].map(i=>(matrix[i*3]*local[0]+matrix[i*3+1]*local[1]+matrix[i*3+2]*local[2])*(i===0?1:-1));
  if(!world.every((v,i)=>Math.abs(v-directions[target][i])<1e-6))return false;
 }
 return true;
}
/** Rotate an authored horizontal slope about its component centre. Update the
 * polygon plane as well as its facing, so editing cannot contradict the shape. */
export function reorientExtrudedComponent(component,forward){
 if(component.geometry!=='extruded_profile'||!['+x','-x','+z','-z'].includes(forward))throw new Error('Choose a horizontal facing for an extruded profile.');
 const c=structuredClone(component),shape=c.geometry_parameters,oldAxis=shape.extrusion_axis||'z',newAxis=forward[1]==='x'?'z':'x',previous=c.orientation?.forward||(oldAxis==='z'?'-x':'-z');
 if(previous[0]!==forward[0]){const xs=shape.outline_mm.map(p=>p[0]),sum=Math.min(...xs)+Math.max(...xs);shape.outline_mm=shape.outline_mm.map(([x,y])=>[sum-x,y]);}
 if(oldAxis!==newAxis){const d=c.dimensions_mm,p=c.position_mm,cx=p.x+d.width/2,cz=p.z+d.depth/2;[d.width,d.depth]=[d.depth,d.width];p.x=cx-d.width/2;p.z=cz-d.depth/2;}
 shape.extrusion_axis=newAxis;c.orientation={up:'+y',forward};return c;
}
