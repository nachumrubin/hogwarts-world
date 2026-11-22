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

export const VFLOATS = 12;
export const FUSE_OVERLAP = 0.45; // pos3 normal3 attr4 (order, flags, radius, flex) uv2

export class MeshOut {
  v: number[] = []; i: number[] = [];
  get count() { return this.v.length / VFLOATS; }
  vert(p: V3, n: V3, order: number, flags: number, r: number, flex: number, u: number, w: number): number {
    this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], order, flags, r, flex, u, w); return this.count - 1;
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

export interface LodSpec { edge: number; maxSides: number; minSides: number; minRadius: number; step: number; displace: number }
export const LODS: LodSpec[] = [
  { edge: 0.045, maxSides: 72, minSides: 5, minRadius: 0, step: 1, displace: 1 },
  { edge: 0.12, maxSides: 24, minSides: 4, minRadius: 0.012, step: 2.2, displace: 0.6 },
  { edge: 0.35, maxSides: 10, minSides: 3, minRadius: 0.05, step: 5, displace: 0 },
];

export type BarkFn = (p: V3, axis: V3, r: number, node: TNode) => number;

/** Flags packed in attr.y: 1 dead, 2 broken end region, 4 root, 8 collar. */
export function meshChains(sk: Skeleton, chains: Chain[], lod: LodSpec, bark: BarkFn | null, out: MeshOut, opts: { skip?: (c: Chain) => boolean; startCut?: (c: Chain) => number } = {}): void {
  const from = out.count, fromIdx = out.i.length;
  for (const ch of chains) {
    if (opts.skip && opts.skip(ch)) continue;
    const n0 = ch.nodes[0];
    if (n0.r < lod.minRadius && !n0.root) continue;
    const cut = opts.startCut ? opts.startCut(ch) : 0;
    if (cut === Infinity) continue;
    tube(ch, lod, bark, out, cut);
  }
  out.normals(from, fromIdx);
}

interface Sample { p: V3; r: number; node: TNode; t: number; collar: number }

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
    const step = clamp(rr * 1.1, 0.035, 0.6) * lod.step;
    const k = Math.max(1, Math.ceil(segL / step));
    for (let j = 0; j < k; j++) {
      const t = j / k;
      const p = catmull(p0, p1, p2, p3, t);
      const r = R[i] + (R[i + 1] - R[i]) * t;
      out.push({ p, r, node: t < 0.5 ? N[i] : N[i + 1], t: acc + segL * t, collar: 0 });
    }
    acc += segL;
  }
  out.push({ p: P[P.length - 1], r: R[R.length - 1], node: N[N.length - 1], t: acc, collar: 0 });
  // collar: the branch runs inside its parent from the parent's axis, emerges at distance e (depends on the
  // branching angle) and is widened just around the emergence point, so it flows out of the parent's surface
  if (ch.attach && out.length > 2 && !noCollar) {
    const r0 = out[Math.min(2, out.length - 1)].r;
    const pd = ch.attach.parent ? norm(sub(ch.attach.p, ch.attach.parent.p)) : [0, 1, 0] as V3;
    const cd = norm(sub(out[Math.min(2, out.length - 1)].p, out[0].p));
    const sinA = Math.sqrt(Math.max(0, 1 - dot(pd, cd) ** 2));
    const e = parentR / Math.max(sinA, 0.3);
    const widest = Math.min(parentR * 0.85, r0 * 1.45);
    const L2 = r0 * 3 + 0.05;
    for (const s of out) {
      if (s.t > e + L2) break;
      const k = smoothstep(e * 0.4, e, s.t) * (1 - smoothstep(e, e + L2, s.t));
      if (k > 0) { s.collar = k; s.r = s.r + Math.max(0, widest - s.r) * k; }
    }
  }
  return out;
}

function smoothstep(a: number, b: number, x: number) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

function sidesFor(r: number, lod: LodSpec): number { return clamp(Math.round((2 * Math.PI * r) / lod.edge), lod.minSides, lod.maxSides); }

function tube(ch: Chain, lod: LodSpec, bark: BarkFn | null, out: MeshOut, startCut: number): void {
  const S = samples(ch, lod, startCut > 0).filter((s) => s.t >= startCut);
  if (S.length < 2) return;
  // taking over from a fused (implicit) surface: start slightly inside it and ramp up to full radius
  if (startCut > 0) for (const s of S) { const k = (s.t - startCut) / (FUSE_OVERLAP * 0.45); if (k < 1) s.r *= 0.9 + 0.1 * Math.max(0, k); }
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
    const flex = clamp(1 - s.r / 0.25, 0, 1);
    const idx: number[] = [];
    if (last && !node.broken) {
      // closed tip
      idx.push(out.vert(add(s.p, mul(Ta, s.r)), Ta, order, flags, s.r, flex, 0, s.t));
    } else {
      for (let q = 0; q <= n; q++) {
        const a = (q / n) * Math.PI * 2;
        const d = add(mul(Nf, Math.cos(a)), mul(B, Math.sin(a)));
        let rr = s.r;
        const base = add(s.p, mul(d, rr));
        if (bark && lod.displace > 0 && rr > 0.03) rr += bark(base, Ta, s.r, node) * lod.displace;
        idx.push(out.vert(add(s.p, mul(d, rr)), d, order, flags, s.r, flex, q / n, s.t));
      }
    }
    if (prev) stitch(out, prev.idx, idx);
    prev = { idx, n };
    if (last && node.broken && idx.length > 2) brokenCap(out, idx, s, Ta, order, flags | 2, flex, ch.id);
  }
}

/** Stitch two rings (each closed: last vertex duplicates the first in angle) with possibly different counts. */
function stitch(out: MeshOut, a: number[], b: number[]): void {
  if (b.length === 1) { for (let q = 0; q < a.length - 1; q++) out.tri(a[q], b[0], a[q + 1]); return; }
  const na = a.length - 1, nb = b.length - 1;
  let i = 0, j = 0;
  while (i < na || j < nb) {
    // advance the ring whose next vertex has the smaller angle
    const ta = (i + 1) / na, tb = (j + 1) / nb;
    if (j >= nb || (i < na && ta <= tb)) { out.tri(a[i], b[j], a[i + 1]); i++; }
    else { out.tri(a[i], b[j], b[j + 1]); j++; }
  }
}

/** Jagged, splintered end of a broken limb. */
function brokenCap(out: MeshOut, ring: number[], s: Sample, T: V3, order: number, flags: number, flex: number, seed: number): void {
  const n = ring.length - 1;
  const v = out.v;
  const tip: number[] = [];
  for (let q = 0; q <= n; q++) {
    const o = ring[q] * VFLOATS;
    const p: V3 = [v[o], v[o + 1], v[o + 2]];
    const h = Math.abs(Math.sin(q * 2.7 + seed * 1.3)) * Math.abs(Math.sin(q * 0.9 + seed)) * s.r * 2.2;
    const inward = sub(s.p, p);
    tip.push(out.vert(add(add(p, mul(inward, 0.35)), mul(T, h)), T, order, flags, s.r, flex, q / n, s.t + h));
  }
  stitch(out, ring, tip);
  const c = out.vert(add(s.p, mul(T, s.r * 0.4)), T, order, flags, s.r, flex, 0.5, s.t);
  for (let q = 0; q < n; q++) out.tri(tip[q], c, tip[q + 1]);
}

export { lerp };
