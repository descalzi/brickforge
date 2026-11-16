import { scoreSurfaceFit } from "./surface-fit.js?v=3233205dd5e1";

function featureDiameter(feature) {
  return Number.isFinite(feature?.equivalent_diameter_mm)
    ? feature.equivalent_diameter_mm
    : Number.isFinite(feature?.width_mm) ? feature.width_mm : null;
}

function featureAxis(feature) {
  if (Array.isArray(feature?.axis_vector_world) && feature.axis_vector_world.length === 3) {
    return feature.axis_vector_world;
  }
  const index = ["x", "y", "z"].indexOf(feature?.axis);
  return index >= 0 ? [0, 1, 2].map((axis) => axis === index ? 1 : 0) : null;
}

export function validateCuratedSpecialisedCatalogue(catalogue) {
  if (!catalogue || catalogue.schema_version !== 1 || !Array.isArray(catalogue.profiles)
      || !catalogue.source_library?.commit) return false;
  return catalogue.profiles.every((profile) =>
    typeof profile.part_id === "string"
    && typeof profile.source_file === "string"
    && Array.isArray(profile.measured_opening_profiles)
    && Array.isArray(profile.nominal_connection_interfaces)
    && profile.nominal_connection_interfaces.every((entry) =>
      typeof entry.interface_id === "string"
      && typeof entry.interface_type === "string"
      && typeof entry.source_primitive === "string"
      && typeof entry.status === "string"
      && (entry.nominal_diameter_mm === null
        || (Number.isFinite(entry.nominal_diameter_mm) && entry.nominal_diameter_mm > 0))
    )
  );
}

/**
 * Compare measured target openings with source-derived nominal part interfaces.
 * This validates metadata and dimensions only; it does not claim clutch-force or
 * physical connection validation.
 */
export function matchNominalConnectionInterfaces(targetFeatures, partProfiles, {
  diameterToleranceMm = 0.5,
} = {}) {
  if (!Array.isArray(targetFeatures) || !Array.isArray(partProfiles)
      || !Number.isFinite(diameterToleranceMm) || diameterToleranceMm <= 0) {
    throw new TypeError("Target features, part profiles and a positive interface tolerance are required.");
  }
  const results = [];
  for (const target of targetFeatures) {
    const diameter = featureDiameter(target);
    if (diameter === null || target.shape !== "round opening") continue;
    const targetAxis = featureAxis(target);
    for (const profile of partProfiles) {
      const source = profile.source_verified_catalogue_entry;
      if (!source || !Array.isArray(source.nominal_connection_interfaces)) continue;
      for (const iface of source.nominal_connection_interfaces) {
        if (!Number.isFinite(iface.nominal_diameter_mm)) continue;
        const error = Math.abs(diameter - iface.nominal_diameter_mm);
        if (error > diameterToleranceMm) continue;
        const partAxis = featureAxis({ axis_vector_world: iface.axis_vector });
        const axisRelation = targetAxis && partAxis
          ? Math.abs(targetAxis.reduce((sum, value, index) => sum + value * partAxis[index], 0))
          : null;
        results.push({
          target_feature_id: target.id,
          part_id: profile.part_id,
          description: profile.description || source.description,
          interface_id: iface.interface_id,
          interface_type: iface.interface_type,
          source_file: source.source_file,
          source_commit: profile.source_verified_catalogue_entry.source_commit
            || profile.source_library_commit || null,
          nominal_diameter_mm: iface.nominal_diameter_mm,
          target_diameter_mm: diameter,
          diameter_error_mm: error,
          axis_alignment_cosine: axisRelation,
          status: "nominal_interface_geometry_match",
          physical_clutch_verified: false,
          note: "Source-derived nominal interface dimensions match the measured target opening; physical clutch, insertion clearance and strength are not verified.",
        });
      }
    }
  }
  return results.sort((left, right) => left.diameter_error_mm - right.diameter_error_mm
    || left.part_id.localeCompare(right.part_id));
}

/**
 * Run a detailed triangle-surface proximity check for a placed specialised part.
 * This is intentionally separate from nominal connection-interface matching.
 */
export function validateSpecialisedSurfaceCandidate(profile, transformedPartPositions, targetPositions, options = {}) {
  if (!profile?.source_verified_catalogue_entry || !Array.isArray(profile.mesh_positions_mm)) {
    throw new TypeError("A source-verified part profile with detailed triangle geometry is required.");
  }
  const report = options.precomputedReport
    || scoreSurfaceFit(transformedPartPositions, targetPositions, options);
  return {
    part_id: profile.part_id,
    source_file: profile.source_verified_catalogue_entry.source_file,
    nominal_interface_status: "source_metadata_available",
    surface_status: report.status,
    surface_score: report.score,
    global_bidirectional_score: report.global_bidirectional_score,
    target_surface_coverage: report.target_to_candidate.within_tolerance_fraction,
    candidate_to_target_mean_distance_mm: report.candidate_to_target.mean_distance_mm,
    candidate_to_target_95th_percentile_distance_mm: report.candidate_to_target.percentile_95_distance_mm,
    candidate_to_target_within_tolerance_fraction: report.candidate_to_target.within_tolerance_fraction,
    detailed_surface_check: true,
    physical_connection_verified: false,
    limitations: report.limitations,
  };
}
