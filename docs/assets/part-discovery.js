const ROLE_TERMS = Object.freeze({
  wheel: ["wheel", "tyre", "tire", "rim"],
  tyre: ["tyre", "tire", "wheel"],
  window: ["window", "windscreen", "windshield", "glazing"],
  door: ["door", "hatch"],
  roof: ["roof", "slope", "curved", "wedge"],
  slope: ["slope", "wedge", "curved"],
  wing: ["wing", "wedge", "airfoil"],
  axle: ["axle"],
  pin: ["technic pin", "pin"],
  connector: ["connector", "technic", "pin", "axle"],
  hinge: ["hinge"],
  clip: ["clip"],
  panel: ["panel"],
  plate: ["plate"],
  brick: ["brick"],
  tile: ["tile"],
});

function normalise(value) {
  return String(value || "").toLocaleLowerCase().replace(/[_-]+/g, " ").trim();
}

function partText(part) {
  return [
    part.name,
    part.description,
    part.category,
    ...(Array.isArray(part.keywords) ? part.keywords : []),
  ].map(normalise).filter(Boolean);
}

/**
 * Discovers catalogue candidates for a semantic role without confusing a text
 * match with geometric or physical suitability. Only parts with an authored
 * connection profile are currently eligible for the existing placement engine.
 */
export function discoverPartsForRole(role, partCatalogue, connectionCatalogue, options = {}) {
  if (typeof role !== "string" || !role.trim()) throw new TypeError("role must be a non-empty string.");
  if (!Array.isArray(partCatalogue)) throw new TypeError("partCatalogue must be an array.");
  const key = normalise(role);
  const terms = options.synonyms || ROLE_TERMS[key] || [key];
  const profileIds = new Set((connectionCatalogue?.profiles || []).map((profile) => String(profile.part_id)));
  const limit = options.limit ?? 30;
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("limit must be a positive integer.");

  const ranked = [];
  for (const part of partCatalogue) {
    if (!part || typeof part.part_id !== "string") continue;
    const fields = partText(part);
    const matches = [];
    let score = 0;
    for (const termValue of terms) {
      const term = normalise(termValue);
      if (!term) continue;
      const exactCategory = normalise(part.category) === term;
      const exactKeyword = (part.keywords || []).some((keyword) => normalise(keyword) === term);
      const nameMatch = [part.name, part.description].some((value) => {
        const text = normalise(value);
        return text === term || text.startsWith(term + " ") || text.includes(term);
      });
      const broadMatch = fields.some((field) => field.includes(term));
      if (!broadMatch) continue;
      const contribution = (exactCategory ? 120 : 0)
        + (exactKeyword ? 100 : 0)
        + (nameMatch ? 60 : 0)
        + (broadMatch ? 10 : 0);
      score += contribution;
      matches.push({ term, exact_category: exactCategory, exact_keyword: exactKeyword, name_match: nameMatch });
    }
    if (!matches.length) continue;
    const hasConnectionProfile = profileIds.has(part.part_id);
    ranked.push({
      part_id: part.part_id,
      name: part.name || part.description || part.part_id,
      category: part.category || null,
      filename: part.filename || null,
      score,
      matched_terms: matches,
      connection_profile_available: hasConnectionProfile,
      planner_eligible: hasConnectionProfile,
      geometry_inspection_required: true,
      suitability_status: hasConnectionProfile
        ? "profiled_candidate_requires_geometry_and_interface_review"
        : "catalogue_candidate_only_not_yet_plannable",
    });
  }
  ranked.sort((a, b) => b.score - a.score || a.part_id.localeCompare(b.part_id, undefined, { numeric: true }));
  return {
    role: key,
    query_terms: [...terms],
    candidate_count: ranked.length,
    planner_ready_count: ranked.filter((candidate) => candidate.planner_eligible).length,
    candidates: ranked.slice(0, limit),
    limitations: [
      "Name/category/keyword matches are discovery evidence, not proof that a part performs the requested function.",
      "The searchable index does not contain resolved 3D geometry or complete connection interfaces.",
      "Only candidates with an authored connection profile can enter the current nominal placement engine.",
      "A connection profile does not certify clutch force, strength, stability or legal building technique.",
    ],
  };
}

export function supportedSemanticPartRoles() {
  return Object.keys(ROLE_TERMS);
}
