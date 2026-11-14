const LDU_TO_MM = 0.4;

export function constructionPreviewTransform(part, profile, grid, targetCellBounds, modelCenter) {
  if (!part || !Array.isArray(part.translation_ldu) || part.translation_ldu.length !== 3
    || !part.translation_ldu.every(Number.isFinite)) {
    throw new TypeError("A preview part requires a finite three-axis LDraw translation.");
  }
  if (!profile || !["footprint_studs_x", "footprint_studs_z", "body_height_ldu", "stud_pitch_ldu"]
    .every((key) => Number.isFinite(profile[key]) && profile[key] > 0)) {
    throw new TypeError("A preview part requires positive profile dimensions.");
  }
  if (!grid || !Array.isArray(grid.origin_mm) || grid.origin_mm.length !== 3
    || !grid.origin_mm.every(Number.isFinite)
    || !Array.isArray(grid.pitch_mm) || grid.pitch_mm.length !== 3
    || !grid.pitch_mm.every((value) => Number.isFinite(value) && value > 0)) {
    throw new TypeError("A preview grid requires finite origin and positive pitch vectors.");
  }
  if (!targetCellBounds || !["minX", "maxX", "minZ", "maxZ"]
    .every((key) => Number.isSafeInteger(targetCellBounds[key]))
    || targetCellBounds.maxX < targetCellBounds.minX
    || targetCellBounds.maxZ < targetCellBounds.minZ) {
    throw new TypeError("Target cell bounds must describe a non-empty integer rectangle.");
  }
  if (!Array.isArray(modelCenter) || modelCenter.length !== 3 || !modelCenter.every(Number.isFinite)) {
    throw new TypeError("The source model centre must contain three finite coordinates.");
  }
  const courseMatch = /^layer-(\d+)-/.exec(part.instance_id || "");
  if (!courseMatch) throw new TypeError("A preview part instance ID must identify its course.");
  if (Math.abs(profile.stud_pitch_ldu * LDU_TO_MM - grid.pitch_mm[0]) > 1e-6
    || Math.abs(profile.stud_pitch_ldu * LDU_TO_MM - grid.pitch_mm[2]) > 1e-6
    || Math.abs(profile.body_height_ldu * LDU_TO_MM - grid.pitch_mm[1]) > 1e-6) {
    throw new RangeError("The part profile dimensions do not match the target grid pitch.");
  }
  const [width, height, depth] = grid.pitch_mm;
  const targetCentreX = grid.origin_mm[0]
    + (targetCellBounds.minX + (targetCellBounds.maxX - targetCellBounds.minX + 1) / 2) * width;
  const targetCentreZ = grid.origin_mm[2]
    + (targetCellBounds.minZ + (targetCellBounds.maxZ - targetCellBounds.minZ + 1) / 2) * depth;
  const courseIndex = Number(courseMatch[1]);
  const rotated = Array.isArray(part.matrix) && part.matrix.length === 9
    && part.matrix[0] === 0 && part.matrix[2] === 1
    && part.matrix[6] === -1 && part.matrix[8] === 0;
  return {
    course_index: courseIndex,
    position_mm: [
      part.translation_ldu[0] * LDU_TO_MM + targetCentreX - modelCenter[0],
      grid.origin_mm[1] + (courseIndex + 0.5) * height - modelCenter[1],
      part.translation_ldu[2] * LDU_TO_MM + targetCentreZ - modelCenter[2],
    ],
    size_mm: [
      profile.footprint_studs_x * width,
      profile.body_height_ldu * LDU_TO_MM,
      profile.footprint_studs_z * depth,
    ],
    rotation_y_rad: rotated ? Math.PI / 2 : 0,
  };
}
