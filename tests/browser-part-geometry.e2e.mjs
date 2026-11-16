import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { createReadStream, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../docs");
const mime=new Map([[".html","text/html"],[".js","text/javascript"],[".json","application/json"],[".css","text/css"],[".svg","image/svg+xml"]]);
const server=http.createServer((req,res)=>{
 let pathname;try{pathname=decodeURIComponent(new URL(req.url,"http://localhost").pathname);}catch{res.writeHead(400).end();return;}
 const target=path.resolve(root,"."+pathname);if(!target.startsWith(root+path.sep)&&target!==root){res.writeHead(403).end();return;}
 if(!existsSync(target)){res.writeHead(404).end("Not found");return;}
 res.setHeader("Content-Type",mime.get(path.extname(target))||"application/octet-stream");createReadStream(target).pipe(res);
});
await new Promise(resolve=>server.listen(4175,"127.0.0.1",resolve));
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage(),errors=[];
 page.on("pageerror",error=>errors.push(error.message));
 page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
 await page.goto("http://127.0.0.1:4175/part-geometry-lab.html?parts=3001,3739,5260,3934",{waitUntil:"networkidle"});
 await page.waitForFunction(()=>["complete","partial"].includes(document.querySelector("#status")?.dataset.state),null,{timeout:90000});
 const report=JSON.parse(await page.locator("#results").innerText());
 assert.equal(report.results.length,4);
 assert.ok(report.results.every(item=>item.status==="measured"),JSON.stringify(report.results));
 const byId=new Map(report.results.map(item=>[item.part_id,item]));
 assert.ok(byId.get("3001").triangle_count>100);
 assert.ok(byId.get("3739").dimensions_mm.width>0);
 assert.ok(byId.get("5260").dimensions_mm.height>0);
 assert.ok(byId.get("3934").dimensions_mm.depth>0);
 assert.equal(errors.length,0,errors.join(" | "));
 console.log(JSON.stringify({browser:"Chromium headless",source:report.source,parts:report.results.map(({part_id,dimensions_mm,triangle_count})=>({part_id,dimensions_mm,triangle_count}))}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
