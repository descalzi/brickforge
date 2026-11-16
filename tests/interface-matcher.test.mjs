import assert from "node:assert/strict";
import test from "node:test";

import { matchRequiredInterfaces } from "../docs/assets/interface-matcher.js";

const technicProfile = {
  part_id: "3701",
  nominal_connection_interfaces: [
    { interface_id: "pin-hole-1", interface_type: "technic_pin_hole", nominal_diameter_mm: 4.8, axis_vector: [0,0,1], source_primitive: "p/peghole.dat", status: "nominal_geometry_derived" },
    { interface_id: "pin-hole-2", interface_type: "technic_pin_hole", nominal_diameter_mm: 4.8, axis_vector: [0,0,1], source_primitive: "p/peghole.dat", status: "nominal_geometry_derived" },
    { interface_id: "pin-hole-3", interface_type: "technic_pin_hole", nominal_diameter_mm: 4.8, axis_vector: [0,0,1], source_primitive: "p/peghole.dat", status: "nominal_geometry_derived" },
  ],
};

test("matches source-derived Technic pin holes by type, diameter and axis", () => {
  const result = matchRequiredInterfaces([
    { interface_type: "technic_pin_hole", diameter_mm: 4.8, axis_vector: [0,0,1], count: 3 },
  ], technicProfile.nominal_connection_interfaces);
  assert.equal(result.satisfied, true);
  assert.equal(result.requirements[0].matched_count, 3);
  assert.equal(result.physical_connection_verified, false);
});

test("does not confuse pin holes with axle cross holes or wrong diameters", () => {
  const wrongType = matchRequiredInterfaces([
    { interface_type: "technic_axle_cross_hole", count: 1 },
  ], technicProfile.nominal_connection_interfaces);
  const wrongDiameter = matchRequiredInterfaces([
    { interface_type: "technic_pin_hole", diameter_mm: 6.0, count: 1 },
  ], technicProfile.nominal_connection_interfaces);
  assert.equal(wrongType.satisfied, false);
  assert.equal(wrongDiameter.satisfied, false);
});

test("requires enough distinct nominal interfaces for the requested count", () => {
  const result = matchRequiredInterfaces([
    { interface_type: "technic_pin_hole", diameter_mm: 4.8, count: 4 },
  ], technicProfile.nominal_connection_interfaces);
  assert.equal(result.satisfied, false);
  assert.equal(result.requirements[0].matched_count, 3);
});

test("rejects malformed requirements and invalid tolerance controls", () => {
  assert.throws(() => matchRequiredInterfaces([{ interface_type: "pin", count: 0 }], []), /positive count/);
  assert.throws(() => matchRequiredInterfaces([], [], { minimumAxisAlignmentCosine: 1.2 }), /valid ranges/);
});
