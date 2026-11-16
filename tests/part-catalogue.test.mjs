import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { discoverPartCandidates, validatePartCapabilityCatalogue } from "../docs/assets/part-catalogue.js";

const catalogue=JSON.parse(await readFile(new URL("../docs/data/part-capabilities-v1.json",import.meta.url),"utf8"));

test("source-backed part capability catalogue validates with unique identities",()=>{
 assert.equal(validatePartCapabilityCatalogue(catalogue).valid,true);
 const duplicate=structuredClone(catalogue);duplicate.parts.push(structuredClone(duplicate.parts[0]));
 assert.equal(validatePartCapabilityCatalogue(duplicate).valid,false);
});

test("semantic discovery finds the exact Technic beam for a beam requirement",()=>{
 const result=discoverPartCandidates({role:"beam",required_capabilities:["technic_pin_holes"],dimensions_mm:{width:32,depth:8,height:9.6}},catalogue,{maxDimensionErrorMm:0.01});
 assert.equal(result.status,"candidates_found");
 assert.equal(result.candidates[0].part_id,"3701");
 assert.equal(result.candidates[0].dimension_error_mm,0);
 assert.equal(result.candidates[0].interfaces.length,3);
});

test("semantic discovery does not invent wheels from structural brick geometry",()=>{
 const result=discoverPartCandidates({role:"wheel"},catalogue);
 assert.equal(result.status,"no_candidates");
 assert.deepEqual(result.candidates,[]);
});

test("reference-only parts are excluded unless explicitly requested",()=>{
 const defaultResult=discoverPartCandidates({role:"axle_connector_candidate"},catalogue);
 assert.equal(defaultResult.status,"no_candidates");
 const diagnostic=discoverPartCandidates({role:"axle_connector_candidate"},catalogue,{includeReferenceOnly:true});
 assert.equal(diagnostic.candidates[0].part_id,"32064a");
 assert.equal(diagnostic.candidates[0].candidate_status,"reference_only");
});

test("dimension limits and required capabilities constrain discovery",()=>{
 const tooSmall=discoverPartCandidates({role:"beam",dimensions_mm:{width:32,depth:8,height:9.6}},catalogue,{maxDimensionErrorMm:0.01});
 assert.equal(tooSmall.candidates[0].part_id,"3701");
 const unsupported=discoverPartCandidates({role:"beam",required_capabilities:["rotating_wheel"],dimensions_mm:{width:32,depth:8,height:9.6}},catalogue);
 assert.equal(unsupported.status,"no_candidates");
});

test("specialist wheel, window, slope and wing parts are indexed but not promoted to buildable geometry",()=>{
 const wheels=discoverPartCandidates({role:"wheel"},catalogue,{includeReferenceOnly:true});
 const windows=discoverPartCandidates({role:"window"},catalogue,{includeReferenceOnly:true});
 const slopes=discoverPartCandidates({role:"slope"},catalogue,{includeReferenceOnly:true});
 const wings=discoverPartCandidates({role:"wing"},catalogue,{includeReferenceOnly:true});
 assert.ok(wheels.candidates.some(part=>part.part_id==="3739"));
 assert.ok(windows.candidates.some(part=>part.part_id==="5260"));
 assert.ok(slopes.candidates.some(part=>part.part_id==="3039"));
 assert.ok(wings.candidates.some(part=>part.part_id==="3934"));
 assert.ok([...wheels.candidates,...windows.candidates,...slopes.candidates,...wings.candidates].every(part=>part.candidate_status==="reference_only"&&part.dimensions_mm===null));
});
