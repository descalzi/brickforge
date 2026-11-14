import assert from "node:assert/strict";
import test from "node:test";

import { constructionPreviewTransform } from "../docs/assets/construction-preview.js";

const grid = {
  origin_mm: [-16, 4.8, 8],
  pitch_mm: [8, 9.6, 8],
};
const profile = {
  footprint_studs_x: 4,
  footprint_studs_z: 2,
  body_height_ldu: 24,
  stud_pitch_ldu: 20,
};
const bounds = { minX: 2, maxX: 5, minZ: 1, maxZ: 2 };

test("construction preview aligns the footprint centre and course height to the target grid", () => {
  const transform = constructionPreviewTransform({
    instance_id: "layer-00-part-000",
    translation_ldu: [0, 0, 0],
    matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  }, profile, grid, bounds, [0, 0, 0]);

  assert.deepEqual(transform.position_mm, [0, 9.6, 24]);
  assert.deepEqual(transform.size_mm, [32, 9.6, 16]);
  assert.equal(transform.course_index, 0);
  assert.equal(transform.rotation_y_rad, 0);
});

test("construction preview preserves course order and quarter-turn orientation", () => {
  const transform = constructionPreviewTransform({
    instance_id: "layer-02-part-003",
    translation_ldu: [10, -48, -10],
    matrix: [0, 0, 1, 0, 1, 0, -1, 0, 0],
  }, profile, grid, bounds, [2, 1, 3]);

  assert.deepEqual(transform.position_mm, [2, 28.2, 21]);
  assert.equal(transform.course_index, 2);
  assert.equal(transform.rotation_y_rad, Math.PI / 2);
});

test("construction preview rejects mismatched profile pitch", () => {
  assert.throws(() => constructionPreviewTransform(
    { instance_id: "layer-00-part-000", translation_ldu: [0, 0, 0], matrix: [] },
    { ...profile, stud_pitch_ldu: 16 },
    grid,
    bounds,
    [0, 0, 0],
  ), /do not match the target grid pitch/);
});

test("construction preview rejects malformed course identifiers", () => {
  assert.throws(() => constructionPreviewTransform(
    { instance_id: "part-000", translation_ldu: [0, 0, 0], matrix: [] },
    profile,
    grid,
    bounds,
    [0, 0, 0],
  ), /identify its course/);
});
