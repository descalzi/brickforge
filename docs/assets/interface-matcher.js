function normaliseAxis(axis) {
  if (!Array.isArray(axis) || axis.length !== 3 || !axis.every(Number.isFinite)) return null;
  const length = Math.hypot(...axis);
  return length > 1e-9 ? axis.map((value) => value / length) : null;
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

/**
 * Match required functional interfaces against source-derived nominal catalogue
 * interfaces. This is not a physical clutch, insertion-clearance or strength test.
 */
export function matchRequiredInterfaces(requiredInterfaces, candidateInterfaces, options = {}) {
  if (!Array.isArray(requiredInterfaces) || !Array.isArray(candidateInterfaces)) {
    throw new TypeError("Required and candidate interfaces must be arrays.");
  }
  const defaultDiameterTolerance = options.diameterToleranceMm ?? 0.5;
  const minimumAxisAlignment = options.minimumAxisAlignmentCosine ?? 0.95;
  if (!Number.isFinite(defaultDiameterTolerance) || defaultDiameterTolerance < 0
      || !Number.isFinite(minimumAxisAlignment) || minimumAxisAlignment < 0 || minimumAxisAlignment > 1) {
    throw new RangeError("Interface tolerances must be finite and within their valid ranges.");
  }
  const requirements = requiredInterfaces.map((requirement, index) => {
    if (!requirement || typeof requirement.interface_type !== "string"
        || !Number.isInteger(requirement.count ?? 1) || (requirement.count ?? 1) < 1) {
      throw new TypeError("Required interface " + index + " needs an interface_type and positive count.");
    }
    const axis = requirement.axis_vector === undefined ? null : normaliseAxis(requirement.axis_vector);
    if (requirement.axis_vector !== undefined && !axis) {
      throw new TypeError("Required interface " + index + " has an invalid axis_vector.");
    }
    if (requirement.diameter_mm !== undefined
        && (!Number.isFinite(requirement.diameter_mm) || requirement.diameter_mm <= 0)) {
      throw new TypeError("Required interface " + index + " has an invalid diameter_mm.");
    }
    return { ...requirement, count: requirement.count ?? 1, axis };
  });
  const matches = requirements.map((requirement) => {
    const candidates = candidateInterfaces.filter((candidate) => {
      if (candidate.interface_type !== requirement.interface_type) return false;
      if (requirement.diameter_mm !== undefined) {
        if (!Number.isFinite(candidate.nominal_diameter_mm)) return false;
        const tolerance = requirement.max_diameter_error_mm ?? defaultDiameterTolerance;
        if (Math.abs(candidate.nominal_diameter_mm - requirement.diameter_mm) > tolerance) return false;
      }
      if (requirement.axis) {
        const axis = normaliseAxis(candidate.axis_vector);
        if (!axis || Math.abs(dot(requirement.axis, axis)) < minimumAxisAlignment) return false;
      }
      return true;
    });
    return {
      interface_type: requirement.interface_type,
      required_count: requirement.count,
      matched_count: candidates.length,
      satisfied: candidates.length >= requirement.count,
      matched_interfaces: candidates.map((candidate) => ({
        interface_id: candidate.interface_id,
        nominal_diameter_mm: candidate.nominal_diameter_mm ?? null,
        axis_vector: candidate.axis_vector ?? null,
        source_primitive: candidate.source_primitive,
        status: candidate.status,
      })),
    };
  });
  return {
    satisfied: matches.every((match) => match.satisfied),
    requirements: matches,
    physical_connection_verified: false,
    evidence_type: "source-derived-nominal-interface-geometry",
    limitations: [
      "Nominal interface dimensions are derived from LDraw source primitives, not measured production tolerances.",
      "Pin insertion, clutch force, friction, load capacity, strength and stability are not verified.",
      "The candidate part still needs geometry placement, orientation, collision and global assembly validation.",
    ],
  };
}
