import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { interfacesForPartInstances, matchAssemblyConnectors, matchConnectorInterfaces, nominalInterfacesForInstances } from "../docs/assets/connector-matcher.js";

const catalogue=JSON.parse(await readFile(new URL("../docs/data/connector-compatibility-v1.json",import.meta.url),"utf8"));
const rules=catalogue.rules;
const partCatalogue=JSON.parse(await readFile(new URL("../docs/data/part-capabilities-v1.json",import.meta.url),"utf8"));
const pin={interface_id:"pin-end",interface_type:"technic_friction_pin",position_mm:[0,0,0],axis_vector:[1,0,0],nominal_diameter_mm:4.9};
const hole={interface_id:"beam-hole",interface_type:"technic_pin_hole",position_mm:[0,0,0],axis_vector:[0,0,1],nominal_diameter_mm:4.8};

test("nominal pin and hole interfaces match after a valid placement rotation",()=>{
 const rotation=[0,0,1,0,1,0,-1,0,0];
 const result=matchConnectorInterfaces({interface:pin,placement:{matrix:rotation,translation_mm:[10,0,0]}},{interface:hole,placement:{translation_mm:[10,0,0]}},rules);
 assert.equal(result.compatible,true);
 assert.equal(result.status,"nominal_geometry_compatible");
 assert.ok(Math.abs(result.diameter_delta_mm-0.1)<1e-9);
 assert.equal(result.physical_connection_verified,false);
});

test("connector matcher rejects non-coaxial interfaces",()=>{
 const result=matchConnectorInterfaces({interface:pin},{interface:{...hole,axis_vector:[0,1,0]}},rules);
 assert.equal(result.compatible,false);
 assert.equal(result.status,"interface_axis_mismatch");
});

test("connector matcher rejects a pin that is too large for the nominal hole",()=>{
 const result=matchConnectorInterfaces({interface:{...pin,axis_vector:[0,0,1],nominal_diameter_mm:5.5}},{interface:hole},rules);
 assert.equal(result.compatible,false);
 assert.equal(result.status,"interface_diameter_mismatch");
});

test("connector matcher refuses to guess missing diameter or unknown connector families",()=>{
 const missing=matchConnectorInterfaces({interface:{...pin,axis_vector:[0,0,1],nominal_diameter_mm:null}},{interface:hole},rules);
 assert.equal(missing.status,"interface_diameter_unknown");
 const unknown=matchConnectorInterfaces({interface:{...pin,interface_type:"ball" }},{interface:hole},rules);
 assert.equal(unknown.status,"incompatible_interface_types");
});

test("invalid connector transforms are reported rather than treated as a match",()=>{
 const result=matchConnectorInterfaces({interface:pin,placement:{matrix:[1,2],translation_mm:[0,0,0]}},{interface:hole},rules);
 assert.equal(result.compatible,false);
 assert.equal(result.status,"invalid_interface_geometry");
});

test("source-derived Technic beam interfaces can be lifted into positioned assembly instances", async()=>{
 const specialised=JSON.parse(await readFile(new URL("../docs/data/specialised-technic-part-catalogue.json",import.meta.url),"utf8"));
 const interfaces=nominalInterfacesForInstances(specialised,[{instance_id:"beam-a",part_id:"3701"}]);
 assert.equal(interfaces.length,3);
 assert.ok(interfaces.every(item=>item.interface_type==="technic_pin_hole"));
 assert.ok(interfaces.every(item=>item.nominal_diameter_mm===4.8));
 assert.ok(interfaces.every(item=>item.evidence_status==="nominal_geometry_derived"));
});

test("assembly connector matcher aligns a nominal pin candidate to a source-derived Technic beam hole",async()=>{
 const specialised=JSON.parse(await readFile(new URL("../docs/data/specialised-technic-part-catalogue.json",import.meta.url),"utf8"));
 const holes=nominalInterfacesForInstances(specialised,[{instance_id:"beam",part_id:"3701"}]);
 const pin={instance_id:"pin",part_id:"synthetic-technic-pin",interface_id:"pin-end",interface_type:"technic_friction_pin",position_mm:[0,4,0],axis_vector:[0,0,-1],nominal_diameter_mm:4.9};
 const placements={pin:{translation_mm:[-8,0,0]}};
 const matches=matchAssemblyConnectors([...holes,pin],rules,placements);
 assert.equal(matches.length,1);
 assert.equal(matches[0].instance_male,"pin");
 assert.equal(matches[0].instance_female,"beam");
 assert.equal(matches[0].physical_connection_verified,false);
});

test("actual LDraw Technic beam and friction-pin datums produce a nominal connector match",()=>{
 const interfaces=interfacesForPartInstances(partCatalogue,[{instance_id:"beam-a",part_id:"3701"},{instance_id:"beam-b",part_id:"3701"},{instance_id:"pin",part_id:"2780"}]);
 const rotation=[0,0,1,0,1,0,-1,0,0];
 const matches=matchAssemblyConnectors(interfaces,rules,{ "beam-a":{matrix:rotation,translation_mm:[0,0,0]},"beam-b":{matrix:rotation,translation_mm:[8,0,0]},pin:{translation_mm:[4,4,0]}});
 assert.equal(matches.length,2);
 assert.ok(matches.every(match=>match.instance_male==="pin"));
 assert.deepEqual(new Set(matches.map(match=>match.instance_female)),new Set(["beam-a","beam-b"]));
 assert.ok(matches.every(match=>match.physical_connection_verified===false));
 assert.ok(matches.every(match=>Math.abs(match.diameter_delta_mm-0.1)<1e-9));
});
