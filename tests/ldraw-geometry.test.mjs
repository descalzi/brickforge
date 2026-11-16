import assert from "node:assert/strict";
import test from "node:test";

import { createLDrawGeometryResolver, scoreGeometrySuitability } from "../docs/assets/ldraw-geometry.js";

const sha = "c70360d1c588be894997b2168c61909bc8058c4d";
const catalogue = { source: { geometry_base_url: "https://raw.githubusercontent.com/kulits/ldraw-parts/" + sha + "/ldraw/" } };
const partIndex = { parts: [{ part_id: "testpart", filename: "parts/testpart.dat" }] };

function fakeFetch(files) {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    const path = url.split("/ldraw/")[1];
    if (!(path in files)) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => files[path] };
  };
  fetchImpl.requested = requested;
  return fetchImpl;
}

test("resolves nested LDraw part and primitive geometry into transformed dimensions", async () => {
  const fetchImpl = fakeFetch({
    "parts/testpart.dat": [
      "0 Name: Test part",
      "1 16 10 0 0 1 0 0 0 1 0 0 0 1 s/testparts01.dat",
    ].join("\n"),
    "parts/s/testparts01.dat": [
      "0 Name: Test subpart",
      "3 16 0 0 0 10 0 0 0 10 0",
      "1 16 0 0 0 1 0 0 0 1 0 0 0 1 primitive.dat",
    ].join("\n"),
    "p/primitive.dat": "3 16 0 0 0 0 10 0 0 0 10",
  });
  const resolver = createLDrawGeometryResolver(catalogue, { fetchImpl });
  const report = await resolver.resolvePart("testpart", partIndex, { includeTrianglePositions: true });
  assert.equal(report.part_id, "testpart");
  assert.equal(report.triangle_count, 2);
  assert.deepEqual(report.dimensions_mm, [4, 4, 4]);
  assert.equal(report.bounding_box_volume_mm3, 64);
  assert.equal(report.surface_area_mm2, 16);
  assert.equal(report.geometry_status, "resolved_ldraw_surface");
  assert.equal(report.triangle_positions_mm.length, 18);
  assert.ok(fetchImpl.requested.some((url) => url.endsWith("/p/primitive.dat")));
});

test("uses the best axis permutation when scoring part envelope suitability", () => {
  const report = scoreGeometrySuitability(
    { part_id: "wheel", dimensions_mm: [12, 8, 12] },
    [8, 12, 12],
    { maxRelativeError: 0.01 },
  );
  assert.equal(report.within_dimension_tolerance, true);
  assert.equal(report.mean_relative_error, 0);
  assert.deepEqual(report.orientation_permutation, [1, 0, 2]);
});

test("rejects unpinned geometry sources and invalid target envelopes", () => {
  assert.throws(() => createLDrawGeometryResolver({ source: { geometry_base_url: "https://example.com/ldraw/" } }), /pinned/);
  assert.throws(() => scoreGeometrySuitability({ dimensions_mm: [1, 2, 3] }, [1, 0, 3]), /positive dimensions/);
  assert.throws(() => scoreGeometrySuitability({ dimensions_mm: [1, 2, 3] }, [1,2,3], { orientationPermutation: [0,0,2] }), /permutation/);
});

test("detects cyclic nested references instead of recursing indefinitely", async () => {
  const fetchImpl = fakeFetch({
    "parts/testpart.dat": "1 16 0 0 0 1 0 0 0 1 0 0 0 1 s/testparts01.dat",
    "parts/s/testparts01.dat": "1 16 0 0 0 1 0 0 0 1 0 0 0 1 parts/testpart.dat",
  });
  const resolver = createLDrawGeometryResolver(catalogue, { fetchImpl });
  await assert.rejects(() => resolver.resolvePart("testpart", partIndex), /Cyclic LDraw reference/);
});

test("rejects unsafe root catalogue paths before any fetch", async () => {
  const fetchImpl = fakeFetch({});
  const resolver = createLDrawGeometryResolver(catalogue, { fetchImpl });
  const unsafeIndex = { parts: [{ part_id: "testpart", filename: "parts/../../outside.dat" }] };
  await assert.rejects(() => resolver.resolvePart("testpart", unsafeIndex), /safe top-level path/);
  assert.equal(fetchImpl.requested.length, 0);
});
