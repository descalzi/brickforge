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
await new Promise(resolve=>server.listen(4174,"127.0.0.1",resolve));
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage(),errors=[];
 page.on("pageerror",error=>errors.push(error.message));
 page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
 await page.goto("http://127.0.0.1:4174/designer.html?fixture=stacked-body&run=1",{waitUntil:"networkidle"});
 await page.waitForFunction(()=>document.querySelector("#engine-status")?.dataset.state==="planned",{timeout:30000});
 assert.equal(await page.locator("#engine-parts").innerText(),"4");
 assert.equal(await page.locator("#engine-connections").innerText(),"4");
 assert.equal(await page.locator("#engine-pairs").innerText(),"16");
 assert.equal(await page.locator("#download-ldraw").isEnabled(),true);
 assert.equal(await page.locator("#engine-preview rect").count(),4);
 const report=await page.locator("#engine-report").innerText();
 assert.match(report,/physical_clutch_strength/);
 assert.match(report,/not_assessed/);
 assert.equal(errors.length,0,errors.join(" | "));
 console.log(JSON.stringify({browser:"Chromium headless",fixture:"interlocked-structural-body",parts:4,connections:4,matingPairs:16,consoleErrors:errors.length}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
