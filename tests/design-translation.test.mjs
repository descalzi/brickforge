import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { translateComponentRequirements, validateDesignTranslationMap } from "../docs/assets/design-translation.js";
const mapping=JSON.parse(await readFile(new URL("../docs/data/design-translation-v1.json",import.meta.url),"utf8"));
test("semantic component roles translate without adding LEGO part IDs to design intent",()=>{
 const result=translateComponentRequirements({role:"chassis",required_features:[],forbidden_features:[]},mapping);
 assert.equal(result.valid,true);
 assert.deepEqual(result.part_roles,["chassis","structural"]);
 assert.deepEqual(result.required_capabilities,[]);
});
test("generic object features map to candidate capabilities in a separate translation layer",()=>{
 const result=translateComponentRequirements({role:"beam",required_features:["pin_joint"],forbidden_features:[]},mapping);
 assert.equal(result.valid,true);
 assert.deepEqual(result.required_capabilities,["technic_pin_holes"]);
});
test("unknown semantic features are reported instead of being silently ignored",()=>{
 const result=translateComponentRequirements({role:"wheel",required_features:["suspension_geometry"],forbidden_features:[]},mapping);
 assert.equal(result.valid,false);
 assert.match(result.errors[0],/No catalogue translation exists/);
});
test("unknown semantic roles are reported explicitly",()=>{
 const result=translateComponentRequirements({role:"ornament",required_features:[],forbidden_features:[]},mapping);
 assert.equal(result.valid,false);
 assert.match(result.errors[0],/No part-role translation exists/);
});

test("design translation map rejects malformed role and feature entries",()=>{
 const invalid=structuredClone(mapping);invalid.roles.chassis=[];invalid.features.pin_joint.required_capabilities="technic_pin_holes";
 assert.equal(validateDesignTranslationMap(invalid).valid,false);
});
