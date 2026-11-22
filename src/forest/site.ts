// Forest POC site: the 200 × 200 m test area and its large-scale layout (trails, clearings, hollows, outcrops).
//
// The layout is authored as a composition (where the trails run, where the clearing opens, where the dark passage
// is) and then roughened procedurally, so it reads as found rather than designed. Everything here is deterministic
// and uses only exactly specified IEEE operations (no Math.sin/exp/hypot), because floorDelta() runs inside terrain
// generation on the workers and on the main thread and both must agree bit for bit.
//
// World convention: X east, Z north, metres. Local site coordinates (u, v) = (x − x0, z − z0).

import { noise, fbm, smoothstep } from '../terrain/noise.js';
import { sampleSpline, PolylineIndex, type P2 } from '../world/geometry.ts';

export const SITE = Object.freeze({
  id: 'forest-poc-1',
  /** South-west corner of the playable test area. */
  x0: 6900, z0: 3700, size: 200,
  /** Ring of canopy-only trees around the test area (m), so the forest does not end in a wall. */
  ring: 60,
  /** Terrain micro-relief: full strength inside the area + fadeIn, gone at + fadeOut. */
  fadeIn: 30, fadeOut: 70,
  seed: 0x5f0e57,
});

export interface Clearing { u: number; v: number; ru: number; rv: number; rot: number; kind: 'sunlit' | 'small' | 'windthrow' }
export interface Hollow { u: number; v: number; r: number; depth: number }
export interface Outcrop { u: number; v: number; r: number; strike: number }
export interface Veteran { u: number; v: number; species: 'oak' | 'pine'; note: string }

// authored layout, local metres (u east, v north)
const TRAILS: { id: string; width: number; pts: P2[] }[] = [
  // the main deer trail: enters from the open birch fringe in the south-west, climbs gently to the clearing, leaves north-east
  { id: 'deer-trail', width: 1.3, pts: [[-55, 20], [-10, 32], [22, 46], [52, 68], [78, 92], [100, 104], [126, 128], [152, 150], [190, 168], [260, 190]] },
  // a side trail from the windthrow gap in the east
  { id: 'gap-trail', width: 0.9, pts: [[100, 104], [116, 80], [134, 56], [150, 30], [170, -10], [190, -60]] },
  // the faint passage north through the darkest stand
  { id: 'dark-passage', width: 0.7, pts: [[52, 68], [44, 96], [38, 124], [36, 150], [28, 182], [16, 215], [0, 260]] },
];
export const CLEARINGS: Clearing[] = [
  { u: 104, v: 106, ru: 15, rv: 11, rot: 0.6, kind: 'sunlit' },
  { u: 150, v: 62, ru: 13, rv: 6.5, rot: -0.35, kind: 'windthrow' },
  { u: 62, v: 168, ru: 7, rv: 6, rot: 0.2, kind: 'small' },
  { u: 8, v: 24, ru: 16, rv: 12, rot: 0.3, kind: 'small' }, // the open entrance glade among birches
];
export const HOLLOWS: Hollow[] = [
  { u: 58, v: 38, r: 9, depth: 0.9 },
  { u: 22, v: 122, r: 7, depth: 0.7 },
  { u: 128, v: 176, r: 6, depth: 0.5 },
];
export const OUTCROPS: Outcrop[] = [
  { u: 168, v: 128, r: 18, strike: 0.5 },
  { u: 186, v: 188, r: 14, strike: 0.7 },
  { u: 120, v: 18, r: 10, strike: 0.3 },
];
export const VETERANS: Veteran[] = [
  { u: 90, v: 120, species: 'oak', note: 'the clearing oak' },
  { u: 60, v: 186, species: 'oak', note: 'the elder at the end of the dark passage' },
  { u: 176, v: 150, species: 'pine', note: 'the granny pine on the outcrop' },
  { u: 132, v: 96, species: 'oak', note: 'split veteran by the gap trail' },
  { u: 26, v: 70, species: 'pine', note: 'the entrance pine' },
];

const sqr = (x: number) => x * x;

export class ForestSite {
  readonly trails: { id: string; width: number; idx: PolylineIndex; pts: P2[] }[];
  private nn = { dist: 0, seg: 0, t: 0, side: 0 };
  constructor() {
    this.trails = TRAILS.map((t) => {
      // roughen the authored line so it meanders at the metre scale
      const raw = sampleSpline(t.pts, 2, false);
      const pts = raw.map(([u, v], i): P2 => [u + 2.2 * noise(i * 0.09, 3.1, SITE.seed + 11), v + 2.2 * noise(i * 0.09, 7.7, SITE.seed + 12)]);
      return { id: t.id, width: t.width, pts, idx: new PolylineIndex(pts, false, 16, 64) };
    });
  }

  /** Inside the playable 200 × 200 m area (local coordinates). */
  inside(u: number, v: number, pad = 0): boolean { return u >= -pad && v >= -pad && u <= SITE.size + pad && v <= SITE.size + pad; }
  /** Inside the planted area (test area + canopy ring). */
  inRing(u: number, v: number): boolean { return this.inside(u, v, SITE.ring); }
  /** Distance outside the test area (0 inside). */
  outside(u: number, v: number): number {
    const du = u < 0 ? -u : u > SITE.size ? u - SITE.size : 0, dv = v < 0 ? -v : v > SITE.size ? v - SITE.size : 0;
    return Math.sqrt(du * du + dv * dv);
  }

  /** 0..1, 1 on a trail centre line; second value = distance (m). */
  trail(u: number, v: number): { k: number; dist: number; id: string } {
    let best = 1e9, k = 0, id = '';
    for (const t of this.trails) {
      const n = t.idx.nearest(u, v, this.nn);
      if (n.seg < 0) continue;
      const w = t.width * (0.8 + 0.4 * (0.5 + 0.5 * noise(u * 0.07, v * 0.07, SITE.seed + 21)));
      const kk = 1 - smoothstep(w * 0.5, w * 0.5 + 1.4, n.dist);
      if (kk > k) { k = kk; id = t.id; }
      if (n.dist < best) best = n.dist;
    }
    return { k, dist: best, id };
  }

  /** 0..1 openness of authored clearings, with a ragged edge. */
  clearing(u: number, v: number): { k: number; kind: string } {
    let k = 0, kind = '';
    for (const c of CLEARINGS) {
      const cs = cos(c.rot), sn = sin(c.rot);
      const du = u - c.u, dv = v - c.v;
      const a = (du * cs + dv * sn) / c.ru, b = (-du * sn + dv * cs) / c.rv;
      const r = Math.sqrt(a * a + b * b) + 0.28 * noise(u * 0.11, v * 0.11, SITE.seed + 31);
      const kk = 1 - smoothstep(0.55, 1.05, r);
      if (kk > k) { k = kk; kind = c.kind; }
    }
    return { k, kind };
  }

  hollow(u: number, v: number): number {
    let k = 0;
    for (const h of HOLLOWS) {
      const r = Math.sqrt(sqr(u - h.u) + sqr(v - h.v)) / h.r + 0.25 * noise(u * 0.13, v * 0.13, SITE.seed + 41);
      k = Math.max(k, 1 - smoothstep(0.2, 1.0, r));
    }
    return k;
  }

  /** Rock exposure 0..1: outcrop bodies elongated along their strike, broken by joints. */
  outcrop(u: number, v: number): number {
    let k = 0;
    for (const o of OUTCROPS) {
      const cs = cos(o.strike), sn = sin(o.strike);
      const du = u - o.u, dv = v - o.v;
      const a = (du * cs + dv * sn) / o.r, b = (-du * sn + dv * cs) / (o.r * 0.45);
      const r = Math.sqrt(a * a + b * b) + 0.35 * fbm(u * 0.08, v * 0.08, SITE.seed + 51, 3);
      k = Math.max(k, 1 - smoothstep(0.45, 1.0, r));
    }
    return k;
  }

  /** Strength of the micro-relief overlay at world (x, z): 1 in and near the area, fading out. */
  weight(x: number, z: number): number {
    const d = this.outside(x - SITE.x0, z - SITE.z0);
    return 1 - smoothstep(SITE.fadeIn, SITE.fadeOut, d);
  }

  /**
   * Forest-floor micro-relief added to the world terrain (m). Hummocks and pits from old root plates, rock
   * outcrops standing proud, damp hollows, trails worn slightly into the ground.
   */
  floorDelta(x: number, z: number): number {
    const w = this.weight(x, z);
    if (w <= 0) return 0;
    const u = x - SITE.x0, v = z - SITE.z0, s = SITE.seed;
    // hummocks (6–14 m) and smaller lumps (2–4 m)
    let d = 0.55 * fbm(u * 0.085, v * 0.085, s + 1, 3) + 0.16 * noise(u * 0.33, v * 0.33, s + 2);
    // pit-and-mound from old windthrows: sharp-edged lumps where a cellular-ish noise peaks
    const pm = noise(u * 0.06, v * 0.06, s + 3);
    d += 0.5 * smoothstep(0.55, 0.85, pm) - 0.35 * smoothstep(0.55, 0.85, -pm);
    // outcrops: blocky steps
    const oc = this.outcrop(u, v);
    if (oc > 0) d += oc * (1.6 + 1.2 * noise(u * 0.21, v * 0.21, s + 4)) + 0.5 * oc * smoothstep(0.1, 0.4, noise(u * 0.5, v * 0.5, s + 5));
    // hollows and trails
    for (const h of HOLLOWS) {
      const r = Math.sqrt(sqr(u - h.u) + sqr(v - h.v)) / (h.r * 1.4);
      if (r < 1) d -= h.depth * (1 - r * r) * (1 - r * r);
    }
    const tr = this.trail(u, v).k;
    d -= 0.14 * tr;
    // flatten the clearings a little (deer lie up there; less root heave)
    d *= 1 - 0.5 * this.clearing(u, v).k;
    return d * w;
  }
}

// deterministic cos/sin are not needed (layout only, never on the terrain path through floorDelta's call graph
// except clearing(), which uses these with constant arguments): precompute from a small Taylor series instead of
// Math.cos so the result is bit-identical everywhere.
function cos(a: number): number { return sin(a + 1.5707963267948966); }
function sin(a: number): number {
  // range reduce to [-π, π], then a 9th-order odd polynomial (|err| < 4e-6), plenty for layout geometry
  const TAU = 6.283185307179586;
  a = a - TAU * Math.floor((a + 3.141592653589793) / TAU);
  const a2 = a * a;
  return a * (1 - a2 / 6 * (1 - a2 / 20 * (1 - a2 / 42 * (1 - a2 / 72 * (1 - a2 / 110)))));
}
