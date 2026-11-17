import {cross2} from './polygon-geometry.js?v=76b0ed28438a';
const onSegment=(p,a,b)=>Math.abs(cross2(a,b,p))<=1e-5*Math.max(1,Math.hypot(b[0]-a[0],b[1]-a[1]))&&[0,1].every(i=>p[i]>=Math.min(a[i],b[i])-1e-5&&p[i]<=Math.max(a[i],b[i])+1e-5);
function edges(polygon,lo,hi,index=-1){return polygon.map((a,i)=>{const b=polygon[(i+1)%polygon.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);let dx=(b[0]-a[0])/length,dy=(b[1]-a[1])/length,side=1;if(dx< -1e-8||Math.abs(dx)<1e-8&&dy<0){dx=-dx;dy=-dy;side=-1;}return {a,b,lo,hi,index,side,key:[dx,dy,dx*a[1]-dy*a[0]].map(v=>(Math.abs(v)<.00005?0:v).toFixed(4)).join(',')};});}
/** Necessary boundary-support pruning before material arrangement. Every
 * interior prism face must meet an oppositely directed candidate face. Midpoint
 * support is only a necessary condition; exact cover proves full coverage. */
export function pruneUnsupportedPrismFaces(candidates,outline,length,spaces=[]){
 const index=new Map(),records=candidates.map((c,i)=>edges(c.polygon,c.lo,c.hi,i)),external=[...edges(outline,0,length),...spaces.flatMap(s=>edges(s.polygon,s.lo,s.hi))];
 for(const rs of records)for(const r of rs){if(!index.has(r.key))index.set(r.key,[]);index.get(r.key).push(r);}
 const active=candidates.map(()=>true);let removed=0,passes=0;
 for(;passes<8;passes++){let changed=false;for(let i=0;i<candidates.length;i++)if(active[i])for(const face of records[i]){
  const point=face.a.map((v,k)=>(v+face.b[k])/2),z=(face.lo+face.hi)/2;
  if(external.some(e=>z>=e.lo-1e-6&&z<=e.hi+1e-6&&onSegment(point,e.a,e.b)))continue;
  if((index.get(face.key)||[]).some(e=>e.index!==i&&active[e.index]&&e.side!==face.side&&z>=e.lo-1e-6&&z<=e.hi+1e-6&&onSegment(point,e.a,e.b)))continue;
  active[i]=false;removed++;changed=true;break;
 }if(!changed)break;}
 return {candidates:candidates.filter((_,i)=>active[i]),removed,passes:Math.min(passes+1,8)};
}
