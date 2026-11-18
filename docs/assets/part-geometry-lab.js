import { loadLDrawPartSurface } from "./ldraw-surface-loader.js?v=10525c583bbb";
const status=document.querySelector("#status"),output=document.querySelector("#results");
const ids=(new URLSearchParams(location.search).get("parts")||"3001,3739,35,3486,6600,39367,5260,2493b,3039,3934,3545,2780,3701").split(",").map(value=>value.trim()).filter(Boolean);
async function run(){
 const results=await Promise.all(ids.map(async partId=>{
  try{
   const geometry=await loadLDrawPartSurface(partId);
   const [minimum,maximum]=geometry.bounds_mm;
   return {part_id:partId,status:"measured",dimensions_mm:{width:maximum[0]-minimum[0],height:maximum[1]-minimum[1],depth:maximum[2]-minimum[2]},bounds_mm:geometry.bounds_mm,triangle_count:geometry.triangle_count,source_files:geometry.source_files};
  }catch(error){return {part_id:partId,status:"error",error:error.message};}
 }));
 const failed=results.filter(item=>item.status!=="measured");
 output.textContent=JSON.stringify({schema_version:1,source:"LDraw.org Parts Library",mirror_commit:"c70360d1c588be894997b2168c61909bc8058c4d",results},null,2);
 status.dataset.state=failed.length?"partial":"complete";
 status.textContent=failed.length?failed.length+" part geometry measurement(s) failed.":"Measured "+results.length+" parts from recursive LDraw geometry.";
}
run();
