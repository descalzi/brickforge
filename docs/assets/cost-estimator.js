export function validatePriceCatalogue(catalogue) {
  if (!catalogue || catalogue.schema_version !== 1
      || typeof catalogue.currency !== "string" || !/^[A-Z]{3}$/.test(catalogue.currency)
      || typeof catalogue.source !== "string" || !catalogue.source.trim()
      || typeof catalogue.as_of !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(catalogue.as_of)
      || !catalogue.prices || typeof catalogue.prices !== "object" || Array.isArray(catalogue.prices)) {
    return false;
  }
  return Object.entries(catalogue.prices).every(([key, entry]) =>
    key.length > 0
    && entry && Number.isFinite(entry.unit_price) && entry.unit_price >= 0
    && typeof entry.source === "string" && entry.source.trim().length > 0
    && typeof entry.as_of === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entry.as_of)
  );
}

export function estimateBomCost(bom, catalogue) {
  if (!bom || !Array.isArray(bom.items) || !validatePriceCatalogue(catalogue)) {
    throw new TypeError("A valid BOM and source-attributed price catalogue are required.");
  }
  let knownSubtotal = 0;
  let pricedQuantity = 0;
  const missing = [];
  const lineItems = [];
  for (const item of bom.items) {
    if (!item || typeof item.part_id !== "string"
        || !Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      throw new TypeError("BOM items require a part ID and positive integer quantity.");
    }
    const colourKey = item.part_id + ":" + item.colour_code;
    const price = catalogue.prices[colourKey] || catalogue.prices[item.part_id];
    if (!price) {
      missing.push({ part_id: item.part_id, colour_code: item.colour_code, quantity: item.quantity });
      continue;
    }
    const lineTotal = price.unit_price * item.quantity;
    knownSubtotal += lineTotal;
    pricedQuantity += item.quantity;
    lineItems.push({
      part_id: item.part_id,
      colour_code: item.colour_code,
      quantity: item.quantity,
      unit_price: price.unit_price,
      line_total: lineTotal,
      source: price.source,
      as_of: price.as_of,
    });
  }
  return {
    schema_version: 1,
    currency: catalogue.currency,
    price_source: catalogue.source,
    price_as_of: catalogue.as_of,
    total_quantity: bom.total_parts ?? bom.items.reduce((sum, item) => sum + item.quantity, 0),
    priced_quantity: pricedQuantity,
    missing_part_count: missing.length,
    coverage_fraction: bom.total_parts
      ? pricedQuantity / bom.total_parts
      : 0,
    known_subtotal: Number(knownSubtotal.toFixed(2)),
    estimated_total: missing.length ? null : Number(knownSubtotal.toFixed(2)),
    status: missing.length ? "incomplete_price_coverage" : "complete_price_coverage",
    line_items: lineItems,
    missing,
    limitations: [
      "Prices are only as current and representative as the imported source catalogue.",
      "Shipping, taxes, seller minimums, availability, condition differences and multi-seller basket effects are not included.",
      "A part-only price is used when no colour-specific part_id:colour_code entry exists.",
    ],
  };
}
