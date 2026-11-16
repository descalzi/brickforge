import { matchRequiredInterfaces } from "./interface-matcher.js";
import { scoreGeometrySuitability } from "./ldraw-geometry.js";

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
  beam: ["beam", "bar", "technic"],
  "structural-beam": ["beam", "bar", "technic"],
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
  const specialisedProfiles = new Map((options.specialisedCatalogue?.profiles || [])
    .map((profile) => [String(profile.part_id), profile]));
  const limit = options.limit ?? 30;
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("limit must be a positive integer.");

  const ranked = [];
  for (const part of partCatalogue) {
    if (!part || typeof part.part_id !== "string") continue;
    const specialisedProfile = specialisedProfiles.get(String(part.part_id)) || null;
    const fields = [...partText(part), normalise(specialisedProfile?.description)];
    const matches = [];
    let score = 0;
    for (const termValue of terms) {
      const term = normalise(termValue);
      if (!term) continue;
      const exactCategory = normalise(part.category) === term;
      const exactKeyword = (part.keywords || []).some((keyword) => normalise(keyword) === term);
      const nameMatch = [part.name, part.description, specialisedProfile?.description].some((value) => {
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
    const hasConnectionProfile = profileIds.has(String(part.part_id));
    ranked.push({
      part_id: part.part_id,
      name: part.name || part.description || specialisedProfile?.description || part.part_id,
      category: part.category || null,
      filename: part.filename || null,
      score,
      matched_terms: matches,
      connection_profile_available: hasConnectionProfile,
      specialised_interface_profile_available: Boolean(specialisedProfile),
      specialised_interfaces: specialisedProfile?.nominal_connection_interfaces || [],
      specialised_dimensions_mm: specialisedProfile?.dimensions_mm || null,
      planner_eligible: false,
      geometry_inspection_required: true,
      suitability_status: hasConnectionProfile
        ? "profile_available_geometry_and_interface_checks_required"
        : specialisedProfile
          ? "specialised_interfaces_available_geometry_and_assembly_checks_required"
          : "catalogue_candidate_only_not_yet_plannable",
    });
  }
  ranked.sort((a, b) => b.score - a.score || a.part_id.localeCompare(b.part_id, undefined, { numeric: true }));
  return {
    role: key,
    query_terms: [...terms],
    candidate_count: ranked.length,
    profiled_candidate_count: ranked.filter((candidate) => candidate.connection_profile_available || candidate.specialised_interface_profile_available).length,
    planner_ready_count: 0,
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

/**
 * Resolve and rank a bounded set of semantic candidates against measured target
 * dimensions. This is still candidate generation: a profile and size match must
 * be followed by full mating-interface and assembly validation.
 */
export async function rankPartCandidatesWithGeometry(discovery, geometryResolver, partIndex, targetDimensionsMm, options = {}) {
  if (!discovery || !Array.isArray(discovery.candidates)) {
    throw new TypeError("discovery must contain a candidate array.");
  }
  if (!geometryResolver || typeof geometryResolver.resolvePart !== "function") {
    throw new TypeError("geometryResolver must expose resolvePart().");
  }
  const maxCandidates = options.maxCandidates ?? 12;
  const concurrency = options.concurrency ?? 4;
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1
      || !Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("maxCandidates and concurrency must be positive integers.");
  }
  scoreGeometrySuitability({ dimensions_mm: [1, 1, 1] }, targetDimensionsMm, options);
  if (options.requiredInterfaces !== undefined) {
    matchRequiredInterfaces(options.requiredInterfaces, [], options.interfaceMatchOptions);
  }
  const selected = discovery.candidates.slice(0, maxCandidates);
  const results = new Array(selected.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= selected.length) return;
      const candidate = selected[index];
      try {
        const geometry = await geometryResolver.resolvePart(candidate.part_id, partIndex);
        const semanticScore = discovery.candidates[0]?.score
          ? 100 * candidate.score / discovery.candidates[0].score
          : 0;
        const hasRequiredInterfaces = Array.isArray(options.requiredInterfaces) && options.requiredInterfaces.length > 0;
        const permutations = hasRequiredInterfaces
          ? [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]
          : [undefined];
        let best = null;
        for (const orientationPermutation of permutations) {
          const fit = scoreGeometrySuitability(geometry, targetDimensionsMm, {
            ...options,
            orientationPermutation,
          });
          const interfaceMatch = hasRequiredInterfaces
            ? matchRequiredInterfaces(options.requiredInterfaces, candidate.specialised_interfaces || [], {
              ...(options.interfaceMatchOptions || {}),
              orientationPermutation: fit.orientation_permutation,
              geometryCenterMm: options.interfaceMatchOptions?.geometryCenterMm
                || (geometry.bounds_mm?.minimum && geometry.bounds_mm?.maximum
                  ? geometry.bounds_mm.minimum.map((value, axis) => (value + geometry.bounds_mm.maximum[axis]) / 2)
                  : [0, 0, 0]),
            })
            : null;
          const specialisedInterfaceCandidate = Boolean(
            interfaceMatch?.satisfied && candidate.specialised_interface_profile_available
              && fit.within_dimension_tolerance,
          );
          const combinedScore = fit.score * 0.75 + semanticScore * 0.25
            + (specialisedInterfaceCandidate ? 15 : 0);
          if (!best || combinedScore > best.combinedScore
              || (combinedScore === best.combinedScore
                && specialisedInterfaceCandidate && !best.specialisedInterfaceCandidate)) {
            best = { fit, interfaceMatch, specialisedInterfaceCandidate, combinedScore };
          }
        }
        const { fit, interfaceMatch, specialisedInterfaceCandidate, combinedScore } = best;
        results[index] = {
          ...candidate,
          geometry_status: "resolved",
          geometry_dimensions_mm: geometry.dimensions_mm,
          geometry_fit: fit,
          specialised_interface_match: interfaceMatch,
          specialised_interface_candidate: specialisedInterfaceCandidate,
          combined_score: combinedScore,
          nominal_placement_candidate: candidate.connection_profile_available
            && fit.within_dimension_tolerance,
          requires_connection_validation: true,
          suitability_status: specialisedInterfaceCandidate
            ? "geometry_and_specialised_interfaces_match_requires_assembly_validation"
            : candidate.connection_profile_available && fit.within_dimension_tolerance
              ? "dimensions_fit_profile_available_requires_interface_validation"
              : candidate.connection_profile_available
                ? "profile_available_but_dimensions_outside_tolerance"
                : interfaceMatch && !interfaceMatch.satisfied
                  ? "required_specialised_interfaces_not_satisfied"
                  : "geometry_ranked_only_not_yet_plannable",
        };
      } catch (error) {
        results[index] = {
          ...candidate,
          geometry_status: "unavailable",
          geometry_error: error instanceof Error ? error.message : String(error),
          combined_score: 0,
          nominal_placement_candidate: false,
          requires_connection_validation: true,
          suitability_status: "geometry_unavailable",
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, worker));
  results.sort((a, b) => b.combined_score - a.combined_score
    || a.part_id.localeCompare(b.part_id, undefined, { numeric: true }));
  return {
    role: discovery.role,
    target_dimensions_mm: [...targetDimensionsMm],
    candidate_count: selected.length,
    geometry_resolved_count: results.filter((item) => item.geometry_status === "resolved").length,
    nominal_placement_candidate_count: results.filter((item) => item.nominal_placement_candidate).length,
    candidates: results,
    limitations: [
      "Semantic and bounding-dimension ranking narrows candidates; it does not establish surface-shape equivalence.",
      "Nominal placement candidates still require exact connection-interface validation and global assembly planning.",
      "A part with a connection profile may still be unsuitable in the required orientation or structural context.",
    ],
  };
}

/**
 * End-to-end candidate ranking for one semantic component from Design Specification v1.
 * This selects candidates only; it deliberately does not claim to place or assemble them.
 */
export async function rankDesignComponentCandidates(component, partIndex, connectionCatalogue, specialisedCatalogue, geometryResolver, options = {}) {
  if (!component || typeof component.role !== "string" || !component.geometry
      || component.geometry.type !== "orthogonal_prism") {
    throw new TypeError("A semantic component with an orthogonal_prism geometry is required.");
  }
  if (!Array.isArray(partIndex?.parts)) throw new TypeError("partIndex.parts must be an array.");
  const targetDimensionsMm = options.targetDimensionsMm || [
    component.geometry.width_studs * 8,
    component.height_courses * 9.6,
    component.geometry.depth_studs * 8,
  ];
  const discovery = discoverPartsForRole(component.role, partIndex.parts, connectionCatalogue, {
    specialisedCatalogue,
    synonyms: options.synonyms,
    limit: options.discoveryLimit ?? options.maxCandidates ?? 30,
  });
  const ranking = await rankPartCandidatesWithGeometry(
    discovery,
    geometryResolver,
    partIndex,
    targetDimensionsMm,
    {
      ...options,
      requiredInterfaces: options.requiredInterfaces ?? component.required_interfaces,
    },
  );
  return {
    component_id: component.id ?? null,
    component_role: component.role,
    target_dimensions_mm: targetDimensionsMm,
    discovery,
    ranking,
    assembly_status: "candidate_ranking_only_not_placed",
  };
}
