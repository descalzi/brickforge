// Use the exported bill of materials for quantities and the canonical sequence for picking order.
export function buildInventory(plan) {
  const partsByInstance = new Map(plan.parts.map(part => [part.instance_id, part]));
  const firstStep = new Map();
  const key = (id, colour) => JSON.stringify([id, colour]);
  for (const step of plan.instructions.steps) {
    for (const id of step.parts) {
      const part = partsByInstance.get(id);
      const group = key(part.part_id, part.colour_code ?? part.colour);
      if (!firstStep.has(group)) firstStep.set(group, step.step);
    }
  }
  return plan.bom.items.map(item => ({
    ...item, first_step: firstStep.get(key(item.part_id, item.colour_code))
  })).sort((a, b) => a.first_step - b.first_step);
}

export function inventoryCsv(rows) {
  const lines = ["LDraw part,LDraw colour,Quantity,First step"];
  for (const row of rows) {
    lines.push([row.part_id, row.colour_code, row.quantity, row.first_step].join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
