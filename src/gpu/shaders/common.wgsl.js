// Shared WGSL: frame uniforms, hashing/noise for shader-side detail, and the atmosphere model.
//
// Atmosphere: single scattering of sunlight by air molecules (Rayleigh) and haze (Mie, Henyey-Greenstein) with
// exponential density falloff. Optical depth along a straight ray has a closed form for a flat atmosphere; towards
// the sky a Chapman-style approximation accounts for Earth curvature near the horizon. The sun's transmittance is
// evaluated at the camera height (the world is small compared with the scale heights). Multiple scattering is
// approximated by an isotropic sky-ambient term. All coefficients are physical (per metre).
//
// The h31 hash is adapted from Abyssal Garden (MIT, © 2026 Maksymilian Dendura), shaders.js W_NOISE; see NOTICE.md.

export const FRAME_FLOATS = 64;

export const COMMON_WGSL = /* wgsl */ `
struct Frame {
  viewProj: mat4x4f,
  camPos: vec4f,      // xyz camera relative to render origin, w = time (s)
  origin: vec4f,      // xyz render origin in world space, w = water level
  sunDir: vec4f,      // xyz towards the sun, w = sun illuminance
  camRight: vec4f,    // xyz, w = tan(fovY/2)·aspect
  camUp: vec4f,       // xyz, w = tan(fovY/2)
  camFwd: vec4f,      // xyz, w = near plane
  viewport: vec4f,    // width, height, 1/width, 1/height
  params: vec4f,      // morphStart, debug mode, unused, overview fade 0..1
  atmo: vec4f,        // haze multiplier, exposure, mie g, ambient strength
  camWorld: vec4f,    // camera world position (for noise / height-dependent fog), w = camera altitude
  ovRect: vec4f,      // overview maps: world minX, minZ, 1/sizeX, 1/sizeZ
};
fn overviewUV(p: vec2f) -> vec2f { return (p - F.ovRect.xy) * F.ovRect.zw; }
fn inOverview(uv: vec2f) -> bool { return all(uv > vec2f(0.0)) && all(uv < vec2f(1.0)); }

const PI = 3.14159265;
const BETA_R = vec3f(5.8e-6, 13.5e-6, 33.1e-6);
const BETA_M = 3.0e-6;      // multiplied by atmo.x (haze); Scottish summer air is hazy
const H_R = 8000.0;
const H_M = 1200.0;
const EARTH_R = 6.36e6;
const SUN_COLOR = vec3f(1.0, 0.96, 0.90);

fn sat(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }

fn h31(p: vec3f) -> f32 { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }

// value noise with derivative (xz plane), for shader-side detail only
fn vnoised(p: vec2f) -> vec3f {
  let i = floor(p); let f = p - i;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  let a = h31(vec3f(i, 1.0)); let b = h31(vec3f(i + vec2f(1.0, 0.0), 1.0));
  let c = h31(vec3f(i + vec2f(0.0, 1.0), 1.0)); let d = h31(vec3f(i + vec2f(1.0, 1.0), 1.0));
  let k1 = b - a; let k2 = c - a; let k3 = a - b - c + d;
  return vec3f(a + k1 * u.x + k2 * u.y + k3 * u.x * u.y, du * vec2f(k1 + k3 * u.y, k2 + k3 * u.x));
}
fn vnoise(p: vec2f) -> f32 { return vnoised(p).x; }

fn phaseR(c: f32) -> f32 { return 3.0 / (16.0 * PI) * (1.0 + c * c); }
fn phaseM(c: f32, g: f32) -> f32 { let g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }

// Optical depth (m) of an exponential layer with scale height H along a ray from height y0, direction dy (vertical
// component), length L. Closed form; the dy→0 limit is handled.
fn odSegment(y0: f32, dy: f32, L: f32, H: f32) -> f32 {
  let e0 = exp(-max(y0, -200.0) / H);
  let k = dy * L / H;
  if (abs(k) < 1e-3) { return L * e0 * (1.0 - 0.5 * k); }
  return e0 * H * (1.0 - exp(-k)) / dy;
}
// Optical depth from height y0 to space in direction with vertical component mu (Chapman-like approximation).
fn odToSpace(y0: f32, mu: f32, H: f32) -> f32 {
  let m = clamp(mu, -0.05, 1.0);
  return H * exp(-max(y0, -200.0) / H) * 2.0 / (m + sqrt(m * m + 2.0 * H / EARTH_R));
}

fn hazeBeta() -> f32 { return BETA_M * F.atmo.x; }

// Transmittance from height y towards the sun.
fn sunTransmittance(y: f32) -> vec3f {
  let mu = F.sunDir.y;
  return exp(-(BETA_R * odToSpace(y, mu, H_R) + 1.1 * hazeBeta() * odToSpace(y, mu, H_M)));
}

fn sunIrradiance(y: f32) -> vec3f { return SUN_COLOR * F.sunDir.w * sunTransmittance(y); }

// In-scattered radiance and transmittance along a ray, given optical depths (rayleigh, mie) and view-sun cosine.
struct Scatter { inscatter: vec3f, transmittance: vec3f };
fn scatterFromDepths(odR: f32, odM: f32, cosT: f32, y: f32) -> Scatter {
  let tauR = BETA_R * odR; let tauM = hazeBeta() * odM;
  let tau = tauR + 1.1 * tauM;
  let T = exp(-tau);
  let w = (vec3f(1.0) - T) / max(tau, vec3f(1e-6)); // fraction of light that survives, per unit optical depth
  let sun = sunIrradiance(y);
  let single = sun * (tauR * phaseR(cosT) + tauM * phaseM(cosT, F.atmo.z));
  // multiple scattering / skylight: isotropic, proportional to the scattering depth, tinted towards the sky colour
  let amb = F.atmo.w * F.sunDir.w * (tauR * vec3f(0.07, 0.085, 0.105) * 1.3 + tauM * vec3f(0.065, 0.066, 0.068));
  return Scatter((single + amb) * w, T);
}

// Aerial perspective for a surface point at world-relative offset 'toPoint' from the camera.
fn aerial(color: vec3f, toPoint: vec3f) -> vec3f {
  let L = length(toPoint);
  let d = toPoint / max(L, 1e-3);
  let y0 = F.camWorld.y;
  let s = scatterFromDepths(odSegment(y0, d.y, L, H_R), odSegment(y0, d.y, L, H_M), dot(d, F.sunDir.xyz), max(y0 + 0.5 * toPoint.y, 0.0));
  return color * s.transmittance + s.inscatter;
}

// Sky radiance in direction d (unit), seen from the camera height. Includes the sun disc.
fn skyRadiance(d: vec3f, withSun: bool) -> vec3f {
  let y0 = max(F.camWorld.y, 0.0);
  let mu = d.y;
  let s = scatterFromDepths(odToSpace(y0, mu, H_R), odToSpace(y0, mu, H_M), dot(d, F.sunDir.xyz), y0);
  var c = s.inscatter;
  if (withSun) {
    let cs = dot(d, F.sunDir.xyz);
    let disc = smoothstep(0.99995, 0.999985, cs);
    c += disc * SUN_COLOR * F.sunDir.w * 2.2e4 * s.transmittance;
  }
  // below the horizon: fade to a dim ground-bounce colour so rays that miss the terrain backdrop do not look black
  let below = smoothstep(0.0, -0.08, mu);
  return mix(c, sunIrradiance(0.0) * vec3f(0.035, 0.04, 0.03) * F.sunDir.y + c * 0.25, below);
}

fn skyAmbient(n: vec3f) -> vec3f {
  // cheap irradiance estimate: zenith and horizon radiance, weighted by how much the normal sees each
  let zen = skyRadiance(vec3f(0.0, 1.0, 0.0), false);
  let hor = skyRadiance(normalize(vec3f(-F.sunDir.x, 0.12, -F.sunDir.z)), false);
  return PI * mix(hor, zen, 0.5 + 0.5 * n.y) * (0.6 + 0.4 * n.y);
}
`;
