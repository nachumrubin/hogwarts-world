// Tree lab renderer (WebGPU). Geometry is uploaded once per specimen and LOD (GpuMesh); a scene is a list of draws
// that place meshes (offset + material kind), so the same specimen can be shown alone, in a comparison line-up or
// in a thumbnail without re-uploading. Rendering is on demand (the lab asks for a frame when something changed, or
// continuously in live mode); captures render offscreen at a fixed resolution independent of the window.
// Display modes: materials (reserved: neutral placeholder tone), clay, silhouette, wireframe, normals, hierarchy.
// Lighting presets: neutral studio, daylight, overcast, low-angle sun. Sun shadow map, sky/fill ambient, ACES.
import { VFLOATS } from '../framework/mesher.ts';

export type Mode = 'lit' | 'clay' | 'silhouette' | 'wire' | 'normals' | 'hierarchy';
export const MODES: Mode[] = ['lit', 'clay', 'silhouette', 'wire', 'normals', 'hierarchy'];

/** Material kinds of a draw. */
export const KIND = { tree: 0, ground: 1, figure: 2, pole: 3, leaf: 4, card: 5, twig: 6, needle: 7, poly: 8 } as const;
import { PACKED, type FoliageLod } from '../framework/foliage.ts';
/** Foliage of one specimen at one LOD on the GPU: one instance buffer per set, drawn with a shared template. */
/** One specimen-LOD's foliage: every set's instances in one shared GPU buffer (sets address it by offset). */
export interface GpuFoliage { buf: GPUBuffer | null; sets: { kind: 'leaf' | 'needle' | 'card' | 'twig' | 'poly'; layer: number; grid: [number, number]; buf: GPUBuffer; offset: number; count: number; tmpl: string }[]; bytes: number; instances: number; triangles: number }
/** How the foliage is represented: alpha-tested leaf sprites near / shoot cards / clump cards by LOD (hybrid, the
 *  lab's choice); shoot cards at every distance; or opaque leaf polygons cut from the sprites' outlines. */
export type FoliageRep = 'hybrid' | 'cards' | 'geometry';
/** Foliage texture layers (tools/foliage_textures.py writes textures/foliage.json in this order). */
export const FOLIAGE_LAYERS = ['oak', 'birch', 'pine', 'card-oak', 'card-birch', 'card-pine'];

export interface LightPreset {
  id: string; label: string;
  sun: [number, number, number]; intensity: number; sunColor: [number, number, number];
  zenith: [number, number, number]; horizon: [number, number, number]; ambient: number;
  shadow: number; fill: number; studio: boolean;
  /** exposure of the materials mode (linear multiplier before the ACES curve) */
  exposure: number;
}
export const LIGHTS: LightPreset[] = [
  { id: 'studio', label: 'Neutral studio', sun: [0.45, 0.78, 0.48], intensity: 1.45, sunColor: [1, 1, 1], zenith: [0.78, 0.79, 0.8], horizon: [0.7, 0.7, 0.71], ambient: 0.95, shadow: 0.55, fill: 0.45, studio: true, exposure: 0.62 },
  { id: 'day', label: 'Daylight', sun: [0.55, 0.62, 0.42], intensity: 2.1, sunColor: [1, 0.95, 0.88], zenith: [0.55, 0.65, 0.85], horizon: [0.62, 0.7, 0.82], ambient: 0.6, shadow: 1, fill: 0, studio: false, exposure: 0.55 },
  { id: 'overcast', label: 'Overcast', sun: [0.25, 0.9, 0.35], intensity: 0.35, sunColor: [1, 1, 1], zenith: [0.85, 0.87, 0.9], horizon: [0.8, 0.82, 0.85], ambient: 1.45, shadow: 0.2, fill: 0, studio: false, exposure: 0.8 },
  { id: 'low', label: 'Low-angle sun', sun: [0.88, 0.2, 0.32], intensity: 2.5, sunColor: [1, 0.76, 0.52], zenith: [0.34, 0.44, 0.68], horizon: [0.88, 0.7, 0.58], ambient: 0.42, shadow: 1, fill: 0, studio: false, exposure: 0.55 },
];

export interface GpuMesh { vbuf: GPUBuffer; ibuf: GPUBuffer; lbuf: GPUBuffer | null; idx: Uint32Array | null; indexCount: number; lineCount: number; triangles: number; vertices: number; bytes: number }
/** Bark material of a tree draw (species family). */
export const MAT = { oak: 0, pine: 1, birch: 2 } as const;
export interface Draw { mesh: GpuMesh; offset: [number, number, number]; kind: number; castShadow?: boolean; mat?: number; foliage?: GpuFoliage | null; yaw?: number }

/** Bark texture layers (tools/textures.py writes textures/manifest.json in this order). Tile = real-world size of
 *  one texture repeat, metres. */
export const BARK_LAYERS = [{ id: 'oak', tile: 1.0 }, { id: 'pinelow', tile: 1.5 }, { id: 'pineup', tile: 0.7 }, { id: 'birch', tile: 1.1 }, { id: 'ground', tile: 2.5 }];
export interface TexStats { layers: number; size: number; bytes: number; download: number; ms: number }

export const SHADER = /* wgsl */ `
struct U {
  vp: mat4x4f, sm: mat4x4f,
  cam: vec4f,     // xyz eye, w per-draw yaw (rad, about the draw's origin)
  sun: vec4f,     // xyz dir to sun, intensity
  mode: vec4f,    // mode id, bark material (0 oak, 1 pine, 2 birch), textures ready, exposure
  off: vec4f,     // per-draw offset xyz, kind (0 tree, 1 ground, 2 figure, 3 scale pole)
  sunc: vec4f,    // sun colour, fill intensity
  zen: vec4f,     // zenith colour, ambient scale
  hor: vec4f,     // horizon colour, shadow strength
  env: vec4f,     // studio backdrop, -, -, -
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var shadowMap: texture_depth_2d;
@group(0) @binding(2) var cmp: sampler_comparison;
@group(0) @binding(3) var barkAlb: texture_2d_array<f32>;   // rgb albedo (sRGB-decoded), a height
@group(0) @binding(4) var barkNrm: texture_2d_array<f32>;   // rg normal (x across, y along the branch), b roughness, a occlusion
@group(0) @binding(5) var barkSmp: sampler;

const TILE = array<f32, 5>(${BARK_LAYERS.map((l) => l.tile.toFixed(3)).join(', ')});
const PI = 3.14159265;

// vertex layout: pos3 normal3 (order, flags, radius, relief) axis3 origin3 (see mesher.ts VFLOATS)
struct VIn { @location(0) p: vec3f, @location(1) n: vec3f, @location(2) a: vec4f, @location(3) ax: vec3f, @location(4) org: vec3f };
struct VOut {
  @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f,
  @location(2) @interpolate(flat) a: vec4f,   // order, flags, -, -
  @location(3) lp: vec3f,                     // tree-local position
  @location(4) rw: vec3f,                     // radius, bark relief (cap: radial fraction), wood (0 bark … 1 bare wood)
  @location(5) ax: vec3f, @location(6) org: vec3f,
};

fn rotY(v: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
@vertex fn vs(i: VIn) -> VOut {
  var o: VOut;
  let wp = rotY(i.p, u.cam.w) + u.off.xyz;
  o.cp = u.vp * vec4f(wp, 1.0); o.wp = wp; o.n = rotY(i.n, u.cam.w); o.a = i.a; o.lp = i.p;
  let f = u32(i.a.y + 0.5);
  o.rw = vec3f(i.a.z, i.a.w, select(0.0, 1.0, (f & 3u) != 0u));
  o.ax = i.ax; o.org = i.org;
  return o;
}
@vertex fn vsShadow(i: VIn) -> @builtin(position) vec4f { return u.sm * vec4f(rotY(i.p, u.cam.w) + u.off.xyz, 1.0); }

fn aces(x: vec3f) -> vec3f { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0)); }
// octahedral unit-vector encoding (impostor normals): [-1,1]²
fn octEnc(n: vec3f) -> vec2f {
  let p = n.xz / (abs(n.x) + abs(n.y) + abs(n.z));
  return select((1.0 - abs(p.yx)) * select(vec2f(-1.0), vec2f(1.0), p >= vec2f(0.0)), p, n.y >= 0.0);
}
fn octDec(e: vec2f) -> vec3f {
  var n = vec3f(e.x, 1.0 - abs(e.x) - abs(e.y), e.y);
  let t = max(-n.y, 0.0); n.x += select(t, -t, n.x >= 0.0); n.z += select(t, -t, n.z >= 0.0);
  return normalize(n);
}
fn srgb(c: vec3f) -> vec3f { return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308)); }
fn shadow(wp: vec3f, n: vec3f) -> f32 {
  // normal offset and depth bias grow at grazing light angles (shadow acne showed as bands on limbs lit edge-on)
  let g = 1.0 - max(dot(n, normalize(u.sun.xyz)), 0.0);
  let s = u.sm * vec4f(wp + n * (0.03 + 0.06 * g), 1.0);
  let uv = vec2f(s.x * 0.5 + 0.5, 0.5 - s.y * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return 1.0; }
  var a = 0.0;
  let e = 1.0 / f32(textureDimensions(shadowMap).x);
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) { a += textureSampleCompareLevel(shadowMap, cmp, uv + vec2f(f32(x), f32(y)) * e * 1.5, s.z - 0.0004 - 0.0012 * g); } }
  return a / 9.0;
}
fn hierCol(order: f32, flags: f32) -> vec3f {
  let f = u32(flags + 0.5);
  if ((f & 1u) != 0u) { return vec3f(0.35, 0.35, 0.38); }       // dead
  if ((f & 4u) != 0u) { return vec3f(0.45, 0.2, 0.6); }         // roots
  let o = i32(order + 0.5);
  switch o { case 0: { return vec3f(0.35, 0.22, 0.12); } case 1: { return vec3f(0.85, 0.25, 0.15); } case 2: { return vec3f(0.95, 0.6, 0.15); }
    case 3: { return vec3f(0.9, 0.9, 0.2); } case 4: { return vec3f(0.35, 0.8, 0.3); } case 5: { return vec3f(0.2, 0.75, 0.85); } default: { return vec3f(0.4, 0.45, 0.95); } }
}

// ---------------------------------------------------------------- noise (macro variation, wood grain)
fn hash3(p: vec3f) -> f32 { let q = fract(p * vec3f(0.1031, 0.1030, 0.0973)); let r = q + dot(q, q.yzx + 33.33); return fract((r.x + r.y) * r.z); }
fn vnoise(p: vec3f) -> f32 {
  let i = floor(p); let f = p - i; let w = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3f(1, 0, 0)), w.x), mix(hash3(i + vec3f(0, 1, 0)), hash3(i + vec3f(1, 1, 0)), w.x), w.y),
             mix(mix(hash3(i + vec3f(0, 0, 1)), hash3(i + vec3f(1, 0, 1)), w.x), mix(hash3(i + vec3f(0, 1, 1)), hash3(i + vec3f(1, 1, 1)), w.x), w.y), w.z);
}
fn fbm(p: vec3f) -> f32 { return 0.5 * vnoise(p) + 0.3 * vnoise(p * 2.07 + 5.3) + 0.2 * vnoise(p * 4.13 + 1.7); }

// ---------------------------------------------------------------- bark mapping
// The bark is projected onto planes that contain the local branch axis A (from the mesh: continuous across
// junctions, see mesher.ts), at d = p − origin, in metres: plane (P, A) for surfaces facing ±Q, (Q, A) for ±P, and
// (P, Q) for surfaces facing along the axis (cut and broken faces, flat root tops). Texture "up" runs along A, so
// fissures follow every branch; true metres everywhere, so the scale never stretches with taper.
struct Ctx { c1: vec2f, c2: vec2f, c3: vec2f, gx1: vec2f, gy1: vec2f, gx2: vec2f, gy2: vec2f, gx3: vec2f, gy3: vec2f,
             t1: vec3f, t2: vec3f, b3: vec3f, P: vec3f, A: vec3f, w: vec3f };
struct Bark { alb: vec3f, h: f32, pn: vec3f, rough: f32, ao: f32 };

fn bmix(a: Bark, b: Bark, t: f32) -> Bark {
  return Bark(mix(a.alb, b.alb, t), mix(a.h, b.h, t), mix(a.pn, b.pn, t), mix(a.rough, b.rough, t), mix(a.ao, b.ao, t));
}
/** Height-aware blend: b grows in from a's crevices first (no soft cross-fade). */
fn hblend(a: Bark, b: Bark, t: f32) -> Bark {
  if (t <= 0.001) { return a; } if (t >= 0.999) { return b; }
  let a1 = a.h + 1.0 - t; let a2 = b.h + t; let m = max(a1, a2) - 0.25;
  let w1 = max(a1 - m, 0.0); let w2 = max(a2 - m, 0.0);
  return bmix(a, b, w2 / max(w1 + w2, 1e-4));
}
fn fetchL(layer: i32, c: vec2f, gx: vec2f, gy: vec2f, T: vec3f, B: vec3f) -> Bark {
  let uv = vec2f(c.x, -c.y);
  let a = textureSampleGrad(barkAlb, barkSmp, uv, layer, vec2f(gx.x, -gx.y), vec2f(gy.x, -gy.y));
  let n = textureSampleGrad(barkNrm, barkSmp, uv, layer, vec2f(gx.x, -gx.y), vec2f(gy.x, -gy.y));
  let t = n.xy * 2.0 - 1.0;
  return Bark(a.rgb, a.a, T * t.x + B * t.y, n.z, n.w);
}
/** One projection plane of one layer. Repeats along the branch are broken up: every tile-length band along the
 *  axis takes its own random offset, and the last fifth of each band height-blends into the next band's. */
fn plane(layer: i32, cm: vec2f, gx: vec2f, gy: vec2f, T: vec3f, B: vec3f, scale: f32) -> Bark {
  let tile = TILE[layer] * scale; let c = cm / tile; let gxs = gx / tile; let gys = gy / tile;
  let band = floor(c.y); let f = c.y - band; let L = f32(layer) * 7.13 + scale * 3.7;
  let o0 = vec2f(hash3(vec3f(band, L, 1.0)), hash3(vec3f(band, L, 2.0)) * 0.6);
  var r = fetchL(layer, c + o0, gxs, gys, T, B);
  let w = smoothstep(0.8, 1.0, f);
  if (w > 0.002) {
    let o1 = vec2f(hash3(vec3f(band + 1.0, L, 1.0)), hash3(vec3f(band + 1.0, L, 2.0)) * 0.6);
    r = hblend(r, fetchL(layer, c + o1, gxs, gys, T, B), w);
  }
  return r;
}
fn layerTri(layer: i32, x: Ctx, scale: f32) -> Bark {
  var acc = Bark(vec3f(0.0), 0.0, vec3f(0.0), 0.0, 0.0);
  if (x.w.x > 0.01) { let b = plane(layer, x.c1, x.gx1, x.gy1, x.t1, x.A, scale); acc = Bark(acc.alb + b.alb * x.w.x, acc.h + b.h * x.w.x, acc.pn + b.pn * x.w.x, acc.rough + b.rough * x.w.x, acc.ao + b.ao * x.w.x); }
  if (x.w.y > 0.01) { let b = plane(layer, x.c2, x.gx2, x.gy2, x.t2, x.A, scale); acc = Bark(acc.alb + b.alb * x.w.y, acc.h + b.h * x.w.y, acc.pn + b.pn * x.w.y, acc.rough + b.rough * x.w.y, acc.ao + b.ao * x.w.y); }
  if (x.w.z > 0.01) { let b = plane(layer, x.c3, x.gx3, x.gy3, x.P, x.b3, scale); acc = Bark(acc.alb + b.alb * x.w.z, acc.h + b.h * x.w.z, acc.pn + b.pn * x.w.z, acc.rough + b.rough * x.w.z, acc.ao + b.ao * x.w.z); }
  return acc;
}

// ---------------------------------------------------------------- wood (dead limbs, broken ends, cavities)
/** Weathered wood: fibres along the axis, drying checks, end grain (growth rings, decayed pith) on broken faces. */
fn wood(x: Ctx, r: f32, cap: bool, radial: f32, tint: vec3f, ringsPerM: f32) -> Bark {
  let u = select(x.c2.x, x.c1.x, x.w.x >= x.w.y); let v = x.c1.y; let T = select(x.t2, x.t1, x.w.x >= x.w.y);
  let g = fbm(vec3f(u * 70.0, v * 2.2, 3.1)) * 0.65 + vnoise(vec3f(u * 260.0, v * 7.0, 9.0)) * 0.35;
  let e = 0.004;
  let g2 = fbm(vec3f((u + e) * 70.0, v * 2.2, 3.1)) * 0.65 + vnoise(vec3f((u + e) * 260.0, v * 7.0, 9.0)) * 0.35;
  let check = smoothstep(0.035, 0.0, abs(vnoise(vec3f(u * 16.0, v * 0.5, 5.0)) - 0.5)) * smoothstep(0.35, 0.6, vnoise(vec3f(u * 4.0, v * 0.3, 8.0)));
  let streak = vnoise(vec3f(u * 9.0, v * 0.35, 12.0));
  var alb = tint * (0.55 + 0.8 * g) * (0.75 + 0.5 * streak) * (1.0 - 0.8 * check);
  var pn = T * clamp((g2 - g) / e * 0.012, -0.7, 0.7);
  var h = g * (1.0 - check);
  if (cap) {
    // end grain: growth rings around the pith (radial = fraction of the radius from the cap's vertices), wobbling
    let rr = radial * r;
    let wob = vnoise(vec3f(x.c3 * 30.0, 2.0)) * 0.004;
    let ring = fract((rr + wob) * ringsPerM);
    let late = smoothstep(0.75, 0.95, ring);
    alb = tint * mix(1.05, 0.72, late) * (0.9 + 0.2 * vnoise(vec3f(x.c3 * 90.0, 4.0)));
    let rot = smoothstep(0.35, 0.05, radial + 0.15 * vnoise(vec3f(x.c3 * 12.0, 6.0)));   // heart rot in old wood
    alb = mix(alb, vec3f(0.05, 0.03, 0.018), rot * 0.8);
    pn = vec3f(0.0); h = 0.5 - 0.3 * rot;
  }
  return Bark(alb, h, pn, 0.88, 1.0 - 0.3 * check);
}

struct Surf { alb: vec3f, n: vec3f, rough: f32, ao: f32 };

/** A layer at the scale that fits the bark's age: plates widen as the stem thickens (oak ridges ~3 cm apart on a
 *  limb, 8–10 cm on an ancient bole). Two fixed scales, height-blended over a radius band, so the pattern never
 *  stretches. */
fn aged(layer: i32, x: Ctx, r: f32, r0: f32, r1: f32, big: f32) -> Bark {
  let t = smoothstep(r0, r1, r);
  if (t <= 0.001) { return layerTri(layer, x, 1.0); }
  if (t >= 0.999) { return layerTri(layer, x, big); }
  return hblend(layerTri(layer, x, 1.0), layerTri(layer, x, big), t);
}

/** Bark and wood of one tree fragment: species layers distributed by branch radius (as a proxy for age), height,
 *  orientation, the branch hierarchy and the growth history recorded in the mesh flags (dead, broken, hollow). */
fn treeSurface(i: VOut, nG: vec3f, x: Ctx, mat: u32) -> Surf {
  let r = i.rw.x; let relief = i.rw.y; let woodW = clamp(i.rw.z, 0.0, 1.0);
  let flags = u32(i.a.y + 0.5); let order = i32(round(i.a.x));
  let stem = order <= 0 || (flags & 16u) != 0u;   // trunk, fused base and forks, roots
  let lp = i.lp;
  let mac = fbm(lp * vec3f(0.9, 0.35, 0.9) + 11.0);              // macro variation (metres)
  var s: Bark;
  var strength = 1.0;
  if (mat == 0u) {
    // ---- pedunculate oak: smooth olive-grey young bark → fissured plates from ~10 cm diameter → deep, weathered
    // ridges on the old bole
    let yb = layerTri(3, x, 0.5);
    let tone = vec3f(0.07, 0.064, 0.052) * (0.85 + 0.3 * mac);
    s = Bark(tone * (0.8 + 0.5 * (1.0 - dot(yb.alb, vec3f(0.33)))), yb.h, yb.pn * 0.35, 0.62, yb.ao);
    if (r < 0.012) { s.alb = vec3f(0.085, 0.067, 0.052) * (0.85 + 0.3 * mac); }
    let m = smoothstep(0.03, 0.14, r);
    if (m > 0.001) {
      var pb = aged(0, x, r, 0.3, 0.6, 2.6);
      let g = dot(pb.alb, vec3f(0.3, 0.55, 0.15));
      pb.alb = mix(vec3f(g), pb.alb, 0.55) * vec3f(0.5, 0.48, 0.45) * (0.8 + 0.4 * mac);
      s = hblend(s, pb, m);
    }
    strength = mix(0.7, 1.6, smoothstep(0.4, 1.0, r));
    // green algae on the shaded side and lichen on upper faces, more on old bark; moss and soil at the base
    let away = clamp(-dot(nG.xz, normalize(vec2f(0.45, 0.48))) * 0.8 + 0.2, 0.0, 1.0);
    let alg = smoothstep(0.45, 0.75, fbm(lp * 1.7 + 3.0) * 0.7 + away * 0.45) * smoothstep(0.05, 0.4, r) * (1.0 - s.h * 0.6);
    s.alb = mix(s.alb, vec3f(0.07, 0.085, 0.035), alg * 0.55);
    let lich = smoothstep(0.62, 0.78, fbm(lp * 4.3 + 17.0) + max(nG.y, 0.0) * 0.25) * smoothstep(0.04, 0.3, r) * s.h;
    s.alb = mix(s.alb, vec3f(0.21, 0.23, 0.18), lich * 0.6);
  } else if (mat == 1u) {
    // ---- Scots pine: grey-brown young shoots → thin orange flaking bark on the upper stem and limbs → thick,
    // dark, fractured plates on the lower trunk, rising to an irregular boundary at ~4–7 m
    let yb = layerTri(3, x, 0.5);
    s = Bark(vec3f(0.12, 0.075, 0.045) * (0.8 + 0.4 * mac) * (0.8 + 0.4 * (1.0 - dot(yb.alb, vec3f(0.33)))), yb.h, yb.pn * 0.3, 0.6, yb.ao);
    let fl = smoothstep(0.012, 0.04, r);
    if (fl > 0.001) { var ub = aged(2, x, r, 0.12, 0.25, 1.8); ub.alb = ub.alb * 0.8; s = hblend(s, ub, fl); }
    let bound = 5.2 + (fbm(vec3f(lp.x * 1.4, lp.y * 0.22, lp.z * 1.4)) - 0.5) * 5.0;
    let pw = select(0.0, smoothstep(bound + 0.9, bound - 0.9, lp.y) * smoothstep(0.07, 0.16, r), stem);
    if (pw > 0.001) { var lb = aged(1, x, r, 0.22, 0.4, 1.7); lb.alb = lb.alb * vec3f(0.72, 0.68, 0.66) * (0.75 + 0.35 * mac); s = hblend(s, lb, pw); }
    strength = mix(1.2, 1.7, pw);
  } else {
    // ---- silver birch: red-brown young twigs with pale lenticels → white paper bark with dark lenticels from
    // ~5 cm → black, deeply fissured bark at the base of the mature stem, rising in irregular streaks
    let wb = layerTri(3, x, select(0.45, 1.0, r > 0.04));
    let lent = 1.0 - smoothstep(0.15, 0.45, dot(wb.alb, vec3f(0.33)));
    s = Bark(mix(vec3f(0.055, 0.028, 0.02), vec3f(0.30, 0.22, 0.18), lent * 0.5) * (0.85 + 0.3 * mac), wb.h, wb.pn * 0.4, 0.42, wb.ao);
    let wt = smoothstep(0.012, 0.05, r);
    if (wt > 0.001) {
      var white = wb; white.alb = white.alb * mix(vec3f(0.62, 0.6, 0.57), vec3f(0.82, 0.81, 0.78), smoothstep(0.03, 0.15, r)) * (0.88 + 0.24 * mac);
      // dark chevrons where branches leave (collar) and a little grime in the crotches
      if ((flags & 8u) != 0u) { white.alb = white.alb * mix(1.0, 0.18, smoothstep(0.5, 0.68, fbm(lp * 7.0 + 2.0)) * smoothstep(0.03, 0.08, r)); }
      s = hblend(s, white, wt);
    }
    let streak = (fbm(vec3f(lp.x * 3.0, lp.y * 0.25, lp.z * 3.0)) - 0.5) * 2.2;
    let top = 0.15 + 1.0 * smoothstep(0.1, 0.3, r) + streak * 0.55;
    let bw = select(0.0, smoothstep(top + 0.7, top - 0.5, lp.y) * smoothstep(0.06, 0.12, r), stem);
    if (bw > 0.001) {
      var bb = layerTri(0, x, 1.3);
      bb.alb = mix(vec3f(0.016, 0.015, 0.014), vec3f(0.36, 0.35, 0.33), smoothstep(0.4, 0.8, bb.h)) * (0.8 + 0.4 * mac);
      s = hblend(s, bb, bw);
    }
    strength = mix(0.7, 1.3, bw);
  }
  // ---- exposed wood: dead limbs (bark mostly shed, a few remnants), broken ends, the oak's hollow
  let cap = (flags & 2u) != 0u;
  if (woodW > 0.001 || cap) {
    let tint = select(vec3f(0.17, 0.16, 0.145), vec3f(0.2, 0.16, 0.11), mat == 1u);
    let wd = wood(x, r, cap, relief, tint, select(260.0, 380.0, mat == 1u));
    let remn = select(smoothstep(0.55, 0.65, fbm(lp * 5.0 + 7.0)), 0.0, cap || (flags & 1u) == 0u);
    s = hblend(s, wd, select(woodW * (1.0 - remn), 1.0, cap));
  }
  if ((flags & 32u) != 0u) { s.alb = vec3f(0.055, 0.034, 0.02) * (0.7 + 0.6 * fbm(lp * 9.0)); s.rough = 0.92; s.ao = s.ao * 0.45; }
  // crevices of the geometric bark relief (fissures and ridges below the texture's scale) and base occlusion
  let cav = select(clamp(-relief / max(0.012, 0.06 * clamp(r, 0.03, 1.5)), 0.0, 1.0), 0.0, cap);
  let ao = s.ao * s.ao * (1.0 - 0.45 * cav);
  let n = normalize(nG + s.pn * strength);
  return Surf(s.alb, n, clamp(s.rough, 0.3, 1.0), ao);
}

fn ggx(N: vec3f, V: vec3f, L: vec3f, rough: f32) -> f32 {
  let H = normalize(V + L); let a = rough * rough; let a2 = a * a;
  let ndh = max(dot(N, H), 0.0); let ndv = max(dot(N, V), 1e-3); let ndl = max(dot(N, L), 0.0);
  let dd = ndh * ndh * (a2 - 1.0) + 1.0; let D = a2 / (PI * dd * dd);
  let k = (rough + 1.0) * (rough + 1.0) / 8.0;
  let G = ndv / (ndv * (1.0 - k) + k) * ndl / (ndl * (1.0 - k) + k);
  let F = 0.04 + 0.96 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
  return D * G * F / (4.0 * ndv * max(ndl, 1e-3)) * ndl;
}

@fragment fn fs(i: VOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let mode = u32(u.mode.x + 0.5);
  var n = normalize(i.n);
  if (!ff) { n = -n; }
  let kind = u32(u.off.w + 0.5);
  // bark mapping frame and its screen derivatives (computed here, in uniform control flow)
  var A = i.ax; let al = length(A); A = select(vec3f(0.0, 1.0, 0.0), A / al, al > 1e-4);
  let yy = max(1.0 + A.y, 0.05);
  let P = vec3f(1.0 - A.x * A.x / yy, -A.x, -A.x * A.z / yy);
  let Q = vec3f(-A.x * A.z / yy, -A.z, 1.0 - A.z * A.z / yy);
  let d = i.lp - i.org;
  let nl = rotY(n, -u.cam.w);   // tree-local normal: the bark mapping lives in the tree's own frame
  let sq = select(-1.0, 1.0, dot(nl, Q) >= 0.0); let sp = select(1.0, -1.0, dot(nl, P) >= 0.0);
  let c1 = vec2f(dot(d, P) * sq + select(0.37, 0.0, sq > 0.0), dot(d, A));
  let c2 = vec2f(dot(d, Q) * sp + select(0.61, 0.0, sp > 0.0), dot(d, A));
  let c3 = vec2f(dot(d, P), dot(d, Q));
  let dx = dpdx(d); let dy = dpdy(d);
  var wv = pow(abs(vec3f(dot(nl, Q), dot(nl, P), dot(nl, A))), vec3f(4.0));
  wv = wv / max(wv.x + wv.y + wv.z, 1e-4);
  let x = Ctx(c1, c2, c3,
    vec2f(dot(dx, P) * sq, dot(dx, A)), vec2f(dot(dy, P) * sq, dot(dy, A)),
    vec2f(dot(dx, Q) * sp, dot(dx, A)), vec2f(dot(dy, Q) * sp, dot(dy, A)),
    vec2f(dot(dx, P), dot(dx, Q)), vec2f(dot(dy, P), dot(dy, Q)),
    P * sq, Q * sp, Q, P, A, wv);

  if (mode == 2u) { return vec4f(select(vec3f(0.0), vec3f(0.92), kind == 1u), 1.0); }        // silhouette: black tree, light ground
  if (mode == 4u) { return vec4f(n * 0.5 + 0.5, 1.0); }
  let L = normalize(u.sun.xyz);
  let sunC = u.sunc.xyz * u.sun.w;
  if (mode == 0u || mode == 6u || mode == 7u) {
    // ---- materials: physically based (Lambert + GGX, F0 0.04), sky and ground bounce, sun shadow map
    var sf = Surf(vec3f(0.3), n, 0.9, 1.0);
    if (kind == 0u) {
      if (u.mode.z > 0.5) { sf = treeSurface(i, nl, x, u32(u.mode.y + 0.5)); sf.n = rotY(sf.n, u.cam.w); }
      else { sf.alb = vec3f(0.13, 0.11, 0.09); }
    } else if (kind == 1u) {
      let gg = abs(fract(i.wp.xz / 5.0 + 0.5) - 0.5) * 5.0; let w = fwidth(i.wp.xz) * 1.2;
      let line = 1.0 - min(smoothstep(vec2f(0.0), w + 0.02, gg).x, smoothstep(vec2f(0.0), w + 0.02, gg).y);
      let gc = vec2f(i.wp.x, -i.wp.z); let gdx = dpdx(gc); let gdy = dpdy(gc);
      if (u.env.y > 0.5 && u.mode.z > 0.5) {
        // woodland: photoscanned forest floor (moss, leaf litter), two scales blended by a slow noise against tiling
        // (no along-axis bands here: two scales, the second turned 37°, height-blended by a slow noise)
        let t = TILE[4]; let c37 = 0.799; let s37 = 0.602;
        let r2 = vec2f(c37 * gc.x - s37 * gc.y, s37 * gc.x + c37 * gc.y) / 1.73 + vec2f(0.37, 0.71);
        var g1 = fetchL(4, gc / t, gdx / t, gdy / t, vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, -1.0));
        let g2 = fetchL(4, r2 / t, vec2f(c37 * gdx.x - s37 * gdx.y, s37 * gdx.x + c37 * gdx.y) / (1.73 * t), vec2f(c37 * gdy.x - s37 * gdy.y, s37 * gdy.x + c37 * gdy.y) / (1.73 * t), vec3f(c37, 0.0, -s37), vec3f(-s37, 0.0, -c37));
        g1 = hblend(g1, g2, smoothstep(0.3, 0.7, fbm(vec3f(i.wp.xz * 0.06, 4.0))));
        let gl = dot(g1.alb, vec3f(0.3, 0.59, 0.11));
        sf.alb = mix(vec3f(gl), g1.alb, 0.65) * vec3f(0.62, 0.7, 0.5) * (0.8 + 0.4 * fbm(vec3f(i.wp.xz * 0.25, 9.0)));
        sf.n = normalize(n + g1.pn * 1.2); sf.rough = g1.rough; sf.ao = g1.ao;
      } else {
        // plot: dull soil tone; the 5 m survey grid stays as a faint scale reference
        let g = fbm(vec3f(i.wp.xz * 0.7, 1.0)) * 0.6 + fbm(vec3f(i.wp.xz * 6.0, 2.0)) * 0.4;
        sf.alb = mix(vec3f(0.055, 0.045, 0.03), vec3f(0.11, 0.1, 0.06), g);
        sf.alb = mix(sf.alb, sf.alb * 0.6, line * 0.5);
      }
    } else if (kind == 2u) { sf.alb = vec3f(0.30, 0.12, 0.06); sf.rough = 0.7; }
    else {
      let b = floor(i.wp.y);
      sf.alb = select(vec3f(0.52, 0.5, 0.45), vec3f(0.38, 0.02, 0.015), (i32(b) & 1) == 1);
      if (fract(i.wp.y / 5.0) > 0.96 || fract(i.wp.y / 5.0) < 0.04) { sf.alb = vec3f(0.01); }
      sf.rough = 0.6;
    }
    let N = sf.n;
    // impostor bake (render/impostor.ts): unlit albedo, or tree-local normal with ambient occlusion
    if (mode == 6u) { return vec4f(srgb(sf.alb), 1.0); }
    if (mode == 7u) { return vec4f(octEnc(rotY(N, -u.cam.w)) * 0.5 + 0.5, 0.5 * sf.ao * select(1.0, mix(0.5, 1.0, smoothstep(0.0, 1.2, i.lp.y)), kind == 0u), 1.0); }
    let V = normalize(u.cam.xyz - i.wp);
    let sh = mix(1.0, shadow(i.wp, n), u.hor.w);
    let ndl = max(dot(N, L), 0.0) * smoothstep(-0.05, 0.1, dot(n, L));   // the geometric side decides (no light leaks)
    let sky = mix(u.hor.xyz, u.zen.xyz, 0.5 + 0.5 * N.y) * (0.6 + 0.4 * N.y) * u.zen.w;
    let bounce = vec3f(0.12, 0.10, 0.07) * (0.5 - 0.5 * N.y) * u.zen.w;
    let F = normalize(vec3f(-L.x, 0.45, -L.z));
    let fill = vec3f(u.sunc.w) * max(dot(N, F), 0.0);
    let baseAo = select(1.0, mix(0.5, 1.0, smoothstep(0.0, 1.2, i.lp.y)), kind == 0u);
    let ao = sf.ao * baseAo;
    var c = sf.alb * (sunC * ndl * sh + (sky + bounce + fill) * ao);
    c += sunC * sh * ggx(N, V, L, sf.rough) * PI * 0.5;
    let fr = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0) * (1.0 - sf.rough) ;
    c += sky * fr * ao * 0.25;
    if (u.env.x < 0.5) { let dd = length(u.cam.xyz - i.wp); c = mix(c, u.hor.xyz * 0.9, 1.0 - exp(-dd * 0.002)); }
    return vec4f(srgb(aces(c * u.mode.w)), 1.0);
  }
  // ---- structural modes (clay, hierarchy): unchanged from the structural phase
  var alb = vec3f(0.36);
  if (kind == 1u) {
    alb = vec3f(0.30, 0.31, 0.27);
    // 5 m survey grid on the ground (scale reference)
    let g = abs(fract(i.wp.xz / 5.0 + 0.5) - 0.5) * 5.0;
    let w = fwidth(i.wp.xz) * 1.2;
    let line = 1.0 - min(smoothstep(vec2f(0.0), w + 0.02, g).x, smoothstep(vec2f(0.0), w + 0.02, g).y);
    alb = mix(alb, alb * 0.72, line * 0.8);
  }
  if (kind == 2u) { alb = vec3f(0.55, 0.30, 0.20); }
  if (kind == 3u) {
    // ranging pole: alternate 1 m bands, a dark band every 5 m
    let b = floor(i.wp.y);
    alb = select(vec3f(0.75, 0.74, 0.7), vec3f(0.62, 0.12, 0.1), (i32(b) & 1) == 1);
    if (fract(i.wp.y / 5.0) > 0.96 || fract(i.wp.y / 5.0) < 0.04) { alb = vec3f(0.05); }
  }
  if (mode == 5u && kind == 0u) { alb = hierCol(i.a.x, i.a.y); }
  let sh = mix(1.0, shadow(i.wp, n), u.hor.w);
  let ndl = max(dot(n, L), 0.0);
  let sky = mix(u.hor.xyz, u.zen.xyz, 0.5 + 0.5 * n.y) * (0.6 + 0.4 * n.y) * u.zen.w;
  let ground = vec3f(0.25, 0.24, 0.2) * (0.5 - 0.5 * n.y) * 0.5;
  let F = normalize(vec3f(-L.x, 0.45, -L.z));
  let fill = vec3f(u.sunc.w) * max(dot(n, F), 0.0);
  // cheap ambient occlusion towards the trunk base
  let ao = select(1.0, mix(0.55, 1.0, smoothstep(0.0, 1.2, i.wp.y)), kind == 0u);
  var c = alb * (sunC * ndl * sh + (sky + ground) * ao + fill * ao);
  let H = normalize(L + normalize(u.cam.xyz - i.wp));
  c += sunC * sh * pow(max(dot(n, H), 0.0), 40.0) * 0.04 * ndl;
  if (u.env.x < 0.5) {
    let dd = length(u.cam.xyz - i.wp);
    c = mix(c, u.hor.xyz, 1.0 - exp(-dd * 0.0025));
  }
  return vec4f(srgb(aces(c * 0.55)), 1.0);
}
@fragment fn fsWire(i: VOut) -> @location(0) vec4f {
  let kind = u32(u.off.w + 0.5);
  if (kind == 1u) { return vec4f(0.6, 0.6, 0.6, 1.0); }
  return vec4f(hierCol(i.a.x, i.a.y) * 0.9, 1.0);
}


// ================================================================ foliage (instanced; see framework/foliage.ts)
// off.w: 4 leaf (bent blade), 5 card, 6 twig, 7 needle fascicle; env.y texture layer, env.zw sprite grid; mode.y bark
// material family (twig colour). Template: x across [−0.5, 0.5], y along [0, 1]; twigs: x = angle, y along.
@group(0) @binding(6) var folAlb: texture_2d_array<f32>;   // rgb front albedo, a opacity
@group(0) @binding(7) var folNrm: texture_2d_array<f32>;   // rg normal, b roughness, a translucency
// packed instance (framework/foliage.ts PACKED): position + length unorm16, quaternion snorm8, width/fold/curl/r1
// unorm8, cell/exposure/variation unorm8
struct FIn { @location(0) t: vec2f, @location(1) ia: vec4f, @location(2) iq: vec4f, @location(3) ib: vec4f, @location(4) ic: vec4f };
struct Inst { p: vec3f, q: vec4f, sx: f32, sy: f32, fold: f32, curl: f32, r1: f32, cell: f32, e: f32, v: f32 };
fn inst(i: FIn) -> Inst {
  var o: Inst;
  o.p = vec3f(i.ia.x * 80.0 - 40.0, i.ia.y * 80.0 - 5.0, i.ia.z * 80.0 - 40.0); o.sy = i.ia.w * 2.0;
  o.q = normalize(i.iq);
  o.sx = 0.0005 * exp2(i.ib.x * 10.0); o.fold = i.ib.y * 0.5; o.curl = i.ib.z * 0.5; o.r1 = i.ib.w;
  o.cell = round(i.ic.x * 255.0); o.e = i.ic.y; o.v = i.ic.z * 2.0 - 1.0;
  return o;
}
struct FOut {
  @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) uv: vec2f,
  @location(2) n: vec3f, @location(3) tx: vec3f, @location(4) ty: vec3f, @location(5) e: vec3f,   // exposure, variation, along
};
fn qrot(q: vec4f, v: vec3f) -> vec3f { let t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t); }
fn folLocal(i: FIn, n: Inst) -> array<vec3f, 3> {   // position, normal, (unused)
  let k = u32(u.off.w + 0.5);
  if (k == 6u) {
    let a = i.t.x * 6.2831853; let r = n.sx * mix(1.0, n.r1, i.t.y);
    return array<vec3f, 3>(vec3f(cos(a) * r, i.t.y * n.sy, sin(a) * r), vec3f(cos(a), 0.0, sin(a)), vec3f(0.0));
  }
  let X = i.t.x * n.sx; let Y = i.t.y * n.sy;
  // midrib fold (edges raised) and curl along the blade (tip bends back)
  let z = n.fold * abs(i.t.x) * 2.0 * n.sx - n.curl * i.t.y * i.t.y * n.sy;
  let dzdx = n.fold * sign(i.t.x) * 2.0; let dzdy = -2.0 * n.curl * i.t.y;
  return array<vec3f, 3>(vec3f(X, Y, z), normalize(vec3f(-dzdx, -dzdy, 1.0)), vec3f(0.0));
}
@vertex fn vsFol(i: FIn) -> FOut {
  var o: FOut;
  let n = inst(i);
  let L = folLocal(i, n);
  let wp = rotY(n.p + qrot(n.q, L[0]), u.cam.w) + u.off.xyz;
  o.cp = u.vp * vec4f(wp, 1.0); o.wp = wp;
  let c = n.cell; let gx = max(u.env.z, 1.0); let gy = max(u.env.w, 1.0);
  let col = c - gx * floor(c / gx); let row = floor(c / gx);
  o.uv = vec2f((col + i.t.x + 0.5) / gx, (row + 1.0 - i.t.y * 0.999) / gy);
  o.n = rotY(qrot(n.q, L[1]), u.cam.w); o.tx = rotY(qrot(n.q, vec3f(1.0, 0.0, 0.0)), u.cam.w); o.ty = rotY(qrot(n.q, vec3f(0.0, 1.0, 0.0)), u.cam.w);
  o.e = vec3f(n.e, n.v, i.t.y);
  return o;
}
@vertex fn vsFolShadow(i: FIn) -> FOut {
  var o: FOut;
  let n = inst(i);
  let L = folLocal(i, n);
  let wp = rotY(n.p + qrot(n.q, L[0]), u.cam.w) + u.off.xyz;
  o.cp = u.sm * vec4f(wp, 1.0); o.wp = wp;
  let c = n.cell; let gx = max(u.env.z, 1.0); let gy = max(u.env.w, 1.0);
  o.uv = vec2f((c - gx * floor(c / gx) + i.t.x + 0.5) / gx, (floor(c / gx) + 1.0 - i.t.y * 0.999) / gy);
  o.n = vec3f(0.0); o.tx = vec3f(0.0); o.ty = vec3f(0.0); o.e = vec3f(0.0);
  return o;
}
@fragment fn fsFolShadow(i: FOut) {
  if (u32(u.off.w + 0.5) == 6u || u32(u.off.w + 0.5) == 8u) { return; }
  let a = textureSampleLevel(folAlb, barkSmp, i.uv, i32(u.env.y + 0.5), 1.0).a;
  if (a * select(1.0, 2.5, u32(u.off.w + 0.5) == 7u) < 0.5) { discard; }
}
fn folAlpha(a: f32, uv: vec2f, boost: f32) -> f32 {
  // alpha-to-coverage with mip-aware sharpening: the opacity edge stays one pixel wide at every distance, and
  // coverage is boosted with the mip level so thin leaves and needles do not dissolve far away
  let d = max(length(dpdx(uv)), length(dpdy(uv))) * 1024.0;
  let lvl = max(log2(max(d, 1e-4)), 0.0);
  let aa = a * (1.0 + boost * lvl);
  return clamp((aa - 0.5) / max(fwidth(aa), 1e-4) + 0.5, 0.0, 1.0);
}
@fragment fn fsFol(i: FOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let k = u32(u.off.w + 0.5); let layer = i32(u.env.y + 0.5); let mode = u32(u.mode.x + 0.5);
  let A = textureSample(folAlb, barkSmp, i.uv, layer);
  let Nt = textureSample(folNrm, barkSmp, i.uv, layer);
  // needles are 2–3 texels wide: their coverage needs a much stronger boost with distance than broad leaves
  // distance boost on top of the coverage-preserving mips (viewer.alphaBoost, carried in sunc.w for foliage draws)
  let alpha = select(folAlpha(A.a, i.uv, u.sunc.w), 1.0, k == 6u || k == 8u);
  if (mode == 2u) { return vec4f(0.0, 0.0, 0.0, alpha); }
  var Ng = normalize(i.n); if (!ff) { Ng = -Ng; }
  if (mode == 4u) { return vec4f(Ng * 0.5 + 0.5, alpha); }
  let L = normalize(u.sun.xyz); let V = normalize(u.cam.xyz - i.wp);
  let sunC = u.sunc.xyz * u.sun.w;
  // a card stands for a spray's volume of leaves around its plane: its shadow is tested a spray's depth towards the
  // sun, so the crossed partner card and the card itself do not shadow it (they did: LOD1 crowns were far darker)
  let wpS = select(i.wp, i.wp + L * 0.35, k == 5u);
  let sh = mix(1.0, shadow(wpS, select(Ng, L, k == 5u)), u.hor.w);
  let exposure = i.e.x; let vari = i.e.y;
  if (mode != 0u && mode < 6u) {
    // structural modes: foliage in a neutral clay green-grey, so leafless/foliated clay views stay comparable
    let alb = select(vec3f(0.30, 0.33, 0.28), vec3f(0.36), k == 6u);
    let sky = mix(u.hor.xyz, u.zen.xyz, 0.5 + 0.5 * Ng.y) * u.zen.w;
    let c = alb * (sunC * max(dot(Ng, L), 0.0) * sh + sky * mix(0.45, 1.0, exposure));
    return vec4f(srgb(aces(c * 0.55)), alpha);
  }
  if (k == 6u) {
    // twiglets: smooth young bark, species colour
    var tw = vec3f(0.13, 0.11, 0.085);
    if (u32(u.mode.y + 0.5) == 2u) { tw = vec3f(0.09, 0.045, 0.03); }
    if (mode == 6u) { return vec4f(srgb(tw), 1.0); }
    if (mode == 7u) { return vec4f(octEnc(rotY(Ng, -u.cam.w)) * 0.5 + 0.5, 0.5 * mix(0.55, 1.0, exposure), 1.0); }
    let sky = mix(u.hor.xyz, u.zen.xyz, 0.5 + 0.5 * Ng.y) * (0.6 + 0.4 * Ng.y) * u.zen.w;
    let c = tw * (sunC * max(dot(Ng, L), 0.0) * sh + sky * mix(0.6, 1.0, exposure));
    return vec4f(srgb(aces(c * u.mode.w)), 1.0);
  }
  // ---- leaves, needles, cards
  let tn = Nt.xy * 2.0 - 1.0;
  var T = normalize(i.tx); var B = normalize(i.ty);
  var N = normalize(Ng + (T * tn.x + B * tn.y) * select(1.0, -1.0, !ff) * 0.8);
  // pigmentation: per-shoot variation (yellower ↔ bluer, lighter ↔ darker); undersides paler, greyer
  var alb = A.rgb * (1.0 + 0.18 * vari) * mix(vec3f(1.0), vec3f(1.12, 1.05, 0.8), clamp(vari, 0.0, 1.0) * 0.5);
  if (!ff && k != 5u) { let g = dot(alb, vec3f(0.3, 0.59, 0.11)); alb = mix(alb, vec3f(g) * vec3f(0.95, 1.05, 0.95), 0.35) * 1.45; }
  // impostor bake: albedo (with the leaf's translucency in alpha's place, carried by the normal pass), tree-local
  // normal with the crown exposure as occlusion
  if (mode == 6u) { return vec4f(srgb(alb), alpha); }
  if (mode == 7u) { return vec4f(octEnc(rotY(N, -u.cam.w)) * 0.5 + 0.5, 0.5 + 0.5 * mix(0.3, 1.0, exposure), alpha); }
  let rough = clamp(Nt.z * select(1.0, 1.25, !ff), 0.3, 1.0);
  // a card stands for a shoot's worth of leaves at every angle: about half of them face the sun whichever way the
  // card faces, and the rest pass light through (lit by its one plane, a card was far darker than the leaves it replaces)
  var ndl = max(dot(N, L), 0.0);
  if (k == 5u) { ndl = 0.45 + 0.35 * max(dot(N, L), 0.0); }
  // transmission: sun through the blade when it lights the far face (thin, so most of the light passes the veins)
  let back = select(max(-dot(Ng, L), 0.0), 0.35 + 0.3 * max(-dot(Ng, L), 0.0), k == 5u);
  // transmitted light is tested for shadow on the leaf's sunlit side (offset towards the sun), not the visible side:
  // tested on the visible (dark) side every backlit leaf shadowed itself and the crown edge never glowed
  let shT = select(mix(1.0, shadow(i.wp, -Ng), u.hor.w), sh, k == 5u);
  let transCol = alb * vec3f(1.6, 1.8, 0.6) * Nt.w;
  // sky light reaching a leaf is attenuated by the crown above it (exposure), but a leaf crown is not a black box:
  // leaves pass on roughly half the light they intercept (reflectance + transmittance ≈ 0.2–0.4 in the green), so
  // the interior also receives light scattered between leaves; and a thin blade transmits the sky above it to its
  // underside. Without these two terms crown interiors and the view up into a crown were far too dark.
  let ao = mix(0.55, 1.0, exposure) * mix(0.88, 1.0, i.e.z);
  let skyUp = mix(u.hor.xyz, u.zen.xyz, 0.75) * u.zen.w;
  let sky = mix(u.hor.xyz, u.zen.xyz, 0.5 + 0.5 * N.y) * (0.65 + 0.35 * N.y) * u.zen.w;
  let bounce = vec3f(0.10, 0.10, 0.06) * (0.5 - 0.5 * N.y) * u.zen.w;
  let scatter = skyUp * (1.0 - exposure) * 0.3 + sunC * (1.0 - sh) * exposure * 0.06;
  var c = alb * (sunC * ndl * sh + (sky + bounce) * ao + scatter) + sunC * shT * transCol * back * (0.5 + 0.8 * pow(max(dot(V, -L), 0.0), 3.0));
  c += transCol * skyUp * (0.25 + 0.45 * max(-N.y, 0.0)) * ao;
  c += sunC * sh * ggx(N, V, L, rough) * PI * 0.35;
  if (u.env.x < 0.5) { let dd = length(u.cam.xyz - i.wp); c = mix(c, u.hor.xyz * 0.9, 1.0 - exp(-dd * 0.002)); }
  return vec4f(srgb(aces(c * u.mode.w)), alpha);
}

// ---- overdraw counting (additive, no depth test): r = bark/other fragments, g = foliage fragments passing the alpha test
@fragment fn fsCount(i: VOut) -> @location(0) vec4f { return vec4f(1.0, 0.0, 0.0, 0.0); }
// b = every rasterized foliage fragment, before the alpha test (what the GPU pays for)
@fragment fn fsFolCount(i: FOut) -> @location(0) vec4f {
  let k = u32(u.off.w + 0.5);
  var g = 1.0;
  if (k != 6u && k != 8u) {
    let a = textureSampleLevel(folAlb, barkSmp, i.uv, i32(u.env.y + 0.5), 0.0).a;
    if (a < 0.5) { g = 0.0; }
  }
  return vec4f(0.0, g, 1.0, 0.0);
}
struct SkyOut { @builtin(position) p: vec4f, @location(0) uv: vec2f };
@vertex fn vsSky(@builtin(vertex_index) k: u32) -> SkyOut { var o: SkyOut; let p = vec2f(f32(i32(k & 1u) * 4 - 1), f32(i32(k >> 1u) * 4 - 1)); o.p = vec4f(p, 1.0, 1.0); o.uv = p; return o; }
@fragment fn fsSky(i: SkyOut) -> @location(0) vec4f {
  let mode = u32(u.mode.x + 0.5);
  if (mode == 2u) { return vec4f(1.0); }
  if (mode == 3u || mode == 4u || mode == 5u) { return vec4f(0.12, 0.12, 0.13, 1.0); }
  let t = i.uv.y * 0.5 + 0.5;
  if (u.env.x > 0.5) { return vec4f(srgb(aces(mix(vec3f(0.62), vec3f(0.78), t) * 0.9)), 1.0); }
  let c = mix(u.hor.xyz, u.zen.xyz * 0.8, t);
  return vec4f(srgb(aces(c * 0.9)), 1.0);
}
`;

interface Target { w: number; h: number; msaa: GPUTexture; depth: GPUTexture }

export class Viewer {
  device!: GPUDevice; ctx!: GPUCanvasContext; format!: GPUTextureFormat;
  private pipe!: GPURenderPipeline; private wire!: GPURenderPipeline; private sky!: GPURenderPipeline; private shadowPipe!: GPURenderPipeline;
  private ubuf!: GPUBuffer; private bgs: GPUBindGroup[] = []; private shadowTex!: GPUTexture;
  private screen: Target | null = null;
  draws: Draw[] = [];
  mode: Mode = 'clay';
  light: LightPreset = LIGHTS[0];
  shadowVP = new Float32Array(16);
  shadowDirty = true;
  hasTs = false; private qs: GPUQuerySet | null = null; private qbuf: GPUBuffer | null = null; private qread: GPUBuffer[] = []; private qbusy = [false, false];
  adapterName = '';
  gpuMs = 0; cpuMs = 0; drawCalls = 0; tris = 0; verts = 0;
  geometryBytes = 0;
  shadowSize = 4096;

  async init(canvas: HTMLCanvasElement, shadowSize = 4096): Promise<void> {
    const ad = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
    if (!ad) throw new Error('WebGPU is not available in this browser.');
    this.hasTs = ad.features.has('timestamp-query');
    const info = (ad as any).info || {};
    this.adapterName = [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || 'WebGPU adapter';
    this.device = await ad.requestDevice({ requiredFeatures: this.hasTs ? ['timestamp-query'] : [], requiredLimits: { maxBufferSize: Math.min(ad.limits.maxBufferSize, 1 << 30), maxStorageBufferBindingSize: Math.min(ad.limits.maxStorageBufferBindingSize, 1 << 30) } });
    this.device.addEventListener('uncapturederror', (e: any) => { console.error('WebGPU', e.error?.message); (window as any).__errors = ((window as any).__errors || []).concat(e.error?.message); });
    this.ctx = canvas.getContext('webgpu')!;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device: this.device, format: this.format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const d = this.device;
    const m = d.createShaderModule({ code: SHADER });
    const bgl = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 256 } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } }] });
    this.bgl = bgl;
    const layout = d.createPipelineLayout({ bindGroupLayouts: [bgl] });
    const vb: GPUVertexBufferLayout[] = [{ arrayStride: VFLOATS * 4, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
      { shaderLocation: 2, offset: 24, format: 'float32x4' }, { shaderLocation: 3, offset: 40, format: 'float32x3' }, { shaderLocation: 4, offset: 52, format: 'float32x3' }] }];
    const ds: GPUDepthStencilState = { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' };
    this.pipe = d.createRenderPipeline({ layout, vertex: { module: m, entryPoint: 'vs', buffers: vb }, fragment: { module: m, entryPoint: 'fs', targets: [{ format: this.format }] }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: ds, multisample: { count: 4 } });
    this.wire = d.createRenderPipeline({ layout, vertex: { module: m, entryPoint: 'vs', buffers: vb }, fragment: { module: m, entryPoint: 'fsWire', targets: [{ format: this.format }] }, primitive: { topology: 'line-list' }, depthStencil: { ...ds, depthCompare: 'less-equal' }, multisample: { count: 4 } });
    this.sky = d.createRenderPipeline({ layout, vertex: { module: m, entryPoint: 'vsSky' }, fragment: { module: m, entryPoint: 'fsSky', targets: [{ format: this.format }] }, depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'less-equal' }, multisample: { count: 4 } });
    this.shadowPipe = d.createRenderPipeline({ layout, vertex: { module: m, entryPoint: 'vsShadow', buffers: vb }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2 } });
    // foliage: a template mesh (slot 0: template coordinates) instanced per leaf / card / twig (slot 1)
    const fvb: GPUVertexBufferLayout[] = [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
      { arrayStride: PACKED, stepMode: 'instance', attributes: [{ shaderLocation: 1, offset: 0, format: 'unorm16x4' }, { shaderLocation: 2, offset: 8, format: 'snorm8x4' }, { shaderLocation: 3, offset: 12, format: 'unorm8x4' }, { shaderLocation: 4, offset: 16, format: 'unorm8x4' }] }];
    this.folPipe = d.createRenderPipeline({ layout, vertex: { module: m, entryPoint: 'vsFol', buffers: fvb }, fragment: { module: m, entryPoint: 'fsFol', targets: [{ format: this.format }] }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: ds, multisample: { count: 4, alphaToCoverageEnabled: true } });
    this.folShadow = d.createRenderPipeline({ layout, vertex: { module: m, entryPoint: 'vsFolShadow', buffers: fvb }, fragment: { module: m, entryPoint: 'fsFolShadow', targets: [] }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2 } });
    this.templates = this.makeTemplates();
    this.ubuf = d.createBuffer({ size: 256 * 4096, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.shadowSize = shadowSize;
    this.shadowTex = d.createTexture({ size: [shadowSize, shadowSize], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const dummy = d.createTexture({ size: [1, 1], format: 'depth32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
    this.cmp = d.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' });
    this.barkSampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', maxAnisotropy: 8 });
    this.dummyDepth = dummy;
    const one = (f: GPUTextureFormat) => d.createTexture({ size: [1, 1, 1], format: f, usage: GPUTextureUsage.TEXTURE_BINDING, dimension: '2d' });
    this.barkAlb = one('rgba8unorm-srgb'); this.barkNrm = one('rgba8unorm');
    this.folAlb = one('rgba8unorm-srgb'); this.folNrm = one('rgba8unorm');
    this.rebind();
    if (this.hasTs) {
      this.qs = d.createQuerySet({ type: 'timestamp', count: 2 });
      this.qbuf = d.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
      this.qread = [0, 1].map(() => d.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
    }
  }

  private bgl!: GPUBindGroupLayout; private cmp!: GPUSampler; private barkSampler!: GPUSampler; private dummyDepth!: GPUTexture;
  private barkAlb!: GPUTexture; private barkNrm!: GPUTexture; private folAlb!: GPUTexture; private folNrm!: GPUTexture;
  private folPipe!: GPURenderPipeline; private folShadow!: GPURenderPipeline;
  private templates!: Record<string, { buf: GPUBuffer; count: number; tris: number }>;
  /** Foliage textures: loaded once (loadFoliage). */
  folTex: TexStats | null = null;
  /** content key of the loaded foliage textures (impostor atlas fingerprints) */
  folTexKey = '';
  foliageBytes = 0;
  /** natural woodland review environment (forest-floor ground, no survey grid); false: the neutral plot */
  woodland = false;
  /** Template meshes in template coordinates (x across, y along): a blade bent along its midrib (3 × 3), a flat
   *  fascicle (2 × 2), a card with a slight fold (3 × 2), a 4-sided tapered twig. Non-indexed triangle lists. */
  private makeTemplates() {
    const grid = (nx: number, ny: number): number[] => {
      const v: number[] = [], P = (i: number, j: number) => [-0.5 + i / (nx - 1), j / (ny - 1)];
      for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), dd = P(i, j + 1); v.push(...a, ...b, ...c, ...a, ...c, ...dd); }
      return v;
    };
    const twig: number[] = [];
    for (let k = 0; k < 4; k++) { const a = k / 4, b = (k + 1) / 4; twig.push(a, 0, b, 0, b, 1, a, 0, b, 1, a, 1); }
    const mk = (v: number[]) => { const b = this.device.createBuffer({ size: v.length * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }); this.device.queue.writeBuffer(b, 0, new Float32Array(v)); return { buf: b, count: v.length / 2, tris: v.length / 6 }; };
    return { leaf: mk(grid(3, 3)), needle: mk(grid(2, 2)), card: mk(grid(3, 2)), twig: mk(twig) } as Record<string, { buf: GPUBuffer; count: number; tris: number }>;
  }
  private outlines: number[][][] = [];
  /** Upload foliage in a representation: 'geometry' splits the leaf / fascicle set by sprite and draws each sprite's
   *  own triangulated outline (opaque); 'cards' is the LOD1 data (the caller passes it); hybrid draws as given. */
  uploadFoliageAs(f: FoliageLod, rep: FoliageRep): GpuFoliage {
    if (rep !== 'geometry') return this.uploadFoliage(f);
    const sets: FoliageLod['sets'] = [];
    for (const s of f.sets) {
      if (s.kind !== 'leaf' && s.kind !== 'needle') { sets.push(s); continue; }
      for (let cell = 0; cell < 8; cell++) {
        const pick: number[] = [];
        for (let k = 0; k < s.count; k++) if (s.data[k * PACKED + 16] === cell) pick.push(k);
        const d = new Uint8Array(pick.length * PACKED); pick.forEach((k, j) => d.set(s.data.subarray(k * PACKED, k * PACKED + PACKED), j * PACKED));
        sets.push({ kind: 'poly' as never, layer: s.layer, grid: s.grid, data: d, count: pick.length, cell } as never);
      }
    }
    return this.uploadFoliage({ ...f, sets });
  }
  /** alpha boost per mip level on top of the coverage-preserving mips (leaves and cards; needles) */
  alphaBoost = { leaf: 0.15, needle: 0.5 };
  /** card boundaries: true = hull-fitted outlines (tools/foliage_textures.py card_hulls), false = full quads */
  hullCards = true;
  uploadFoliage(f: FoliageLod): GpuFoliage {
    const live = f.sets.filter((s) => s.count);
    // one buffer per specimen-LOD; each set starts on a 256-byte boundary (vertex buffer offsets must be aligned)
    const offs: number[] = []; let size = 0;
    for (const s of live) { offs.push(size); size += Math.ceil(s.data.byteLength / 256) * 256; }
    const buf = size ? this.device.createBuffer({ size, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }) : null;
    const sets = live.map((s, k) => {
      this.device.queue.writeBuffer(buf!, offs[k], s.data);
      const tmpl = (s.kind as string) === 'poly' ? this.polyTemplate(s.layer, (s as unknown as { cell: number }).cell)
        : s.kind === 'card' && this.hullCards && s.hull ? this.hullTemplate(s.layer, s.hull) : s.kind;
      return { kind: s.kind as GpuFoliage['sets'][number]['kind'], layer: s.layer, grid: s.grid, buf: buf!, offset: offs[k], count: s.count, tmpl };
    });
    const bytes = live.reduce((a, s) => a + s.data.byteLength, 0); this.foliageBytes += bytes;
    return { buf, sets, bytes, instances: sets.reduce((a, s) => a + s.count, 0), triangles: sets.reduce((a, s) => a + s.count * this.templates[s.tmpl].tris, 0) };
  }
  private hulls: Record<string, number[]>[] = [];
  private hullTemplate(layer: number, kind: 'shoot' | 'clump'): string {
    const key = `hull:${layer}:${kind}`, v = this.hulls[layer]?.[kind];
    if (!v) return 'card';
    if (!this.templates[key]) {
      const b = this.device.createBuffer({ size: v.length * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }); this.device.queue.writeBuffer(b, 0, new Float32Array(v));
      this.templates[key] = { buf: b, count: v.length / 2, tris: v.length / 6 };
    }
    return key;
  }
  private polyTemplate(layer: number, cell: number): string {
    const key = `poly:${layer}:${cell}`;
    if (!this.templates[key]) {
      const v = this.outlines[layer]?.[cell] ?? [];
      const b = this.device.createBuffer({ size: Math.max(16, v.length * 4), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }); this.device.queue.writeBuffer(b, 0, new Float32Array(v));
      this.templates[key] = { buf: b, count: v.length / 2, tris: v.length / 6 };
    }
    return key;
  }
  destroyFoliage(g: GpuFoliage): void { g.buf?.destroy(); this.foliageBytes -= g.bytes; }
  /** Load the foliage texture array (textures/foliage.json from tools/foliage_textures.py): sprite layers and card
   *  layers, mips built on the GPU like the bark's. */
  async loadFoliage(base: string, bust = ''): Promise<TexStats> {
    const t0 = performance.now(), d = this.device;
    const man = await (await fetch(`${base}foliage.json${bust ? '?v=' + bust : ''}`)).json() as { size: number; layers: { id: string; albedo: string; normal: string; outlines?: number[][]; hulls?: Record<string, number[]>; alphaScale?: number[] }[] };
    this.outlines = man.layers.map((l) => l.outlines ?? []);
    this.folTexKey = man.layers.map((l) => `${l.albedo.split('?')[1] ?? ''}${l.normal.split('?')[1] ?? ''}`).join('').slice(0, 64);
    this.hulls = man.layers.map((l) => l.hulls ?? {});
    if (man.layers.map((l) => l.id).join() !== FOLIAGE_LAYERS.join()) throw new Error('foliage texture manifest does not match the renderer layers');
    const n = man.layers.length, S = man.size, levels = Math.floor(Math.log2(S)) + 1;
    const mk = (f: GPUTextureFormat) => d.createTexture({ size: [S, S, n], format: f, mipLevelCount: levels, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    const alb = mk('rgba8unorm-srgb'), nrm = mk('rgba8unorm');
    let download = 0;
    await Promise.all(man.layers.flatMap((l, k) => [[alb, l.albedo], [nrm, l.normal]].map(async ([tex, file]) => {
      const blob = await (await fetch(base + (file as string))).blob(); download += blob.size;
      const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      d.queue.copyExternalImageToTexture({ source: bmp }, { texture: tex as GPUTexture, origin: [0, 0, k], premultipliedAlpha: false }, [S, S]);
      bmp.close();
    })));
    this.mips(alb, nrm, n, levels);
    const scaled = this.alphaScaled(alb, n, levels, man.layers.map((l) => l.alphaScale ?? []));
    this.folAlb.destroy(); this.folNrm.destroy(); this.folAlb = scaled; this.folNrm = nrm; this.rebind();
    let bytes = 0; for (let l = 0; l < levels; l++) bytes += Math.max(1, S >> l) ** 2 * 4 * n * 2;
    this.folTex = { layers: n, size: S, bytes, download, ms: performance.now() - t0 };
    return this.folTex;
  }
  /** Bark textures: loaded once (loadBark); null until then (the materials mode shows a flat placeholder). */
  tex: TexStats | null = null;
  private rebind(): void {
    const d = this.device, av = this.barkAlb.createView({ dimension: '2d-array' }), nv = this.barkNrm.createView({ dimension: '2d-array' });
    this.bgs = [this.shadowTex, this.dummyDepth].map((t) => d.createBindGroup({ layout: this.bgl, entries: [{ binding: 0, resource: { buffer: this.ubuf, size: 256 } }, { binding: 1, resource: t.createView() }, { binding: 2, resource: this.cmp },
      { binding: 3, resource: av }, { binding: 4, resource: nv }, { binding: 5, resource: this.barkSampler },
      { binding: 6, resource: this.folAlb.createView({ dimension: '2d-array' }) }, { binding: 7, resource: this.folNrm.createView({ dimension: '2d-array' }) }] }));
  }

  /** Load the bark texture arrays (textures/manifest.json from tools/textures.py), build their mip chains on the GPU
   *  (albedo averaged in linear light; normals renormalized, with their spread folded into roughness so that distant
   *  bark does not turn glossy), and bind them. */
  async loadBark(base: string, bust = ''): Promise<TexStats> {
    const t0 = performance.now(), d = this.device;
    const man = await (await fetch(`${base}manifest.json${bust ? '?v=' + bust : ''}`)).json() as { size: number; layers: { id: string; albedo: string; normal: string }[] };
    if (man.layers.map((l) => l.id).join() !== BARK_LAYERS.map((l) => l.id).join()) throw new Error('bark texture manifest does not match the renderer layers');
    const n = man.layers.length, S = man.size, levels = Math.floor(Math.log2(S)) + 1;
    const mk = (f: GPUTextureFormat) => d.createTexture({ size: [S, S, n], format: f, mipLevelCount: levels, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    const alb = mk('rgba8unorm-srgb'), nrm = mk('rgba8unorm');
    let download = 0;
    await Promise.all(man.layers.flatMap((l, k) => [[alb, l.albedo], [nrm, l.normal]].map(async ([tex, file]) => {
      const blob = await (await fetch(base + (file as string))).blob(); download += blob.size;
      const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      d.queue.copyExternalImageToTexture({ source: bmp }, { texture: tex as GPUTexture, origin: [0, 0, k], premultipliedAlpha: false }, [S, S]);
      bmp.close();
    })));
    this.mips(alb, nrm, n, levels);
    this.barkAlb.destroy(); this.barkNrm.destroy();
    this.barkAlb = alb; this.barkNrm = nrm; this.rebind();
    let bytes = 0; for (let l = 0; l < levels; l++) bytes += Math.max(1, S >> l) ** 2 * 4 * n * 2;
    this.tex = { layers: n, size: S, bytes, download, ms: performance.now() - t0 };
    return this.tex;
  }
  /** Coverage-preserving alpha: a copy of the mip chain with each level's alpha scaled (per layer, scales from
   *  tools/foliage_textures.py) so the share of texels passing the alpha test matches level 0 at every distance. */
  alphaCoverage = true;
  private alphaScaled(src: GPUTexture, layers: number, levels: number, scales: number[][]): GPUTexture {
    if (!this.alphaCoverage) return src;
    const d = this.device;
    const dst = d.createTexture({ size: [src.width, src.height, layers], format: src.format, mipLevelCount: levels, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    const m = d.createShaderModule({ code: /* wgsl */ `
      @group(0) @binding(0) var src: texture_2d<f32>;
      @group(0) @binding(1) var<uniform> s: vec4f;
      @vertex fn vs(@builtin(vertex_index) k: u32) -> @builtin(position) vec4f { let p = vec2f(f32(i32(k & 1u) * 4 - 1), f32(i32(k >> 1u) * 4 - 1)); return vec4f(p, 0.0, 1.0); }
      @fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f { let t = textureLoad(src, vec2i(p.xy), 0); return vec4f(t.rgb, clamp(t.a * s.x, 0.0, 1.0)); }` });
    const pipe = d.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ format: src.format }] }, primitive: { topology: 'triangle-list' } });
    const enc = d.createCommandEncoder(), ubufs: GPUBuffer[] = [];
    for (let k = 0; k < layers; k++) for (let l = 0; l < levels; l++) {
      const ub = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); ubufs.push(ub);
      d.queue.writeBuffer(ub, 0, new Float32Array([scales[k]?.[l] ?? 1, 0, 0, 0]));
      const bg = d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: src.createView({ dimension: '2d', baseArrayLayer: k, arrayLayerCount: 1, baseMipLevel: l, mipLevelCount: 1 }) }, { binding: 1, resource: { buffer: ub } }] });
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: dst.createView({ dimension: '2d', baseArrayLayer: k, arrayLayerCount: 1, baseMipLevel: l, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
      pass.setPipeline(pipe); pass.setBindGroup(0, bg); pass.draw(3); pass.end();
    }
    d.queue.submit([enc.finish()]);
    d.queue.onSubmittedWorkDone().then(() => { src.destroy(); for (const b of ubufs) b.destroy(); });
    return dst;
  }
  private mipsRange(alb: GPUTexture, nrm: GPUTexture, layer: number, levels: number): void { this.mips(alb, nrm, layer + 1, levels, true, layer); }
  mips(alb: GPUTexture, nrm: GPUTexture, layers: number, levels: number, plain = false, first = 0): void {
    const d = this.device;
    const code = /* wgsl */ `
      @group(0) @binding(0) var src: texture_2d<f32>;
      @group(0) @binding(1) var smp: sampler;
      struct O { @builtin(position) p: vec4f, @location(0) uv: vec2f };
      @vertex fn vs(@builtin(vertex_index) k: u32) -> O { var o: O; let p = vec2f(f32(i32(k & 1u) * 4 - 1), f32(i32(k >> 1u) * 4 - 1)); o.p = vec4f(p, 0.0, 1.0); o.uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); return o; }
      @fragment fn albedo(i: O) -> @location(0) vec4f { return textureSampleLevel(src, smp, i.uv, 0.0); }
      @fragment fn normal(i: O) -> @location(0) vec4f {
        let q = vec2i(i.p.xy) * 2; var nn = vec3f(0.0); var r2 = 0.0; var ao = 0.0;
        for (var k = 0; k < 4; k++) {
          let t = textureLoad(src, q + vec2i(k & 1, k >> 1), 0); let xy = t.xy * 2.0 - 1.0;
          nn += vec3f(xy, sqrt(max(1.0 - dot(xy, xy), 0.0))); r2 += t.z * t.z; ao += t.w;
        }
        let len = length(nn) / 4.0; let m = normalize(nn);
        // Toksvig: the normals' spread at this scale becomes roughness
        return vec4f(m.xy * 0.5 + 0.5, sqrt(min(1.0, r2 / 4.0 + (1.0 - len) * 2.0)), ao / 4.0);
      }`;
    const m = d.createShaderModule({ code });
    const pipes = new Map<GPUTexture, GPURenderPipeline>();
    for (const [t, entry] of [[alb, 'albedo'], [nrm, plain ? 'albedo' : 'normal']] as [GPUTexture, string][]) pipes.set(t, d.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: entry, targets: [{ format: t.format }] }, primitive: { topology: 'triangle-list' } }));
    const smp = d.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    const enc = d.createCommandEncoder();
    for (const t of [alb, nrm]) for (let k = first; k < layers; k++) for (let l = 1; l < levels; l++) {
      const pipe = pipes.get(t)!;
      const bg = d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: t.createView({ dimension: '2d', baseArrayLayer: k, arrayLayerCount: 1, baseMipLevel: l - 1, mipLevelCount: 1 }) }, ...(t === alb || plain ? [{ binding: 1, resource: smp }] : [])] });
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: t.createView({ dimension: '2d', baseArrayLayer: k, arrayLayerCount: 1, baseMipLevel: l, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
      pass.setPipeline(pipe); pass.setBindGroup(0, bg); pass.draw(3); pass.end();
    }
    d.queue.submit([enc.finish()]);
  }

  upload(v: Float32Array, idx: Uint32Array): GpuMesh {
    const d = this.device;
    const vbuf = d.createBuffer({ size: v.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }); d.queue.writeBuffer(vbuf, 0, v);
    const ibuf = d.createBuffer({ size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST }); d.queue.writeBuffer(ibuf, 0, idx);
    // the wireframe's line index buffer (twice the triangle index buffer) is built on first use only
    const bytes = v.byteLength + idx.byteLength;
    this.geometryBytes += bytes;
    return { vbuf, ibuf, lbuf: null, idx, indexCount: idx.length, lineCount: 0, triangles: idx.length / 3, vertices: v.length / VFLOATS, bytes };
  }
  private lines(m: GpuMesh): GPUBuffer | null {
    if (m.lbuf || !m.idx) return m.lbuf;
    const idx = m.idx, l = new Uint32Array(idx.length * 2);
    for (let k = 0; k < idx.length; k += 3) { l[k * 2] = idx[k]; l[k * 2 + 1] = idx[k + 1]; l[k * 2 + 2] = idx[k + 1]; l[k * 2 + 3] = idx[k + 2]; l[k * 2 + 4] = idx[k + 2]; l[k * 2 + 5] = idx[k]; }
    m.lbuf = this.device.createBuffer({ size: l.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST }); this.device.queue.writeBuffer(m.lbuf, 0, l);
    m.lineCount = l.length; m.bytes += l.byteLength; this.geometryBytes += l.byteLength;
    return m.lbuf;
  }
  destroy(m: GpuMesh): void { m.vbuf.destroy(); m.ibuf.destroy(); m.lbuf?.destroy(); this.geometryBytes -= m.bytes; }

  setDraws(d: Draw[]): void { this.draws = d; this.shadowDirty = true; }

  /** Fit the sun shadow map around a box. */
  fitShadow(min: [number, number, number], max: [number, number, number]): void {
    const sun = this.light.sun;
    const f = [-sun[0], -sun[1], -sun[2]]; const fl = Math.hypot(f[0], f[1], f[2]); f[0] /= fl; f[1] /= fl; f[2] /= fl;
    let r = [f[2], 0, -f[0]]; const rl = Math.hypot(r[0], r[2]); r = [r[0] / rl, 0, r[2] / rl];
    const up = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
    let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9, c0 = 1e9, c1 = -1e9;
    for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
      const a = x * r[0] + y * r[1] + z * r[2], b = x * up[0] + y * up[1] + z * up[2], c = x * f[0] + y * f[1] + z * f[2];
      a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); c0 = Math.min(c0, c); c1 = Math.max(c1, c);
    }
    const hw = (a1 - a0) / 2, hh = (b1 - b0) / 2, ca = (a0 + a1) / 2, cb = (b0 + b1) / 2, dz = c1 - c0 + 2;
    this.shadowVP.set([r[0] / hw, up[0] / hh, f[0] / dz, 0, r[1] / hw, up[1] / hh, f[1] / dz, 0, r[2] / hw, up[2] / hh, f[2] / dz, 0, -ca / hw, -cb / hh, -(c0 - 1) / dz, 1]);
    this.shadowDirty = true;
  }

  private writeU(slot: number, vp: Float32Array, cam: number[], kind: number, off: number[], mat = 0, fol: [number, number, number] = [0, 0, 0], yaw = 0) {
    const L = this.light, s = L.sun, sl = Math.hypot(s[0], s[1], s[2]);
    const u = new Float32Array(64);
    u.set(vp, 0); u.set(this.shadowVP, 16); u.set([cam[0], cam[1], cam[2], yaw], 32); u.set([s[0] / sl, s[1] / sl, s[2] / sl, L.intensity], 36);
    u.set([this.bakeMode ?? MODES.indexOf(this.mode), mat, this.tex ? 1 : 0, L.exposure], 40); u.set([off[0], off[1], off[2], kind], 44);
    u.set([...L.sunColor, kind === 4 || kind === 5 || kind === 8 ? this.alphaBoost.leaf : kind === 7 ? this.alphaBoost.needle : L.fill], 48); u.set([...L.zenith, L.ambient], 52); u.set([...L.horizon, this.shadowOff ? 0 : L.shadow], 56); u.set([L.studio ? 1 : 0, fol[0], fol[1], fol[2]], 60);
    this.device.queue.writeBuffer(this.ubuf, slot * 256, u);
  }

  private target(w: number, h: number, old: Target | null): Target {
    if (old && old.w === w && old.h === h) return old;
    old?.msaa.destroy(); old?.depth.destroy();
    const d = this.device;
    return { w, h, msaa: d.createTexture({ size: [w, h], format: this.format, sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT }), depth: d.createTexture({ size: [w, h], format: 'depth32float', sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT }) };
  }

  /** impostor bake: 6 = unlit albedo, 7 = tree-local normal + occlusion (null: the display mode) */
  bakeMode: number | null = null;
  /** extra passes drawn after the foliage (impostors): main pass and shadow pass */
  extra: { main: (pass: GPURenderPassEncoder) => { calls: number; tris: number }; shadow: (pass: GPURenderPassEncoder) => void } | null = null;
  private encode(enc: GPUCommandEncoder, view: GPUTextureView, tg: Target, vp: Float32Array, cam: number[], draws: Draw[], timed: boolean): number {
    const bake = this.bakeMode !== null;
    // uniform slots: 0 global, then one per draw, then one per foliage set
    this.writeU(0, vp, cam, 0, [0, 0, 0]);
    draws.forEach((m, k) => this.writeU(1 + k, vp, cam, m.kind, m.offset, m.mat ?? 0, m.kind === 1 ? [this.woodland ? 1 : 0, 0, 0] : [0, 0, 0], m.yaw ?? 0));
    const fslots: { draw: Draw; set: GpuFoliage['sets'][number]; slot: number }[] = [];
    let next = 1 + draws.length;
    for (const m of draws) if (m.foliage) for (const set of m.foliage.sets) {
      if (next >= 4096) throw new Error('too many draws');
      this.writeU(next, vp, cam, KIND[set.kind], m.offset, m.mat ?? 0, [set.layer, set.grid[0], set.grid[1]], m.yaw ?? 0);
      fslots.push({ draw: m, set, slot: next++ });
    }
    if (this.shadowDirty && !bake && !this.shadowOff) {
      const p = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: this.shadowTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
      p.setPipeline(this.shadowPipe);
      draws.forEach((m, k) => { if (m.kind === 1 || m.castShadow === false) return; p.setBindGroup(0, this.bgs[1], [(1 + k) * 256]); p.setVertexBuffer(0, m.mesh.vbuf); p.setIndexBuffer(m.mesh.ibuf, 'uint32'); p.drawIndexed(m.mesh.indexCount); });
      // foliage casts alpha-tested shadows
      p.setPipeline(this.folShadow);
      for (const f of fslots) { const t = this.templates[f.set.tmpl]; p.setBindGroup(0, this.bgs[1], [f.slot * 256]); p.setVertexBuffer(0, t.buf); p.setVertexBuffer(1, f.set.buf, f.set.offset); p.draw(t.count, f.set.count); }
      this.extra?.shadow(p);
      p.end(); this.shadowDirty = false;
    }
    const tsSlot = timed && this.hasTs ? (this.qbusy[0] ? (this.qbusy[1] ? -1 : 1) : 0) : -1;
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: tg.msaa.createView(), resolveTarget: view, loadOp: 'clear', storeOp: 'discard', clearValue: [0, 0, 0, bake ? 0 : 1] }],
      depthStencilAttachment: { view: tg.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      timestampWrites: tsSlot >= 0 ? { querySet: this.qs!, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } : undefined,
    });
    let calls = 0, tris = 0, verts = 0;
    const wire = this.mode === 'wire';
    draws.forEach((m, k) => {
      pass.setBindGroup(0, this.bgs[0], [(1 + k) * 256]); pass.setVertexBuffer(0, m.mesh.vbuf);
      const lb = wire ? this.lines(m.mesh) : null;
      if (lb) { pass.setPipeline(this.wire); pass.setIndexBuffer(lb, 'uint32'); pass.drawIndexed(m.mesh.lineCount); }
      else { pass.setPipeline(this.pipe); pass.setIndexBuffer(m.mesh.ibuf, 'uint32'); pass.drawIndexed(m.mesh.indexCount); }
      calls++; tris += m.mesh.triangles; verts += m.mesh.vertices;
    });
    if (!wire) {
      pass.setPipeline(this.folPipe);
      for (const f of fslots) { const t = this.templates[f.set.tmpl]; pass.setBindGroup(0, this.bgs[0], [f.slot * 256]); pass.setVertexBuffer(0, t.buf); pass.setVertexBuffer(1, f.set.buf, f.set.offset); pass.draw(t.count, f.set.count); calls++; tris += t.tris * f.set.count; }
    }
    if (!wire && !bake && this.extra) { const e = this.extra.main(pass); calls += e.calls; tris += e.tris; }
    if (!bake) { pass.setPipeline(this.sky); pass.setBindGroup(0, this.bgs[0], [0]); pass.draw(3); calls++; }
    pass.end();
    if (timed) { this.drawCalls = calls; this.tris = tris; this.verts = verts; }
    if (tsSlot >= 0) { enc.resolveQuerySet(this.qs!, 0, 2, this.qbuf!, 0); enc.copyBufferToBuffer(this.qbuf!, 0, this.qread[tsSlot], 0, 16); }
    return tsSlot;
  }

  /** Render the current draw list to the canvas. */
  render(vp: Float32Array, cam: number[]): void {
    const t0 = performance.now();
    const d = this.device, cv = this.ctx.getCurrentTexture();
    this.screen = this.target(cv.width, cv.height, this.screen);
    const enc = d.createCommandEncoder();
    const tsSlot = this.encode(enc, cv.createView(), this.screen, vp, cam, this.draws, true);
    // optional read-back of the presented frame itself (tests that what reaches the canvas is right)
    let rb: { buf: GPUBuffer; bpr: number; w: number; h: number; done: (b: Blob) => void } | null = null;
    if (this.readback) {
      const w = cv.width, h = cv.height, bpr = Math.ceil(w * 4 / 256) * 256;
      const buf = d.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      enc.copyTextureToBuffer({ texture: cv }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
      rb = { buf, bpr, w, h, done: this.readback }; this.readback = null;
    }
    d.queue.submit([enc.finish()]);
    if (rb) { const r = rb; r.buf.mapAsync(GPUMapMode.READ).then(() => { const png = this.toPng(new Uint8Array(r.buf.getMappedRange()), r.bpr, r.w, r.h); r.buf.unmap(); r.buf.destroy(); png.then(r.done); }); }
    if (tsSlot >= 0) {
      const b = this.qread[tsSlot]; this.qbusy[tsSlot] = true;
      b.mapAsync(GPUMapMode.READ).then(() => { const a = new BigInt64Array(b.getMappedRange()); this.gpuMs = Number(a[1] - a[0]) / 1e6; b.unmap(); this.qbusy[tsSlot] = false; }, () => { this.qbusy[tsSlot] = false; });
    }
    this.cpuMs = performance.now() - t0;
  }

  /** Render one impostor frame (bake mode set by the caller) into a region of an atlas texture (this.format). */
  private bakeTg: Target | null = null; private bakeColor: GPUTexture | null = null;
  bakeFrame(atlas: GPUTexture, layer: number, x: number, y: number, size: number, vp: Float32Array, cam: number[], draws: Draw[]): void {
    const d = this.device;
    this.bakeTg = this.target(size, size, this.bakeTg);
    if (!this.bakeColor || this.bakeColor.width !== size) { this.bakeColor?.destroy(); this.bakeColor = d.createTexture({ size: [size, size], format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC }); }
    const enc = d.createCommandEncoder();
    this.encode(enc, this.bakeColor.createView(), this.bakeTg, vp, cam, draws, false);
    enc.copyTextureToTexture({ texture: this.bakeColor }, { texture: atlas, origin: [x, y, layer] }, [size, size]);
    d.queue.submit([enc.finish()]);
  }
  /** Shadow map resolution (0: shadows off). */
  setShadowSize(n: number): void {
    this.shadowOff = n <= 0;
    const s = Math.max(n, 256);
    if (s !== this.shadowSize) { this.shadowTex.destroy(); this.shadowSize = s; this.shadowTex = this.device.createTexture({ size: [s, s], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }); this.rebind(); this.onRebind?.(); }
    this.shadowDirty = true;
  }
  shadowOff = false;
  onRebind: (() => void) | null = null;
  get shadowTexture(): GPUTexture { return this.shadowTex; }
  /** the global uniform bind group (slot 0 holds the frame's camera and light): shadow pass = no shadow-map binding */
  globalBindGroup(shadowPass: boolean): GPUBindGroup { return this.bgs[shadowPass ? 1 : 0]; }
  /** Rebuild one layer's mip chain of a pair of colour textures (impostor atlases): plain averaging. */
  mipsLayer(a: GPUTexture, b: GPUTexture, layer: number, levels: number): void { this.mipsRange(a, b, layer, levels); }
  get uniformLayout(): GPUBindGroupLayout { return this.bgl; }
  /** Benchmark: render `frames` frames of a draw list offscreen at w×h, one at a time; per frame the wall time from
   *  submit to completion and (where the adapter has timestamp queries) the GPU time of the main pass. */
  async benchFrames(w: number, h: number, vp: Float32Array, cam: number[], frames: number, draws: Draw[] = this.draws): Promise<{ wall: number[]; gpu: number[]; calls: number; tris: number }> {
    const d = this.device, tg = this.target(w, h, null);
    const color = d.createTexture({ size: [w, h], format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const one = (timed: boolean) => { const enc = d.createCommandEncoder(); const slot = this.encode(enc, color.createView(), tg, vp, cam, draws, timed); d.queue.submit([enc.finish()]); return slot; };
    this.shadowDirty = true; one(false); await d.queue.onSubmittedWorkDone();
    const wall: number[] = [], gpu: number[] = [];
    for (let k = 0; k < frames; k++) {
      // the shadow map is re-rendered every frame, as a moving sun or camera-fitted cascade would need
      this.shadowDirty = !this.shadowOff;
      const t0 = performance.now(); const slot = one(true); await d.queue.onSubmittedWorkDone(); wall.push(performance.now() - t0);
      if (slot >= 0) { const b = this.qread[slot]; await b.mapAsync(GPUMapMode.READ); const a = new BigInt64Array(b.getMappedRange()); const ms = Number(a[1] - a[0]) / 1e6; b.unmap(); if (ms > 0) gpu.push(ms); }
    }
    color.destroy(); tg.msaa.destroy(); tg.depth.destroy(); this.shadowDirty = true;
    return { wall, gpu, calls: this.drawCalls, tris: this.tris };
  }
  /** Render a draw list offscreen at w×h and return a PNG blob. Does not touch the canvas. */
  async renderImage(w: number, h: number, vp: Float32Array, cam: number[], draws: Draw[] = this.draws): Promise<Blob> {
    const d = this.device;
    const tg = this.target(w, h, null);
    const color = d.createTexture({ size: [w, h], format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const enc = d.createCommandEncoder();
    this.shadowDirty = true; // the draw list may differ from the screen's
    this.encode(enc, color.createView(), tg, vp, cam, draws, false);
    this.shadowDirty = true;
    const bpr = Math.ceil(w * 4 / 256) * 256;
    const buf = d.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    enc.copyTextureToBuffer({ texture: color }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
    d.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const png = this.toPng(new Uint8Array(buf.getMappedRange()), bpr, w, h);
    buf.unmap(); buf.destroy(); color.destroy(); tg.msaa.destroy(); tg.depth.destroy();
    return png;
  }
  /** Time `frames` offscreen renders of a draw list at w×h: wall-clock per frame from submit to GPU completion
   *  (onSubmittedWorkDone), and the GPU pass time from timestamp queries where the adapter exposes them. On a
   *  software adapter (SwiftShader) these are CPU-rasterizer timings, not GPU performance. */
  async timeRender(w: number, h: number, vp: Float32Array, cam: number[], frames = 10, draws: Draw[] = this.draws): Promise<{ wallMs: number; gpuMs: number | null }> {
    const d = this.device, tg = this.target(w, h, null);
    const color = d.createTexture({ size: [w, h], format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const one = (timed: boolean) => { const enc = d.createCommandEncoder(); const slot = this.encode(enc, color.createView(), tg, vp, cam, draws, timed); d.queue.submit([enc.finish()]); return slot; };
    this.shadowDirty = true; one(false); await d.queue.onSubmittedWorkDone(); // warm-up (pipelines, shadow map)
    const t0 = performance.now();
    for (let k = 0; k < frames; k++) one(false);
    await d.queue.onSubmittedWorkDone();
    const wallMs = (performance.now() - t0) / frames;
    let gpuMs: number | null = null;
    if (this.hasTs) {
      this.gpuMs = 0; const slot = one(true); await d.queue.onSubmittedWorkDone();
      for (let k = 0; k < 3000 && slot >= 0 && this.qbusy[slot]; k++) await new Promise((r) => setTimeout(r, 10));
      gpuMs = this.gpuMs || null;
    }
    color.destroy(); tg.msaa.destroy(); tg.depth.destroy(); this.shadowDirty = true;
    return { wallMs, gpuMs };
  }
  private countPipes: { bark: GPURenderPipeline; fol: GPURenderPipeline } | null = null;
  /** Overdraw at w×h for a draw list: every fragment rasterized (bark) or passing the alpha test (foliage) is
   *  counted per pixel, with no depth rejection, so the figure is an upper bound on shading work that does not depend
   *  on the GPU (draw order and early depth rejection decide how much of it a real GPU actually shades). */
  async measureOverdraw(w: number, h: number, vp: Float32Array, cam: number[], draws: Draw[] = this.draws): Promise<{ coverage: number; foliageCoverage: number; meanFoliage: number; p95Foliage: number; maxFoliage: number; meanAll: number; rasterized: number; shadedFraction: number; fragments: number }> {
    const d = this.device;
    if (!this.countPipes) {
      const m = d.createShaderModule({ code: SHADER });
      const layout = d.createPipelineLayout({ bindGroupLayouts: [this.bgl] });
      const add: GPUBlendState = { color: { operation: 'add', srcFactor: 'one', dstFactor: 'one' }, alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' } };
      const vb: GPUVertexBufferLayout[] = [{ arrayStride: VFLOATS * 4, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 2, offset: 24, format: 'float32x4' }, { shaderLocation: 3, offset: 40, format: 'float32x3' }, { shaderLocation: 4, offset: 52, format: 'float32x3' }] }];
      const fvb: GPUVertexBufferLayout[] = [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
        { arrayStride: PACKED, stepMode: 'instance', attributes: [{ shaderLocation: 1, offset: 0, format: 'unorm16x4' }, { shaderLocation: 2, offset: 8, format: 'snorm8x4' }, { shaderLocation: 3, offset: 12, format: 'unorm8x4' }, { shaderLocation: 4, offset: 16, format: 'unorm8x4' }] }];
      this.countPipes = {
        bark: d.createRenderPipeline({ layout, vertex: { module: m, entryPoint: 'vs', buffers: vb }, fragment: { module: m, entryPoint: 'fsCount', targets: [{ format: 'rgba16float', blend: add }] }, primitive: { topology: 'triangle-list', cullMode: 'none' } }),
        fol: d.createRenderPipeline({ layout, vertex: { module: m, entryPoint: 'vsFol', buffers: fvb }, fragment: { module: m, entryPoint: 'fsFolCount', targets: [{ format: 'rgba16float', blend: add }] }, primitive: { topology: 'triangle-list', cullMode: 'none' } }),
      };
    }
    const tex = d.createTexture({ size: [w, h], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    this.writeU(0, vp, cam, 0, [0, 0, 0]);
    const enc = d.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    let slot = 1;
    for (const m of draws) {
      if (m.kind === 1) continue;
      this.writeU(slot, vp, cam, m.kind, m.offset, m.mat ?? 0, [0, 0, 0], m.yaw ?? 0);
      pass.setPipeline(this.countPipes.bark); pass.setBindGroup(0, this.bgs[0], [slot * 256]); pass.setVertexBuffer(0, m.mesh.vbuf); pass.setIndexBuffer(m.mesh.ibuf, 'uint32'); pass.drawIndexed(m.mesh.indexCount); slot++;
      if (m.foliage) for (const set of m.foliage.sets) {
        this.writeU(slot, vp, cam, KIND[set.kind], m.offset, m.mat ?? 0, [set.layer, set.grid[0], set.grid[1]], m.yaw ?? 0);
        const t = this.templates[set.tmpl];
        pass.setPipeline(this.countPipes.fol); pass.setBindGroup(0, this.bgs[0], [slot * 256]); pass.setVertexBuffer(0, t.buf); pass.setVertexBuffer(1, set.buf, set.offset); pass.draw(t.count, set.count); slot++;
      }
    }
    pass.end();
    const bpr = Math.ceil(w * 8 / 256) * 256;
    const buf = d.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
    d.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const u16 = new Uint16Array(buf.getMappedRange());
    const half = (x: number) => { const e = (x >> 10) & 31, f = x & 1023; return e === 0 ? f / 16777216 : (1 + f / 1024) * 2 ** (e - 15); };
    let cov = 0, fcov = 0, fsum = 0, asum = 0, fmax = 0, rast = 0; const hist = new Uint32Array(512);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * bpr) / 2 + x * 4, r = half(u16[o]), g = half(u16[o + 1]); rast += half(u16[o + 2]);
      if (r + g > 0) { cov++; asum += r + g; }
      if (g > 0) { fcov++; fsum += g; fmax = Math.max(fmax, g); hist[Math.min(511, Math.round(g))]++; }
    }
    buf.unmap(); buf.destroy(); tex.destroy();
    let acc = 0, p95 = 0; for (let k = 0; k < 512; k++) { acc += hist[k]; if (acc >= fcov * 0.95) { p95 = k; break; } }
    // rasterized: foliage fragments per foliage-covered pixel, alpha-rejected ones included; shadedFraction: the share
    // of rasterized foliage fragments that pass the alpha test (the rest is wasted card area)
    return { coverage: cov / (w * h), foliageCoverage: fcov / (w * h), meanFoliage: fcov ? fsum / fcov : 0, p95Foliage: p95, maxFoliage: fmax, meanAll: cov ? asum / cov : 0,
      rasterized: fcov ? rast / fcov : 0, shadedFraction: rast ? fsum / rast : 0, fragments: rast };
  }
  /** Set to receive a PNG of the next frame presented to the canvas. */
  readback: ((b: Blob) => void) | null = null;
  private toPng(src: Uint8Array, bpr: number, w: number, h: number): Promise<Blob> {
    const px = new Uint8ClampedArray(w * h * 4), bgra = this.format.startsWith('bgra');
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * bpr + x * 4, o = (y * w + x) * 4; px[o] = src[i + (bgra ? 2 : 0)]; px[o + 1] = src[i + 1]; px[o + 2] = src[i + (bgra ? 0 : 2)]; px[o + 3] = 255; }
    const cv = new OffscreenCanvas(w, h); cv.getContext('2d')!.putImageData(new ImageData(px, w, h), 0, 0);
    return cv.convertToBlob({ type: 'image/png' });
  }
}

/** Column-major perspective (standard depth 0..1) × look-at. */
export function viewProj(eye: number[], target: number[], fovY: number, aspect: number, near = 0.05, far = 2000): Float32Array {
  const f = norm3(sub3(target, eye));
  const upv = Math.abs(f[1]) > 0.999 ? [0, 0, -1] : [0, 1, 0];
  const r = norm3(cross3(f, upv)), u = cross3(r, f);
  const t = 1 / Math.tan(fovY / 2);
  const P = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, far / (near - far), -1, 0, 0, (far * near) / (near - far), 0];
  const V = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot3(r, eye), -dot3(u, eye), dot3(f, eye), 1];
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) { let s = 0; for (let k = 0; k < 4; k++) s += P[k * 4 + rr] * V[c * 4 + k]; out[c * 4 + rr] = s; }
  return out;
}
const sub3 = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
