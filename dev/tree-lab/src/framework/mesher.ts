// Swept generalized cylinders for branch chains.
//   • Catmull-Rom spline through the chain's nodes, resampled by radius (fine where thick, coarse where thin)
//   • parallel-transport frames (no twisting), ring side count chosen per ring from the radius and the LOD,
//     consecutive rings with different counts stitched by angle (no visible segmentation steps)
//   • a child branch starts on its parent's axis with a widened collar that tapers to its own radius, so it grows
//     out of the parent instead of meeting it as an intersecting cylinder (junction blending)
//   • bark displacement in world space (the SDF mesher uses the same function, so the two surfaces agree)
//   • normals from the displaced surface
import { type V3, add, sub, mul, norm, len, dot, cross, perp, lerp, clamp } from './math.ts';
import type { Chain, Skeleton, TNode } from './skeleton.ts';

/** Vertex layout (16 floats): position 3, normal 3, order, flags, radius, bark relief (m, at the vertex; on a broken
 *  end's cap: radial fraction), bark-mapping axis A 3, bark-mapping origin C 3. The material projects its bark onto
 *  planes containing A, at d = p − C, in metres (renderer). C = c − v·A, with c the branch centre line and v the
 *  bark coordinate along the branch (barkFrames), so d·A = v + (p − c)·A: the bark runs continuously from the trunk
 *  up every branch, and as A turns (collars, forks, bends) the pattern pivots about the branch centre instead of
 *  about the world origin (pivoting about the origin compressed it into stripes wherever the axis turned). */
export const VFLOATS = 16;
/** How far (along the branch) a tube starts before the point where it leaves a blended region: the full width of
 *  the band in which the blended surface relaxes to the bare branch and sinks inside it. */
export const FUSE_OVERLAP = 1.0;

const UP: V3 = [0, 1, 0], ZERO: V3 = [0, 0, 0];

/** Bark mapping frames: every chain's orientation σ (+1 / −1: the trunk runs up its axis, every other chain the way
 *  that agrees with its parent where it attaches, so roots run inwards) and the bark coordinate v at every node:
 *  continuous through the hierarchy (a branch starts at its parent's v where it attaches) and advancing by σ × the
 *  distance along each chain. */
export function barkFrames(chains: Chain[]): { sg: Map<number, number>; V: Map<TNode, number> } {
  const sg = chainSigns(chains), V = new Map<TNode, number>();
  for (const ch of chains) {
    const s = sg.get(ch.id) ?? 1;
    let prev: TNode | null = ch.attach;
    for (const n of ch.nodes) {
      V.set(n, prev ? (V.get(prev) ?? 0) + s * len(sub(n.p, prev.p)) : 0);
      prev = n;
    }
  }
  return { sg, V };
}

export function chainSigns(chains: Chain[]): Map<number, number> {
  const sg = new Map<number, number>(), dirAt = (ns: TNode[], i: number): V3 => norm(sub(ns[Math.min(ns.length - 1, i + 1)].p, ns[Math.max(0, i - 1)].p));
  for (const ch of chains) {
    if (!ch.parent || !ch.attach) { sg.set(ch.id, 1); continue; }
    const pn = ch.parent.attach ? [ch.parent.attach, ...ch.parent.nodes] : ch.parent.nodes;
    const i = pn.indexOf(ch.attach);
    const pd = i >= 0 ? mul(dirAt(pn, i), sg.get(ch.parent.id) ?? 1) : UP;
    const cd = norm(sub(ch.nodes[Math.min(1, ch.nodes.length - 1)].p, ch.attach.p));
    sg.set(ch.id, dot(cd, pd) >= 0 ? 1 : -1);
  }
  return sg;
}

export class MeshOut {
  v: number[] = []; i: number[] = [];
  get count() { return this.v.length / VFLOATS; }
  vert(p: V3, n: V3, order: number, flags: number, r: number, relief: number, A: V3 = UP, C: V3 = ZERO): number {
    this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], order, flags, r, relief, A[0], A[1], A[2], C[0], C[1], C[2]); return this.count - 1;
  }
  tri(a: number, b: number, c: number) { this.i.push(a, b, c); }
  /** Recompute smooth normals from the faces (after displacement); `from` = first vertex to touch. */
  normals(from = 0, fromIdx = 0): void {
    const v = this.v, acc = new Float64Array((this.count - from) * 3);
    for (let k = fromIdx; k < this.i.length; k += 3) {
      const a = this.i[k], b = this.i[k + 1], c = this.i[k + 2];
      if (a < from || b < from || c < from) continue;
      const pa: V3 = [v[a * VFLOATS], v[a * VFLOATS + 1], v[a * VFLOATS + 2]], pb: V3 = [v[b * VFLOATS], v[b * VFLOATS + 1], v[b * VFLOATS + 2]], pc: V3 = [v[c * VFLOATS], v[c * VFLOATS + 1], v[c * VFLOATS + 2]];
      const fn = cross(sub(pb, pa), sub(pc, pa));
      for (const q of [a, b, c]) { const o = (q - from) * 3; acc[o] += fn[0]; acc[o + 1] += fn[1]; acc[o + 2] += fn[2]; }
    }
    for (let q = from; q < this.count; q++) {
      const o = (q - from) * 3, l = Math.hypot(acc[o], acc[o + 1], acc[o + 2]);
      if (l > 1e-12) { v[q * VFLOATS + 3] = acc[o] / l; v[q * VFLOATS + 4] = acc[o + 1] / l; v[q * VFLOATS + 5] = acc[o + 2] / l; }
    }
  }
}

/** `chord`: rings on branches thinner than `adaptiveBelow` (no bark relief there) are placed by curvature: a ring
 *  is kept only where the dense spline would deviate from the straight run between kept rings by more than
 *  chord × radius (min 1.5 mm), where the radius changes by > 8 % (this traces collar flares), or at live/dead
 *  changes and broken ends. */
export interface LodSpec { edge: number; maxSides: number; minSides: number; minRadius: number; step: number; displace: number; chord: number; adaptiveBelow: number; chordMin: number; rChange: number }
export const LODS: LodSpec[] = [
  { edge: 0.045, maxSides: 72, minSides: 5, minRadius: 0, step: 1, displace: 1, chord: 0.12, adaptiveBelow: 0.03, chordMin: 0.0015, rChange: 0.08 },
  // LOD1/LOD2: the absolute deviation floor and the radius-change test scale with the viewing distance the LOD is for
  // (with LOD0's 1.5 mm / 8 % they kept a ring every few cm along tapering, gently curved branches: LOD2 rose 15–40 %)
  { edge: 0.12, maxSides: 24, minSides: 4, minRadius: 0.012, step: 2.2, displace: 0.6, chord: 0.25, adaptiveBelow: 0.06, chordMin: 0.005, rChange: 0.15 },
  { edge: 0.35, maxSides: 10, minSides: 3, minRadius: 0.05, step: 5, displace: 0, chord: 0.5, adaptiveBelow: 0.2, chordMin: 0.02, rChange: 0.35 },
];

/** Bark relief (m, outward) at a surface point; tubes also pass `at` = [ring angle, arc length] (continuous). */
export type BarkFn = (p: V3, axis: V3, r: number, node: TNode, at?: [number, number]) => number;

/** Flags packed in attr.y: 1 dead, 2 broken end region, 4 root, 8 collar. */
export function meshChains(sk: Skeleton, chains: Chain[], lod: LodSpec, bark: BarkFn | null, out: MeshOut, opts: { skip?: (c: Chain) => boolean; startCut?: (c: Chain) => number } = {}): void {
  // parents before children (a child's bark mapping starts as its parent's where it attaches); chains() is pre-order
  const { sg: signs, V } = barkFrames(chains), maps: MapStore = new Map();
  for (const ch of chains) {
    if (opts.skip && opts.skip(ch)) continue;
    const n0 = ch.nodes[0];
    if (n0.r < lod.minRadius && !n0.root) continue;
    const cut = opts.startCut ? opts.startCut(ch) : 0;
    if (cut === Infinity) continue;
    tube(ch, lod, bark, out, cut, signs.get(ch.id) ?? 1, V.get(ch.attach ?? ch.nodes[0]) ?? 0, maps);
  }
}

interface Sample { p: V3; r: number; node: TNode; t: number; collar: number; ax: V3; own: number }
/** Bark-mapping axis of a chain at each of its nodes, for its children to start from. */
type MapStore = Map<Chain, Map<TNode, V3>>;

function catmull(p0: V3, p1: V3, p2: V3, p3: V3, t: number): V3 {
  const t2 = t * t, t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), f(p0[2], p1[2], p2[2], p3[2])];
}

function samples(ch: Chain, lod: LodSpec, noCollar = false): Sample[] {
  const nodes = ch.nodes;
  // control points: start inside the parent (on its axis) for attached chains
  const P: V3[] = [], R: number[] = [], N: TNode[] = [];
  if (ch.attach) { P.push(ch.attach.p); R.push(nodes[0].r); N.push(nodes[0]); }
  for (const n of nodes) { P.push(n.p); R.push(n.r); N.push(n); }
  if (P.length < 2) return [];
  const out: Sample[] = [];
  const parentR = ch.attach ? ch.attach.r : 0;
  let acc = 0;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    const segL = len(sub(p2, p1));
    const rr = Math.max(R[i], R[i + 1]);
    const step = rr < lod.adaptiveBelow ? 0.02 : clamp(rr * 1.1, 0.035, 0.6) * lod.step;
    const k = Math.max(1, Math.ceil(segL / step));
    for (let j = 0; j < k; j++) {
      const t = j / k;
      const p = catmull(p0, p1, p2, p3, t);
      const r = R[i] + (R[i + 1] - R[i]) * t;
      out.push({ p, r, node: t < 0.5 ? N[i] : N[i + 1], t: acc + segL * t, collar: 0, ax: norm(sub(p2, p1)), own: 1 });
    }
    acc += segL;
  }
  out.push({ p: P[P.length - 1], r: R[R.length - 1], node: N[N.length - 1], t: acc, collar: 0, ax: norm(sub(P[P.length - 1], P[P.length - 2])), own: 1 });
  // sample at least every 2 cm where the branch is thin, so the curvature test below sees the true spline
  // collar: the branch runs inside its parent from the parent's axis, emerges at distance e (depends on the
  // branching angle) and is widened just around the emergence point, so it flows out of the parent's surface
  if (ch.attach && out.length > 2 && !noCollar) {
    const r0 = out[Math.min(2, out.length - 1)].r;
    const pd = ch.attach.parent ? norm(sub(ch.attach.p, ch.attach.parent.p)) : [0, 1, 0] as V3;
    const cd = norm(sub(out[Math.min(2, out.length - 1)].p, out[0].p));
    const sinA = Math.sqrt(Math.max(0, 1 - dot(pd, cd) ** 2));
    const e = parentR / Math.max(sinA, 0.3);
    // a modest swell that peaks just inside the parent's surface and dies away over several branch radii: the
    // branch flares into the stem instead of showing a ball joint where it leaves it
    const widest = Math.min(parentR * 0.75, r0 * 1.22);
    const L2 = r0 * 5 + 0.08, e0 = e * 0.82;
    for (const s of out) {
      if (s.t > e0 + L2) break;
      const k = smoothstep(e * 0.3, e0, s.t) * (1 - smoothstep(e0, e0 + L2, s.t));
      if (k > 0) { s.collar = k; s.r = s.r + Math.max(0, widest - s.r) * k; }
    }
    // the bark mapping hands over from the parent's to the branch's own across the collar
    for (const s of out) s.own = smoothstep(e * 0.5, e0 + L2 * 0.7, s.t);
  }
  return lod.chord > 0 ? adapt(out, lod, ch.attach ? parentR : 0) : out;
}

/** Curvature-adaptive ring placement for thin branches (see LodSpec.chord). Thick (bark-relief) stretches keep
 *  the radius-based spacing; the dense spline stays the reference for the deviation test. */
function adapt(S: Sample[], lod: LodSpec, parentR: number): Sample[] {
  if (S.length < 3) return S;
  const keep: Sample[] = [S[0]];
  let a = 0;
  // thick (bark-relief) stretches keep the radius-based spacing; live/dead changes and broken ends always get a ring
  const must = (i: number) => {
    const s = S[i], p = S[i - 1];
    if (s.node.dead !== p.node.dead || s.node.broken) return true;
    // (on thin branches the collar flare and the run inside the parent are traced by the radius-change test)
    if (s.r >= lod.adaptiveBelow) return s.t - keep[keep.length - 1].t >= clamp(s.r * 1.1, 0.035, 0.6) * lod.step;
    return false;
  };
  for (let j = 1; j < S.length; j++) {
    if (j === S.length - 1 || must(j)) { keep.push(S[j]); a = j; continue; }
    // can the straight run a → j+1 stand in for every dense sample in between?
    const A = S[a], Bq = S[j + 1], d = sub(Bq.p, A.p), L2 = Math.max(dot(d, d), 1e-12);
    let ok = Math.abs(Bq.r - A.r) <= lod.rChange * A.r + 0.0005;
    for (let k = a + 1; k <= j && ok; k++) {
      const q = sub(S[k].p, A.p), t = clamp(dot(q, d) / L2, 0, 1);
      const e = sub(q, mul(d, t));
      if (Math.sqrt(dot(e, e)) > Math.max(lod.chord * S[k].r, lod.chordMin)) ok = false;
    }
    if (!ok) { keep.push(S[j]); a = j; }
  }
  return keep;
}

function smoothstep(a: number, b: number, x: number) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

function sidesFor(r: number, lod: LodSpec): number { return clamp(Math.round((2 * Math.PI * r) / lod.edge), lod.minSides, lod.maxSides); }

function tube(ch: Chain, lod: LodSpec, bark: BarkFn | null, out: MeshOut, startCut: number, sg: number, v0: number, maps: MapStore): void {
  const all = samples(ch, lod, startCut > 0);
  const S = all.filter((s) => s.t >= startCut);
  // begin exactly at the cut (rings on a thick stem can be ~0.7 m apart: starting at the next ring left a gap)
  const k0 = all.findIndex((s) => s.t >= startCut);
  if (startCut > 0 && k0 > 0 && all[k0].t > startCut + 1e-4) {
    const a = all[k0 - 1], b = all[k0], u = (startCut - a.t) / (b.t - a.t);
    S.unshift({ p: lerp(a.p, b.p, u), r: a.r + (b.r - a.r) * u, node: u < 0.5 ? a.node : b.node, t: startCut, collar: 0, ax: b.ax, own: 1 });
  }
  if (S.length < 2) return;
  // Bark mapping (see VFLOATS): axis A = σ × the branch direction, origin C = c(s) − v(s) A with v(s) = v0 + σ s. In
  // the band where a tube takes over from a fused surface the axis is the skeleton segment's (what the fused surface
  // relaxes to there); a child tube turns from its parent's axis to its own across the collar.
  const sb = startCut > 0 ? startCut + FUSE_OVERLAP : 0;
  const parentA = ch.parent && ch.attach ? maps.get(ch.parent)?.get(ch.attach) : undefined;
  const own = new Map<TNode, V3>(); maps.set(ch, own);
  if (startCut > 0) {
    // taking over from a fused (implicit) surface. Through the handover band the fused surface sinks across the
    // tube: rings every 8 cm there (on a stem they are otherwise ~0.6 m apart, so the tube stayed undersized across
    // the band and the two surfaces met in a visible lip)
    const end = startCut + FUSE_OVERLAP, dense: Sample[] = [];
    for (let k = 0; k < S.length; k++) {
      const a = S[k], b = S[k + 1]; dense.push(a);
      if (!b || a.t >= end) continue;
      for (let t = a.t + 0.08; t < Math.min(b.t, end) - 0.02; t += 0.08) { const u = (t - a.t) / (b.t - a.t); dense.push({ ...a, p: lerp(a.p, b.p, u), r: a.r + (b.r - a.r) * u, t, node: u < 0.5 ? a.node : b.node }); }
    }
    S.splice(0, S.length, ...dense);
    // start slightly inside it and reach full radius within 12 cm
    for (const s of S) { const k = (s.t - startCut) / 0.12; if (k < 1) s.r *= 0.9 + 0.1 * Math.max(0, k); }
  }
  let T = norm(sub(S[1].p, S[0].p));
  let Nf = perp(T);
  let prev: { idx: number[]; n: number } | null = null;
  const order = ch.order;
  for (let k = 0; k < S.length; k++) {
    const s = S[k];
    const Tn = k < S.length - 1 ? norm(sub(S[k + 1].p, s.p)) : T;
    const Ta = norm(add(T, Tn));
    Nf = norm(sub(Nf, mul(Ta, dot(Nf, Ta))));
    T = Tn;
    const B = cross(Ta, Nf);
    const last = k === S.length - 1;
    const node = s.node;
    const n = sidesFor(Math.max(s.r, 0.002), lod);
    const flags = (node.dead ? 1 : 0) | (node.root ? 4 : 0) | (s.collar > 0 ? 8 : 0);
    // this ring's bark mapping (axis A, origin C)
    let A: V3 = s.t <= sb ? mul(s.ax, sg) : mul(Ta, sg);
    if (parentA && s.own < 1) A = norm(lerp(parentA, A, s.own));
    const C: V3 = sub(s.p, mul(A, v0 + sg * s.t));
    if (!own.has(node)) own.set(node, A);
    const idx: number[] = [];
    if (last && !node.broken) {
      // closed tip
      idx.push(out.vert(add(s.p, mul(Ta, s.r)), Ta, order, flags, s.r, 0, A, C));
    } else {
      for (let q = 0; q <= n; q++) {
        const a = (q / n) * Math.PI * 2;
        const d = add(mul(Nf, Math.cos(a)), mul(B, Math.sin(a)));
        let rr = s.r, nrm = d, relief = 0;
        const base = add(s.p, mul(d, rr));
        if (bark && lod.displace > 0 && rr > 0.03) {
          // bark coordinates: the stem (order 0) uses the world angle and height, exactly like the blended base it
          // continues (no pattern switch at the handover); branches use their own continuous ring angle and length
          const stem = order === 0, at0: [number, number] = stem ? [Math.atan2(base[2], base[0]), base[1]] : [a, s.t];
          const b0 = bark(base, Ta, s.r, node, at0);
          rr += b0 * lod.displace; relief = b0 * lod.displace;
          // shading normal of the displaced surface (finite differences of the bark field around and along the
          // axis, in the tube's own continuous coordinates)
          const t1 = cross(Ta, d), e = 0.008;
          const p1 = add(base, mul(t1, e)), p2 = add(base, mul(Ta, e));
          const g1 = (bark(p1, Ta, s.r, node, stem ? [Math.atan2(p1[2], p1[0]), p1[1]] : [a + e / s.r, s.t]) - b0) / e;
          const g2 = (bark(p2, Ta, s.r, node, stem ? [Math.atan2(p2[2], p2[0]), p2[1]] : [a, s.t + e]) - b0) / e;
          nrm = norm(sub(d, mul(add(mul(t1, g1), mul(Ta, g2)), lod.displace)));
        }
        idx.push(out.vert(add(s.p, mul(d, rr)), nrm, order, flags, s.r, relief, A, C));
      }
    }
    if (prev) stitch(out, prev.idx, idx);
    prev = { idx, n };
    if (last && node.broken && idx.length > 2) brokenCap(out, idx, s, Ta, order, flags | 2, ch.id, A, C);
  }
}

/** Stitch two rings (each closed: last vertex duplicates the first in angle) with possibly different counts.
 *  Rings run counter-clockwise about the axis (d = N cos + B sin, B = T × N), `b` further along it; triangles are
 *  wound counter-clockwise seen from outside, like the fused surface and the ground, so front faces face out. */
function stitch(out: MeshOut, a: number[], b: number[]): void {
  if (b.length === 1) { for (let q = 0; q < a.length - 1; q++) out.tri(a[q], a[q + 1], b[0]); return; }
  const na = a.length - 1, nb = b.length - 1;
  let i = 0, j = 0;
  while (i < na || j < nb) {
    // advance the ring whose next vertex has the smaller angle
    const ta = (i + 1) / na, tb = (j + 1) / nb;
    if (j >= nb || (i < na && ta <= tb)) { out.tri(a[i], a[i + 1], b[j]); i++; }
    else { out.tri(a[i], b[j + 1], b[j]); j++; }
  }
}

/** Splintered end of a broken limb. A branch snaps on an oblique plane: the tension side tears out in a few long
 *  splinters, the compression side breaks short and shredded, and the end narrows as the fibres pull apart. All
 *  irregularity comes from a hash of the chain id and the ring position (deterministic). */
function brokenCap(out: MeshOut, ring: number[], s: Sample, T: V3, order: number, flags: number, seed: number, A: V3, C: V3): void {
  const n = ring.length - 1;
  const v = out.v;
  const H = (k: number) => { const x = Math.sin(seed * 91.17 + k * 12.9898) * 43758.5453; return x - Math.floor(x); };
  // direction of the tension side (in the ring plane), how oblique the break is, where the long splinters stand
  const phase = H(1) * Math.PI * 2, slant = 0.5 + 0.9 * H(2);
  const spl = [H(3), H(4), H(5)].map((x) => Math.floor(x * n));
  const tip: number[] = [], vFrom = out.count, iFrom = out.i.length;
  for (let q = 0; q <= n; q++) {
    const o = ring[q] * VFLOATS;
    const p: V3 = [v[o], v[o + 1], v[o + 2]];
    const a = (q / n) * Math.PI * 2;
    const side = 0.5 + 0.5 * Math.cos(a - phase); // 1 on the tension side, 0 on the compression side
    let h = s.r * (slant * side + 0.12 + 0.18 * H(10 + (q % n)));
    for (const k of spl) { const dq = Math.min(Math.abs(q - k), n - Math.abs(q - k)); if (dq <= 1) h += s.r * (dq ? 0.35 : 0.9) * (0.5 + side) * H(20 + k); }
    const inward = sub(s.p, p), pull = 0.25 + 0.35 * H(30 + (q % n));
    // (relief carries the radial fraction on the cap: the material draws the end grain from it)
    tip.push(out.vert(add(add(p, mul(inward, pull)), mul(T, h)), T, order, flags, s.r, 1 - pull, A, C));
  }
  stitch(out, ring, tip);
  // the broken face: low in the middle (decayed pith), on the compression side of centre
  const c = out.vert(add(s.p, mul(T, s.r * (0.15 + 0.3 * slant * 0.5))), T, order, flags, s.r, 0, A, C);
  for (let q = 0; q < n; q++) out.tri(tip[q], tip[q + 1], c);
  out.normals(vFrom, iFrom); // splinters shade by their own faces
}

export { lerp };
