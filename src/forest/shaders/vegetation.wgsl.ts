// Trees, rocks, logs and roots: one vertex format, instanced. Two fragment paths (separate pipelines, so texture
// sampling stays in uniform control flow): opaque wood/rock, and alpha-to-coverage leaf cards.
//
// Per-instance variation in the vertex shader (stem lean and S-bend, crown shift towards light, scale, tint, leaf
// density) on top of per-archetype geometry, so neighbours never share a silhouette.
// Wind: hierarchical — the stem sways with height², branches by their flex weight, leaf cards flutter along their
// normals — driven by a travelling gust field (spatially coherent, never synchronised across the forest).
// Adapted from Abyssal Garden sway() (shaders.js W_LEAF): position-phased, amplitude growing with height, two
// summed frequencies.

import { COMMON_WGSL } from '../../gpu/shaders/common.wgsl.js';
import { FOREST_STRUCT_WGSL, FOREST_BINDINGS_WGSL, FOREST_FUNCS_WGSL } from './forest-common.wgsl.ts';

export const VEG_HEAD = COMMON_WGSL + FOREST_STRUCT_WGSL + /* wgsl */ `
@group(0) @binding(0) var<uniform> F: Frame;
` + FOREST_BINDINGS_WGSL + FOREST_FUNCS_WGSL;

export const VEGETATION_WGSL = VEG_HEAD + /* wgsl */ `
struct VIn {
  @location(0) pos: vec3f, @location(1) nrm: vec4f, @location(2) tan: vec4f, @location(3) uv: vec2f,
  @location(4) wind: vec4f, @location(5) mat: vec4u,
  @location(6) i0: vec4f, @location(7) i1: vec4f, @location(8) i2: vec4f, @location(9) i3: vec4f,
};
struct VOut {
  @builtin(position) cp: vec4f,
  @location(0) ps: vec3f, @location(1) n: vec3f, @location(2) t: vec3f, @location(3) uv: vec2f,
  @location(4) @interpolate(flat) mat: vec4u, @location(5) ao: f32, @location(6) hn: f32,
  @location(7) @interpolate(flat) inst: vec4f,   // fade, density, tint, moss/stiffness
  @location(8) @interpolate(flat) seed: f32, @location(9) varr: f32, @location(10) lp: vec3f,
};

fn rotY(v: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }

fn deform(i: VIn, withWind: bool) -> VOut {
  var o: VOut;
  let scale = i.i1.x; let invH = i.i1.y;
  var p = i.pos * scale;
  let hn = clamp(p.y * invH, 0.0, 1.5);
  var w = rotY(p, i.i0.w);
  // stem lean (shear), S-bend and crown shift towards light
  let bendDir = vec2f(cos(i.i2.w * 6.2831), sin(i.i2.w * 6.2831));
  w.x += i.i1.z * max(p.y, 0.0) + i.i2.x * hn * hn + bendDir.x * i.i2.z * sin(3.14159 * min(hn, 1.0));
  w.z += i.i1.w * max(p.y, 0.0) + i.i2.y * hn * hn + bendDir.y * i.i2.z * sin(3.14159 * min(hn, 1.0));
  var n = rotY(i.nrm.xyz, i.i0.w);
  let t = rotY(i.tan.xyz, i.i0.w);
  let base = i.i0.xyz;
  if (withWind && F2.look.z > 0.5) {
    let time = F2.siteOff.w;
    let g = gust(base.xz);
    let stiff = max(i.i3.w, 0.3);
    let H = select(10.0, 1.0 / max(invH, 1e-4), invH > 0.0);
    let wd = windDir(); let wp = vec3f(-wd.z, 0.0, wd.x);
    // stem: slow bending, a little cross-wind oscillation
    let amp = g * 0.0045 * H * hn * hn / stiff;
    w += wd * amp * (0.75 + 0.25 * sin(time * 0.7 + i.i2.w * 40.0)) + wp * amp * 0.25 * sin(time * 1.1 + i.i2.w * 23.0);
    // branches: flex weight from the mesh; frequency rises towards the twigs
    let fl = i.wind.x * i.wind.x;
    let ph = i.wind.y * 6.2831 + i.i2.w * 13.0;
    let fr = 1.3 + i.wind.z * 3.2;
    let osc = vec3f(sin(time * fr + ph), 0.5 * sin(time * fr * 1.37 + ph * 1.7), cos(time * fr * 0.91 + ph * 0.6));
    w += (wd * g * 0.6 + osc * (0.25 + 0.75 * g)) * fl * 0.16 / stiff * min(scale, 1.5);
    // leaves: flutter along the card normal
    if (i.mat.x == 1u) { w += t * sin(time * (6.5 + i.wind.y * 4.0) + f32(i.mat.z) * 0.37 + base.x) * 0.03 * (0.3 + g); }
  }
  let ps = base + w;
  o.ps = ps; o.n = n; o.t = t; o.uv = i.uv; o.mat = i.mat; o.ao = i.wind.w; o.hn = hn;
  o.inst = i.i3; o.inst.x = i.i3.x; o.seed = i.i2.w; o.varr = f32(i.mat.w) / 255.0; o.lp = i.pos;
  o.cp = F.viewProj * vec4f(siteToRender(ps), 1.0);
  return o;
}

@vertex fn vs(i: VIn) -> VOut { return deform(i, true); }
@vertex fn vsStatic(i: VIn) -> VOut { return deform(i, false); }

// dithered LOD cross-fade: complementary masks for the outgoing and incoming level
fn lodFade(fc: vec2f, f: f32) {
  if (f == 0.0) { return; }
  let d = ign(fc + vec2f(0.5, 0.25));
  if (f > 0.0) { if (d >= f) { discard; } } else { if (d < -f) { discard; } }
}

fn tileUV(uv: vec2f, tile: u32) -> vec2f {
  let tx = f32(tile % 4u); let ty = f32(tile / 4u);
  let q = clamp(vec2f(uv.x, 1.0 - uv.y), vec2f(0.004), vec2f(0.996));
  return (vec2f(tx, ty) + q) * 0.25;
}

// ---------------------------------------------------------------- wood and rock
fn barkColor(layer: u32, d: DS, hn: f32, varr: f32, seed: f32) -> vec3f {
  let h = d.h; let m = d.m;
  var c: vec3f;
  switch layer {
    case 0u: { c = mix(vec3f(0.045, 0.040, 0.034), vec3f(0.115, 0.102, 0.088), ssf(0.2, 0.8, h)); c = mix(c, vec3f(0.17, 0.18, 0.15), ssf(0.62, 0.8, m) * 0.6); }   // oak + lichen
    case 1u: { c = mix(vec3f(0.30, 0.12, 0.055), vec3f(0.42, 0.20, 0.09), m) * (0.55 + 0.55 * h); c = mix(c, vec3f(0.16, 0.13, 0.11), ssf(0.75, 0.95, m) * 0.6); }  // pine upper: orange flakes
    case 2u: { // pine lower: red fissures, grey plates; the upper stem turns orange and flaky
      c = mix(vec3f(0.12, 0.055, 0.030), vec3f(0.115, 0.098, 0.085), ssf(0.3, 0.7, m)) * (0.55 + 0.6 * h);
      c = mix(c, mix(vec3f(0.30, 0.13, 0.06), vec3f(0.40, 0.19, 0.085), m) * (0.6 + 0.5 * h), ssf(0.35, 0.6, hn));
    }
    case 3u: { // birch: white with black lenticels and diamonds; black fissured base
      c = mix(vec3f(0.52, 0.50, 0.46), vec3f(0.035, 0.030, 0.028), m) * (0.8 + 0.25 * h);
      c = mix(c, vec3f(0.045, 0.040, 0.035) * (0.6 + 0.8 * h), ssf(0.22, 0.05, hn));
    }
    case 4u: { c = mix(vec3f(0.14, 0.135, 0.12), vec3f(0.22, 0.23, 0.19), m * 0.7) * (0.75 + 0.35 * h); }  // smooth grey
    default: { c = mix(vec3f(0.12, 0.11, 0.095), vec3f(0.26, 0.245, 0.22), h) * (0.8 + 0.3 * m); }        // deadwood, silvered
  }
  return c * (0.85 + 0.3 * hashf(seed * 91.0));
}

@fragment fn fsSolid(i: VOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  lodFade(i.cp.xy, i.inst.x);
  let ng = normalize(i.n) * select(-1.0, 1.0, ff);
  let dist = length(siteToRender(i.ps) - F.camPos.xyz);
  let mat = i.mat.x; let layer = i.mat.y;
  var alb: vec3f; var n = ng; var rough = 0.9; var ao = i.ao;
  let basic = F2.look.x < 1.5;
  // sample everything unconditionally (uniform control flow), pick by material
  let T = normalize(i.t - ng * dot(i.t, ng));
  let Bt = cross(ng, T);
  let barkL = i32(min(layer, 5u)) + L_BARK;
  let bk = textureSample(detail, repSampler, i.uv, barkL);
  let bd = DS(bk.b, bk.a, bk.rg * 2.0 - 1.0);
  // triplanar for rocks (object space, so the texture sticks to the rock), Abyssal Garden tri()
  let wts = pow(abs(normalize(i.n)), vec3f(4.0)); let wn = wts / (wts.x + wts.y + wts.z);
  let rs = 0.55 * i.inst.y;
  let rx = textureSample(detail, repSampler, i.lp.zy * rs, L_ROCK); let ry = textureSample(detail, repSampler, i.lp.xz * rs, L_ROCK); let rz = textureSample(detail, repSampler, i.lp.xy * rs, L_ROCK);
  let rh = rx.b * wn.x + ry.b * wn.y + rz.b * wn.z; let rm = rx.a * wn.x + ry.a * wn.y + rz.a * wn.z;
  let ra = rx.rg * 2.0 - 1.0; let rb = ry.rg * 2.0 - 1.0; let rc = rz.rg * 2.0 - 1.0;
  let rn = vec3f(0.0, ra.y, ra.x) * wn.x + vec3f(rb.x, 0.0, rb.y) * wn.y + vec3f(rc.x, rc.y, 0.0) * wn.z;
  // moss (from the ground moss layer), triplanar in world space
  let mx = textureSample(detail, repSampler, i.ps.zy * 1.3, L_MOSS); let my = textureSample(detail, repSampler, i.ps.xz * 1.3, L_MOSS);
  let mh = mix(mx.b, my.b, wn.y); let mm = mix(mx.a, my.a, wn.y);
  let mossCol = mix(vec3f(0.032, 0.058, 0.012), vec3f(0.090, 0.115, 0.024), mm) * (0.5 + 0.7 * mh);
  let cv = canopyAt(i.ps);
  let damp = sat(0.35 + cv.g * 0.8 + (1.0 - cv.r) * 0.3);

  if (mat == 3u) { // rock
    alb = mix(vec3f(0.075, 0.075, 0.07), vec3f(0.165, 0.16, 0.148), rm) * (0.5 + 0.65 * rh);
    alb = mix(alb, vec3f(0.21, 0.22, 0.18), ssf(0.66, 0.78, fract(rm * 5.3 + i.seed)) * 0.55); // lichen
    let mossK = sat(ssf(0.1, 0.75, ng.y + (mh - 0.5) * 0.6) * i.inst.w * 1.3 + ssf(0.0, -0.5, i.lp.y) * 0.4);
    alb = mix(alb, mossCol, mossK);
    n = normalize(ng + rotY(rn, 0.0) * 0.9 * (1.0 - mossK * 0.6));
    rough = 0.8;
    ao *= mix(0.55, 1.0, ssf(0.1, 0.6, rh));
  } else if (mat == 7u) { // root-plate soil
    alb = vec3f(0.055, 0.042, 0.030) * (0.6 + 0.6 * bd.h);
    n = normalize(ng + (T * bd.s.x + Bt * bd.s.y) * 0.6);
  } else if (mat == 4u) { // broken / cut wood: pale, ringed, darker with decay
    let r = length(i.uv - 0.5) * 2.0;
    alb = mix(vec3f(0.30, 0.22, 0.13), vec3f(0.17, 0.12, 0.07), ssf(0.0, 1.0, r)) * (0.85 + 0.15 * sin(r * 40.0));
    alb = mix(alb, vec3f(0.10, 0.08, 0.06), i.varr * 0.8);
    n = normalize(ng + (T * bd.s.x + Bt * bd.s.y) * 0.5);
  } else if (mat == 6u) { // bracket fungus
    alb = mix(vec3f(0.22, 0.16, 0.10), vec3f(0.45, 0.40, 0.32), ssf(0.6, 0.9, i.uv.y)) * (0.8 + 0.3 * bd.h);
    rough = 0.7;
  } else { // bark, deadwood, roots
    alb = barkColor(min(layer, 5u), bd, i.hn, i.varr, i.seed);
    n = normalize(ng + (T * bd.s.y + Bt * bd.s.x) * 1.4);
    // decaying logs lose bark in patches
    if (i.varr > 0.0 && mat == 0u) { alb = mix(alb, barkColor(5u, bd, i.hn, 0.0, i.seed), ssf(0.45, 0.7, i.varr + (bd.m - 0.5) * 0.6)); }
    // moss: lower stem and up-facing limbs, north side (Z+) in this wet climate, more where the canopy keeps it damp
    let sp = layer;
    let mossy = select(select(select(0.55, 0.25, sp == 3u), 0.35, sp == 1u || sp == 2u), 1.0, sp == 0u || sp == 5u);
    var mossK = (ssf(0.35, 0.0, i.hn) * 0.7 + ssf(0.2, 0.8, ng.y) * 0.6 + ssf(0.0, 0.8, ng.z) * 0.25) * mossy * damp;
    if (mat == 5u) { mossK = mossK * 0.5 + 0.3 * ssf(0.2, 0.7, ng.y); }
    if (i.varr > 0.0) { mossK += ssf(0.3, 0.9, i.varr) * ssf(-0.2, 0.6, ng.y) * 0.8; }
    mossK = sat(mossK + (mh - 0.5) * 0.5) * i.inst.w;
    alb = mix(alb, mossCol, ssf(0.25, 0.6, mossK));
    n = normalize(mix(n, ng, ssf(0.25, 0.6, mossK) * 0.5));
    ao *= mix(0.6, 1.0, bd.h);
    if (mat == 5u) { alb *= 0.75; ao *= 0.85; }
  }
  if (basic) {
    alb = select(select(vec3f(0.10, 0.085, 0.07), vec3f(0.45, 0.43, 0.40), layer == 3u), vec3f(0.12, 0.12, 0.11), mat == 3u);
    n = ng; ao = i.ao;
  }
  alb *= mix(0.9, 1.1, i.inst.z);
  let col = forestLight(alb, i.ps, n, ng, ao, rough, i.cp.xy, 1.0);
  return finishColor(col, i.ps);
}

// ---------------------------------------------------------------- leaf cards
struct LeafOut { @location(0) c: vec4f };
fn leafSample(i: VOut) -> vec4f { return textureSample(leafAlb, repSampler, tileUV(i.uv, i.mat.y)); }

@fragment fn fsLeaf(i: VOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  lodFade(i.cp.xy, i.inst.x);
  let a = leafSample(i);
  let nm = textureSample(leafNrm, repSampler, tileUV(i.uv, i.mat.y));
  // canopy density: thinner, less healthy crowns drop some cards
  if (f32(i.mat.z) / 255.0 > i.inst.y) { discard; }
  // sharpen alpha into coverage for alpha-to-coverage (crisp edges, no sorting)
  let cov = clamp((a.a - 0.45) / max(fwidth(a.a), 1e-3) + 0.5, 0.0, 1.0);
  if (cov < 0.02) { discard; }
  let cardN = normalize(i.t) * select(-1.0, 1.0, ff);
  let folN = normalize(i.n);
  var n = normalize(folN * 0.65 + cardN * 0.35 + vec3f(nm.x - 0.5, 0.0, nm.y - 0.5) * 0.6);
  let L = F2.sunCol.xyz;
  let V = normalize(F.camPos.xyz - siteToRender(i.ps));
  // per-instance hue/health tint: some crowns yellower, some deeper green
  var alb = a.rgb * mix(vec3f(1.12, 1.08, 0.8), vec3f(0.92, 1.0, 1.05), i.inst.z);
  alb *= 0.85 + 0.3 * hashf(f32(i.mat.z) + i.seed * 17.0);
  let sh = shadowAt(i.ps, cardN, i.cp.xy);
  let cv = canopyAt(i.ps);
  let ao = i.ao * i.ao * (1.0 - 0.6 * cv.g);
  let ndl = dot(n, L);
  let wrap = max((ndl + 0.45) / 1.45, 0.0);
  let sun = forestSun(i.ps.y) * sh;
  // diffuse transmission and forward-scattered glow when the sun is behind the leaf
  let trans = nm.b * (max(-dot(cardN, L), 0.0) * 0.55 + pow(max(dot(-V, L), 0.0), 6.0) * 0.9);
  let transCol = alb * vec3f(1.35, 1.45, 0.6);
  var col = (alb * wrap + transCol * trans) * sun / PI;
  col += alb * forestSky(n) * cv.r * ao / PI;
  col += alb * forestSky(vec3f(0.0, 1.0, 0.0)) * (1.0 - cv.r) * 0.22 * vec3f(0.8, 1.0, 0.6) * ao / PI;
  col += alb * forestSun(0.0) * F2.sunCol.y * vec3f(0.04, 0.05, 0.025) * ao / PI;
  let H = normalize(V + L);
  col += sun * pow(max(dot(cardN * sign(dot(cardN, V) + 1e-4), H), 0.0), 60.0) * nm.a * 0.12 * max(ndl, 0.0);
  if (F2.look.x < 1.5) { col = vec3f(0.035, 0.06, 0.02) * (forestSun(i.ps.y) * max(ndl, 0.2) + forestSky(n)) / PI; }
  var o = finishColor(col, i.ps);
  o.a = cov;
  return o;
}

// ---------------------------------------------------------------- shadow map
struct SOut { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) mat: vec4u, @location(2) @interpolate(flat) dens: f32 };
@vertex fn vsShadow(i: VIn) -> SOut {
  let o = deform(i, false);
  var s: SOut; s.cp = F2.shadowVP * vec4f(o.ps, 1.0); s.uv = i.uv; s.mat = i.mat; s.dens = i.i3.y;
  return s;
}
@fragment fn fsShadowLeaf(s: SOut) {
  let a = textureSampleLevel(leafAlb, repSampler, tileUV(s.uv, s.mat.y), 1.0);
  if (a.a < 0.5 || f32(s.mat.z) / 255.0 > s.dens) { discard; }
}

// ---------------------------------------------------------------- impostor bake (unlit albedo + normal, orthographic views)
struct BakeOut { @location(0) alb: vec4f, @location(1) nrm: vec4f };
@vertex fn vsBake(i: VIn) -> VOut {
  var o = deform(i, false);
  o.cp = F2.shadowVP * vec4f(o.ps, 1.0); // the bake camera is passed in shadowVP
  return o;
}
@fragment fn fsBakeSolid(i: VOut, @builtin(front_facing) ff: bool) -> BakeOut {
  let ng = normalize(i.n) * select(-1.0, 1.0, ff);
  let bk = textureSample(detail, repSampler, i.uv, i32(min(i.mat.y, 5u)) + L_BARK);
  let bd = DS(bk.b, bk.a, bk.rg * 2.0 - 1.0);
  var o: BakeOut;
  o.alb = vec4f(barkColor(min(i.mat.y, 5u), bd, i.hn, 0.0, i.seed) * i.ao, 1.0);
  o.nrm = vec4f(ng * 0.5 + 0.5, i.ao);
  return o;
}
@fragment fn fsBakeLeaf(i: VOut, @builtin(front_facing) ff: bool) -> BakeOut {
  let a = textureSample(leafAlb, repSampler, tileUV(i.uv, i.mat.y));
  if (a.a < 0.5) { discard; }
  var o: BakeOut;
  let n = normalize(normalize(i.n) * 0.7 + normalize(i.t) * select(-0.3, 0.3, ff));
  o.alb = vec4f(a.rgb, 1.0);
  o.nrm = vec4f(n * 0.5 + 0.5, i.ao);
  return o;
}
`;
