// Object intent v2: the contract between a language model and the brick engine.
//
// The interpreter describes what the object looks like at its real-world size,
// using a few overlapping primitives. It never chooses scale, parts, studs or
// placements; the engine owns quantisation and construction.
import {resolveColour} from './brick-colours.js?v=fab991c95518';

export const INTENT_SCHEMA_ID = 'brickforge.object-intent/2';
export const SHAPES = Object.freeze(['box', 'cylinder', 'cone', 'sphere', 'dome', 'wedge', 'roof']);
export const MODES = Object.freeze(['solid', 'void', 'paint']);
export const BUILD_SIZES = Object.freeze({small: 12, medium: 20, large: 32});
const UNIT_MM = {m: 1000, cm: 10, mm: 1};
const AXES = ['x', 'y', 'z'];
const DIRECTIONS = ['+x', '-x', '+z', '-z'];

export const INTENT_INSTRUCTIONS = `You convert a description of a real object into one JSON object (schema ${INTENT_SCHEMA_ID}) that a brick-building engine turns into a buildable model with instructions.

Describe how the object LOOKS, at its real-world size, as a few overlapping 3D primitives. Do not think about bricks, studs, part numbers or scale: the engine chooses those.

Coordinate frame (one frame for every component):
- y is up; the object rests on the ground at y = 0.
- x is the object's width (left/right). Centre symmetric objects on x = 0.
- z is its length. The FRONT of the object faces -z (a car's bonnet is at low z, its boot at high z).
- "units" is "m", "cm" or "mm"; use the unit that is natural for the object.

Every component has "id", "role", "shape", "center" [x,y,z] and "size" [x,y,z] (full extents, not half sizes, along each axis before rotation) and usually "colour".
Shapes:
- box: a rectangular block.
- cylinder: needs "axis" ("x", "y" or "z"); size gives its extents, so a vertical pole of diameter 0.1 and height 2 is size [0.1, 2, 0.1].
- cone: like cylinder; "top_scale" is the width at the high end of the axis relative to the low end (0 = point, 0.5 = frustum, 2 = widens upward). The wider end fills the size.
- sphere: an ellipsoid filling its size.
- dome: the upper half of an ellipsoid; center is the middle of its flat base, size [width, height, depth].
- wedge: a box whose top slopes down; "slope": {"down_toward": "+x" | "-x" | "+z" | "-z", "low_fraction": height at the low edge as a fraction of the full height (0..1)}.
- roof: a gable roof prism; "ridge_axis" ("x" or "z") is the direction the ridge runs; "eave_fraction" is the height at the eaves as a fraction of total height (usually 0).
Optional: "rotate_deg" [rx, ry, rz] rotates a component about its own centre (applied x, then y, then z). Prefer axis-aligned shapes.

Modes:
- "solid" (default) adds material. Later solids win where colours overlap.
- "void" removes material from every solid (doorways, arches, tunnels, the gap under a table top). Give voids a role such as "opening".
- "paint" recolours existing surface material inside its volume without adding any (windows on a car body, stripes, a face). Paint must overlap the surface it colours.

Rules that make the result buildable:
- Parts that are joined in reality must overlap or touch in your description; a gap means floating material.
- Use role "wheel" with a cylinder on axis "x" for road wheels. The engine fits real wheel assemblies.
- Use shape "roof" or "wedge" for sloped surfaces so the engine can use real slope elements.
- Mark small decorative items "importance": "detail"; they may disappear at small build sizes. Everything else is "essential".
- "attach_to" (id or list of ids) states that a component must be structurally joined to another.
- "finish": "smooth" asks for a smooth top (tiles) instead of exposed studs.
- Colours are names such as "red", "dark grey", "light grey", "white", "black", "tan", "reddish brown", "dark green", "trans clear" or "trans light blue". Use a "trans" colour for glass.
- "build": {"size": "small" | "medium" | "large"} sets how large the model should be; omit for medium.
- Record every choice the description did not state in "assumptions". List anything you could not express in "unsupported" rather than inventing it.
Return JSON only.`;

const finite = v => typeof v === 'number' && Number.isFinite(v);
const vec3 = v => Array.isArray(v) && v.length === 3 && v.every(finite);

/** Validate and normalise an intent. Lengths are converted to millimetres. */
export function normaliseIntent(input) {
  const errors = [], warnings = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {valid: false, errors: ['The intent must be a JSON object.'], warnings};
  if (input.schema !== INTENT_SCHEMA_ID) errors.push(`schema must be "${INTENT_SCHEMA_ID}".`);
  const units = input.units ?? 'm';
  if (!UNIT_MM[units]) errors.push('units must be "m", "cm" or "mm".');
  const k = UNIT_MM[units] || 1;
  const build = input.build ?? {};
  const size = build.size ?? 'medium';
  if (!BUILD_SIZES[size]) errors.push('build.size must be small, medium or large.');
  let target = build.target_longest_studs ?? BUILD_SIZES[size] ?? 20;
  if (!Number.isInteger(target) || target < 6 || target > 64) {
    errors.push('build.target_longest_studs must be an integer from 6 to 64.');
    target = 20;
  }
  const hollow = build.hollow ?? 'auto';
  if (!['auto', 'solid'].includes(hollow)) errors.push('build.hollow must be "auto" or "solid".');
  if (!Array.isArray(input.components) || !input.components.length) errors.push('components must be a non-empty array.');
  const raw = Array.isArray(input.components) ? input.components : [];
  if (raw.length > 200) errors.push('At most 200 components are supported.');
  const ids = new Set();
  const components = [];
  raw.forEach((c, index) => {
    const at = `components[${index}]`;
    if (!c || typeof c !== 'object') { errors.push(at + ' must be an object.'); return; }
    const id = typeof c.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(c.id) ? c.id : null;
    if (!id) errors.push(at + '.id must be a short identifier (letters, digits, - or _).');
    else if (ids.has(id)) errors.push(`${at}.id "${id}" is repeated.`);
    else ids.add(id);
    const where = id ? `Component "${id}"` : at;
    if (!SHAPES.includes(c.shape)) errors.push(`${where}: shape must be one of ${SHAPES.join(', ')}.`);
    if (!vec3(c.center)) errors.push(`${where}: center must be [x, y, z].`);
    if (!vec3(c.size) || !c.size.every(v => v > 0)) errors.push(`${where}: size must be three positive extents.`);
    const mode = c.mode ?? 'solid';
    if (!MODES.includes(mode)) errors.push(`${where}: mode must be solid, void or paint.`);
    let colour = null;
    if (mode !== 'void') {
      colour = c.colour === undefined ? null : resolveColour(c.colour);
      if (c.colour === undefined) warnings.push(`${where} has no colour; light grey is used.`);
      else if (colour === null) warnings.push(`${where} colour "${c.colour}" is not in the palette; light grey is used.`);
      colour ??= 71;
    }
    const out = {
      id: id || at, label: typeof c.label === 'string' ? c.label : (id || at),
      role: typeof c.role === 'string' && c.role.trim() ? c.role.trim().toLowerCase() : 'body',
      shape: c.shape, mode, colour,
      center_mm: vec3(c.center) ? c.center.map(v => v * k) : [0, 0, 0],
      size_mm: vec3(c.size) ? c.size.map(v => v * k) : [1, 1, 1],
      importance: c.importance ?? 'essential',
      finish: c.finish ?? 'studs',
      attach_to: c.attach_to === undefined ? [] : [].concat(c.attach_to),
    };
    if (!['essential', 'detail'].includes(out.importance)) errors.push(`${where}: importance must be essential or detail.`);
    if (!['studs', 'smooth'].includes(out.finish)) errors.push(`${where}: finish must be studs or smooth.`);
    if (c.rotate_deg !== undefined) {
      if (!vec3(c.rotate_deg)) errors.push(`${where}: rotate_deg must be [rx, ry, rz].`);
      else if (c.rotate_deg.some(v => v % 360 !== 0)) out.rotate_deg = c.rotate_deg.slice();
    }
    if (c.shape === 'cylinder' || c.shape === 'cone') {
      out.axis = c.axis ?? 'y';
      if (!AXES.includes(out.axis)) errors.push(`${where}: axis must be x, y or z.`);
    }
    if (c.shape === 'cone') {
      out.top_scale = c.top_scale ?? 0;
      if (!finite(out.top_scale) || out.top_scale < 0 || out.top_scale > 4) errors.push(`${where}: top_scale must be between 0 and 4.`);
    }
    if (c.shape === 'wedge') {
      const s = c.slope ?? {};
      out.slope = {down_toward: s.down_toward ?? '-z', low_fraction: s.low_fraction ?? 0};
      if (!DIRECTIONS.includes(out.slope.down_toward)) errors.push(`${where}: slope.down_toward must be +x, -x, +z or -z.`);
      if (!finite(out.slope.low_fraction) || out.slope.low_fraction < 0 || out.slope.low_fraction >= 1) errors.push(`${where}: slope.low_fraction must be in [0, 1).`);
    }
    if (c.shape === 'roof') {
      out.ridge_axis = c.ridge_axis ?? 'x';
      out.eave_fraction = c.eave_fraction ?? 0;
      if (!['x', 'z'].includes(out.ridge_axis)) errors.push(`${where}: ridge_axis must be x or z.`);
      if (!finite(out.eave_fraction) || out.eave_fraction < 0 || out.eave_fraction >= 1) errors.push(`${where}: eave_fraction must be in [0, 1).`);
    }
    components.push(out);
  });
  for (const c of components) for (const target of c.attach_to) {
    if (!ids.has(target)) errors.push(`Component "${c.id}" attaches to unknown component "${target}".`);
    else if (target === c.id) errors.push(`Component "${c.id}" cannot attach to itself.`);
  }
  if (components.length && !components.some(c => c.mode === 'solid')) errors.push('At least one component must be solid.');
  const listOfStrings = v => v === undefined || (Array.isArray(v) && v.every(s => typeof s === 'string'));
  if (!listOfStrings(input.assumptions)) errors.push('assumptions must be a list of strings.');
  if (!listOfStrings(input.unsupported)) errors.push('unsupported must be a list of strings.');
  const intent = {
    schema: INTENT_SCHEMA_ID,
    name: typeof input.name === 'string' && input.name.trim() ? input.name.trim() : 'Untitled object',
    description: typeof input.description === 'string' ? input.description : '',
    units, build: {size, target_longest_studs: target, hollow},
    components,
    assumptions: Array.isArray(input.assumptions) ? input.assumptions.slice() : [],
    unsupported: Array.isArray(input.unsupported) ? input.unsupported.slice() : [],
  };
  return {valid: errors.length === 0, errors, warnings, intent};
}

export function assertValidIntent(input) {
  const result = normaliseIntent(input);
  if (!result.valid) throw new Error('Invalid object intent: ' + result.errors.join(' '));
  return result;
}

/** Provider-neutral request: what a language model gateway receives. */
export function buildIntentRequest(description, responseSchema) {
  if (typeof description !== 'string' || !description.trim() || description.length > 12000) throw new Error('Enter a description of up to 12,000 characters.');
  if (!responseSchema || typeof responseSchema !== 'object') throw new Error('The object intent schema is required.');
  return {schema_version: 2, input: description.trim(), instructions: INTENT_INSTRUCTIONS, response_schema: responseSchema};
}
