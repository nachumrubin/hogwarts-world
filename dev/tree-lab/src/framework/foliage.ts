// Foliage from the branch hierarchy (deterministic). Nothing is scattered through a crown volume: every leaf, needle
// fascicle and card hangs on a shoot, and every shoot grows from live, thin wood near a live tip of the skeleton.
//
//   1. bearing wood: live, unbroken segments thinner than `maxR`, within `zone` metres (along the branch) of a live
//      tip; dead limbs, storm breaks and the stag-headed top stay bare
//   2. shoots on it, by phyllotaxis (golden-angle spiral, species divergence), plus a terminal shoot on every live
//      tip; broadleaves get a real twiglet per shoot (it is drawn), pines carry their fascicles on the skeleton's own
//      shoots
//   3. light: the shoots' leaf area is deposited in a voxel grid; exposure at every voxel is the transmitted sky light
//      along a zenith ray and six oblique rays (weighted by `sideLight`: open-grown trees take side light, a forest
//      tree almost none). Shoots in deep shade are shed (internal crown gaps), the rest carry leaves in proportion to
//      their light; shade leaves are larger and held flatter, sun leaves smaller and steeper (as in real crowns)
//   4. leaves per shoot by species: oak leaves clustered towards the shoot tip on a 2/5 spiral, blades turned to
//      the light; birch leaves alternate along hanging shoots, hanging from their petioles; pine fascicles spiral
//      around the last years' shoots pointing forwards, thinning with needle age
//   5. LODs from the same shoots: LOD0 every leaf / fascicle + twiglets; LOD1 one card per shoot (a photo of a shoot
//      composited from the same scanned leaves); LOD2 crossed clump cards per cluster of shoots
// Instances: 16 floats (see FI). The renderer instances one template mesh per set.
import { type V3, add, sub, mul, norm, dot, cross, len, rotate, clamp, smooth, rng, perp, noise3 } from './math.ts';
import type { Skeleton, TNode } from './skeleton.ts';

/** Instance layout (floats): position 3, orientation quaternion 4 (template +Y = leaf axis, +Z = blade normal),
 *  size x (width) and y (length), fold, curl, sprite cell, light exposure (0..1), colour variation (−1..1),
 *  r1/r0 (twigs), spare. */
export const FI = 16;
export type FoliageKind = 'leaf' | 'needle' | 'card' | 'twig';
export interface FoliageSet { kind: FoliageKind; layer: number; grid: [number, number]; data: Float32Array; count: number }
export interface FoliageLod { sets: FoliageSet[]; instances: number; triangles: number }
export interface FoliageStats { shoots: number; shed: number; leaves: number; leafArea: number; bearingLength: number; ms: number }
export interface Foliage { lods: FoliageLod[]; stats: FoliageStats }

export interface FoliageSpec {
  type: 'broad' | 'pine';
  /** texture-array layers: single sprites, and shoot/clump cards */
  spriteLayer: number; cardLayer: number;
  seed: number;
  maxR: number; zone: number;
  /** shoots along bearing wood: spacing (m), length (m), divergence from the bearing axis (rad) */
  spacing: number; shootLen: [number, number]; diverge: number;
  /** leaves (or fascicles) per shoot at full light; leaf length range (m) */
  perShoot: [number, number]; leafLen: [number, number];
  /** fraction of the shoot (from its tip) that bears leaves */
  leafy: number;
  /** blade attitude: 0 follow the shoot, 1 turned fully to the light; droop: hanging (birch) */
  toLight: number; droop: number;
  /** light: extinction per unit leaf-area density, side-light weight, exposure below which shoots are shed */
  extinction: number; sideLight: number; shedBelow: number;
  /** overall density scale (vigour of the individual: a declining veteran carries a thinner crown) */
  density: number;
  /** twiglet radius at base (m), colour handled by the renderer */
  twigR: number;
  /** broadleaf sprays: laterals per leader shoot, their length relative to the leader, and leaves per metre of
   *  shoot (the skeleton's metamers are 0.1–0.4 m: the sprays fill the crown between them, as real twig systems do) */
  laterals?: [number, number]; lateralLen?: [number, number]; leavesPerM?: number;
  /** LOD1 shoot card (m, width × height), LOD2 clump card edge (m) and clustering cell (m) */
  card: [number, number]; clump: number; clumpCell: number;
}

interface Shoot { base: V3; dir: V3; len: number; exp: number; out: V3; seed: number; terminal: boolean }

const quatFromBasis = (X: V3, Y: V3, Z: V3): [number, number, number, number] => {
  // rotation matrix with columns X, Y, Z → quaternion (x, y, z, w)
  const m00 = X[0], m11 = Y[1], m22 = Z[2], tr = m00 + m11 + m22;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; return [(Y[2] - Z[1]) / s, (Z[0] - X[2]) / s, (X[1] - Y[0]) / s, 0.25 * s]; }
  if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; return [0.25 * s, (Y[0] + X[1]) / s, (Z[0] + X[2]) / s, (Y[2] - Z[1]) / s]; }
  if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; return [(Y[0] + X[1]) / s, 0.25 * s, (Z[1] + Y[2]) / s, (Z[0] - X[2]) / s]; }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2; return [(Z[0] + X[2]) / s, (Z[1] + Y[2]) / s, 0.25 * s, (X[1] - Y[0]) / s];
};
/** Orientation with template +Y along `y` and the blade normal as close to `n` as `y` allows. */
function frame(y: V3, n: V3): [number, number, number, number] {
  const Y = norm(y);
  let Z = sub(n, mul(Y, dot(n, Y)));
  if (len(Z) < 1e-4) Z = perp(Y);
  Z = norm(Z);
  const X = cross(Y, Z);
  return quatFromBasis(X, Y, Z);
}

class Grid {
  n: [number, number, number]; o: V3; c: number; d: Float32Array; e: Float32Array | null = null;
  constructor(min: V3, max: V3, c: number) {
    this.c = c; this.o = sub(min, [c, c, c]);
    this.n = [0, 1, 2].map((k) => Math.max(1, Math.ceil((max[k] - min[k]) / c) + 3)) as [number, number, number];
    this.d = new Float32Array(this.n[0] * this.n[1] * this.n[2]);
  }
  idx(p: V3): number {
    const i = Math.floor((p[0] - this.o[0]) / this.c), j = Math.floor((p[1] - this.o[1]) / this.c), k = Math.floor((p[2] - this.o[2]) / this.c);
    if (i < 0 || j < 0 || k < 0 || i >= this.n[0] || j >= this.n[1] || k >= this.n[2]) return -1;
    return i + this.n[0] * (j + this.n[1] * k);
  }
  /** transmitted sky light at every cell: zenith + six rays at 40° elevation */
  exposure(ext: number, side: number): void {
    const [nx, ny, nz] = this.n, c = this.c, e = new Float32Array(this.d.length);
    const dirs: [V3, number][] = [[[0, 1, 0], 1]];
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + 0.3; dirs.push([norm([Math.cos(a) * 0.77, 0.64, Math.sin(a) * 0.77]), side / 6 * 1.6]); }
    const wsum = dirs.reduce((s, d) => s + d[1], 0);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const p: V3 = [this.o[0] + (i + 0.5) * c, this.o[1] + (j + 0.5) * c, this.o[2] + (k + 0.5) * c];
      let acc = 0;
      for (const [d, w] of dirs) {
        let tau = 0;
        for (let s = c; s < 40; s += c) { const q = this.idx(add(p, mul(d, s))); if (q < 0) break; tau += this.d[q]; }
        acc += w * Math.exp(-ext * tau);
      }
      e[i + nx * (j + ny * k)] = acc / wsum;
    }
    this.e = e;
  }
  at(p: V3): number { const q = this.idx(p); return q < 0 || !this.e ? 1 : this.e[q]; }
}

export function growFoliage(sk: Skeleton, f: FoliageSpec): Foliage {
  const t0 = performance.now();
  const R = rng(f.seed);
  const wood = sk.nodes.filter((n) => !n.root);
  // distance (along the branches) from each node down to its nearest live tip
  const toTip = new Map<TNode, number>();
  const post = [...wood].sort((a, b) => b.id - a.id); // children have larger ids than parents
  for (const n of post) {
    let d = !n.children.length && !n.dead && !n.broken ? 0 : Infinity;
    for (const c of n.children) { const dc = toTip.get(c); if (dc !== undefined && !c.dead) d = Math.min(d, dc + len(sub(c.p, n.p))); }
    toTip.set(n, d);
  }
  // crown centre (for outward directions)
  const tips = wood.filter((n) => !n.children.length && !n.dead && !n.broken);
  const cc: V3 = mul(tips.reduce((s, n) => add(s, n.p), [0, 0, 0] as V3), 1 / Math.max(1, tips.length));
  const outward = (p: V3): V3 => { const d = sub(p, cc); d[1] *= 0.35; return len(d) > 1e-3 ? norm(d) : [1, 0, 0]; };
  // ---- 1–2. shoots on bearing wood
  const cand: Shoot[] = [];
  let bearing = 0, seedK = 0;
  for (const n of wood) {
    const p = n.parent; if (!p || p.root && n.order < 0) continue;
    if (n.dead || n.broken || n.r > f.maxR || n.root) continue;
    const tt = toTip.get(n) ?? Infinity; if (tt > f.zone) continue;
    const seg = sub(n.p, p.p), L = len(seg); if (L < 1e-4) continue;
    const ax = mul(seg, 1 / L);
    bearing += L;
    const k = Math.max(1, Math.round((L / f.spacing) * f.density));
    for (let s = 0; s < k; s++) {
      const t = (s + 0.3 + 0.4 * R()) / k;
      const base = add(p.p, mul(seg, t));
      const phi = (n.id * 2.39996 + s * 2.39996) % (Math.PI * 2);
      const side = rotate(perp(ax), ax, phi);
      // divergence from the bearing axis, leaning outwards and towards the light
      let dir = norm(add(mul(ax, Math.cos(f.diverge)), mul(side, Math.sin(f.diverge))));
      dir = norm(add(dir, add(mul(outward(base), 0.25), [0, f.type === 'pine' ? 0.1 : 0.15 - f.droop * 0.6, 0])));
      const sl = f.shootLen[0] + (f.shootLen[1] - f.shootLen[0]) * R();
      const b0 = add(base, mul(side, n.r));
      cand.push({ base: b0, dir, len: sl, exp: 1, out: outward(base), seed: seedK++, terminal: false });
      // spray: laterals off the leader, alternating sides, spreading roughly across the light
      if (f.laterals) {
        const nl = f.laterals[0] + Math.floor(R() * (f.laterals[1] - f.laterals[0] + 1));
        const across = norm(cross(dir, [0, 1, 0])), flat = len(across) > 0.1 ? across : perp(dir);
        for (let j = 0; j < nl; j++) {
          const tt = 0.25 + 0.6 * (j + R() * 0.8) / Math.max(nl, 1);
          const lb = add(b0, mul(dir, sl * tt));
          const sgn = j % 2 ? 1 : -1, ang = (0.55 + 0.45 * R()) * sgn;
          const ld = norm(add(rotate(dir, norm(cross(dir, flat)), ang), [0, (R() - 0.4) * 0.3 - f.droop * 0.4, 0]));
          const ll = sl * (f.lateralLen![0] + (f.lateralLen![1] - f.lateralLen![0]) * R()) * (1 - tt * 0.4);
          cand.push({ base: lb, dir: ld, len: ll, exp: 1, out: outward(lb), seed: seedK++, terminal: false });
        }
      }
    }
    if (!n.children.length) {
      const sl = f.shootLen[1] * (0.9 + 0.3 * R());
      cand.push({ base: n.p, dir: norm(add(ax, [0, f.type === 'pine' ? 0.05 : -f.droop * 0.5, 0])), len: sl, exp: 1, out: outward(n.p), seed: seedK++, terminal: true });
    }
  }
  // ---- 3. light
  const min: V3 = [1e9, 1e9, 1e9], max: V3 = [-1e9, -1e9, -1e9];
  for (const s of cand) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], s.base[k]); max[k] = Math.max(max[k], s.base[k]); }
  const G = new Grid(min, max, 0.6);
  const leafArea = (f.leafLen[0] + f.leafLen[1]) ** 2 / 4 * (f.type === 'pine' ? 0.12 : 0.45);
  const nPer = (f.perShoot[0] + f.perShoot[1]) / 2;
  for (const s of cand) { const q = G.idx(add(s.base, mul(s.dir, s.len * 0.6))); if (q >= 0) G.d[q] += (nPer * leafArea) / G.c ** 3 * G.c; }
  G.exposure(f.extinction, f.sideLight);
  const shoots: Shoot[] = [];
  let shed = 0;
  for (const s of cand) {
    s.exp = G.at(add(s.base, mul(s.dir, s.len * 0.6)));
    // shed in deep shade (smooth threshold, deterministic per shoot)
    const keep = smooth(f.shedBelow, f.shedBelow + 0.18, s.exp);
    if (hash(s.seed, f.seed) > keep) { shed++; continue; }
    shoots.push(s);
  }
  // ---- 4. leaves / fascicles, twiglets (LOD0); cards (LOD1); clumps (LOD2)
  const leaves: number[] = [], twigs: number[] = [], cards: number[] = [], clumps: number[] = [];
  let nLeaves = 0, area = 0;
  const put = (arr: number[], p: V3, q: number[], sx: number, sy: number, fold: number, curl: number, cell: number, e: number, v: number, r1 = 1) => arr.push(p[0], p[1], p[2], q[0], q[1], q[2], q[3], sx, sy, fold, curl, cell, e, v, r1, 0);
  for (const s of shoots) {
    const r = rng(f.seed * 7919 + s.seed);
    const e = s.exp, sun = smooth(0.35, 0.85, e);
    const tip = add(s.base, mul(s.dir, s.len));
    const vari = (noise3(s.base[0] * 0.7, s.base[1] * 0.7, s.base[2] * 0.7, f.seed % 97) + (r() - 0.5) * 0.6);
    if (f.type === 'broad') put(twigs, s.base, frame(s.dir, s.out), f.twigR, s.len, 0, 0, 0, e, 0, 0.45);
    const per = f.leavesPerM ? s.len * f.leavesPerM * (0.8 + 0.4 * r()) : f.perShoot[0] + (f.perShoot[1] - f.perShoot[0]) * r();
    const count = Math.max(1, Math.round(per * (0.45 + 0.55 * sun)));
    const side0 = perp(s.dir);
    for (let k = 0; k < count; k++) {
      let p: V3, y: V3, nn: V3, sz: number;
      const phi = k * (f.type === 'pine' ? 2.39996 : 2.513) + r() * 0.5;
      const around = rotate(side0, s.dir, phi);
      if (f.type === 'pine') {
        // fascicles spiral round the shoot, pointing forwards (35–60°), sparser on older (proximal) wood
        const t = Math.pow(r(), 0.75);
        p = add(s.base, mul(s.dir, s.len * (1 - t)));
        y = norm(add(mul(s.dir, Math.cos(0.65 + 0.35 * r())), mul(around, Math.sin(0.65 + 0.35 * r()))));
        nn = rotate(around, y, r() * Math.PI);
        sz = f.leafLen[0] + (f.leafLen[1] - f.leafLen[0]) * r();
        put(leaves, p, frame(y, nn), sz * 0.5, sz, 0, 0.08 + 0.1 * r(), Math.floor(r() * 8), e, vari);
      } else {
        // broadleaf: oak leaves crowd towards the shoot tip; birch leaves alternate along the shoot
        const t = f.leafy * (k + 0.5) / count;
        const along = f.droop > 0 ? 1 - t : 1 - Math.pow(t, 1.15);
        p = add(s.base, mul(s.dir, s.len * clamp(along, 0, 1)));
        // leaf axis: out from the shoot, then pulled towards the light (sun leaves steeper), or hanging (birch)
        const spread = 0.75 + 0.5 * r();
        y = norm(add(mul(s.dir, Math.cos(spread)), mul(around, Math.sin(spread))));
        y = norm(add(y, [0, -f.droop * (0.6 + 0.6 * r()), 0]));
        const light = norm(add([0, 1, 0], mul(s.out, 0.6 * (0.3 + 0.7 * sun))));
        nn = norm(add(mul(light, f.toLight * (0.55 + 0.45 * (1 - sun))), mul(rotate(around, y, (r() - 0.5) * 1.2), 1 - f.toLight * 0.7)));
        sz = (f.leafLen[0] + (f.leafLen[1] - f.leafLen[0]) * r()) * (1.15 - 0.25 * sun);
        const fold = (0.06 + 0.1 * r()) * (0.6 + 0.6 * sun), curl = (0.05 + 0.12 * r()) + f.droop * 0.1;
        put(leaves, p, frame(y, nn), sz * 0.5, sz, fold, curl, Math.floor(r() * 8), e, vari);
      }
      nLeaves++; area += sz * sz * (f.type === 'pine' ? 0.06 : 0.3);
    }
    // LOD1: one card per shoot, facing the light (pines: two crossed, a bottle-brush)
    const cardN = norm(add([0, 1, 0], mul(s.out, 0.8)));
    const cv = Math.floor(r() * 3);
    const cw = f.card[0] * (0.85 + 0.3 * r()), ch = Math.max(f.card[1], s.len * 1.25);
    put(cards, s.base, frame(s.dir, cardN), cw, ch, 0.05, 0.06, cv, e, vari);
    if (f.type === 'pine') put(cards, s.base, frame(s.dir, cross(s.dir, cardN)), cw, ch, 0, 0.04, (cv + 1) % 3, e, vari);
    void tip;
  }
  // LOD2: clusters of shoots on a coarse grid → crossed clump cards, sized to the cluster
  const cells = new Map<number, Shoot[]>();
  const C2 = new Grid(min, max, f.clumpCell);
  for (const s of shoots) { const q = C2.idx(add(s.base, mul(s.dir, s.len * 0.5))); if (q < 0) continue; let l = cells.get(q); if (!l) cells.set(q, (l = [])); l.push(s); }
  for (const [, l] of [...cells.entries()].sort((a, b) => a[0] - b[0])) {
    if (l.length < 2) continue;
    const c = mul(l.reduce((acc, s) => add(acc, add(s.base, mul(s.dir, s.len * 0.5))), [0, 0, 0] as V3), 1 / l.length);
    const e = l.reduce((a, s) => a + s.exp, 0) / l.length;
    const out = outward(c);
    const r = rng(f.seed * 31 + l[0].seed);
    const size = f.clump * clamp(Math.sqrt(l.length / 6), 0.6, 1.4);
    const up: V3 = [0, 1, 0];
    const base = sub(c, [0, size * 0.45, 0]);
    put(clumps, base, frame(up, norm(add(out, [0, 0.35, 0]))), size, size, 0.08, 0, 3, e, (r() - 0.5));
    put(clumps, base, frame(up, norm(cross(out, up))), size * 0.8, size, 0.05, 0, 3, e, (r() - 0.5));
    if (e > 0.6) put(clumps, add(base, [0, size * 0.5, 0]), frame(out, up), size * 0.75, size * 0.7, 0.1, 0, 3, e, (r() - 0.5)); // a near-horizontal top card
  }
  const set = (kind: FoliageKind, layer: number, grid: [number, number], a: number[]): FoliageSet => ({ kind, layer, grid, data: new Float32Array(a), count: a.length / FI });
  const tri = { leaf: 8, needle: 2, card: 4, twig: 8 } as const;
  const lod = (sets: FoliageSet[]): FoliageLod => ({ sets: sets.filter((s) => s.count), instances: sets.reduce((a, s) => a + s.count, 0), triangles: sets.reduce((a, s) => a + s.count * tri[s.kind], 0) });
  return {
    lods: [
      lod([set('twig', 0, [1, 1], twigs), set(f.type === 'pine' ? 'needle' : 'leaf', f.spriteLayer, [4, 2], leaves)]),
      lod([set('card', f.cardLayer, [2, 2], cards)]),
      lod([set('card', f.cardLayer, [2, 2], clumps)]),
    ],
    stats: { shoots: shoots.length, shed, leaves: nLeaves, leafArea: +area.toFixed(1), bearingLength: +bearing.toFixed(1), ms: Math.round(performance.now() - t0) },
  };
}

function hash(a: number, b: number): number { const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return x - Math.floor(x); }
