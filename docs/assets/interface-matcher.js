function normaliseAxis(axis) {
  if (!Array.isArray(axis) || axis.length !== 3 || !axis.every(Number.isFinite)) return null;
  const length = Math.hypot(...axis);
  return length > 1e-9 ? axis.map((value) => value / length) : null;
}

function interfaceTypeMatches(requiredType, candidate) {
  if (requiredType === "round_opening") {
    return /(?:hole|opening)/i.test(candidate.interface_type || "")
      && Number.isFinite(candidate.nominal_diameter_mm);
  }
  return candidate.interface_type === requiredType;
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
  const orientationPermutation = options.orientationPermutation ?? [0, 1, 2];
  const orientationSigns = options.orientationSigns ?? [1, 1, 1];
  const geometryCenterMm = options.geometryCenterMm ?? [0, 0, 0];
  if (!Array.isArray(orientationPermutation) || orientationPermutation.length !== 3
      || new Set(orientationPermutation).size !== 3
      || !orientationPermutation.every((axis) => Number.isInteger(axis) && axis >= 0 && axis <= 2)) {
    throw new RangeError("orientationPermutation must be a permutation of the three coordinate axes.");
  }
  if (!Array.isArray(orientationSigns) || orientationSigns.length !== 3
      || !orientationSigns.every((sign) => sign === 1 || sign === -1)) {
    throw new RangeError("orientationSigns must contain three values of +1 or -1.");
  }
  if (!Array.isArray(geometryCenterMm) || geometryCenterMm.length !== 3
      || !geometryCenterMm.every(Number.isFinite)) {
    throw new RangeError("geometryCenterMm must be a finite three-dimensional point.");
  }
  if (!Number.isFinite(defaultDiameterTolerance) || defaultDiameterTolerance < 0
      || !Number.isFinite(minimumAxisAlignment) || minimumAxisAlignment < 0 || minimumAxisAlignment > 1) {
    throw new RangeError("Interface tolerances must be finite and within their valid ranges.");
  }
  const requirements = requiredInterfaces.map((requirement, index) => {
    if (!requirement || typeof requirement.interface_type !== "string"
        || !Number.isInteger(requirement.count ?? requirement.positions_mm?.length ?? 1)
        || (requirement.count ?? requirement.positions_mm?.length ?? 1) < 1) {
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
    if (requirement.max_diameter_error_mm !== undefined
        && (!Number.isFinite(requirement.max_diameter_error_mm) || requirement.max_diameter_error_mm < 0)) {
      throw new TypeError("Required interface " + index + " has an invalid max_diameter_error_mm.");
    }
    if (requirement.positions_mm !== undefined
        && (!Array.isArray(requirement.positions_mm)
          || !requirement.positions_mm.every((position) => Array.isArray(position)
            && position.length === 3 && position.every(Number.isFinite)))) {
      throw new TypeError("Required interface " + index + " has invalid positions_mm.");
    }
    if (requirement.positions_mm !== undefined
        && requirement.count !== undefined && requirement.count !== requirement.positions_mm.length) {
      throw new TypeError("Required interface " + index + " count must equal positions_mm length when positions are specified.");
    }
    if (requirement.position_tolerance_mm !== undefined
        && (!Number.isFinite(requirement.position_tolerance_mm) || requirement.position_tolerance_mm < 0)) {
      throw new TypeError("Required interface " + index + " has an invalid position_tolerance_mm.");
    }
    return {
      ...requirement,
      count: requirement.count ?? requirement.positions_mm?.length ?? 1,
      axis,
    };
  });
  const matches = requirements.map((requirement) => {
    const candidates = candidateInterfaces.map((candidate, index) => ({ candidate, index })).filter(({ candidate }) => {
      if (!candidate || !interfaceTypeMatches(requirement.interface_type, candidate)) return false;
      if (requirement.diameter_mm !== undefined) {
        if (!Number.isFinite(candidate.nominal_diameter_mm)) return false;
        const tolerance = requirement.max_diameter_error_mm ?? defaultDiameterTolerance;
        if (Math.abs(candidate.nominal_diameter_mm - requirement.diameter_mm) > tolerance) return false;
      }
      if (requirement.axis) {
        const localAxis = normaliseAxis(candidate.axis_vector);
        const axis = localAxis ? orientationPermutation.map((sourceAxis, targetAxis) => localAxis[sourceAxis] * orientationSigns[targetAxis]) : null;
        if (!axis || Math.abs(dot(requirement.axis, axis)) < minimumAxisAlignment) return false;
      }
      return true;
    });
    let matchedInterfaces;
    if (requirement.positions_mm) {
      const used = new Set();
      const tolerance = requirement.position_tolerance_mm ?? options.positionToleranceMm ?? 1;
      if (!Number.isFinite(tolerance) || tolerance < 0) {
        throw new RangeError("Position tolerances must be non-negative and finite.");
      }
      matchedInterfaces = [];
      for (const requiredPosition of requirement.positions_mm) {
        let best = null;
        for (const item of candidates) {
          if (used.has(item.index) || !Array.isArray(item.candidate.centre_mm)
              || item.candidate.centre_mm.length !== 3
              || !item.candidate.centre_mm.every(Number.isFinite)) continue;
          const localPosition = item.candidate.centre_mm.map((value, axis) => value - geometryCenterMm[axis]);
          const orientedPosition = orientationPermutation.map((sourceAxis, targetAxis) => localPosition[sourceAxis] * orientationSigns[targetAxis]);
          const distance = Math.hypot(...orientedPosition.map((value, axis) => value - requiredPosition[axis]));
          if (!best || distance < best.distance) best = { ...item, distance };
        }
        if (best && best.distance <= tolerance) {
          used.add(best.index);
          matchedInterfaces.push({
            interface_id: best.candidate.interface_id,
            nominal_diameter_mm: best.candidate.nominal_diameter_mm ?? null,
            axis_vector: best.candidate.axis_vector ?? null,
            position_error_mm: best.distance,
            source_primitive: best.candidate.source_primitive,
            status: best.candidate.status,
          });
        }
      }
    } else {
      matchedInterfaces = candidates.map(({ candidate }) => ({
        interface_id: candidate.interface_id,
        nominal_diameter_mm: candidate.nominal_diameter_mm ?? null,
        axis_vector: candidate.axis_vector ?? null,
        source_primitive: candidate.source_primitive,
        status: candidate.status,
      }));
    }
    return {
      interface_type: requirement.interface_type,
      required_count: requirement.count,
      matched_count: matchedInterfaces.length,
      satisfied: matchedInterfaces.length >= requirement.count,
      matched_interfaces: matchedInterfaces,
    };
  });
  return {
    satisfied: matches.every((match) => match.satisfied),
    requirements: matches,
    orientation_permutation: orientationPermutation,
    orientation_signs: orientationSigns,
    physical_connection_verified: false,
    evidence_type: "source-derived-nominal-interface-geometry",
    limitations: [
      "Nominal interface dimensions are derived from LDraw source primitives, not measured production tolerances.",
      "Pin insertion, clutch force, friction, load capacity, strength and stability are not verified.",
      "The candidate part still needs geometry placement, orientation, collision and global assembly validation.",
    ],
  };
}
