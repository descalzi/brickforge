const EPS=1e-7;
export const cross2=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
export const signedArea=p=>p.reduce((s,v,i)=>s+v[0]*p[(i+1)%p.length][1]-v[1]*p[(i+1)%p.length][0],0)/2;
export const polygonArea=p=>Math.abs(signedArea(p));
export function convexHull(points){const ps=[...new Map(points.map(p=>[p.map(v=>v.toFixed(7)).join(','),p])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const half=a=>{const h=[];for(const p of a){while(h.length>1&&cross2(h.at(-2),h.at(-1),p)<=EPS)h.pop();h.push(p);}return h.slice(0,-1);};return [...half(ps),...half([...ps].reverse())];}
export function pointInPolygon(p,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if(Math.abs(cross2(a,b,p))<EPS&&p[0]>=Math.min(a[0],b[0])-EPS&&p[0]<=Math.max(a[0],b[0])+EPS&&p[1]>=Math.min(a[1],b[1])-EPS&&p[1]<=Math.max(a[1],b[1])+EPS)return true;if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
export function clipConvex(subject,cutter){let output=subject;const clip=signedArea(cutter)<0?[...cutter].reverse():cutter;for(let i=0;i<clip.length&&output.length;i++){const a=clip[i],b=clip[(i+1)%clip.length],input=output;output=[];for(let j=0;j<input.length;j++){const p=input[j],q=input[(j+1)%input.length],dp=cross2(a,b,p),dq=cross2(a,b,q),ip=dp>=-EPS,iq=dq>=-EPS;if(ip)output.push(p);if(ip!==iq){const t=dp/(dp-dq);output.push(p.map((v,k)=>v+t*(q[k]-v)));}}}return output;}
export function triangulatePolygon(polygon){
 let ps=polygon.map(p=>[...p]);if(ps.length>64)throw new Error('Polygon exceeds the 64-vertex composition envelope.');
 let changed=true;while(changed&&ps.length>3){changed=false;for(let i=0;i<ps.length;i++)if(Math.abs(cross2(ps[(i+ps.length-1)%ps.length],ps[i],ps[(i+1)%ps.length]))<EPS){ps.splice(i,1);changed=true;break;}}
 if(signedArea(ps)<0)ps.reverse();if(polygonArea(ps)<EPS)throw new Error('Polygon has no material area.');
 for(let i=0;i<ps.length;i++)for(let j=i+2;j<ps.length;j++){if(i===0&&j===ps.length-1)continue;const a=ps[i],b=ps[(i+1)%ps.length],c=ps[j],d=ps[(j+1)%ps.length];if(cross2(a,b,c)*cross2(a,b,d)<-EPS&&cross2(c,d,a)*cross2(c,d,b)<-EPS)throw new Error('Polygon crosses itself.');}
 const result=[];let budget=ps.length*ps.length;while(ps.length>3&&budget--){let found=false;for(let i=0;i<ps.length;i++){const a=ps[(i+ps.length-1)%ps.length],b=ps[i],c=ps[(i+1)%ps.length];if(cross2(a,b,c)<=EPS)continue;if(ps.some(p=>p!==a&&p!==b&&p!==c&&cross2(a,b,p)>=-EPS&&cross2(b,c,p)>=-EPS&&cross2(c,a,p)>=-EPS))continue;result.push([a,b,c]);ps.splice(i,1);found=true;break;}if(!found)throw new Error('Polygon is not a supported simple outline.');}result.push(ps);return result;
}
