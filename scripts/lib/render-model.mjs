// Offline PNG preview of a planned model (evaluation and review only).
import {deflateSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {rasterizeInstructionFaces} from '../../docs/assets/instruction-rasterizer.js';
import {colourHex, isTransparent} from '../../docs/assets/brick-colours.js';

const crcTable = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = bytes => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function encodePng(rgb, width, height) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const meshCache = new Map();
function partTriangles(profile, dataDir) {
  if (meshCache.has(profile.part_id)) return meshCache.get(profile.part_id);
  let tris = [];
  if (profile.mesh_file) {
    const a = JSON.parse(readFileSync(`${dataDir}/${profile.mesh_file}`)).triangle_positions_mm;
    for (let i = 0; i < a.length; i += 9) tris.push([a.slice(i, i + 3), a.slice(i + 3, i + 6), a.slice(i + 6, i + 9)]);
  } else {
    const w = profile.footprint_studs_x * 4, d = profile.footprint_studs_z * 4, h = profile.body_height_ldu * 0.4;
    const p = [[-w, 0, -d], [w, 0, -d], [w, 0, d], [-w, 0, d], [-w, h, -d], [w, h, -d], [w, h, d], [-w, h, d]];
    for (const ids of [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]) tris.push([p[ids[0]], p[ids[1]], p[ids[2]]], [p[ids[0]], p[ids[2]], p[ids[3]]]);
    for (const f of profile.features.filter(f => f.kind === 'stud')) {
      const [x, y, z] = f.position_ldu.map(v => v * 0.4);
      for (let i = 0; i < 10; i++) {
        const a = i * Math.PI / 5, b = (i + 1) * Math.PI / 5, pa = [x + 2.4 * Math.cos(a), y - 1.7, z + 2.4 * Math.sin(a)], pb = [x + 2.4 * Math.cos(b), y - 1.7, z + 2.4 * Math.sin(b)];
        tris.push([[x, y - 1.7, z], pa, pb], [pa, [pa[0], y, pa[2]], pb], [pb, [pa[0], y, pa[2]], [pb[0], y, pb[2]]]);
      }
    }
  }
  meshCache.set(profile.part_id, tris);
  return tris;
}

const rgb = hex => hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255);
const transform = (m, p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2], m[3] * p[0] + m[4] * p[1] + m[5] * p[2], m[6] * p[0] + m[7] * p[1] + m[8] * p[2]];

/** Render views side by side. views: yaw angles in radians. highlight: Set of instance ids drawn magenta. */
export function renderPlan(plan, profiles, {dataDir, size = 420, views = [-0.75, 2.4], highlight = new Set()} = {}) {
  const width = size * views.length, height = size, out = new Uint8Array(width * height * 3);
  const light = (() => { const v = [0.45, 0.8, -0.4], l = Math.hypot(...v); return v.map(x => x / l); })();
  const world = [];
  for (const part of plan.parts) {
    const profile = profiles.get(part.part_id);
    const base = highlight.has(part.instance_id) ? [1, 0, 1] : rgb(colourHex.get(part.colour_code) || '#a9b8c2');
    const colour = isTransparent(part.colour_code) ? base.map(v => v * 0.75 + 0.2) : base;
    for (const tri of partTriangles(profile, dataDir)) {
      const pts = tri.map(p => transform(part.matrix, p).map((v, i) => (v + part.translation_ldu[i] * 0.4) * (i === 0 ? 1 : -1)));
      const a = pts[1].map((v, i) => v - pts[0][i]), b = pts[2].map((v, i) => v - pts[0][i]);
      const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], l = Math.hypot(...n) || 1;
      const shade = 0.55 + 0.45 * Math.abs(n.reduce((s, v, i) => s + v / l * light[i], 0));
      world.push({pts, colour: colour.map(v => v * shade)});
    }
  }
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const f of world) for (const p of f.pts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
  const centre = [0, 1, 2].map(i => (lo[i] + hi[i]) / 2);
  views.forEach((yaw, v) => {
    const pitch = -0.5;
    const project = ([x, y, z]) => { x -= centre[0]; y -= centre[1]; z -= centre[2];
      const rx = x * Math.cos(yaw) + z * Math.sin(yaw), rz = -x * Math.sin(yaw) + z * Math.cos(yaw);
      return [rx, y * Math.cos(pitch) - rz * Math.sin(pitch), y * Math.sin(pitch) + rz * Math.cos(pitch)]; };
    const projected = world.map(f => ({colour: f.colour, points: f.pts.map(project)}));
    let ext = 0;
    for (const f of projected) for (const p of f.points) ext = Math.max(ext, Math.abs(p[0]), Math.abs(p[1]));
    ext *= 1.08;
    const faces = projected.map(f => ({colour: f.colour, points: f.points.map(p => [size / 2 + p[0] / ext * size / 2, size / 2 - p[1] / ext * size / 2, -p[2]])}));
    const px = rasterizeInstructionFaces(faces, size, size, [0.94, 0.95, 0.96]);
    for (let y = 0; y < size; y++) out.set(px.subarray(y * size * 3, (y + 1) * size * 3), (y * width + v * size) * 3);
  });
  return encodePng(out, width, height);
}
