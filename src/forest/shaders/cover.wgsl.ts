// Ground cover generated entirely in the vertex shader (no vertex buffers): ferns, grass tussocks, blaeberry.
// Adapted from Abyssal Garden W_LEAF (shaders.js): one instance per plant, each blade/frond a strip whose rows come
// from vertex_index, bent with constant curvature (exact arc), widened at a distance with alpha set to the true
// coverage (so thin blades stay stable instead of shimmering), shrunk away at the far end of their range.
// Fern pinnae are cut analytically in the fragment shader, so they stay crisp at any distance.

import { VEG_HEAD } from './vegetation.wgsl.ts';

export const COVER_WGSL = VEG_HEAD + /* wgsl */ `
override ROWS: u32 = 9u;     // rows per frond / blade (LOD)
override FAR: f32 = 55.0;    // fade-out distance
override KIND: u32 = 0u;     // 0 ferns, 1 grass, 2 blaeberry
override SHADOW: bool = false;

struct IIn { @location(0) a: vec4f, @location(1) b: vec4f }; // a: pos.xyz, yaw; b: size, seed, kind, light
struct COut {
  @builtin(position) cp: vec4f, @location(0) ps: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f,
  @location(3) @interpolate(flat) info: vec4f, // kind, seed, light, coverage scale
  @location(4) cov: f32, @location(5) hgt: f32,
};

fn hsh(x: f32) -> f32 { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }

fn camDist(ps: vec3f) -> f32 { return length(siteToRender(ps) - F.camPos.xyz); }

@vertex fn vs(@builtin(vertex_index) vi: u32, inst: IIn) -> COut {
  var o: COut;
  let segs = ROWS - 1u;
  let perStrip = segs * 6u;
  let strip = vi / perStrip;
  let k = vi % perStrip;
  var corners = array<u32, 6>(0u, 1u, 2u, 2u, 1u, 3u);
  let quad = k / 6u; let corner = corners[k % 6u];
  let row = quad + (corner >> 1u);
  let u = f32(corner & 1u) * 2.0 - 1.0;
  let v = f32(row) / f32(segs);
  let base = inst.a.xyz; let yaw = inst.a.w;
  let size = inst.b.x; let seed = inst.b.y; let kind = u32(inst.b.z + 0.5); let light = inst.b.w;
  let dist = camDist(base);
  var fade = 1.0 - smoothstep(FAR * 0.75, FAR, dist);
  if (SHADOW) { fade = 1.0; }
  let sf = f32(strip);
  let hs = hsh(seed + sf * 7.13); let hs2 = hsh(seed * 1.7 + sf * 3.1); let hs3 = hsh(seed * 2.3 + sf * 5.7);
  // per kind: strips per plant, length, width, tilt from vertical, curvature
  var nStrips = 12u; var len = size; var wid = 0.1; var tilt = 0.6; var curv = 1.2; var az = sf * 2.39996 + seed * 6.2831 + yaw;
  var stem = 0.0;
  if (KIND == 0u) {
    if (kind == 0u) { // bracken: a few tall fronds, stipe upright, blade bending over flat
      nStrips = 3u; len = size * (0.9 + 0.3 * hs); wid = len * 0.42; tilt = 0.25 + 0.25 * hs2; curv = 2.2 + 0.6 * hs3; stem = 0.32;
    } else if (kind == 1u) { // broad buckler: shuttlecock of arching fronds
      nStrips = 10u; len = size * (0.75 + 0.4 * hs); wid = len * 0.30; tilt = 0.45 + 0.45 * hs2; curv = 1.4 + 0.8 * hs3; stem = 0.12;
    } else { // hard fern: narrow ladder fronds spreading low
      nStrips = 12u; len = size * (0.8 + 0.35 * hs); wid = len * 0.13; tilt = 0.9 + 0.5 * hs2; curv = 1.0 + 0.6 * hs3; stem = 0.05;
    }
  } else if (KIND == 1u) {
    nStrips = 26u; len = size * (0.6 + 0.6 * hs); wid = 0.004 + 0.004 * hs2; tilt = 0.08 + 0.55 * hs2 * hs2; curv = 0.4 + 1.6 * hs3;
    if (kind == 1u) { nStrips = 18u; wid = 0.0045; tilt = 0.06 + 0.22 * hs2; curv = 0.3; len = size * (1.1 + 0.6 * hs); } // rushes: stiff, upright
    az = hs * 6.2831 + seed;
    // tussock: blades start from a small tuft, not a single point
    stem = 0.0;
  } else {
    nStrips = 9u; len = 0.11 + 0.06 * hs; wid = len; tilt = 0.3 + 1.0 * hs2; curv = 0.0;
  }
  if (strip >= nStrips || fade <= 0.001) { o.cp = vec4f(0.0, 0.0, 2.0, 1.0); return o; }
  let d0 = vec3f(sin(az) * sin(tilt), cos(tilt), cos(az) * sin(tilt)); // initial direction
  let side = normalize(vec3f(cos(az), 0.0, -sin(az)));
  let pe = normalize(cross(side, d0)); // bend direction (down/outwards)
  var p: vec3f; var nrm: vec3f; var w = 0.0;
  let L = len * mix(0.4, 1.0, fade);
  if (KIND == 2u) {
    // blaeberry: small leaf cards around a low dome (atlas tile 12)
    let c = base + vec3f(sin(az) * 0.12 * hs3, 0.08 + 0.18 * hs2 * size * 3.0, cos(az) * 0.12 * hs3) * mix(0.3, 1.0, fade);
    let t1 = side; let t2 = normalize(cross(d0, side));
    p = c + (t1 * u * 0.5 + t2 * (v - 0.5)) * len * 1.6 * fade;
    nrm = normalize(d0 + vec3f(0.0, 0.6, 0.0));
    o.uv = vec2f(u * 0.5 + 0.5, v);
  } else {
    // constant-curvature arc (exact), bending away from vertical; stipe below 'stem' stays straight
    let vb = max(v - stem, 0.0) / (1.0 - stem);
    let kq = curv * vb; let ka = select(kq, 0.001, abs(kq) < 0.001);
    let sK = sin(ka); let cK = cos(ka);
    let stemPos = d0 * L * min(v, stem);
    let arcLen = L * (1.0 - stem);
    p = base + stemPos + arcLen * (d0 * (sK / max(curv, 0.001)) + pe * ((1.0 - cK) / max(curv, 0.001)));
    if (curv * vb < 0.001) { p = base + d0 * L * v; }
    let T = normalize(d0 * cK + pe * sK);
    // width profile
    var prof: f32;
    if (KIND == 0u) {
      if (kind == 0u) { prof = select(0.0, pow(max(1.0 - vb, 0.0), 0.55) * smoothstep(0.0, 0.08, vb), v > stem); }        // bracken: triangular blade
      else if (kind == 1u) { prof = pow(sin(3.14159 * pow(max(vb, 0.0), 0.75)), 0.8) * step(stem, v + 0.001); }       // lanceolate
      else { prof = pow(sin(3.14159 * vb), 0.4); }
    } else { prof = 1.0 - v * 0.85; }
    w = wid * prof;
    // distant thin blades: widen to a pixel, carry the true coverage instead (stable, no shimmer)
    let px = dist * F.camUp.w * 2.0 * F.viewport.w * 1.4;
    var cov = 1.0;
    if (KIND == 1u && !SHADOW) { let ww = max(w, px * 0.6); cov = w / max(ww, 1e-5); w = ww; }
    o.cov = cov;
    // pinnae droop: fern fronds are slightly V-shaped across
    let across = normalize(side + pe * (abs(u) * select(0.25, 0.65, KIND == 0u)));
    p += across * u * w * fade;
    nrm = normalize(cross(T, across));
    if (dot(nrm, vec3f(0.0, 1.0, 0.0)) < 0.0) { nrm = -nrm; }
    o.uv = vec2f(u, v);
    if (KIND == 1u) { p += vec3f(sin(az), 0.0, cos(az)) * 0.07 * hs3 * size; } // blades rise from a tuft, not a point
  }
  // wind: Abyssal Garden sway (position phase, amplitude ∝ height^1.25, two frequencies), stiffer for ferns
  if (!SHADOW && F2.look.z > 0.5) {
    let t = F2.siteOff.w; let g = gust(base.xz);
    let hgt = max(p.y - base.y, 0.0);
    let ph = dot(base.xz, vec2f(0.31, 0.17)) + seed * 6.2831 + sf * 0.7;
    let fr = select(select(1.9, 2.6, KIND == 1u), 1.4, KIND == 2u);
    let a = (0.05 + 0.25 * g) * pow(hgt / max(L, 0.05), 1.25) * select(select(0.35, 0.22, KIND == 1u), 0.08, KIND == 2u) * L;
    let wd = windDir();
    p += (wd * (0.6 * g + 0.4 * sin(t * fr + ph)) + vec3f(-wd.z, 0.0, wd.x) * 0.35 * sin(t * fr * 1.31 + ph * 1.7)) * a;
  }
  o.ps = p; o.n = nrm; o.hgt = v;
  o.info = vec4f(f32(kind), seed + sf * 0.37, light, fade);
  if (SHADOW) { o.cp = F2.shadowVP * vec4f(p, 1.0); }
  else { o.cp = F.viewProj * vec4f(siteToRender(p), 1.0); }
  if (KIND != 1u) { o.cov = 1.0; }
  return o;
}

// analytic fern frond mask: rachis + pinnae (+ pinnules), u across (−1..1), v along
fn fernMask(uv: vec2f, kind: u32, seed: f32) -> f32 {
  let au = abs(uv.x); let v = uv.y;
  if (au < 0.03) { return 1.0; } // rachis
  // pinnae: lanceolate leaflets angled towards the frond tip, with gaps between them; each pinna is made of
  // rounded pinnules (bracken, buckler fern) or is entire (hard fern)
  var np = 15.0; var lean = 0.5; var npl = 8.0; var hw0 = 0.30;
  if (kind == 0u) { np = 11.0; lean = 0.4; npl = 10.0; hw0 = 0.34; if (v < 0.32) { return 0.0; } }
  if (kind == 2u) { np = 24.0; lean = 0.12; npl = 0.0; hw0 = 0.30; }
  let alt = select(0.0, 0.5, uv.x < 0.0 && kind != 0u);
  let pv = v * np - au * lean * 1.4 + alt;
  let pi = floor(pv);
  let a = fract(pv) - 0.5;                       // across the pinna (in pinna-spacing units)
  let taper = (1.0 - pow(au, 1.6));               // pinnae narrow towards their tips
  var hw = hw0 * taper;
  if (npl > 0.0) {
    // pinnules: alternate rounded lobes along the pinna, separated nearly to the pinna midrib
    let pp = au * npl + select(0.0, 0.5, a < 0.0);
    let pf = fract(pp) - 0.5;
    let lobe = sqrt(max(0.0, 1.0 - 4.0 * pf * pf));
    hw *= 0.25 + 0.75 * lobe;
    if (abs(a) < 0.045) { return 1.0; }          // pinna midrib
  }
  let h = fract(sin(pi * 12.9898 + seed * 78.233) * 43758.5453);
  if (h < 0.06) { hw *= 0.35; }                  // the odd damaged pinna
  return smoothstep(0.02, -0.02, abs(a) - hw);
}

@fragment fn fs(i: COut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let kind = u32(i.info.x + 0.5); let seed = i.info.y; let light = i.info.z;
  var alpha = 1.0;
  var alb: vec3f; var trans = 0.6; var gloss = 0.1;
  let hs = hsh(seed * 3.3);
  let la = textureSample(leafAlb, repSampler, (vec2f(0.0, 3.0) + clamp(vec2f(i.uv.x, 1.0 - i.uv.y), vec2f(0.004), vec2f(0.996))) * 0.25);
  if (KIND == 0u) {
    alpha = fernMask(i.uv, kind, seed);
    if (kind == 0u) {
      alb = mix(vec3f(0.034, 0.062, 0.014), vec3f(0.052, 0.078, 0.018), hs);
      alb = mix(alb, vec3f(0.17, 0.10, 0.035), ssf(0.88, 1.0, hs) * 0.9); // the odd frond already bronzing
      if (i.uv.y < 0.32) { alb = vec3f(0.07, 0.05, 0.025); }
    } else if (kind == 1u) { alb = mix(vec3f(0.024, 0.050, 0.013), vec3f(0.040, 0.068, 0.016), hs); }
    else { alb = vec3f(0.022, 0.048, 0.014) * (0.8 + 0.4 * hs); gloss = 0.4; trans = 0.35; }
    if (abs(i.uv.x) < 0.035) { alb *= 0.65; }
    alb *= (0.7 + 0.4 * i.uv.y) * (0.8 + 0.35 * abs(i.uv.x)); // paler leaflet tips, darker towards the rachis
    trans = 0.35;
  } else if (KIND == 1u) {
    // blade: green base to straw tip, a few dead blades
    let dead = step(0.82, hs);
    alb = mix(mix(vec3f(0.030, 0.050, 0.015), vec3f(0.075, 0.095, 0.030), i.hgt), vec3f(0.14, 0.12, 0.065) * (0.7 + 0.5 * i.hgt), dead);
    if (kind == 1u) { alb = mix(vec3f(0.025, 0.045, 0.015), vec3f(0.05, 0.075, 0.025), i.hgt); }
    alpha = i.cov * smoothstep(1.0, 0.92, i.hgt + abs(i.uv.x) * 0.06);
    trans = 0.5;
  } else {
    alpha = la.a;
    alb = la.rgb * mix(0.85, 1.2, hs);
  }
  alpha *= select(1.0, smoothstep(0.0, 0.5, i.info.w * 2.0), i.info.w < 0.5);
  let cov = clamp((alpha - 0.5) / max(fwidth(alpha), 1e-3) + 0.5, 0.0, 1.0);
  if (cov < 0.02) { discard; }
  let n0 = normalize(i.n);
  let L = F2.sunCol.xyz;
  let V = normalize(F.camPos.xyz - siteToRender(i.ps));
  let n = select(-n0, n0, dot(n0, V) > -0.2 || ff);
  let sh = shadowAt(i.ps, n0, i.cp.xy);
  let cv = canopyAt(i.ps + vec3f(0.0, 0.5, 0.0));
  let ao = mix(0.35, 1.0, i.hgt) * (0.75 + 0.25 * light);
  let ndl = dot(n, L);
  let sun = forestSun(i.ps.y) * sh;
  var col = alb * max((ndl + 0.5) / 1.5, 0.0) * sun / PI;
  col += alb * vec3f(1.3, 1.4, 0.6) * trans * (max(-ndl, 0.0) * 0.5 + pow(max(dot(-V, L), 0.0), 6.0) * 0.8) * sun / PI;
  col += alb * forestSky(n) * cv.r * ao / PI;
  col += alb * forestSky(vec3f(0.0, 1.0, 0.0)) * (1.0 - cv.r) * 0.2 * vec3f(0.8, 1.0, 0.6) * ao / PI;
  col += alb * forestSun(0.0) * F2.sunCol.y * vec3f(0.04, 0.05, 0.025) * ao / PI;
  col += sun * pow(max(dot(n, normalize(V + L)), 0.0), 50.0) * gloss * 0.15;
  var o = finishColor(col, i.ps);
  o.a = cov;
  return o;
}

@fragment fn fsShadow(i: COut) {
  let kind = u32(i.info.x + 0.5);
  var a = 1.0;
  if (KIND == 0u) { a = fernMask(i.uv, kind, i.info.y); }
  if (KIND == 2u) { a = textureSampleLevel(leafAlb, repSampler, (vec2f(0.0, 3.0) + clamp(vec2f(i.uv.x, 1.0 - i.uv.y), vec2f(0.004), vec2f(0.996))) * 0.25, 1.0).a; }
  if (a < 0.5) { discard; }
}
`;
