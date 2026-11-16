/** Orthographic depth-buffer renderer for PDF diagrams. It handles intersecting
 * LDraw triangles without relying on BFC winding or whole-face painter order.
 * Text, arrows and page furniture remain vector PDF content. */
export function rasterizeInstructionFaces(faces,width,height,background=[1,1,1]){
 const pixels=new Uint8Array(width*height*3),depth=new Float64Array(width*height).fill(-Infinity);
 for(let i=0;i<pixels.length;i++)pixels[i]=Math.round(background[i%3]*255);
 const edge=(a,b,x,y)=>(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]);
 for(const f of faces){const [a,b,c]=f.points,area=edge(a,b,c[0],c[1]);if(Math.abs(area)<1e-10)continue;
  const minX=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))),maxX=Math.min(width-1,Math.ceil(Math.max(a[0],b[0],c[0]))),minY=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))),maxY=Math.min(height-1,Math.ceil(Math.max(a[1],b[1],c[1]))),colour=f.colour.map(v=>Math.max(0,Math.min(255,Math.round(v*255))));
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
   const u=edge(b,c,x+.5,y+.5)/area,v=edge(c,a,x+.5,y+.5)/area,w=1-u-v;if(u< -1e-7||v< -1e-7||w< -1e-7)continue;
   const z=u*a[2]+v*b[2]+w*c[2],i=y*width+x;if(z<depth[i]-1e-7)continue;depth[i]=z;pixels.set(colour,i*3);
  }
 }
 // Test each crease sample against the completed depth buffer. Hidden edges
 // therefore cannot be drawn on top of a different surface.
 for(const f of faces)for(let e=0;e<3;e++)if(f.edges?.[e]){
  const a=f.points[e],b=f.points[(e+1)%3],length=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])*1.5),colour=(f.edgeColour||[.2,.2,.2]).map(v=>Math.round(v*255));
  for(let j=0;j<=length;j++){const t=length?j/length:0,x=Math.floor(a[0]+(b[0]-a[0])*t),y=Math.floor(a[1]+(b[1]-a[1])*t),z=a[2]+(b[2]-a[2])*t;if(x<0||y<0||x>=width||y>=height)continue;const i=y*width+x;if(z>=depth[i]-.15)pixels.set(colour,i*3);}
 }
 return pixels;
}
