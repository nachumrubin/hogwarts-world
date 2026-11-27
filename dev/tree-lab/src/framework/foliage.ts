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

/** Generation layout (floats, CPU only): position 3, orientation quaternion 4 (template +Y = leaf axis, +Z =
 *  blade normal), size x (width) and y (length), fold, curl, sprite cell, light exposure (0..1), colour variation
 *  (−1..1), r1/r0 (twigs), spare. */
export const FI = 16;
/** Packed GPU instance (bytes): position unorm16 × 3 (tree-local, x/z −40…40 m, y −5…75 m) + length unorm16
 *  (0…2 m); orientation snorm8 × 4; width (log2-coded, 0.5 mm…0.5 m), fold, curl, r1 unorm8 × 4; sprite cell,
 *  exposure, variation, spare unorm8 × 4. 20 bytes instead of 64. */
export const PACKED = 20;
export type FoliageKind = 'leaf' | 'needle' | 'card' | 'twig';
export interface FoliageSet { kind: FoliageKind; layer: number; grid: [number, number]; data: Uint8Array; count: number; hull?: 'shoot' | 'clump' }
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
  /** sprays: each shoot point on bearing wood grows a small twig system: a leader, `laterals` side shoots
   *  (length × `latLen` of the leader, at `latAngle` rad) and, at level 2, `sub` shoots off each lateral. `volume`
   *  0 keeps the laterals in one plane across the light, 1 spreads them all round (phyllotaxis). The skeleton's
   *  metamers are 0.1–0.4 m: sprays fill the crown between them, as real twig systems do. */
  spray?: { levels: number; laterals: [number, number]; latLen: [number, number]; latAngle: [number, number]; volume: number; sub?: [number, number]; subLen?: [number, number] };
  /** leaves per metre of shoot (broadleaves) */
  leavesPerM?: number;
  /** outward reach (m): sprays lean out of the crown by up to this, so the foliage, not the skeleton tips, makes the
   *  crown's edge */
  reach?: number;
  /** crown fullness 0…1 (the density experiments): spray spacing, sub-shoots and reach scale with it */
  fullness?: number;
  /** shoots below this light exposure carry one shoot card instead of individual leaves even at LOD0: the shaded
   *  crown interior gains volume at a fraction of the cost (it is seen through the outer leaves) */
  interiorCard?: number;
  /** LOD1 spray cards: half-angle of the V pair about the spray axis (rad; default 0.7, 40°) */
  cardV?: number;
  /** pine: shoots turn up towards their tips (rad over the shoot) */
  upturn?: number;
  /** LOD1 shoot card (m, width × height), LOD2 clump card edge (m) and clustering cell (m) */
  card: [number, number]; clump: number; clumpCell: number;
}

interface Shoot { base: V3; dir: V3; len: number; exp: number; out: V3; seed: number; terminal: boolean; level: number; root: number }

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
  // ---- 1–2. shoots on bearing wood: sprays (recursive twig systems), plus a terminal spray on every live tip
  const cand: Shoot[] = [];
  let bearing = 0, seedK = 0;
  const full = f.fullness ?? 1, sp = f.spray;
  const spacing = f.spacing / (0.7 + 0.6 * full);
  const reach = (f.reach ?? 0) * (0.4 + 0.6 * full);
  const spray = (base: V3, dir: V3, L: number, level: number, terminal: boolean, root = -1) => {
    const seed = seedK++; if (root < 0) root = seed;
    cand.push({ base, dir, len: L, exp: 1, out: outward(base), seed, terminal, level, root });
    if (!sp || level >= sp.levels) return;
    const cfg = level === 0 ? sp.laterals : (sp.sub ?? [0, 0]);
    const lens = level === 0 ? sp.latLen : (sp.subLen ?? sp.latLen);
    if (level === 1 && full < 0.35) return; // sub-shoots only in the fuller crowns
    const n = cfg[0] + Math.floor(R() * (cfg[1] - cfg[0] + 1));
    const across = cross(dir, [0, 1, 0]), flat = len(across) > 0.1 ? norm(across) : perp(dir);
    const phi0 = R() * 6.283;
    for (let j = 0; j < n; j++) {
      const t = 0.18 + 0.72 * (j + R() * 0.8) / Math.max(n, 1);
      const lb = add(base, mul(dir, L * t));
      const around = rotate(perp(dir), dir, phi0 + j * 2.39996);
      const side = norm(add(mul(flat, (j % 2 ? 1 : -1) * (1 - sp.volume)), mul(around, sp.volume)));
      const ang = sp.latAngle[0] + (sp.latAngle[1] - sp.latAngle[0]) * R();
      let ld = norm(add(mul(dir, Math.cos(ang)), mul(side, Math.sin(ang))));
      ld = norm(add(ld, add(mul(outward(lb), reach * 0.5), [0, (R() - 0.4) * 0.25 - f.droop * 0.15, 0])));
      const ll = L * (lens[0] + (lens[1] - lens[0]) * R()) * (1 - t * 0.35);
      if (ll > 0.02) spray(lb, ld, ll, level + 1, false, root);
    }
  };
  for (const n of wood) {
    const p = n.parent; if (!p) continue;
    if (n.dead || n.broken || n.r > f.maxR || n.root) continue;
    const tt = toTip.get(n) ?? Infinity; if (tt > f.zone) continue;
    const seg = sub(n.p, p.p), L = len(seg); if (L < 1e-4) continue;
    const ax = mul(seg, 1 / L);
    bearing += L;
    const k = Math.max(1, Math.round((L / spacing) * f.density));
    for (let s = 0; s < k; s++) {
      const t = (s + 0.3 + 0.4 * R()) / k;
      const base = add(p.p, mul(seg, t));
      const phi = (n.id * 2.39996 + s * 2.39996) % (Math.PI * 2);
      const side = rotate(perp(ax), ax, phi);
      // divergence from the bearing axis, leaning outwards (reach) and towards the light
      let dir = norm(add(mul(ax, Math.cos(f.diverge)), mul(side, Math.sin(f.diverge))));
      dir = norm(add(dir, add(mul(outward(base), 0.25 + reach), [0, f.type === 'pine' ? 0.1 : 0.15 - f.droop * 0.6, 0])));
      const sl = f.shootLen[0] + (f.shootLen[1] - f.shootLen[0]) * R();
      spray(add(base, mul(side, n.r)), dir, sl, 0, false);
    }
    if (!n.children.length) spray(n.p, norm(add(ax, [0, f.type === 'pine' ? 0.05 : -f.droop * 0.5, 0])), f.shootLen[1] * (0.9 + 0.3 * R()), 0, true);
  }
  // ---- 3. light
  const min: V3 = [1e9, 1e9, 1e9], max: V3 = [-1e9, -1e9, -1e9];
  for (const s of cand) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], s.base[k]); max[k] = Math.max(max[k], s.base[k]); }
  const G = new Grid(min, max, 0.6);
  const leafArea = (f.leafLen[0] + f.leafLen[1]) ** 2 / 4 * (f.type === 'pine' ? 0.12 : 0.45);
  const nPer = (f.perShoot[0] + f.perShoot[1]) / 2;
  for (const s of cand) { const q = G.idx(add(s.base, mul(s.dir, s.len * 0.6))); if (q >= 0) G.d[q] += ((f.leavesPerM ? s.len * f.leavesPerM : nPer) * leafArea) / G.c ** 3 * G.c; }
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
  const leaves: number[] = [], twigs: number[] = [], cards: number[] = [], clumps: number[] = [], icards: number[] = [];
  let nLeaves = 0, area = 0;
  const put = (arr: number[], p: V3, q: number[], sx: number, sy: number, fold: number, curl: number, cell: number, e: number, v: number, r1 = 1) => arr.push(p[0], p[1], p[2], q[0], q[1], q[2], q[3], sx, sy, fold, curl, cell, e, v, r1, 0);
  // sprays: a spray card (textures: tools/foliage_textures.py spray_card) is the whole leader-and-laterals system at
  // true scale, sized from its leader; a spray whose leader is in deep shade is drawn as that card even at LOD0
  const leadFrac = f.type === 'pine' ? 0.35 : f.type === 'broad' && f.droop > 0.3 ? 0.6 : 0.62;   // tools/foliage_textures.py SPRAY
  const live = new Map<number, Shoot>(); for (const s of shoots) if (s.level === 0) live.set(s.root, s);
  const interiorRoot = new Set<number>();
  if ((f.interiorCard ?? 0) > 0) for (const [k, s] of live) if (s.exp < f.interiorCard!) interiorRoot.add(k);
  const sprayCard = (arr: number[], s: Shoot, r: () => number, vari: number, vA = 0.7) => {
    const cardN = norm(add([0, 1, 0], mul(s.out, 0.8)));
    const ch = (s.len / leadFrac) * (0.95 + 0.1 * r()), cw = ch * (0.85 + 0.3 * r()), cv = Math.floor(r() * 2);   // atlas cells 0, 1: sprays
    // two cards in a V about the spray's axis, each turned 40° from the light-facing direction: both keep the
    // atlas leaves' lean towards the light (a perpendicular cross turned half of them sideways, which darkened LOD1),
    // and the pair still has depth from the side
    // the atlas leaves face the card's front, as LOD0's leaves face the light: so the card's front is the sky
    // direction (world up) made perpendicular to the spray axis (falls back to outwards for a vertical spray)
    const upP = sub([0, 1, 0], mul(s.dir, s.dir[1])), n0 = len(upP) > 0.2 ? norm(upP) : norm(sub(cardN, mul(s.dir, dot(cardN, s.dir)))), side = norm(cross(s.dir, n0)), c40 = Math.cos(vA), s40 = Math.sin(vA);
    // r1 carries each LOD1 card's tilt about the spray axis (0.5 + tilt / π; 1 = untilted frame not given, LOD0's
    // interior cards): the renderer shades the atlas leaves in the untilted spray frame, so they face the light as
    // LOD0's leaves do, whichever way their card leans (render/viewer.ts fsFol)
    const tilt = (a: number) => (vA === 0.7 && arr === icards ? 1 : 0.5 + a / Math.PI);
    put(arr, s.base, frame(s.dir, add(mul(n0, c40), mul(side, s40))), cw, ch, 0.05, 0.06, cv, s.exp, vari, tilt(vA));
    put(arr, s.base, frame(s.dir, add(mul(n0, c40), mul(side, -s40))), cw * 0.9, ch, 0.05, 0.05, 1 - cv, s.exp, vari, tilt(-vA));
  };
  for (const s of shoots) {
    const r = rng(f.seed * 7919 + s.seed);
    const e = s.exp, sun = smooth(0.35, 0.85, e);
    const tip = add(s.base, mul(s.dir, s.len));
    const vari = (noise3(s.base[0] * 0.7, s.base[1] * 0.7, s.base[2] * 0.7, f.seed % 97) + (r() - 0.5) * 0.6);
    const interior = interiorRoot.has(s.root);
    if (f.type === 'broad' && s.level <= 1 && !interior) put(twigs, s.base, frame(s.dir, s.out), f.twigR * (s.level ? 0.7 : 1), s.len, 0, 0, 0, e, 0, 0.45);
    if (interior && s.level === 0) sprayCard(icards, s, r, vari);
    const per = f.leavesPerM ? s.len * f.leavesPerM * (0.8 + 0.4 * r()) : f.perShoot[0] + (f.perShoot[1] - f.perShoot[0]) * r();
    const count = Math.max(1, Math.round(per * (0.45 + 0.55 * sun)));
    const side0 = perp(s.dir);
    for (let k = 0; k < (interior ? 0 : count); k++) {
      let p: V3, y: V3, nn: V3, sz: number;
      const phi = k * (f.type === 'pine' ? 2.39996 : 2.513) + r() * 0.5;
      const around = rotate(side0, s.dir, phi);
      if (f.type === 'pine') {
        // fascicles spiral round the shoot, pointing forwards (35–60°), sparser on older (proximal) wood
        // fascicles spiral round the shoot, the shoot turning up towards its tip; needles point forwards (30–65°),
        // splaying wider towards the tip (a rounded tuft, not a flat brush), curved, sparser on older wood
        const t = Math.pow(r(), 0.75), along = 1 - t;
        const up = (f.upturn ?? 0) * along;
        const sdir = norm(add(s.dir, [0, Math.sin(up), 0]));
        p = add(s.base, mul(sdir, s.len * along));
        const splay = 0.5 + 0.55 * r() + 0.25 * along;
        y = norm(add(mul(sdir, Math.cos(splay)), mul(around, Math.sin(splay))));
        nn = rotate(around, y, r() * Math.PI);
        sz = (f.leafLen[0] + (f.leafLen[1] - f.leafLen[0]) * r()) * (0.85 + 0.25 * along);
        put(leaves, p, frame(y, nn), sz * 0.5, sz, 0.04 * r(), 0.1 + 0.18 * r(), Math.floor(r() * 8), e, vari);
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
    // LOD1: one crossed spray card per spray (a lateral whose leader was shed keeps a card of its own)
    // (LOD1 cards may use their own V angle, cardV; LOD0's interior cards keep 40°: LOD0 is frozen)
    if (s.level === 0 || !live.has(s.root)) sprayCard(cards, s, r, vari, f.cardV ?? 0.7);
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
    // a tent of three cards 120° apart, each leaning out from the clump's axis (oaks and pine 40°, the pendulous birch
    // 15°, keeping its hanging curtains), turned at random so neighbouring clumps never line up, and a cap card. Upright
    // cards turned edge-on became thin vertical slivers in side views; leaning cards keep their width from the
    // ground, the side and above
    const v = r() - 0.5, phi = r() * Math.PI * 2, lean = f.droop > 0.3 ? 0.27 : 0.7;
    for (let j = 0; j < 3; j++) {
      const o = rotate(out, up, phi + (j * 2 * Math.PI) / 3);
      const yAx = norm(add(mul(up, Math.cos(lean)), mul(o, Math.sin(lean))));   // the card's long axis leans outwards
      put(clumps, base, frame(yAx, o), size * (j ? 0.9 : 1), size, 0.06, 0, 3, e, v);
    }
    // the cap: the clump seen from above (atlas cell 2), centred over the clump
    const capY = rotate(out, up, phi);
    put(clumps, sub(add(base, [0, size * 0.55, 0]), mul(capY, size * 0.67)), frame(capY, up), size * 1.35, size * 1.35, 0.06, 0, 2, e, v);   // atlas top view: 1.35 × the edge
  }
  const set = (kind: FoliageKind, layer: number, grid: [number, number], a: number[]): FoliageSet => ({ kind, layer, grid, data: pack(a), count: a.length / FI });
  const tri = { leaf: 8, needle: 2, card: 4, twig: 8 } as const;
  const lod = (sets: FoliageSet[]): FoliageLod => ({ sets: sets.filter((s) => s.count), instances: sets.reduce((a, s) => a + s.count, 0), triangles: sets.reduce((a, s) => a + s.count * tri[s.kind], 0) });
  return {
    lods: [
      lod([set('twig', 0, [1, 1], twigs), set(f.type === 'pine' ? 'needle' : 'leaf', f.spriteLayer, [4, 2], leaves), { ...set('card', f.cardLayer, [2, 2], icards), hull: 'shoot' }]),
      lod([{ ...set('card', f.cardLayer, [2, 2], cards), hull: 'shoot' }]),
      lod([{ ...set('card', f.cardLayer, [2, 2], clumps), hull: 'clump' }]),
    ],
    stats: { shoots: shoots.length, shed, leaves: nLeaves, leafArea: +area.toFixed(1), bearingLength: +bearing.toFixed(1), ms: Math.round(performance.now() - t0) },
  };
}

/** Pack generation floats (FI per instance) into PACKED-byte GPU instances. */
export function pack(a: number[]): Uint8Array {
  const n = a.length / FI, out = new Uint8Array(n * PACKED), dv = new DataView(out.buffer);
  const u16 = (o: number, v: number) => dv.setUint16(o, Math.round(clamp(v, 0, 1) * 65535), true);
  const s8 = (v: number) => (Math.round(clamp(v, -1, 1) * 127) + 256) % 256, u8 = (v: number) => Math.round(clamp(v, 0, 1) * 255);
  for (let k = 0; k < n; k++) {
    const i = k * FI, o = k * PACKED;
    u16(o, (a[i] + 40) / 80); u16(o + 2, (a[i + 1] + 5) / 80); u16(o + 4, (a[i + 2] + 40) / 80); u16(o + 6, a[i + 8] / 2);
    let qx = a[i + 3], qy = a[i + 4], qz = a[i + 5], qw = a[i + 6]; if (qw < 0) { qx = -qx; qy = -qy; qz = -qz; qw = -qw; }
    out[o + 8] = s8(qx); out[o + 9] = s8(qy); out[o + 10] = s8(qz); out[o + 11] = s8(qw);
    out[o + 12] = u8((Math.log2(Math.max(a[i + 7], 0.0005) / 0.0005)) / 10); out[o + 13] = u8(a[i + 9] / 0.5); out[o + 14] = u8(a[i + 10] / 0.5); out[o + 15] = u8(a[i + 14]);
    out[o + 16] = a[i + 11]; out[o + 17] = u8(a[i + 12]); out[o + 18] = u8(a[i + 13] * 0.5 + 0.5); out[o + 19] = 0;
  }
  return out;
}
/** Decode instance k's position and exposure (tools, viewpoints). */
export function unpackPos(d: Uint8Array, k: number): { p: V3; e: number; cell: number } {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength), o = k * PACKED;
  return { p: [dv.getUint16(o, true) / 65535 * 80 - 40, dv.getUint16(o + 2, true) / 65535 * 80 - 5, dv.getUint16(o + 4, true) / 65535 * 80 - 40], e: d[o + 17] / 255, cell: d[o + 16] };
}

function hash(a: number, b: number): number { const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return x - Math.floor(x); }
