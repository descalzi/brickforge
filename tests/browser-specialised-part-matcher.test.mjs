import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  matchNominalConnectionInterfaces,
  validateCuratedSpecialisedCatalogue,
  validateSpecialisedSurfaceCandidate,
} from "../docs/assets/specialised-part-matcher.js";

const catalogue = JSON.parse(
  await readFile(new URL("../docs/data/specialised-technic-part-catalogue.json", import.meta.url), "utf8"),
);

const target = {
  id: "opening-z-1",
  axis: "z",
  shape: "round opening",
  equivalent_diameter_mm: 4.8,
  width_mm: 3.2,
};

test("curated Technic seed catalogue is source-verified and keeps measured voids separate", () => {
  assert.equal(validateCuratedSpecialisedCatalogue(catalogue), true);
  assert.ok(catalogue.profiles.every((profile) => Array.isArray(profile.measured_opening_profiles)));
  assert.ok(catalogue.profiles.every((profile) => Array.isArray(profile.nominal_connection_interfaces)));
  assert.ok(catalogue.profiles.find((profile) => profile.part_id === "3700").nominal_connection_interfaces
    .some((iface) => iface.source_primitive === "p/peghole.dat"));
});

test("nominal interface matcher identifies source-derived Technic pin-hole dimensions", () => {
  const sourceProfile = catalogue.profiles.find((profile) => profile.part_id === "3700");
  const matches = matchNominalConnectionInterfaces([target], [{
    part_id: sourceProfile.part_id,
    description: sourceProfile.description,
    source_verified_catalogue_entry: sourceProfile,
    source_library_commit: catalogue.source_library.commit,
  }]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].interface_type, "technic_pin_hole");
  assert.equal(matches[0].nominal_diameter_mm, 4.8);
  assert.equal(matches[0].status, "nominal_interface_geometry_match");
  assert.equal(matches[0].physical_clutch_verified, false);
  assert.equal(matches[0].source_commit, catalogue.source_library.commit);
});

test("nominal interface matcher rejects incompatible opening dimensions", () => {
  const sourceProfile = catalogue.profiles.find((profile) => profile.part_id === "3700");
  const matches = matchNominalConnectionInterfaces([{ ...target, equivalent_diameter_mm: 6.0 }], [{
    part_id: sourceProfile.part_id,
    source_verified_catalogue_entry: sourceProfile,
  }]);
  assert.deepEqual(matches, []);
});

test("detailed surface validation remains distinct from nominal interface validation", () => {
  const sourceProfile = catalogue.profiles.find((profile) => profile.part_id === "3700");
  const profile = {
    part_id: "3700",
    mesh_positions_mm: [0, 0, 0, 10, 0, 0, 0, 10, 0],
    source_verified_catalogue_entry: sourceProfile,
  };
  const result = validateSpecialisedSurfaceCandidate(
    profile,
    profile.mesh_positions_mm,
    profile.mesh_positions_mm,
  );
  assert.equal(result.detailed_surface_check, true);
  assert.equal(result.physical_connection_verified, false);
  assert.equal(result.surface_score, 1);
});
