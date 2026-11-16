import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { planDesign } from "../docs/assets/design-engine.js";
import { worldBodyBounds } from "../docs/assets/specialist-placement.js";
import { validateDesignSpec } from "../docs/assets/design-spec.js";
const read=async p=>JSON.parse(await readFile(new URL("../docs/data/"+p,import.meta.url)));
const catalogue=await read("connection-profiles/basic-bricks.json"),fixtures=await read("design-spec-fixtures.json");
const options={partCatalogue:await read("part-capabilities-v1.json"),designTranslation:await read("design-translation-v1.json"),specialistCatalogue:await read("specialist-profiles-v1.json")};
const profileMap=new Map([...catalogue.profiles,...options.specialistCatalogue.profiles].map(p=>[p.part_id,p]));
function bounds(part){const p=profileMap.get(part.part_id);if(p.body_vertices_mm)return worldBodyBounds(part,p);const rotated=Math.abs(part.matrix[0])<.5,w=(rotated?p.footprint_studs_z:p.footprint_studs_x)*8,d=(rotated?p.footprint_studs_x:p.footprint_studs_z)*8,h=p.body_height_ldu*.4,[x,y,z]=[part.translation_ldu[0]*.4,-part.translation_ldu[1]*.4,-part.translation_ldu[2]*.4];return {min:[x-w/2,y-h,z-d/2],max:[x+w/2,y,z+d/2]};}
for(const spec of fixtures.fixtures)test("studio brief constructs with actual nominal body clearances: "+spec.design_id,()=>{
 const plan=planDesign(spec,catalogue,options);assert.equal(plan.status,"planned",plan.failures?.join(" "));
 assert.equal(plan.bom.items.reduce((n,p)=>n+p.quantity,0),plan.parts.length);assert.equal(plan.ldraw.split("\n").filter(line=>line.startsWith("1 ")).length,plan.parts.length);
 for(const part of plan.parts){
  const actual=bounds(part),c=spec.components.find(c=>c.id===part.component_id),p=c.position_mm,d=c.dimensions_mm;
  const lo=[p.x,p.y,p.z],hi=[p.x+d.width,p.y+d.height,p.z+d.depth];
  assert.ok(actual.min.every((v,i)=>v>=lo[i]-1e-6)&&actual.max.every((v,i)=>v<=hi[i]+1e-6),"part outside semantic volume: "+part.instance_id);
  for(const space of spec.negative_spaces||[]){const p=space.position_mm,d=space.dimensions_mm,lo=[p.x,p.y,p.z],hi=[p.x+d.width,p.y+d.height,p.z+d.depth];assert.ok(![0,1,2].every(i=>Math.min(actual.max[i],hi[i])-Math.max(actual.min[i],lo[i])>1e-6),"part body intersects "+space.id);}
 }
});
test("partial-cell keepouts are rejected instead of silently filled",()=>{const spec=structuredClone(fixtures.fixtures[1]);spec.negative_spaces[0].position_mm.x+=1;const plan=planDesign(spec,catalogue,options);assert.equal(plan.status,"blocked");assert.match(plan.failures[0],/partial grid cell/);});
test("invalid empty-space input fails validation",()=>{for(const spaces of [[null],[{id:"x"}],{},[{...fixtures.fixtures[1].negative_spaces[0],id:"wall"}]]){const spec=structuredClone(fixtures.fixtures[1]);spec.negative_spaces=spaces;assert.equal(validateDesignSpec(spec).valid,false);}});
test("browser envelope prevents unbounded allocation",()=>{const spec=structuredClone(fixtures.fixtures[0]);spec.components[0].dimensions_mm.width=80000;const plan=planDesign(spec,catalogue,options);assert.equal(plan.status,"blocked");assert.match(plan.failures[0],/search envelope/);});
test("decimal millimetre courses use a numeric tolerance",()=>{const spec=structuredClone(fixtures.fixtures[0]);spec.components[0].dimensions_mm.height=28.8;const plan=planDesign(spec,catalogue,options);assert.equal(plan.status,"planned",plan.failures?.join(" "));});
test("attached_to requires direct component mating, even if the global graph connects through a third component",()=>{
 const spec=structuredClone(fixtures.fixtures[0]),template=spec.components[0];
 spec.components=[{...template,id:"left",dimensions_mm:{width:16,depth:16,height:9.6},position_mm:{x:0,y:0,z:0}},{...template,id:"right",dimensions_mm:{width:16,depth:16,height:9.6},position_mm:{x:16,y:0,z:0}},{...template,id:"bridge",dimensions_mm:{width:32,depth:16,height:19.2},position_mm:{x:0,y:9.6,z:0}}];
 assert.equal(planDesign(spec,catalogue,options).status,"planned");spec.relationships=[{type:"attached_to",from:"left",to:"right"}];assert.equal(planDesign(spec,catalogue,options).status,"blocked");
});
