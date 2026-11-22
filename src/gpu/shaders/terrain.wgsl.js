// Terrain shader. Vertex pulling: per-vertex data comes from the chunk pool storage buffer, per-draw data from
// the draws storage buffer indexed by instance_index (set through drawIndexed's firstInstance).
// The morph logic must stay identical to src/terrain/morph.js.

import { COMMON_WGSL } from './common.wgsl.js';
import { WORLD, CHUNK_VERTS, CHUNK_VERTEX_COUNT } from '../../config.js';

export const TERRAIN_WGSL = COMMON_WGSL + /* wgsl */ `
struct Draw {
  origin: vec2f,      // chunk minimum corner relative to the render origin (exact)
  spacing: f32,       // vertex spacing (m), a power of two
  slot: u32,          // pool slot
  morphRange: f32,    // distance where the parent takes over (≥ 1e29: no morph)
  finer: u32,         // edges facing finer neighbours: morph locked there (1 N, 2 E, 4 S, 8 W)
  depth: u32,
  pad: u32,
};

@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<storage, read> draws: array<Draw>;
@group(0) @binding(2) var<storage, read> pool: array<vec4u>;
@group(0) @binding(3) var overview: texture_2d<f32>;
@group(0) @binding(4) var linearSampler: sampler;
@group(0) @binding(5) var materials: texture_2d<f32>;

const VERTS: u32 = ${CHUNK_VERTS}u;
const LAST: u32 = ${WORLD.chunkQuads}u;
const VCOUNT: u32 = ${CHUNK_VERTEX_COUNT}u;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) rel: vec3f,     // position relative to the render origin
  @location(1) n: vec3f,
  @location(2) @interpolate(flat) depth: u32,
  @location(3) morph: f32,
};

fn morphFactor(dist: f32, range: f32, finer: u32, i: u32, j: u32) -> f32 {
  if (range >= 1e29) { return 0.0; }
  if (((finer & 1u) != 0u && j == 0u) || ((finer & 4u) != 0u && j == LAST) ||
      ((finer & 8u) != 0u && i == 0u) || ((finer & 2u) != 0u && i == LAST)) { return 0.0; }
  let ms = F.params.x;
  return clamp((dist - ms * range) / ((1.0 - ms) * range), 0.0, 1.0);
}

fn unpackN(u: u32) -> vec3f { let v = unpack2x16snorm(u); return vec3f(v.x, sqrt(max(1.0 - dot(v, v), 0.0)), v.y); }

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let d = draws[ii];
  let i = vi % VERTS; let j = vi / VERTS;
  let v = pool[d.slot * VCOUNT + vi];
  let h = bitcast<f32>(v.x); let hc = bitcast<f32>(v.y);
  let x = d.origin.x + f32(i) * d.spacing;
  let z = d.origin.y + f32(j) * d.spacing;
  let m = morphFactor(distance(vec3f(x, h, z), F.camPos.xyz), d.morphRange, d.finer, i, j);
  let p = vec3f(x, mix(h, hc, m), z);
  var o: VOut;
  o.pos = F.viewProj * vec4f(p, 1.0);
  o.rel = p;
  o.n = mix(unpackN(v.z), unpackN(v.w), m);
  o.depth = d.depth;
  o.morph = m;
  return o;
}

// ---------------------------------------------------------------------------------------------- materials
fn fbm2(p: vec2f) -> f32 { return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03 + 1.7) + 0.125 * vnoise(p * 4.1 + 5.3) + 0.0625 * vnoise(p * 8.2 + 9.1); }

fn lodColor(d: u32) -> vec3f {
  let k = f32(d);
  return 0.5 + 0.5 * cos(6.2831 * (vec3f(0.0, 0.33, 0.67) + k * 0.13));
}

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let wp = i.rel + F.origin.xyz;            // world position (f32 is fine for shading inputs)
  let toCam = i.rel - F.camPos.xyz;
  let dist = length(toCam);
  var n = normalize(i.n);

  // fine procedural relief on top of the mesh normal (fades out with distance, avoids shimmering)
  let fade = sat(1.0 - dist / 450.0);
  if (fade > 0.0) {
    let g = vnoised(wp.xz * 0.45).yz * 0.45 * 0.35 + vnoised(wp.xz * 1.9 + 3.1).yz * 1.9 * 0.06;
    n = normalize(n + vec3f(-g.x, 0.0, -g.y) * fade * (0.4 + 0.6 * (1.0 - n.y)));
  }
  let slope = 1.0 - n.y;
  let water = F.origin.w;
  let hAbove = wp.y - water;

  // large-scale variation
  let v1 = fbm2(wp.xz * 0.004);
  let v2 = fbm2(wp.xz * 0.021 + 11.0);
  let v3 = vnoise(wp.xz * 0.19);

  // biome / material layers from the baked materials map (forest, lawn, path) and overview alpha (paved, ballast)
  let ouv = overviewUV(wp.xz);
  var mat = vec4f(0.0); var ov = vec4f(1.0, 1.0, 0.0, 0.0);
  if (inOverview(ouv)) { mat = textureSampleLevel(materials, linearSampler, ouv, 0.0); ov = textureSampleLevel(overview, linearSampler, ouv, 0.0); }

  // albedos (linear)
  let grassA = vec3f(0.052, 0.066, 0.030);
  let grassB = vec3f(0.090, 0.084, 0.046);   // drier, straw-coloured moor grass
  let heather = vec3f(0.062, 0.046, 0.045);
  let bracken = vec3f(0.105, 0.066, 0.034);
  let rock = vec3f(0.125, 0.122, 0.116);
  let rockDark = vec3f(0.060, 0.060, 0.059);
  let shingle = vec3f(0.150, 0.138, 0.118);
  let mud = vec3f(0.055, 0.050, 0.040);

  var veg = mix(grassA, grassB, sat(v2 * 1.6 - 0.2));
  veg = mix(veg, heather, smoothstep(0.45, 0.62, v1) * smoothstep(25.0, 140.0, hAbove));
  veg = mix(veg, bracken, smoothstep(0.58, 0.7, v2) * smoothstep(0.08, 0.2, slope) * (1.0 - smoothstep(250.0, 400.0, hAbove)));
  veg *= 0.85 + 0.3 * v3;
  // thinner vegetation high up
  veg = mix(veg, mix(rock, grassB, 0.5), smoothstep(450.0, 700.0, hAbove) * 0.6);

  // rock: strata along height plus vertical weathering streaks, so cliff bands do not read as walls
  let strata = vnoise(vec2f(wp.y * 0.35, wp.x * 0.004 + wp.z * 0.004));
  let streak = vnoise(vec2f((wp.x + wp.z) * 0.25, wp.y * 0.02));
  var rk = mix(rockDark, rock, sat(0.3 + 0.5 * v2 + 0.35 * strata - 0.15 * streak));
  let rockAmt = smoothstep(0.30, 0.52, slope + 0.12 * (v3 - 0.5) + 0.08 * (v1 - 0.5));
  var albedo = mix(veg, rk, rockAmt);
  // shore band: shingle just above the waterline, darker silt below it
  let shore = 1.0 - smoothstep(0.4, 2.2 + 1.5 * v3, hAbove);
  albedo = mix(albedo, shingle * (0.85 + 0.3 * v3), shore * (1.0 - rockAmt * 0.5));
  albedo = mix(albedo, mud, smoothstep(0.0, -3.0, hAbove));

  // managed lawn (castle grounds, pitch, village greens): short, brighter, even grass
  let lawnCol = mix(vec3f(0.048, 0.072, 0.027), vec3f(0.058, 0.080, 0.030), v2) * (0.92 + 0.16 * v3);
  albedo = mix(albedo, lawnCol, mat.b * (1.0 - rockAmt));
  // forest floor: moss and needles, darker with depth; from a distance a clumped canopy tone (no trees yet)
  let depth = mat.g;
  let clump = vnoise(wp.xz * 0.11) * 0.6 + vnoise(wp.xz * 0.031 + 7.0) * 0.4;
  let floorCol = mix(vec3f(0.040, 0.050, 0.022), vec3f(0.022, 0.030, 0.016), depth) * (0.75 + 0.5 * clump);
  let canopyCol = mix(vec3f(0.030, 0.052, 0.022), vec3f(0.016, 0.030, 0.016), depth) * (0.55 + 0.9 * clump);
  let farK = smoothstep(150.0, 900.0, dist);
  albedo = mix(albedo, mix(floorCol, canopyCol, farK), mat.r * (1.0 - rockAmt * 0.7));
  // paths and roads (dirt), paved stone and railway ballast
  let pathCol = vec3f(0.115, 0.095, 0.070) * (0.85 + 0.3 * v3);
  albedo = mix(albedo, pathCol, mat.a * 0.9);
  albedo = mix(albedo, vec3f(0.150, 0.145, 0.138) * (0.8 + 0.4 * v3), ov.a * 0.9);

  // ----------------------------------------------------------------------------------- lighting
  let shadow = mix(1.0, ov.r, F.params.w);
  var skyVis = mix(1.0, ov.g, F.params.w);
  skyVis *= 1.0 - 0.45 * mat.r * (1.0 - farK); // under-canopy darkening near the ground
  let L = F.sunDir.xyz;
  let ndl = max(dot(n, L), 0.0);
  let sun = sunIrradiance(max(wp.y, 0.0)) * ndl * shadow;
  let sky = skyAmbient(n) * skyVis;
  let bounce = sunIrradiance(0.0) * F.sunDir.y * vec3f(0.08, 0.085, 0.06) * (0.5 - 0.5 * n.y);
  var col = albedo * (sun + sky + bounce) / PI;
  // a hint of specular on wet rock / shingle near the water
  let hv = normalize(L - toCam / max(dist, 1e-3));
  col += sunIrradiance(max(wp.y, 0.0)) * shadow * pow(max(dot(n, hv), 0.0), 60.0) * (0.02 + 0.08 * shore) * ndl;

  col = aerial(col, toCam);

  let mode = u32(F.params.y);
  if (mode == 1u) { col = lodColor(i.depth) * (0.35 + 0.65 * ndl) * mix(1.0, 0.55, i.morph) * 3.0; }
  if (mode == 2u) { col = vec3f(0.2, 0.2, 0.2) * (0.5 + 0.5 * ndl); }
  return hdrOut(col);
}
`;
