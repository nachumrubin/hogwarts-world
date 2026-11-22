// Static props and structures (landmark placeholders, railway, viaduct, river water, waterfalls).
import { COMMON_WGSL } from './common.wgsl.js';

export const PROPS_WGSL = COMMON_WGSL + /* wgsl */ `
struct Inst { pos: vec3f, rot: f32, tint: vec3f, scale: f32 };
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<storage, read> inst: array<Inst>;
@group(0) @binding(2) var overview: texture_2d<f32>;
@group(0) @binding(3) var linearSampler: sampler;

struct VIn { @location(0) p: vec3f, @location(1) n: vec4f };
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) rel: vec3f,
  @location(1) n: vec3f,
  @location(2) lp: vec3f,
  @location(3) @interpolate(flat) mat: u32,
  @location(4) @interpolate(flat) tint: vec3f,
};

// rotation about +Y, clockwise from north (towards east), matching src/meshes/mesh-builder.ts
fn rotY(v: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }

@vertex fn vs(v: VIn, @builtin(instance_index) ii: u32) -> VOut {
  let I = inst[ii];
  let p = rotY(v.p * I.scale, I.rot) + I.pos;
  var o: VOut;
  o.pos = F.viewProj * vec4f(p, 1.0);
  o.rel = p; o.n = rotY(v.n.xyz, I.rot); o.lp = v.p * I.scale;
  o.mat = u32(round(v.n.w * 127.0)); o.tint = I.tint;
  return o;
}

fn albedoOf(m: u32, lp: vec3f, wp: vec3f, n: vec3f) -> vec3f {
  let k = vnoise(wp.xz * 0.7 + wp.y * 0.31) * 0.5 + vnoise(vec2f(wp.x + wp.z, wp.y) * 2.3) * 0.5;
  // coursed masonry: horizontal courses with offset joints
  let course = fract(lp.y / 0.45);
  let joint = smoothstep(0.0, 0.08, course) * smoothstep(1.0, 0.92, course);
  switch m {
    case 0u: { return vec3f(0.23, 0.215, 0.19) * (0.75 + 0.4 * k) * (0.82 + 0.18 * joint); }   // castle stone
    case 1u: { return vec3f(0.07, 0.075, 0.085) * (0.8 + 0.4 * k); }                           // slate
    case 2u: { return vec3f(0.17, 0.11, 0.07) * (0.75 + 0.4 * k); }                            // timber
    case 3u: { return vec3f(0.05, 0.07, 0.06); }                                               // glass
    case 4u: { return vec3f(0.05, 0.08, 0.03) * (0.6 + 0.8 * k); }                             // foliage
    case 7u: { return vec3f(0.55, 0.40, 0.12); }                                               // gold
    case 8u: { return vec3f(0.50, 0.48, 0.45) * (0.8 + 0.3 * k); }                             // fabric (colour from the instance tint)
    case 9u: { return vec3f(0.42, 0.38, 0.31) * (0.8 + 0.3 * k); }                             // plaster
    case 10u: { return vec3f(0.10, 0.085, 0.075) * (0.75 + 0.5 * k); }                         // shingle roof
    case 11u: { return vec3f(0.16, 0.15, 0.15); }                                              // steel
    case 12u: { return vec3f(0.12, 0.10, 0.08) * (0.8 + 0.3 * k); }                            // sleepers/ballast
    case 13u: { return vec3f(0.24, 0.24, 0.23) * (0.7 + 0.5 * k); }                            // standing stone
    case 14u: { return vec3f(0.55, 0.56, 0.58); }                                              // webs
    case 15u: { return vec3f(0.11, 0.11, 0.12) * (0.7 + 0.5 * k); }                            // dark stone
    case 16u: { return vec3f(0.07, 0.10, 0.035) * (0.85 + 0.3 * k); }                          // lawn
    default: { return vec3f(0.3); }
  }
}

@fragment fn fs(i: VOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let wp = i.rel + F.origin.xyz;
  let toP = i.rel - F.camPos.xyz;
  let dist = length(toP);
  let v = toP / max(dist, 1e-3);
  var n = normalize(i.n); if (!ff) { n = -n; }
  let ouv = overviewUV(wp.xz);
  var shadow = 1.0; var skyVis = 1.0;
  if (inOverview(ouv)) {
    let o = textureSampleLevel(overview, linearSampler, ouv, 0.0);
    // the overview shadow is the terrain's at ground level; parts well above the ground escape it
    let above = sat((wp.y - o.b) / 25.0);
    shadow = mix(1.0, mix(o.r, 1.0, above), F.params.w);
    skyVis = mix(1.0, mix(o.g, 1.0, above), F.params.w);
  }
  let L = F.sunDir.xyz;
  let sunE = sunIrradiance(max(wp.y, 0.0)) * shadow;
  if (i.mat == 5u || i.mat == 6u) {
    // river water and waterfall foam
    let t = F.camPos.w;
    if (i.mat == 6u) {
      let f = vnoise(vec2f((wp.x + wp.z) * 0.7, wp.y * 0.5 + t * 3.0)) * 0.6 + vnoise(vec2f((wp.x - wp.z) * 2.1, wp.y * 1.7 + t * 5.0)) * 0.4;
      let foam = vec3f(0.55, 0.58, 0.6) * (0.55 + 0.6 * f);
      return hdrOut(aerial(foam * (sunE * 0.6 + skyAmbient(n)) / PI, toP));
    }
    let g = vnoised(wp.xz * 0.6 + vec2f(t * 0.6, t * 0.35)).yz * 0.08;
    let nn = normalize(vec3f(-g.x, 1.0, -g.y));
    let r = reflect(v, nn);
    let fres = 0.02 + 0.98 * pow(1.0 - max(dot(-v, nn), 0.0), 5.0);
    // banks and trees line a river: near-horizontal reflections see mostly dark bank, not sky
    let bank = (sunE * 0.25 + skyAmbient(vec3f(0.0, 1.0, 0.0))) * vec3f(0.045, 0.055, 0.04) / PI;
    let refl = mix(bank, skyRadiance(vec3f(r.x, max(r.y, 0.02), r.z), false), smoothstep(0.05, 0.4, r.y));
    let col = refl * fres * 0.75 + (sunE * L.y + skyAmbient(vec3f(0.0, 1.0, 0.0))) * vec3f(0.010, 0.012, 0.010) * (1.0 - fres);
    return hdrOut(aerial(col, toP));
  }
  let alb = albedoOf(i.mat, i.lp, wp, n) * i.tint;
  let ndl = max(dot(n, L), 0.0);
  var col = alb * (sunE * ndl + skyAmbient(n) * skyVis * (0.55 + 0.45 * n.y)) / PI;
  if (i.mat == 3u || i.mat == 7u) {
    let r = reflect(v, n);
    let fres = 0.04 + 0.96 * pow(1.0 - max(dot(-v, n), 0.0), 5.0);
    col += skyRadiance(r, false) * fres * select(0.5, 0.25, i.mat == 7u) + sunE * pow(max(dot(r, L), 0.0), 200.0) * 2.0;
  }
  return hdrOut(aerial(col, toP));
}
`;
