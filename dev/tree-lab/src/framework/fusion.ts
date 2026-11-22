// Junction and root-base fusion: the thick part of the tree inside a region (bole, major forks, root buttresses)
// is meshed as one implicit surface — a smooth union of tapered capsules (one per skeleton segment), displaced by
// the species bark function and optionally hollowed — then polygonised with surface nets (the technique Abyssal
// Garden uses for its terrain, math.js surfaceNets). Branches therefore grow out of each other with continuous
// surfaces instead of intersecting cylinders, and roots merge into the flare.
//
// Tubes take over where a branch leaves the region (or gets thinner than minR): the tube starts slightly inside
// the implicit surface with a radius ramp, so the two meet without a visible seam.
import { type V3, add, sub, mul, norm, dot, clamp } from './math.ts';
import type { Skeleton, TNode, Chain } from './skeleton.ts';
import { MeshOut, type BarkFn } from './mesher.ts';

export interface FusionOpts {
  min: V3; max: V3; cell: number; minR: number;
  bark: BarkFn | null;
  /** smooth-union radius as a fraction of the thinner capsule's radius */
  blend: number;
  /** optional carve: signed distance of the removed volume (negative inside), given the uncarved distance */
  carve?: (p: V3, d: number) => number;
}

interface Cap { a: V3; b: V3; ra: number; rb: number; axis: V3; L: number; node: TNode; lo: V3; hi: V3 }

function sdCone(p: V3, c: Cap): { d: number; t: number } {
  // round cone approximated: distance to the axis segment minus the interpolated radius
  const ap = sub(p, c.a);
  const t = clamp(dot(ap, c.axis) / c.L, 0, 1);
  const q = add(c.a, mul(c.axis, t * c.L));
  const dd = sub(p, q);
  return { d: Math.sqrt(dot(dd, dd)) - (c.ra + (c.rb - c.ra) * t), t };
}

export function inRegion(p: V3, o: FusionOpts, pad = 0): boolean {
  return p[0] >= o.min[0] - pad && p[1] >= o.min[1] - pad && p[2] >= o.min[2] - pad && p[0] <= o.max[0] + pad && p[1] <= o.max[1] + pad && p[2] <= o.max[2] + pad;
}

export function fuse(sk: Skeleton, o: FusionOpts, out: MeshOut): { triangles: number; ms: number; caps: number; samples: number } {
  const t0 = performance.now();
  const from = out.count, fromIdx = out.i.length;
  // ---- capsules
  const caps: Cap[] = [];
  for (const n of sk.nodes) {
    const p = n.parent; if (!p) continue;
    const ra = p === sk.root ? Math.max(p.r, n.r) : p.r, rb = n.r;
    if (Math.min(ra, rb) < o.minR && !(n.root && p === sk.root)) continue;
    if (!inRegion(p.p, o, ra) && !inRegion(n.p, o, rb)) continue;
    const ax = sub(n.p, p.p), L = Math.sqrt(dot(ax, ax)); if (L < 1e-4) continue;
    const R = Math.max(ra, rb) * 1.15 + 0.1;
    caps.push({ a: p.p, b: n.p, ra, rb, axis: mul(ax, 1 / L), L, node: n,
      lo: [Math.min(p.p[0], n.p[0]) - R, Math.min(p.p[1], n.p[1]) - R, Math.min(p.p[2], n.p[2]) - R],
      hi: [Math.max(p.p[0], n.p[0]) + R, Math.max(p.p[1], n.p[1]) + R, Math.max(p.p[2], n.p[2]) + R] });
  }
  const s = o.cell;
  const nx = Math.ceil((o.max[0] - o.min[0]) / s) + 1, ny = Math.ceil((o.max[1] - o.min[1]) / s) + 1, nz = Math.ceil((o.max[2] - o.min[2]) / s) + 1;
  const B = 8; // coarse block = B cells
  const bx = Math.ceil(nx / B), by = Math.ceil(ny / B), bz = Math.ceil(nz / B);
  const f = new Float32Array(nx * ny * nz);
  const idx = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const pos = (i: number, j: number, k: number): V3 => [o.min[0] + i * s, o.min[1] + j * s, o.min[2] + k * s];
  let samples = 0;
  // field evaluation with a per-block capsule list
  const field = (p: V3, list: Cap[]): { d: number; cap: Cap | null; t: number } => {
    let d = 1e9, best: Cap | null = null, bt = 0, dPlain = 1e9;
    for (const c of list) {
      if (p[0] < c.lo[0] || p[1] < c.lo[1] || p[2] < c.lo[2] || p[0] > c.hi[0] || p[1] > c.hi[1] || p[2] > c.hi[2]) continue;
      const q = sdCone(p, c);
      if (q.d < d + 0.5) {
        // polynomial smooth minimum, blend radius ∝ the thinner member (continuous forks, no fat webbing on twigs)
        const k = o.blend * Math.min(c.ra + (c.rb - c.ra) * q.t, best ? best.ra : 1e9) + 1e-4;
        const h = clamp(0.5 + 0.5 * (q.d - d) / k, 0, 1);
        const nd = d > 1e8 ? q.d : q.d * (1 - h) + d * h - k * h * (1 - h);
        if (q.d < dPlain) { best = c; bt = q.t; dPlain = q.d; }
        d = nd;
      }
    }
    if (best) {
      const rb = best.ra + (best.rb - best.ra) * bt;
      const bk = o.bark ? o.bark(p, best.axis, rb, best.node) : 0;
      d -= bk;
      // towards the region's faces the blended surface relaxes to the bare nearest capsule (what the tube that
      // takes over there follows) and then sinks 4 % inside it, so the tube covers the rim and no ledge shows
      const m = Math.min(p[0] - o.min[0], o.max[0] - p[0], p[1] - o.min[1], o.max[1] - p[1], p[2] - o.min[2], o.max[2] - p[2]);
      if (m < 1.0) {
        const w = 1 - clamp((m - 0.15) / 0.85, 0, 1), ws = w * w * (3 - 2 * w);
        const u = 1 - clamp(m / 0.5, 0, 1);
        const bare = dPlain - bk + 0.04 * rb * u * u * (3 - 2 * u);
        d = d * (1 - ws) + bare * ws;
      }
    }
    if (o.carve) d = Math.max(d, -o.carve(p, d));
    return { d, cap: best, t: bt };
  };
  const blockCaps: (Cap[] | null)[] = new Array(bx * by * bz).fill(null);
  for (let K = 0; K < bz; K++) for (let J = 0; J < by; J++) for (let I = 0; I < bx; I++) {
    const c0 = pos(I * B, J * B, K * B), c1 = pos(Math.min(nx - 1, (I + 1) * B), Math.min(ny - 1, (J + 1) * B), Math.min(nz - 1, (K + 1) * B));
    const ctr: V3 = mul(add(c0, c1), 0.5), half = Math.sqrt(dot(sub(c1, c0), sub(c1, c0))) / 2;
    const list = caps.filter((c) => !(c1[0] < c.lo[0] - 0.3 || c1[1] < c.lo[1] - 0.3 || c1[2] < c.lo[2] - 0.3 || c0[0] > c.hi[0] + 0.3 || c0[1] > c.hi[1] + 0.3 || c0[2] > c.hi[2] + 0.3));
    const dc = list.length ? field(ctr, list).d : 1e3;
    const active = Math.abs(dc) < half * 1.7 + 0.35; // conservative: a missed block would leave a crack along its faces
    const fill = dc < 0 ? -1e3 : 1e3;
    if (active) blockCaps[I + bx * (J + by * K)] = list;
    for (let k = K * B; k <= Math.min(nz - 1, (K + 1) * B); k++) for (let j = J * B; j <= Math.min(ny - 1, (J + 1) * B); j++) for (let i = I * B; i <= Math.min(nx - 1, (I + 1) * B); i++) {
      const id = idx(i, j, k);
      if (active) { f[id] = field(pos(i, j, k), list).d; samples++; }
      else if (f[id] === 0) f[id] = fill;
    }
  }
  // ---- surface nets
  const vid = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cid = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k);
  const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0; const v: number[] = [];
    for (let c = 0; c < 8; c++) { const val = f[idx(i + corner[c][0], j + corner[c][1], k + corner[c][2])]; v.push(val); if (val < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let px = 0, py = 0, pz = 0, cnt = 0;
    for (const [a, b] of edges) {
      if ((v[a] < 0) === (v[b] < 0)) continue;
      const t = v[a] / (v[a] - v[b]);
      px += corner[a][0] + (corner[b][0] - corner[a][0]) * t; py += corner[a][1] + (corner[b][1] - corner[a][1]) * t; pz += corner[a][2] + (corner[b][2] - corner[a][2]) * t; cnt++;
    }
    const p: V3 = [o.min[0] + (i + px / cnt) * s, o.min[1] + (j + py / cnt) * s, o.min[2] + (k + pz / cnt) * s];
    // normal: gradient of the field (central differences on the analytic field, block capsule list)
    const I = Math.min(bx - 1, Math.floor(i / B)), J = Math.min(by - 1, Math.floor(j / B)), K = Math.min(bz - 1, Math.floor(k / B));
    const list = blockCaps[I + bx * (J + by * K)] || caps;
    const e = s * 0.5;
    const g: V3 = [field([p[0] + e, p[1], p[2]], list).d - field([p[0] - e, p[1], p[2]], list).d, field([p[0], p[1] + e, p[2]], list).d - field([p[0], p[1] - e, p[2]], list).d, field([p[0], p[1], p[2] + e], list).d - field([p[0], p[1], p[2] - e], list).d];
    const fq = field(p, list);
    const node = fq.cap ? fq.cap.node : sk.root;
    const flags = (node.dead ? 1 : 0) | (node.root ? 4 : 0) | 16;
    vid[cid(i, j, k)] = out.vert(p, norm(g), node.root ? -1 : node.order, flags, fq.cap ? fq.cap.ra : 1, 0, Math.atan2(p[2], p[0]) / 6.283 + 0.5, p[1]);
  }
  // quads across sign-changing grid edges
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const a = f[idx(i, j, k)] < 0;
    if (i < nx - 1 && a !== (f[idx(i + 1, j, k)] < 0)) quad(cid(i, j - 1, k - 1), cid(i, j, k - 1), cid(i, j, k), cid(i, j - 1, k), a);
    if (j < ny - 1 && a !== (f[idx(i, j + 1, k)] < 0)) quad(cid(i - 1, j, k - 1), cid(i - 1, j, k), cid(i, j, k), cid(i, j, k - 1), a);
    if (k < nz - 1 && a !== (f[idx(i, j, k + 1)] < 0)) quad(cid(i - 1, j - 1, k), cid(i, j - 1, k), cid(i, j, k), cid(i - 1, j, k), a);
  }
  function quad(c0: number, c1: number, c2: number, c3: number, flip: boolean) {
    const v0 = vid[c0], v1 = vid[c1], v2 = vid[c2], v3 = vid[c3];
    if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) return;
    if (flip) { out.tri(v0, v1, v2); out.tri(v0, v2, v3); } else { out.tri(v0, v2, v1); out.tri(v0, v3, v2); }
  }
  void from; void fromIdx;
  return { triangles: (out.i.length - fromIdx) / 3, ms: performance.now() - t0, caps: caps.length, samples };
}

/**
 * Where each chain's tube must begin so that it takes over from the fused surface: the arc length at which the
 * chain leaves the region or gets thinner than minR, minus an overlap. Infinity = chain entirely fused (no tube).
 */
export function tubeStarts(chains: Chain[], o: FusionOpts, overlap: number): Map<Chain, number> {
  const res = new Map<Chain, number>();
  for (const ch of chains) {
    const pts: TNode[] = ch.attach ? [ch.attach, ...ch.nodes] : ch.nodes;
    if (!inRegion(pts[0].p, o) || pts[Math.min(1, pts.length - 1)].r < o.minR) continue; // starts outside, or thin: normal tube
    let acc = 0, cut = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const d = sub(pts[i].p, pts[i - 1].p), L = Math.sqrt(dot(d, d));
      if (!inRegion(pts[i].p, o) || Math.min(pts[i].r, pts[i - 1].r) < o.minR) {
        // the implicit surface stops where the segment leaves the region (or gets too thin), not at the next node
        let f = 1;
        if (!inRegion(pts[i].p, o)) for (let k = 1; k <= 32; k++) { const q = k / 32; const pp: V3 = [pts[i - 1].p[0] + d[0] * q, pts[i - 1].p[1] + d[1] * q, pts[i - 1].p[2] + d[2] * q]; if (!inRegion(pp, o)) { f = (k - 1) / 32; break; } }
        cut = Math.max(0, acc + L * f - overlap); break;
      }
      acc += L;
    }
    res.set(ch, cut);
  }
  return res;
}
export { norm };
