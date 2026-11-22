// Runtime texture bakes (once at startup): tileable detail layers for the forest floor and bark, and the leaf atlas.
// Adapted from Abyssal Garden (MIT, © 2026 Maksymilian Dendura) shaders.js W_DETAIL: periodic value noise (tn/tf)
// and periodic Worley noise (tw) make every layer tile seamlessly; the height field is baked first, then its
// slopes are taken by finite differences (rg), next to the height (b) and a mask (a).

const FS = /* wgsl */ `
struct FsOut { @builtin(position) pos: vec4f };
@vertex fn vsFull(@builtin(vertex_index) i: u32) -> FsOut {
  var o: FsOut; o.pos = vec4f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1), 0.0, 1.0); return o;
}
`;

const NOISE = /* wgsl */ `
fn h31(p: vec3f) -> f32 { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn h33(p: vec3f) -> vec3f { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yxx) * q.zyx); }
fn ss(a: f32, b: f32, x: f32) -> f32 { return smoothstep(a, b, x); }
fn sat(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
// periodic value noise: lattice wraps every 'per' cells (per = vec2 for anisotropic tiles)
fn hp(p: vec2f, per: vec2f, s: f32) -> f32 { return h31(vec3f(p - per * floor(p / per), s)); }
fn tn(p: vec2f, per: vec2f, s: f32) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hp(i, per, s), hp(i + vec2f(1., 0.), per, s), u.x), mix(hp(i + vec2f(0., 1.), per, s), hp(i + vec2f(1., 1.), per, s), u.x), u.y);
}
fn tf(uv: vec2f, per: vec2f, n: i32, s: f32) -> f32 {
  var a = 0.5; var sum = 0.0; var pr = per;
  for (var i = 0; i < n; i++) { sum += a * tn(uv * pr + f32(i) * 7.3, pr, s + f32(i)); pr *= 2.0; a *= 0.5; }
  return sum / (1.0 - 2.0 * a);
}
// periodic Worley: (F1, F2, cell id)
fn tw(p: vec2f, per: vec2f, s: f32) -> vec3f {
  let i = floor(p); let f = fract(p); var d = vec2f(9.0); var id = 0.0;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) {
    let o = vec2f(f32(x), f32(y)); let c = i + o; let cw = c - per * floor(c / per);
    let hh = h33(vec3f(cw, s)); let r = o + hh.xy - f; let l = dot(r, r);
    if (l < d.x) { d.y = d.x; d.x = l; id = hh.z; } else if (l < d.y) { d.y = l; }
  } }
  return vec3f(sqrt(d), id);
}
fn rot(p: vec2f, a: f32) -> vec2f { let c = cos(a); let s = sin(a); return vec2f(p.x * c - p.y * s, p.x * s + p.y * c); }
`;

/** Height/mask pass: one draw per layer; uniform U.x = layer. Output rgba16float (height, mask, 0, 1). */
export const BAKE_HEIGHT_WGSL = FS + NOISE + /* wgsl */ `
@group(0) @binding(0) var<uniform> U: vec4f; // layer, size, 0, 0

// litter of overlapping leaves: several stacked layers of Worley-placed leaf shapes; the topmost covering leaf wins
fn leafLitter(uv: vec2f, needles: bool) -> vec2f {
  var hBest = 0.0; var idBest = 0.0;
  let base = tf(uv, vec2f(8.0), 5, 3.0);
  for (var L = 0; L < 5; L++) {
    let per = select(vec2f(7.0 + f32(L) * 2.0), vec2f(11.0 + f32(L) * 3.0), needles);
    let p = uv * per;
    let i = floor(p);
    for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) {
      let c = i + vec2f(f32(x), f32(y)); let cw = c - per * floor(c / per);
      let hh = h33(vec3f(cw, f32(L) * 13.0 + select(1.0, 51.0, needles)));
      let ctr = c + hh.xy;
      let q = rot(p - ctr, hh.z * 6.2831);
      var inside = 0.0; var hh2 = 0.0;
      if (needles) {
        // a few long thin needles crossing the cell
        for (var k = 0; k < 3; k++) {
          let qk = rot(q, f32(k) * 1.9 + hh.x * 3.0) + vec2f(0.0, (f32(k) - 1.0) * 0.18);
          let d = abs(qk.y) - 0.022 * (1.0 - abs(qk.x) * 0.8);
          let m = ss(0.01, -0.005, d) * ss(0.95, 0.75, abs(qk.x));
          if (m > inside) { inside = m; hh2 = 0.6 + 0.4 * (1.0 - abs(qk.y) / 0.03); }
        }
      } else {
        // a leaf: obovate with shallow lobes (oak) or ovate (birch), curled edges, a midrib
        let sc = 0.42 + 0.22 * hh.x;
        let lp = q / sc;
        let lobes = 1.0 + 0.16 * cos(lp.x * 13.0) * ss(0.0, 0.3, 0.9 - abs(lp.x));
        let w = 0.42 * sqrt(max(0.0, 1.0 - lp.x * lp.x)) * (0.8 + 0.4 * (lp.x * 0.5 + 0.5)) * lobes;
        let d = abs(lp.y) - w;
        let m = ss(0.03, -0.02, d) * step(abs(lp.x), 1.0);
        if (m > 0.0) {
          let curl = 0.25 * pow(abs(lp.y) / max(w, 0.01), 2.0);
          let rib = ss(0.03, 0.0, abs(lp.y)) * 0.15;
          hh2 = 0.55 + curl + rib - 0.12 * abs(lp.x) + 0.05 * tn(lp * 9.0, vec2f(64.0), 9.0);
          inside = m;
        }
      }
      let hl = f32(L) * 0.18 + hh2 * 0.3;
      if (inside > 0.5 && hl > hBest) { hBest = hl; idBest = fract(hh.z * 7.31 + hh.x * 3.7 + f32(L) * 0.13); }
    } }
  }
  return vec2f(sat(hBest * 0.9 + base * 0.15), idBest);
}

fn layerH(uv: vec2f, layer: i32) -> vec2f {
  switch layer {
    case 0: { // soil / humus: crumbly, with small stones and fine roots
      let f = tf(uv, vec2f(6.0), 7, 1.0);
      let st = tw(uv * 26.0, vec2f(26.0), 2.0);
      let stone = ss(0.35, 0.1, st.x) * step(0.72, st.z);
      let rootl = ss(0.04, 0.0, abs(tf(uv, vec2f(3.0), 3, 7.0) - 0.5)) * 0.4;
      return vec2f(sat(f * 0.65 + stone * 0.45 + rootl * 0.3), sat(tf(uv + 0.3, vec2f(4.0), 3, 5.0) + stone * 0.4));
    }
    case 1: { // moss: cushions (Worley mounds) of fine fibrous texture
      let c = tw(uv * 9.0, vec2f(9.0), 11.0);
      let c2 = tw(uv * 23.0, vec2f(23.0), 12.0);
      let mound = pow(sat(1.0 - c.x * 1.2), 0.6) * 0.6 + pow(sat(1.0 - c2.x * 1.3), 0.7) * 0.3;
      let fib = tf(uv, vec2f(96.0), 2, 13.0);
      return vec2f(sat(mound * 0.85 + fib * 0.2), sat(c.z * 0.5 + tf(uv, vec2f(5.0), 3, 14.0) * 0.6 + fib * 0.2 - 0.1));
    }
    case 2: { // wet earth and mud: smooth with low puddled areas and hoof-scuffed ridges
      let f = tf(uv, vec2f(3.0), 6, 21.0);
      let pud = ss(0.45, 0.30, f);
      let scuff = tw(uv * 14.0, vec2f(14.0), 22.0);
      return vec2f(sat(f * 0.8 - pud * 0.3 + ss(0.2, 0.0, scuff.y - scuff.x) * 0.15), sat(tf(uv, vec2f(9.0), 3, 23.0)));
    }
    case 3: { // rock: Abyssal Garden W_DETAIL H(): fbm + ridges + crack network + small pits
      let wq = uv + 0.11 * (vec2f(tf(uv, vec2f(3.0), 4, 31.0), tf(uv + 0.5, vec2f(3.0), 4, 32.0)) - 0.5);
      let f = tf(wq, vec2f(3.0), 8, 33.0);
      let r1 = 1.0 - abs(tf(wq + 1.7, vec2f(5.0), 6, 34.0) * 2.0 - 1.0);
      let cr = min(abs(tf(wq + 4.1, vec2f(4.0), 5, 35.0) * 2.0 - 1.0) * 7.0, 1.0);
      let cr2 = min(abs(tf(wq.yx + 2.3, vec2f(9.0), 4, 36.0) * 2.0 - 1.0) * 9.0, 1.0);
      let pt = tw(wq * 29.0, vec2f(29.0), 37.0);
      let pit = (1.0 - ss(0.0, 0.34, pt.x)) * step(0.62, pt.z);
      return vec2f(f * 0.50 + r1 * r1 * 0.24 + cr * cr2 * 0.26 - pit * 0.07, tf(uv + 3.7, vec2f(3.0), 5, 38.0));
    }
    case 4: { // turf: a sward of tiny tufts (Worley mounds) with fine blade noise, no directional streaks
      let c1 = tw(uv * 46.0, vec2f(46.0), 41.0);
      let c2 = tw(uv * 97.0, vec2f(97.0), 42.0);
      let tuft = pow(sat(1.0 - c1.x * 1.4), 0.7) * 0.6 + pow(sat(1.0 - c2.x * 1.5), 0.8) * 0.35;
      let fine = tf(uv, vec2f(160.0), 2, 43.0);
      return vec2f(sat(tuft * 0.8 + fine * 0.25), sat(c1.z * 0.6 + tf(uv, vec2f(7.0), 3, 45.0) * 0.6 - 0.1));
    }
    case 5: { return leafLitter(uv, false); }
    case 6: { return leafLitter(uv, true); }
    case 7: { // oak bark: deep vertical fissures between blocky plates, horizontal breaks
      let p = uv * vec2f(9.0, 3.0);
      let w = tw(p + vec2f(0.0, tf(uv, vec2f(2.0, 2.0), 3, 51.0) * 0.6), vec2f(9.0, 3.0), 52.0);
      let fis = ss(0.0, 0.22, w.y - w.x);
      let plate = fis * (0.7 + 0.3 * tf(uv, vec2f(24.0, 8.0), 4, 53.0));
      return vec2f(sat(plate * 0.9 + 0.08 * tn(uv * vec2f(120.0, 40.0), vec2f(120.0, 40.0), 54.0)), sat(tf(uv, vec2f(5.0, 2.0), 4, 55.0)));
    }
    case 8: { // pine upper: thin papery flakes, horizontally elongated, peeling at edges
      let p = uv * vec2f(5.0, 16.0);
      let w = tw(p, vec2f(5.0, 16.0), 61.0);
      let edge = ss(0.0, 0.12, w.y - w.x);
      return vec2f(sat(0.45 + 0.35 * edge + 0.2 * w.z * edge + 0.1 * tf(uv, vec2f(40.0, 60.0), 3, 62.0)), w.z);
    }
    case 9: { // pine lower: large plates, deep fissures (red-brown inner bark shows in them)
      let p = uv * vec2f(4.0, 2.0);
      let w = tw(p + vec2f(0.0, tf(uv, vec2f(2.0, 1.0), 3, 71.0) * 0.5), vec2f(4.0, 2.0), 72.0);
      let fis = ss(0.0, 0.18, w.y - w.x);
      let sub = tw(uv * vec2f(16.0, 10.0), vec2f(16.0, 10.0), 73.0);
      let flake = ss(0.0, 0.08, sub.y - sub.x);
      return vec2f(sat(fis * (0.65 + 0.25 * flake) + 0.1 * tf(uv, vec2f(30.0), 3, 74.0)), sat(1.0 - fis));
    }
    case 10: { // birch: smooth papery bark, horizontal lenticels, dark fissured diamonds (mask = dark)
      let len = tw(uv * vec2f(6.0, 60.0), vec2f(6.0, 60.0), 81.0);
      let lent = ss(0.25, 0.05, len.x) * step(0.45, len.z);
      let dia = tw(uv * vec2f(3.0, 2.0), vec2f(3.0, 2.0), 82.0);
      let dark = ss(0.18, 0.08, dia.x) * step(0.8, dia.z);
      let peel = ss(0.6, 0.75, tf(uv, vec2f(4.0, 12.0), 4, 83.0));
      return vec2f(sat(0.6 - lent * 0.25 - dark * 0.3 + peel * 0.15 + 0.05 * tf(uv, vec2f(64.0), 2, 84.0)), sat(max(lent * 0.8, dark)));
    }
    case 11: { // smooth bark (rowan, holly, hazel): faint lenticels, fine wrinkles; mask = lichen
      let len = tw(uv * vec2f(10.0, 40.0), vec2f(10.0, 40.0), 91.0);
      let lent = ss(0.25, 0.05, len.x) * step(0.6, len.z);
      return vec2f(sat(0.6 + 0.12 * tf(uv, vec2f(12.0, 30.0), 4, 92.0) - lent * 0.15), ss(0.55, 0.7, tf(uv, vec2f(4.0), 4, 93.0)));
    }
    default: { // deadwood: silver-grey grain, long cracks along the grain
      let gr = tf(uv * vec2f(1.0, 1.0), vec2f(40.0, 2.0), 4, 101.0);
      let crack = ss(0.03, 0.0, abs(tf(uv, vec2f(6.0, 1.0), 3, 102.0) - 0.5));
      return vec2f(sat(0.55 + 0.35 * gr - crack * 0.45), sat(tf(uv, vec2f(3.0, 2.0), 3, 103.0)));
    }
  }
}

@fragment fn fsHeight(i: FsOut) -> @location(0) vec4f {
  let uv = i.pos.xy / U.y;
  let r = layerH(uv, i32(U.x + 0.5));
  return vec4f(r.x, r.y, 0.0, 1.0);
}
`;

/** Slope pass: reads the height array layer, writes rgba8 (slope x, slope y, height, mask). */
export const BAKE_FINAL_WGSL = FS + /* wgsl */ `
@group(0) @binding(0) var<uniform> U: vec4f; // layer, size, slope scale
@group(0) @binding(1) var hm: texture_2d<f32>;
@fragment fn fsFinal(i: FsOut) -> @location(0) vec4f {
  let n = i32(U.y);
  let p = vec2i(i.pos.xy);
  let c = textureLoad(hm, p, 0);
  let hx = textureLoad(hm, vec2i((p.x + 1) % n, p.y), 0).r - textureLoad(hm, vec2i((p.x + n - 1) % n, p.y), 0).r;
  let hy = textureLoad(hm, vec2i(p.x, (p.y + 1) % n), 0).r - textureLoad(hm, vec2i(p.x, (p.y + n - 1) % n), 0).r;
  let s = clamp(vec2f(hx, hy) * U.y * 0.5 * U.z, vec2f(-1.0), vec2f(1.0));
  return vec4f(s * 0.5 + 0.5, c.r, c.g);
}
`;

/** 2× box downsample for mip chains. U.x = 1: alpha-coverage boost for the leaf atlas. */
export const MIP_WGSL = FS + /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> U: vec4f;
@fragment fn fsDown(i: FsOut) -> @location(0) vec4f {
  let p = vec2i(i.pos.xy) * 2;
  let a = textureLoad(src, p, 0); let b = textureLoad(src, p + vec2i(1, 0), 0);
  let c = textureLoad(src, p + vec2i(0, 1), 0); let d = textureLoad(src, p + vec2i(1, 1), 0);
  if (U.x > 0.5) {
    // colour weighted by alpha so transparent texels do not bleed dark fringes; alpha boosted to keep coverage
    let w = a.a + b.a + c.a + d.a;
    let col = select((a.rgb * a.a + b.rgb * b.a + c.rgb * c.a + d.rgb * d.a) / w, (a.rgb + b.rgb + c.rgb + d.rgb) * 0.25, w < 1e-4);
    return vec4f(col, min(1.0, (a.a + b.a + c.a + d.a) * 0.25 * U.y));
  }
  return (a + b + c + d) * 0.25;
}
`;

/**
 * Leaf atlas: 4 × 4 tiles; each tile a twig with leaves drawn as signed-distance shapes (topmost leaf wins).
 * Target 0: albedo (linear) + coverage alpha. Target 1: card-space normal xy, translucency, gloss.
 */
export const BAKE_LEAF_WGSL = FS + NOISE + /* wgsl */ `
@group(0) @binding(0) var<uniform> U: vec4f; // atlas size, tile size
struct LeafOut { @location(0) alb: vec4f, @location(1) nrm: vec4f };

// leaf shape distance (negative inside) in leaf space: x along the midrib 0..1, y across
fn leafShape(q: vec2f, kind: i32) -> f32 {
  let x = q.x; let y = q.y;
  if (x < 0.0 || x > 1.0) { return 1.0; }
  var w = 0.0;
  switch kind {
    case 0: { // sessile oak: obovate, 5–6 rounded lobes
      w = 0.30 * pow(sin(3.14159 * pow(x, 0.85)), 0.8) * (0.75 + 0.35 * x);
      w *= 1.0 + 0.28 * max(0.0, cos(x * 34.0)) * ss(0.05, 0.25, x) * ss(0.98, 0.8, x);
    }
    case 1: { // birch: triangular-ovate, pointed, doubly serrate
      w = 0.36 * pow(sin(3.14159 * pow(x, 0.6)), 1.2) * (1.15 - x * 0.7);
      w *= 1.0 + 0.06 * abs(sin(x * 70.0));
    }
    case 2: { // rowan leaflet: narrow oblong, serrate
      w = 0.17 * pow(sin(3.14159 * x), 0.6) * (1.0 + 0.08 * abs(sin(x * 60.0)));
    }
    case 3: { // holly: elliptical with spines
      let sp = pow(abs(sin(x * 3.14159 * 4.0)), 6.0);
      w = 0.30 * pow(sin(3.14159 * x), 0.7) * (1.0 + 0.30 * sp);
    }
    case 4: { // hazel: broad round with a short point
      w = 0.44 * pow(sin(3.14159 * pow(x, 0.8)), 0.9) * (1.0 + 0.05 * abs(sin(x * 50.0)));
    }
    default: { // blaeberry: small ovate
      w = 0.32 * pow(sin(3.14159 * x), 0.8);
    }
  }
  return abs(y) - w;
}

struct Hit { d: f32, id: f32, q: vec2f, w: f32, kind: i32 };

@fragment fn fsLeaf(i: FsOut) -> LeafOut {
  let ts = U.y;
  let tile = vec2i(i.pos.xy / ts);
  let t = tile.x + tile.y * 4;
  var uv = fract(i.pos.xy / ts);
  uv.y = 1.0 - uv.y;               // uv.y up
  let mass = (t % 2) == 1 && t < 12; // odd tiles: dense distant clumps
  let sp = select(t / 2, 6, t >= 12); // 0 oak 1 pine 2 birch 3 rowan 4 holly 5 hazel 6 blaeberry
  var o: LeafOut;
  var best: Hit; best.d = 1.0; best.id = -1.0;
  var twig = 1.0;
  let nTw = select(3, 7, mass);
  var col = vec3f(0.0); var alpha = 0.0; var nrm = vec2f(0.0); var gloss = 0.1; var trans = 0.6;
  let r00 = h33(vec3f(f32(t * 17), 1.0, 2.0));
  let mainBase = vec2f(0.5, 0.03); let mainDir = normalize(vec2f((r00.x - 0.5) * 0.4, 1.0));
  for (var tw_ = 0; tw_ < nTw; tw_++) {
    let tseed = f32(t * 17 + tw_ * 5);
    let r0 = h33(vec3f(tseed, 1.0, 2.0));
    // a small spray: the main shoot plus side shoots fanning from it; distant 'mass' tiles scatter many sprays
    var base = mainBase; var dir = mainDir; var tl = 0.9;
    if (!mass && tw_ > 0) {
      let side = select(-1.0, 1.0, tw_ == 1);
      base = mainBase + mainDir * 0.9 * (0.18 + 0.22 * f32(tw_) + 0.1 * r0.x);
      let ang = side * (0.55 + 0.25 * r0.y);
      dir = normalize(mainDir * cos(ang) + vec2f(-mainDir.y, mainDir.x) * sin(ang));
      tl = 0.55 + 0.15 * r0.z;
    }
    if (mass) { base = vec2f(0.1 + 0.8 * r0.x, 0.03 + 0.45 * r0.y); dir = normalize(vec2f((r0.z - 0.5) * 1.8, 1.0)); tl = 0.5; }
    let rel = uv - base;
    let along = dot(rel, dir); let across = dot(rel, vec2f(-dir.y, dir.x)) - 0.02 * sin(along * 9.0 + r0.z * 6.0);
    if (sp != 1) { twig = min(twig, max(abs(across) - mix(0.006, 0.0025, clamp(along / tl, 0.0, 1.0)), max(-along, along - tl))); }
    if (sp == 1) {
      // Scots pine: paired needles (4–7 cm) in dense brushes along the shoot, angled forward
      twig = min(twig, max(abs(across) - 0.004, max(-along, along - tl)));
      for (var k = 0; k < 110; k++) {
        let hk = h33(vec3f(tseed, f32(k), 9.0));
        let s = hk.x * tl;
        let side = select(-1.0, 1.0, hk.y > 0.5);
        let ang = side * (0.45 + 0.6 * hk.z);
        let nd = normalize(dir * cos(ang) + vec2f(-dir.y, dir.x) * sin(ang));
        let st = base + dir * s;
        let L = select(0.13, 0.09, mass) * (0.75 + 0.5 * hk.z);
        let rr = uv - st;
        let a = dot(rr, nd); let b = dot(rr, vec2f(-nd.y, nd.x));
        let d = abs(b) - 0.0032 * (1.0 - a / L * 0.6);
        if (a > 0.0 && a < L && d < 0.0) {
          let z = f32(k + tw_ * 110) / 800.0;
          if (z > best.id) { best.d = d; best.id = z; best.q = vec2f(a / L, b / 0.0032); best.kind = 9; }
        }
      }
    } else {
      // broadleaves: alternate leaves on short petioles along each shoot
      var nl = 11; var L0 = 0.12;
      if (sp == 2) { nl = 14; L0 = 0.075; }   // birch
      if (sp == 3) { nl = 16; L0 = 0.06; }    // rowan leaflets
      if (sp == 4) { nl = 10; L0 = 0.09; }    // holly
      if (sp == 5) { nl = 9; L0 = 0.11; }     // hazel
      if (sp == 6) { nl = 12; L0 = 0.15; }    // blaeberry (small card)
      if (mass) { L0 *= 0.75; }
      for (var k = 0; k < nl; k++) {
        let hk = h33(vec3f(tseed, f32(k), 3.0));
        let s = (0.06 + 0.92 * (f32(k) + hk.x * 0.5) / f32(nl)) * tl;
        let side = select(-1.0, 1.0, (k % 2) == 0);
        var ang = side * (0.6 + 0.55 * hk.y);
        if (sp == 3) { ang = side * 1.3; }                          // rowan leaflets: opposite, near perpendicular
        if (sp == 2) { ang = side * (0.8 + 0.7 * hk.y) + 0.3; }     // birch: drooping
        let ld = normalize(dir * cos(ang) + vec2f(-dir.y, dir.x) * sin(ang));
        let pet = select(L0 * 0.25, 0.006, sp == 3);
        let st = base + dir * s + ld * pet;
        let L = L0 * (0.75 + 0.5 * hk.z) * (1.0 - 0.25 * s / tl);
        let rr = uv - st;
        let q = vec2f(dot(rr, ld) / L, dot(rr, vec2f(-ld.y, ld.x)) / L);
        let kind = select(select(select(select(select(5, 4, sp == 5), 3, sp == 4), 2, sp == 3), 1, sp == 2), 0, sp == 0);
        let d = leafShape(q, kind) * L;
        let z = f32(k + tw_ * 20) / 200.0 + hk.z * 0.001;
        if (d < 0.0015 && z > best.id) { best.d = d; best.id = z; best.q = q; best.kind = kind; best.w = hk.x; }
      }
    }
  }
  // colour and normal of the topmost leaf
  var pal = array<vec3f, 7>(vec3f(0.034, 0.060, 0.014), vec3f(0.020, 0.040, 0.020), vec3f(0.055, 0.085, 0.020), vec3f(0.038, 0.068, 0.016), vec3f(0.014, 0.032, 0.010), vec3f(0.044, 0.072, 0.017), vec3f(0.036, 0.064, 0.016));
  if (best.id >= 0.0) {
    let q = best.q;
    let k = best.kind;
    let cov = ss(0.0015, -0.0015, best.d);
    let hv = h33(vec3f(best.id * 91.0, f32(t), 4.0));
    var c = pal[sp] * (0.75 + 0.5 * hv.x);
    // per-leaf variation: a few yellowing or browning leaves, insect holes, darker veins
    c = mix(c, vec3f(0.16, 0.13, 0.03), ss(0.93, 1.0, hv.y) * 0.8);
    c = mix(c, vec3f(0.10, 0.055, 0.02), ss(0.965, 1.0, hv.z) * 0.9);
    if (k == 9) {
      c = pal[1] * (0.8 + 0.4 * hv.x) * (0.85 + 0.25 * q.x);
      nrm = vec2f(q.y * 0.6, 0.0);
      gloss = 0.35; trans = 0.35;
    } else {
      let vein = ss(0.012, 0.0, abs(q.y)) + ss(0.01, 0.0, abs(fract(q.x * 6.0 + abs(q.y) * 4.0) - 0.5) * 0.08) * 0.3;
      c *= 1.0 - 0.25 * vein;
      c *= 0.85 + 0.3 * q.x * (1.0 - q.x) * 4.0 * 0.25;
      let hole = ss(0.04, 0.02, length(fract(q * vec2f(7.0, 11.0) + hv.xy) - 0.5)) * step(0.9, hv.x);
      alpha = cov * (1.0 - hole);
      // cupped leaf: normal tilts away from the midrib, a crease along it
      let w = max(0.05, 0.4);
      nrm = vec2f(sign(q.y) * min(abs(q.y) / w, 1.0) * 0.45, (q.x - 0.5) * 0.3);
      gloss = select(0.15, 0.6, k == 3);
      trans = select(0.65, 0.25, k == 3);
    }
    if (k == 9) { alpha = cov; }
    col = c;
  }
  // twig (drawn under the leaves)
  if (alpha < 0.5 && twig < 0.002) { col = vec3f(0.05, 0.035, 0.022); alpha = ss(0.002, -0.001, twig); nrm = vec2f(0.0); trans = 0.0; gloss = 0.1; }
  o.alb = vec4f(col, alpha);
  o.nrm = vec4f(nrm * 0.5 + 0.5, trans, gloss);
  return o;
}
`;
