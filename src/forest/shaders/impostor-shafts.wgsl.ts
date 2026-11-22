// LOD3 impostors and sun shafts.
//
// Impostors: each archetype is rendered once at startup from 8 azimuths and from above into a 3 × 3 tile layer of a
// texture array (unlit albedo + object-space normal). Far trees are camera-facing quads that pick the nearest baked
// view, dither between the two nearest so rotation never pops, and are lit like the real foliage.
//
// Shafts: Abyssal Garden W_RAYS + W_RBLUR (shaders.js): at half resolution, march the view ray through the sun
// shadow map with interleaved-gradient-noise jitter, accumulate single scattering (Henyey-Greenstein phase) in the
// forest mist, then a depth-aware 3 × 3 blur hides the jitter; composited additively into the HDR image.

import { VEG_HEAD } from './vegetation.wgsl.ts';
import { COMMON_WGSL } from '../../gpu/shaders/common.wgsl.js';
import { FOREST_STRUCT_WGSL, FOREST_BINDINGS_WGSL, FOREST_FUNCS_WGSL } from './forest-common.wgsl.ts';

export const IMPOSTOR_WGSL = VEG_HEAD + /* wgsl */ `
@group(2) @binding(0) var impAlb: texture_2d_array<f32>;
@group(2) @binding(1) var impNrm: texture_2d_array<f32>;

struct IIn { @location(6) i0: vec4f, @location(7) i1: vec4f, @location(8) i2: vec4f, @location(9) i3: vec4f };
struct IOut {
  @builtin(position) cp: vec4f, @location(0) ps: vec3f, @location(1) uv: vec2f,
  @location(2) @interpolate(flat) views: vec4f, // k0, k1, blend, top(0/1)
  @location(3) @interpolate(flat) inst: vec4f,  // fade, arch layer, yaw, tint
};

@vertex fn vs(@builtin(vertex_index) vi: u32, i: IIn) -> IOut {
  var o: IOut;
  let c = vec2f(f32(vi & 1u), f32((vi >> 1u) & 1u));
  let base = i.i0.xyz; let yaw = i.i0.w;
  let s = i.i1.x; let H = i.i1.y * s; let R = i.i1.z * s;
  let cam = F.camPos.xyz - F2.siteOff.xyz;
  let rel = cam - (base + vec3f(0.0, H * 0.5, 0.0));
  let hd = length(rel.xz);
  let elev = atan2(rel.y, hd);
  // object-space azimuth of the camera (inverse of the instance yaw)
  let cy = cos(-yaw); let sy = sin(-yaw);
  let ro = vec2f(rel.x * cy + rel.z * sy, -rel.x * sy + rel.z * cy);
  var az = atan2(ro.x, ro.y); if (az < 0.0) { az += 6.2831853; }
  let kf = az / 0.7853982;
  let k0 = floor(kf);
  let top = elev > 0.95;
  var p: vec3f;
  if (top) {
    // horizontal quad at crown height, rotated with the instance
    let q = (c * 2.0 - 1.0) * R;
    let cr = cos(yaw); let sr = sin(yaw);
    p = base + vec3f(q.x * cr + q.y * sr, H * 0.72, -q.x * sr + q.y * cr);
    o.uv = c;
  } else {
    let right = normalize(vec3f(rel.z, 0.0, -rel.x));
    p = base + right * (c.x * 2.0 - 1.0) * R + vec3f(0.0, (c.y * 1.04 - 0.04) * H, 0.0);
    // lean the quad back towards the camera when seen from above so it does not shrink
    let toCam = normalize(rel);
    p += toCam * (c.y - 0.5) * H * max(0.0, sin(elev)) * 0.6;
    o.uv = vec2f(c.x, c.y);
  }
  o.views = vec4f(k0 % 8.0, (k0 + 1.0) % 8.0, kf - k0, select(0.0, 1.0, top));
  o.inst = vec4f(i.i3.x, i.i2.x, yaw, i.i3.z);
  o.ps = p;
  o.cp = F.viewProj * vec4f(siteToRender(p), 1.0);
  return o;
}

fn tileUv(uv: vec2f, k: f32) -> vec2f {
  let tx = k % 3.0; let ty = floor(k / 3.0);
  return (vec2f(tx, ty) + vec2f(clamp(uv.x, 0.01, 0.99), 1.0 - clamp(uv.y, 0.01, 0.99))) / 3.0;
}

@fragment fn fs(i: IOut) -> @location(0) vec4f {
  // LOD fade (dither) and view blend (dither)
  let f = i.inst.x;
  let d = ign(i.cp.xy + vec2f(0.5, 0.25));
  if (f > 0.0 && d >= f) { discard; }
  if (f < 0.0 && d < -f) { discard; }
  let d2 = ign(i.cp.xy * 1.37 + vec2f(3.1, 1.7));
  let k = select(select(i.views.x, i.views.y, d2 < i.views.z), 8.0, i.views.w > 0.5);
  let layer = i32(i.inst.y + 0.5);
  let uv = tileUv(i.uv, k);
  let a = textureSample(impAlb, repSampler, uv, layer);
  let nn = textureSample(impNrm, repSampler, uv, layer);
  let cov = clamp((a.a - 0.5) / max(fwidth(a.a), 1e-3) + 0.5, 0.0, 1.0);
  if (cov < 0.02) { discard; }
  var n = nn.xyz * 2.0 - 1.0;
  let cy = cos(i.inst.z); let sy = sin(i.inst.z);
  n = normalize(vec3f(n.x * cy + n.z * sy, n.y, -n.x * sy + n.z * cy));
  let L = F2.sunCol.xyz;
  let alb = a.rgb * mix(vec3f(1.1, 1.06, 0.82), vec3f(0.92, 1.0, 1.05), i.inst.w);
  let sh = shadowAt(i.ps, n, i.cp.xy);
  let ndl = dot(n, L);
  let sun = forestSun(i.ps.y) * sh;
  let V = normalize(F.camPos.xyz - siteToRender(i.ps));
  var col = alb * max((ndl + 0.45) / 1.45, 0.0) * sun / PI;
  col += alb * vec3f(1.3, 1.4, 0.6) * 0.35 * pow(max(dot(-V, L), 0.0), 6.0) * sun / PI;
  col += alb * forestSky(n) * nn.a * 0.85 / PI;
  var o = finishColor(col, i.ps);
  o.a = cov;
  return o;
}
`;

export const SHAFTS_WGSL = (multisampled: boolean) => COMMON_WGSL + FOREST_STRUCT_WGSL + /* wgsl */ `
@group(0) @binding(0) var<uniform> F: Frame;
` + FOREST_BINDINGS_WGSL + FOREST_FUNCS_WGSL + /* wgsl */ `
@group(2) @binding(0) var depthTex: ${multisampled ? 'texture_depth_multisampled_2d' : 'texture_depth_2d'};
override STEPS: i32 = 24;
struct FsOut { @builtin(position) pos: vec4f };
@vertex fn vsFull(@builtin(vertex_index) i: u32) -> FsOut {
  var o: FsOut; o.pos = vec4f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1), 0.0, 1.0); return o;
}
@fragment fn fsShafts(i: FsOut) -> @location(0) vec4f {
  let full = vec2i(i.pos.xy) * 2;
  let dim = vec2i(textureDimensions(depthTex));
  let dp = textureLoad(depthTex, min(full, dim - 1), 0);
  let uv = (vec2f(full) + 1.0) / vec2f(dim);
  let nd = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let rv = F.camFwd.xyz + F.camRight.xyz * (nd.x * F.camRight.w) + F.camUp.xyz * (nd.y * F.camUp.w);
  let rl = length(rv); let rd = rv / rl;
  let viewZ = F.camFwd.w / max(dp, 1e-7);
  let tmax = min(viewZ * rl, 110.0);
  let ro = F.camPos.xyz - F2.siteOff.xyz; // site-local camera
  let L = F2.sunCol.xyz;
  let dt = tmax / f32(STEPS);
  let j = ign(i.pos.xy);
  let k = 1.0 / F2.mist.y;
  var acc = 0.0; var od = 0.0;
  for (var n = 0; n < STEPS; n++) {
    let t = (f32(n) + j) * dt;
    let p = ro + rd * t;
    let s = F2.shadowVP * vec4f(p, 1.0);
    let suv = vec2f(s.x * 0.5 + 0.5, 0.5 - s.y * 0.5);
    var vis = 1.0;
    if (all(suv > vec2f(0.0)) && all(suv < vec2f(1.0))) { vis = textureSampleCompareLevel(shadowMap, shadowCmp, suv, s.z); }
    let dens = F2.mist.x * exp(-k * max(p.y - F2.mist.z, -10.0)) + 0.0008;
    acc += vis * dens * exp(-od) * dt;
    od += dens * dt;
  }
  let mu = dot(rd, L);
  let g = 0.6;
  let ph = (1.0 - g * g) / (4.0 * PI * pow(max(1.0 + g * g - 2.0 * g * mu, 1e-3), 1.5)) + 0.06;
  let c = forestSun(ro.y) * acc * ph * F2.look.y;
  return vec4f(min(c, vec3f(2000.0)), min(viewZ, 10000.0)); // rgba16float: keep finite (inf breaks the blur weights)
}

@group(3) @binding(0) var shaftTex: texture_2d<f32>;
@fragment fn fsBlur(i: FsOut) -> @location(0) vec4f {
  let p = vec2i(i.pos.xy); let mx = vec2i(textureDimensions(shaftTex)) - 1;
  let c = textureLoad(shaftTex, p, 0);
  var acc = vec3f(0.0); var ws = 0.0;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let r = textureLoad(shaftTex, clamp(p + vec2i(x, y), vec2i(0), mx), 0);
    let w = 1.0 / (0.03 + abs(r.a - c.a) / max(c.a, 1e-3));
    acc += r.rgb * w; ws += w;
  } }
  return vec4f(acc / ws, c.a);
}
@fragment fn fsComposite(i: FsOut) -> @location(0) vec4f {
  let uv = i.pos.xy / (vec2f(textureDimensions(shaftTex)) * 2.0);
  let c = textureSampleLevel(shaftTex, clampSampler, uv, 0.0).rgb;
  return vec4f(c, 0.0);
}
`;
