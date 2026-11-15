import assert from "node:assert/strict";
import test from "node:test";

import { estimateBomCost, validatePriceCatalogue } from "../docs/assets/cost-estimator.js";

const bom = {
  total_parts: 7,
  items: [
    { part_id: "3001", colour_code: 4, quantity: 2 },
    { part_id: "3001", colour_code: 1, quantity: 1 },
    { part_id: "3004", colour_code: 4, quantity: 4 },
  ],
};

const prices = {
  schema_version: 1,
  currency: "GBP",
  source: "Example supplied marketplace export",
  as_of: "2026-11-14",
  prices: {
    "3001:4": { unit_price: 0.8, source: "Seller A", as_of: "2026-11-14" },
    "3001": { unit_price: 0.7, source: "Seller B", as_of: "2026-11-14" },
    "3004": { unit_price: 0.2, source: "Seller B", as_of: "2026-11-14" },
  },
};

test("price catalogue requires currency, date, source and source-attributed prices", () => {
  assert.equal(validatePriceCatalogue(prices), true);
  assert.equal(validatePriceCatalogue({ ...prices, currency: "P" }), false);
  assert.equal(validatePriceCatalogue({ ...prices, source: "" }), false);
  assert.equal(validatePriceCatalogue({ ...prices, prices: { "3001": { unit_price: 1 } } }), false);
});

test("BOM estimate uses colour-specific prices before part-level fallback", () => {
  const estimate = estimateBomCost(bom, prices);
  assert.equal(estimate.status, "complete_price_coverage");
  assert.equal(estimate.currency, "GBP");
  assert.equal(estimate.total_quantity, 7);
  assert.equal(estimate.priced_quantity, 7);
  assert.equal(estimate.known_subtotal, 2.6);
  assert.equal(estimate.estimated_total, 2.6);
  assert.equal(estimate.missing_part_count, 0);
});

test("missing part prices produce an incomplete estimate, never a fabricated total", () => {
  const incomplete = { ...prices, prices: { "3001": prices.prices["3001"] } };
  const estimate = estimateBomCost(bom, incomplete);
  assert.equal(estimate.status, "incomplete_price_coverage");
  assert.equal(estimate.estimated_total, null);
  assert.equal(estimate.missing_part_count, 1);
  assert.equal(estimate.priced_quantity, 3);
  assert.equal(estimate.coverage_fraction, 3 / 7);
});

test("invalid BOM quantities are rejected", () => {
  assert.throws(() => estimateBomCost({
    total_parts: 1, items: [{ part_id: "3001", quantity: 0 }],
  }, prices), /positive integer quantity/);
});
