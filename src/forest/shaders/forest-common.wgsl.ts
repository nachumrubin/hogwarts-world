// Shared WGSL for the forest POC: the forest uniform block and its bind group (group 1), shadows, canopy sky
// visibility, wind, mist, and the layered materials (ground, bark, rock).
//
// Techniques adapted from Abyssal Garden (MIT, © 2026 Maksymilian Dendura), shaders.js:
//   • tri()/W_SOLID: runtime-baked tileable detail textures storing slope (rg), height (b) and a mask (a), sampled at
//     several scales and blended; normals perturbed from the stored slopes
//   • shadow9(): 3×3 PCF on a sun shadow map with a comparison sampler
//   • vol()/amb(): a low-resolution volume of the scene's occupancy gives sky visibility and ambient occlusion
//   • sway(): wind displacement phased by position and growing with height, two summed frequencies
//   • fogIn(): analytic integral of exponential height fog along the view ray
// Coordinates: "site-local" = world − (SITE.x0, 0, SITE.z0). Render-relative = site-local + F2.siteOff.xyz.

export const FOREST_STRUCT_WGSL = /* wgsl */ `
struct Forest {
  shadowVP: mat4x4f,  // site-local → shadow clip
  siteOff: vec4f,     // xyz: site-local origin relative to the render origin; w: time (s)
  mapRect: vec4f,     // material maps: site-local x0, z0, 1/sizeX, 1/sizeZ
  volRect: vec4f,     // canopy volume: site-local x0, z0, 1/sizeX, 1/sizeZ
  volY: vec4f,        // volume y0, 1/sizeY; z: shadows on (0/1); w: shadow texel size (uv)
  wind: vec4f,        // direction x, z; strength 0..1; gust speed (m/s)
  mist: vec4f,        // density at the floor (1/m), scale height (m), floor height (m), overcast 0..1
  look: vec4f,        // x: mode (1 basic, 2 full); y: shaft strength; z: wind on; w: detail textures on
  lod: vec4f,         // LOD0 end, LOD1 end, LOD2 end (m), cross-fade band (fraction)
  sunCol: vec4f,      // xyz: sun direction (same as Frame), w: shadow softness (texels)
};
`;

export const FOREST_BINDINGS_WGSL = /* wgsl */ `
@group(1) @binding(0) var<uniform> F2: Forest;
@group(1) @binding(1) var shadowMap: texture_depth_2d;
@group(1) @binding(2) var shadowCmp: sampler_comparison;
@group(1) @binding(3) var detail: texture_2d_array<f32>;
@group(1) @binding(4) var repSampler: sampler;
@group(1) @binding(5) var matA: texture_2d<f32>;
@group(1) @binding(6) var matB: texture_2d<f32>;
@group(1) @binding(7) var canopy: texture_3d<f32>;
@group(1) @binding(8) var leafAlb: texture_2d<f32>;
@group(1) @binding(9) var leafNrm: texture_2d<f32>;
@group(1) @binding(10) var clampSampler: sampler;
`;

/** Functions; need COMMON_WGSL (Frame F, noise, atmosphere) and the forest struct/bindings before them. */
export const FOREST_FUNCS_WGSL = /* wgsl */ `
const L_SOIL = 0; const L_MOSS = 1; const L_MUD = 2; const L_ROCK = 3; const L_GRASS = 4; const L_LITTER = 5; const L_NEEDLE = 6;
const L_BARK = 7; // + bark index (oak, pine upper, pine lower, birch, smooth, deadwood)

fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }
fn ssf(a: f32, b: f32, x: f32) -> f32 { return smoothstep(a, b, x); }
fn hashf(x: f32) -> f32 { return fract(sin(x * 127.1) * 43758.5453); }

fn siteToRender(p: vec3f) -> vec3f { return p + F2.siteOff.xyz; }

// ---------------------------------------------------------------- shadows
fn shadowAt(ps: vec3f, ng: vec3f, fc: vec2f) -> f32 {
  if (F2.volY.z < 0.5) { return 1.0; }
  let L = F2.sunCol.xyz;
  // normal offset (grows at grazing angles) avoids acne without peter-panning
  let off = ng * (0.04 + 0.10 * (1.0 - abs(dot(ng, L))));
  let s = F2.shadowVP * vec4f(ps + off, 1.0);
  let uv = vec2f(s.x * 0.5 + 0.5, 0.5 - s.y * 0.5);
  if (any(uv < vec2f(0.002)) || any(uv > vec2f(0.998))) { return 1.0; }
  let z = s.z;
  let e = F2.volY.w * F2.sunCol.w;
  // 3×3 PCF on a per-pixel rotated grid (Abyssal Garden shadow9, rotated to trade banding for fine noise)
  let a = ign(fc) * 6.2831853; let cs = cos(a); let sn = sin(a);
  var acc = 0.0;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let o = vec2f(f32(x), f32(y)) * e;
    acc += textureSampleCompareLevel(shadowMap, shadowCmp, uv + vec2f(o.x * cs - o.y * sn, o.x * sn + o.y * cs), z);
  } }
  return acc / 9.0;
}

// ---------------------------------------------------------------- canopy volume: sky visibility (r), leaf density (g)
fn canopyAt(ps: vec3f) -> vec2f {
  let uvw = vec3f((ps.x - F2.volRect.x) * F2.volRect.z, (ps.y - F2.volY.x) * F2.volY.y, (ps.z - F2.volRect.y) * F2.volRect.w);
  if (any(uvw < vec3f(0.0)) || any(uvw > vec3f(1.0))) { return vec2f(1.0, 0.0); }
  return textureSampleLevel(canopy, clampSampler, uvw, 0.0).rg;
}

// ---------------------------------------------------------------- wind (spatially coherent travelling gusts)
fn windDir() -> vec3f { return vec3f(F2.wind.x, 0.0, F2.wind.y); }
fn gust(ps: vec2f) -> f32 {
  let t = F2.siteOff.w;
  let d = vec2f(F2.wind.x, F2.wind.y);
  let q = (ps - d * t * F2.wind.w) * 0.028;
  return F2.wind.z * (0.35 + 0.65 * smoothstep(0.25, 0.85, 0.5 + 0.5 * vnoise(q) * 0.7 + 0.5 * vnoise(q * 2.7 + 3.1) * 0.3));
}

// ---------------------------------------------------------------- overcast-aware light
fn forestSun(y: f32) -> vec3f { return sunIrradiance(max(y, 0.0)); }
fn forestSky(n: vec3f) -> vec3f { return skyAmbient(n); }

// forest mist: exponential height fog integrated along the view ray (Abyssal Garden fogIn), tinted by sky and sun
fn forestMist(col: vec3f, ps: vec3f, camS: vec3f) -> vec3f {
  let v = ps - camS; let d0 = length(v);
  if (d0 < 0.01 || F2.mist.x <= 0.0) { return col; }
  let rd = v / d0;
  let d = min(d0, 160.0); // forest mist only within the stand (Abyssal Garden limits its skylight to 150 m the same way)
  let k = 1.0 / F2.mist.y;
  let h0 = camS.y - F2.mist.z;
  let a = k * rd.y;
  var od: f32;
  if (abs(a * d) < 1e-3) { od = F2.mist.x * exp(-k * max(h0, -20.0)) * d; }
  else { od = F2.mist.x * exp(-k * max(h0, -20.0)) * (1.0 - exp(-a * d)) / a; }
  let T = exp(-od);
  let mu = max(dot(rd, F2.sunCol.xyz), 0.0);
  let ins = forestSky(vec3f(0.0, 1.0, 0.0)) / PI * 0.55 + forestSun(camS.y) * (0.08 + 0.35 * pow(mu, 8.0)) * 0.25 * (1.0 - min(F2.look.y, 1.0));
  return col * T + ins * (1.0 - T);
}

fn finishColor(col: vec3f, ps: vec3f) -> vec4f {
  let camS = F.camPos.xyz - F2.siteOff.xyz;
  var c = forestMist(col, ps, camS);
  c = aerial(c, siteToRender(ps) - F.camPos.xyz);
  return hdrOut(c);
}

// ---------------------------------------------------------------- detail texture sampling (derivatives passed in)
struct DS { h: f32, m: f32, s: vec2f };
fn dsamp(uv: vec2f, du: vec2f, dv: vec2f, layer: i32) -> DS {
  let t = textureSampleGrad(detail, repSampler, uv, layer, du, dv);
  var o: DS; o.s = t.rg * 2.0 - 1.0; o.h = t.b; o.m = t.a; return o;
}

// ---------------------------------------------------------------- forest floor
struct Ground { alb: vec3f, n: vec3f, rough: f32, wet: f32, ao: f32 };

fn rot2(p: vec2f, a: f32) -> vec2f { let c = cos(a); let s = sin(a); return vec2f(p.x * c - p.y * s, p.x * s + p.y * c); }

/** Layered forest-floor material at site-local ps with geometric normal ng; dpx/dpy = screen derivatives of ps. */
fn forestGround(ps: vec3f, ng: vec3f, dpx: vec3f, dpy: vec3f, dist: f32) -> Ground {
  var g: Ground;
  let muv = vec2f((ps.x - F2.mapRect.x) * F2.mapRect.z, (ps.z - F2.mapRect.y) * F2.mapRect.w);
  let A = textureSampleLevel(matA, clampSampler, muv, 0.0);   // moss, mud, rock, grass
  let B = textureSampleLevel(matB, clampSampler, muv, 0.0);   // broadleaf litter, needles, trail, light
  // two scales, the second rotated, blended by a slow noise: no visible tiling at walking height or from the air
  let s1 = 0.62; let s2 = 0.21;
  let p1 = ps.xz * s1; let p2 = rot2(ps.xz, 0.71) * s2 + vec2f(0.37, 0.11);
  let d1x = dpx.xz * s1; let d1y = dpy.xz * s1; let d2x = rot2(dpx.xz, 0.71) * s2; let d2y = rot2(dpy.xz, 0.71) * s2;
  let mixK = smoothstep(0.3, 0.7, 0.5 + 0.5 * vnoise(ps.xz * 0.045));
  let far = smoothstep(18.0, 70.0, dist);
  // per-layer: sample both scales
  var hs: array<f32, 7>; var ms: array<f32, 7>; var ss: array<vec2f, 7>;
  for (var i = 0; i < 7; i++) {
    let a = dsamp(p1, d1x, d1y, i); let b = dsamp(p2, d2x, d2y, i);
    let k = mix(mixK * 0.6, 0.85, far);
    hs[i] = mix(a.h, b.h, k); ms[i] = mix(a.m, b.m, k); ss[i] = mix(a.s * s1, b.s * s2, k) / mix(s1, s2, k);
  }
  // weights from the ecology maps; soil fills what is left
  let macroV = vnoise(ps.xz * 0.11) * 0.15;
  var w: array<f32, 7>;
  w[L_MOSS] = A.r * 1.25 + macroV + 0.15 * B.g * vnoise(ps.xz * 0.23);
  w[L_MUD] = A.g;
  w[L_ROCK] = A.b * 1.2;
  w[L_GRASS] = A.a * 0.8;
  w[L_LITTER] = B.r * (1.0 - B.b * 0.8) * 0.9;
  w[L_NEEDLE] = B.g * (1.0 - B.b * 0.8) * 0.8;
  w[L_SOIL] = 0.35 + B.b * 0.6;
  // height-based blending: the layer whose (height + weight) stands highest wins, with a soft transition
  var top = -9.0;
  for (var i = 0; i < 7; i++) { top = max(top, hs[i] * 0.55 + w[i]); }
  var bw: array<f32, 7>; var sum = 0.0;
  for (var i = 0; i < 7; i++) { bw[i] = max(hs[i] * 0.55 + w[i] - top + 0.18, 0.0); sum += bw[i]; }
  var alb = vec3f(0.0); var sl = vec2f(0.0); var hgt = 0.0; var rough = 0.0; var wet = 0.0;
  for (var i = 0; i < 7; i++) {
    let k = bw[i] / sum;
    if (k <= 0.0) { continue; }
    let h = hs[i]; let m = ms[i];
    var c: vec3f; var r = 0.9; var we = 0.0; var bumpK = 1.0;
    switch i {
      case 0: { c = mix(vec3f(0.050, 0.036, 0.024), vec3f(0.085, 0.062, 0.040), m) * (0.6 + 0.6 * h); }  // soil, humus
      case 1: { c = mix(vec3f(0.035, 0.060, 0.012), vec3f(0.095, 0.118, 0.025), m) * (0.45 + 0.75 * h); c = mix(c, vec3f(0.11, 0.10, 0.03), ssf(0.75, 0.95, m) * 0.4); r = 0.95; } // moss
      case 2: { we = ssf(0.55, 0.15, h); c = mix(vec3f(0.060, 0.047, 0.032), vec3f(0.026, 0.021, 0.016), we) * (0.75 + 0.4 * m); r = mix(0.75, 0.18, we); bumpK = 0.5; } // mud
      case 3: { c = mix(vec3f(0.085, 0.085, 0.080), vec3f(0.17, 0.165, 0.150), m) * (0.55 + 0.6 * h); c = mix(c, vec3f(0.20, 0.21, 0.17), ssf(0.62, 0.8, fract(m * 7.13)) * 0.5); r = 0.8; } // rock + lichen
      case 4: { c = mix(vec3f(0.042, 0.060, 0.022), vec3f(0.100, 0.090, 0.050), ssf(0.35, 0.9, m)) * (0.78 + 0.3 * h); } // turf
      case 5: { // broadleaf litter: each leaf (mask id) its own brown
        let id = m;
        c = mix(mix(vec3f(0.11, 0.065, 0.032), vec3f(0.18, 0.105, 0.040), hashf(id * 31.0)), vec3f(0.07, 0.048, 0.030), ssf(0.5, 1.0, hashf(id * 17.0)) * 0.8);
        c = mix(c, vec3f(0.24, 0.16, 0.05), ssf(0.94, 1.0, hashf(id * 7.0)) * 0.5);
        c *= 0.45 + 0.8 * h; r = 0.85;
      }
      default: { c = mix(mix(vec3f(0.062, 0.046, 0.034), vec3f(0.100, 0.062, 0.034), ssf(0.75, 1.0, hashf(m * 23.0))), vec3f(0.048, 0.042, 0.036), ssf(0.0, 0.5, hashf(m * 11.0)) * 0.6) * (0.55 + 0.5 * h); } // needles: mostly old grey-brown, a few fresh russet
    }
    alb += c * k; sl += ss[i] * k * bumpK; hgt += h * k; rough += r * k; wet += we * k;
  }
  // wet in hollows and muddy trails: darker and glossier
  alb *= 1.0 - 0.35 * wet;
  alb *= 0.85 + 0.3 * vnoise(ps.xz * 0.37) * 0.5 + 0.15;
  if (F2.look.w < 0.5) { alb = vec3f(0.045, 0.040, 0.025); sl = vec2f(0.0); hgt = 0.5; }
  // detail normal (Abyssal Garden: slope encoded in the texture), faded with distance against shimmer
  let bump = 1.6 * (1.0 - smoothstep(25.0, 120.0, dist));
  g.n = normalize(ng + vec3f(-sl.x, 0.0, -sl.y) * bump * 0.25);
  g.alb = alb; g.rough = rough; g.wet = wet;
  g.ao = mix(0.55, 1.0, smoothstep(0.05, 0.6, hgt));
  return g;
}

/** Light a diffuse-dominant surface in the forest. ps site-local, n shading normal, ng geometric normal. */
fn forestLight(alb: vec3f, ps: vec3f, n: vec3f, ng: vec3f, ao: f32, rough: f32, fc: vec2f, extraShadow: f32) -> vec3f {
  let L = F2.sunCol.xyz;
  let sh = shadowAt(ps, ng, fc) * extraShadow;
  let cv = canopyAt(ps + ng * 1.0);
  let skyVis = cv.r * (1.0 - 0.5 * cv.g);
  let ndl = max(dot(n, L), 0.0);
  let sun = forestSun(ps.y) * ndl * sh;
  let sky = forestSky(n) * skyVis * ao;
  // light scattered down through the leaves themselves: green-tinted diffuse where the sky is hidden by foliage
  let through = forestSky(vec3f(0.0, 1.0, 0.0)) * (1.0 - cv.r) * 0.16 * vec3f(0.75, 1.0, 0.55) * ao * (0.5 + 0.5 * n.y);
  // light bounced off the sunlit floor and foliage, tinted green-brown
  let bounce = forestSun(0.0) * F2.sunCol.y * vec3f(0.05, 0.055, 0.035) * (0.4 + 0.6 * skyVis) * (0.6 - 0.4 * n.y) * ao;
  var c = alb * (sun + sky + bounce + through) / PI;
  let V = normalize(F.camPos.xyz - siteToRender(ps));
  let H = normalize(V + L);
  let gloss = 1.0 - rough;
  c += forestSun(ps.y) * sh * pow(max(dot(n, H), 0.0), mix(8.0, 120.0, gloss)) * gloss * gloss * 0.25 * ndl;
  return c;
}
`;
