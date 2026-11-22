// Sky (fullscreen, only where nothing was drawn), the flat loch surface, and the tonemapping/upscale pass.

import { COMMON_WGSL } from './common.wgsl.js';

const FULLSCREEN = /* wgsl */ `
struct FsOut { @builtin(position) pos: vec4f, @location(0) ndc: vec2f };
@vertex fn vsFull(@builtin(vertex_index) i: u32) -> FsOut {
  let p = vec2f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1));
  var o: FsOut; o.pos = vec4f(p, 0.0, 1.0); o.ndc = p; return o;
}
`;

export const SKY_WGSL = COMMON_WGSL + /* wgsl */ `
@group(0) @binding(0) var<uniform> F: Frame;
${FULLSCREEN}
fn viewRay(ndc: vec2f) -> vec3f {
  return normalize(F.camFwd.xyz + ndc.x * F.camRight.w * F.camRight.xyz + ndc.y * F.camUp.w * F.camUp.xyz);
}
@fragment fn fsSky(i: FsOut) -> @location(0) vec4f {
  if (u32(F.params.y) == 2u) { return vec4f(40.0, 0.0, 40.0, 1.0); } // crack check: pure magenta where terrain is missing
  return vec4f(skyRadiance(viewRay(i.ndc), true), 1.0);
}
`;

export const WATER_WGSL = COMMON_WGSL + /* wgsl */ `
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var overview: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;

struct WOut { @builtin(position) pos: vec4f, @location(0) rel: vec3f };
const EXTENT = 12000.0;
@vertex fn vsWater(@builtin(vertex_index) i: u32) -> WOut {
  // a quad centred on the camera's snapped origin, large enough to reach the terrain backdrop's edge
  let c = vec2f(f32(i & 1u), f32(i >> 1u)) * 2.0 - 1.0;
  let rel = vec3f(c.x * EXTENT, F.origin.w, c.y * EXTENT);
  var o: WOut; o.pos = F.viewProj * vec4f(rel, 1.0); o.rel = rel; return o;
}

@fragment fn fsWater(i: WOut) -> @location(0) vec4f {
  if (u32(F.params.y) == 2u) { discard; }
  let wp = i.rel + F.origin.xyz;
  let toP = i.rel - F.camPos.xyz;
  let dist = length(toP);
  let v = toP / dist;
  // gentle wind ripples: two scrolling noise octaves → normal (basic water only; no simulation)
  let t = F.camPos.w;
  let g = vnoised(wp.xz * 0.35 + vec2f(t * 0.21, t * 0.13)).yz * 0.35 + vnoised(wp.xz * 1.3 - vec2f(t * 0.37, -t * 0.29)).yz * 1.3 * 0.35;
  let fw = length(fwidth(wp.xz));
  let rough = 0.06 * sat(1.0 - fw * 0.9);
  let n = normalize(vec3f(-g.x * rough, 1.0, -g.y * rough));
  let r = reflect(v, n);
  let cosI = max(dot(-v, n), 0.0);
  let fres = 0.02 + 0.98 * pow(1.0 - cosI, 5.0);
  var refl = skyRadiance(vec3f(r.x, max(r.y, 0.0), r.z), false);
  // the loch is surrounded by hills: near-horizontal reflected rays mostly see terrain, not sky (no SSR yet)
  let hills = (sunIrradiance(0.0) * 0.25 + skyAmbient(vec3f(0.0, 1.0, 0.0))) * vec3f(0.050, 0.058, 0.042) / PI;
  refl = mix(aerial(hills, vec3f(r.x, 0.0, r.z) * 900.0), refl, smoothstep(0.03, 0.30, r.y));
  // sun glint
  let sp = pow(max(dot(r, F.sunDir.xyz), 0.0), 900.0) * 900.0 * 0.08;
  let glint = sunIrradiance(0.0) * sp;

  // depth below the surface from the overview height (approximate; exact edge comes from the depth test)
  let ouv = overviewUV(wp.xz);
  var depth = 30.0;
  var shadow = 1.0;
  if (inOverview(ouv)) {
    let o = textureSampleLevel(overview, linearSampler, ouv, 0.0);
    depth = max(F.origin.w - o.b, 0.0);
    shadow = mix(1.0, o.r, F.params.w);
  }
  // peaty Highland water: brown-black, absorbs quickly
  let pathLen = depth / max(cosI, 0.15);
  let absorb = 1.0 - exp(-pathLen * 0.22);
  let deep = (sunIrradiance(0.0) * F.sunDir.y * shadow + skyAmbient(vec3f(0.0, 1.0, 0.0))) * vec3f(0.006, 0.008, 0.007);
  let a = absorb * (1.0 - fres);
  let col = refl * fres + glint * shadow + deep * a;
  // aerial perspective on what the water contributes; blended premultiplied over the lake bed
  let ins = aerial(vec3f(0.0), toP);
  let T = aerial(vec3f(1.0), toP) - ins;
  let outA = 1.0 - (1.0 - fres) * (1.0 - absorb);
  return vec4f(col * T + ins * outA, outA);
}
`;

export const POST_WGSL = /* wgsl */ `
@group(0) @binding(0) var hdr: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var<uniform> P: vec4f; // exposure, time, 0, 0
${FULLSCREEN}
fn aces(x: vec3f) -> vec3f { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0)); }
fn toSrgb(c: vec3f) -> vec3f { return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308)); }
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453); }
@fragment fn fsPost(i: FsOut) -> @location(0) vec4f {
  let uv = vec2f(i.ndc.x * 0.5 + 0.5, 0.5 - i.ndc.y * 0.5);
  let c = textureSampleLevel(hdr, linearSampler, uv, 0.0).rgb;
  var m = toSrgb(aces(c * P.x));
  m += (hash(i.pos.xy + fract(P.y)) - 0.5) / 255.0; // dither against banding in the sky gradient
  return vec4f(m, 1.0);
}
`;
