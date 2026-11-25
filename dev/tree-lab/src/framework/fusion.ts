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
import { MeshOut, VFLOATS, barkFrames, type BarkFn } from './mesher.ts';

export interface FusionOpts {
  min: V3; max: V3; cell: number; minR: number;
  bark: BarkFn | null;
  /** smooth-union radius as a fraction of the thinner capsule's radius */
  blend: number;
  /** optional carve: signed distance of the removed volume (negative inside), given the uncarved distance */
  carve?: (p: V3, d: number) => number;
  /** optional ground height (tree-local): faces lying wholly more than 10 cm below it are never visible and are
   *  not emitted, and vertices left unused are dropped. Pass the same ground the roots were grown on. */
  ground?: (x: number, z: number) => number;
  /** root flare without undercuts: below `top` m above ground, each point also takes the shape found up to `depth`
   *  m higher, expanded by `slope` × the lift (a smooth union of `steps` lifted copies). The stem then widens
   *  continuously into the ground instead of bulging into a lip with a downward-facing underside. */
  flare?: { top: number; depth: number; steps: number; slope: number };
}

interface Cap { a: V3; b: V3; ra: number; rb: number; axis: V3; L: number; node: TNode; lo: V3; hi: V3; chain: number; at: number; sg: number; va: number }

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
  // branch axis and position along it for every node (same-branch segments blend lightly; see raw())
  const axisOf = new Map<TNode, [number, number]>();
  const allChains = sk.chains(), { sg: signs, V } = barkFrames(allChains);
  for (const ch of allChains) ch.nodes.forEach((n, i) => axisOf.set(n, [ch.id, i]));
  const caps: Cap[] = [];
  for (const n of sk.nodes) {
    const p = n.parent; if (!p) continue;
    const ra = p === sk.root ? Math.max(p.r, n.r) : p.r, rb = n.r;
    if (Math.min(ra, rb) < o.minR && !(n.root && p === sk.root)) continue;
    if (!inRegion(p.p, o, ra) && !inRegion(n.p, o, rb)) continue;
    const ax = sub(n.p, p.p), L = Math.sqrt(dot(ax, ax)); if (L < 1e-4) continue;
    const R = Math.max(ra, rb) * 1.15 + 0.1;
    const ci = axisOf.get(n) ?? [-1 - n.id, 0];
    caps.push({ a: p.p, b: n.p, ra, rb, axis: mul(ax, 1 / L), L, node: n, chain: ci[0], at: ci[1], sg: signs.get(ci[0]) ?? 1, va: V.get(p) ?? 0,
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
  const field = (p: V3, list: Cap[]): { d: number; cap: Cap | null; t: number; bk: number; cavity: boolean } => {
    const f0 = raw(p, list);
    const F = o.flare;
    if (F) {
      const gy = o.ground ? o.ground(p[0], p[2]) : 0, hy = p[1] - gy;
      // the lifted copies can only lower the field, by at most depth × (1 + slope) (the field is ~1-Lipschitz):
      // samples deeper inside than two cells or further out than that bound keep their sign whatever the flare does,
      // and only signs (and values next to a sign change) reach the mesh, so they skip the look-ups
      if (hy < F.top && hy > -F.depth - 0.3 && f0.d > -2 * s && f0.d < F.depth * (1 + F.slope) + 0.12 + 2 * s) {
        let d = f0.d;
        const fl = flareCell.get(cellKey(p[0], p[2])) ?? NONE;
        for (let k = 1; k <= F.steps; k++) {
          const h = (F.depth * k) / F.steps, q: V3 = [p[0], p[1] + h, p[2]];
          if (q[1] - gy > F.top + F.depth) break;
          const w = clamp((F.top - hy) / F.top, 0, 1), ws = w * w * (3 - 2 * w); // fades in gradually below the top
          const dk = raw(q, fl).d - F.slope * h * ws;
          // near-hard minimum: a smooth union would inflate the surface a little at every step (a skirt); the slight
          // smoothing left fades to nothing at the top of the band, where the surface must continue the trunk
          const kb = 0.03 * ws + 1e-4, hh = clamp(0.5 + 0.5 * (dk - d) / kb, 0, 1);
          d = dk * (1 - hh) + d * hh - kb * hh * (1 - hh);
        }
        f0.d = d;
      }
    }
    if (o.carve) { const c = -o.carve(p, f0.d); if (c > f0.d) { f0.d = c; f0.cavity = true; } }
    return f0;
  };
  // capsules near the ground, for the flare's lifted look-ups (they may cross block boundaries)
  const flareCaps = o.flare ? caps.filter((c) => c.lo[1] < (o.flare!.top + o.flare!.depth + 0.5)) : [];
  // … bucketed on a 0.5 m ground grid (the lifted look-ups keep x and z): each look-up visits only the capsules whose
  // bounds cover its column, instead of every capsule near the ground (that made meshing 2–3× slower in e4f3010)
  const CELL = 0.5, NONE: Cap[] = [], flareCell = new Map<number, Cap[]>();
  const cellKey = (x: number, z: number) => (Math.floor(x / CELL) + 4096) * 8192 + Math.floor(z / CELL) + 4096;
  for (const c of flareCaps) for (let x = Math.floor(c.lo[0] / CELL); x <= Math.floor(c.hi[0] / CELL); x++) for (let z = Math.floor(c.lo[2] / CELL); z <= Math.floor(c.hi[2] / CELL); z++) {
    const k = (x + 4096) * 8192 + z + 4096; let l = flareCell.get(k); if (!l) flareCell.set(k, l = []); l.push(c);
  }
  const raw = (p: V3, list: Cap[]): { d: number; cap: Cap | null; t: number; bk: number; cavity: boolean } => {
    let d = 1e9, best: Cap | null = null, bt = 0, dPlain = 1e9, bk = 0;
    for (const c of list) {
      if (p[0] < c.lo[0] || p[1] < c.lo[1] || p[2] < c.lo[2] || p[0] > c.hi[0] || p[1] > c.hi[1] || p[2] > c.hi[2]) continue;
      const q = sdCone(p, c);
      if (q.d < d + 0.5) {
        // polynomial smooth minimum, blend radius ∝ the thinner member (continuous forks, no fat webbing on twigs).
        // Segments of one branch (up to four joints apart: on a thick stem those reach each other) join with a light
        // blend (0.12 r): the full blend inflated a straight stem in rings (and made it fatter than the tube that
        // continues it); a plain minimum left a crease at every joint.
        const seq = best !== null && c.chain === best.chain && Math.abs(c.at - best.at) <= 4;
        const rr = Math.min(c.ra + (c.rb - c.ra) * q.t, best ? best.ra : 1e9);
        const k = (seq ? 0.12 : o.blend) * rr + 1e-4;
        const h = clamp(0.5 + 0.5 * (q.d - d) / k, 0, 1);
        const nd = d > 1e8 ? q.d : q.d * (1 - h) + d * h - k * h * (1 - h);
        if (q.d < dPlain) { best = c; bt = q.t; dPlain = q.d; }
        d = nd;
      }
    }
    if (best) {
      const rb = best.ra + (best.rb - best.ra) * bt;
      bk = o.bark ? o.bark(p, best.axis, rb, best.node) : 0;
      d -= bk;
      // towards the region's faces the blended surface relaxes to the bare nearest capsule (what the tube that
      // takes over there follows), so the tube covers the rim and no ledge shows
      const m = Math.min(p[0] - o.min[0], o.max[0] - p[0], p[1] - o.min[1], o.max[1] - p[1], p[2] - o.min[2], o.max[2] - p[2]);
      if (m < 1.0) {
        const w = 1 - clamp((m - 0.15) / 0.85, 0, 1), ws = w * w * (3 - 2 * w);
        // the relaxed surface also sinks 12 % inside, in step with the relaxation: the tube (which starts where the
        // relaxation starts) then crosses it once, at any exit angle (a sink tied to the face distance left oblique
        // limbs with two near-coincident surfaces over a metre or more, which z-fought in bands)
        const bare = dPlain - bk + 0.2 * rb;
        d = d * (1 - ws) + bare * ws;
      }
    }
    return { d, cap: best, t: bt, bk, cavity: false };
  };
  // bark mapping on the blended surface (see VFLOATS): the nearby capsules' frames, weighted by closeness: axis
  // (each oriented like its chain), centre point and bark coordinate v, blended, then C = c − v A. The frame turns
  // smoothly through forks and root crotches and pivots about the branch centres there; towards the region's faces it
  // becomes the nearest capsule's alone, which is what the tube taking over there starts with.
  const frameAt = (p: V3, list: Cap[], best: Cap | null): [V3, V3] => {
    let A: V3 = [0, 0, 0], c: V3 = [0, 0, 0], v = 0, ws = 0, dmin = 1e9;
    const near: [number, Cap, number][] = [];
    for (const cp of list) {
      if (p[0] < cp.lo[0] || p[1] < cp.lo[1] || p[2] < cp.lo[2] || p[0] > cp.hi[0] || p[1] > cp.hi[1] || p[2] > cp.hi[2]) continue;
      const q = sdCone(p, cp); near.push([q.d, cp, q.t]); dmin = Math.min(dmin, q.d);
    }
    const one = (cp: Cap, t: number, w: number) => {
      A = add(A, mul(cp.axis, w * cp.sg)); c = add(c, mul(add(cp.a, mul(cp.axis, t * cp.L)), w)); v += w * (cp.va + cp.sg * t * cp.L); ws += w;
    };
    for (const [dq, cp, t] of near) { const w = Math.exp(-(dq - dmin) / (0.35 * Math.max(cp.ra, cp.rb) + 0.03)); if (w > 1e-3) one(cp, t, w); }
    if (best) {
      const m = Math.min(p[0] - o.min[0], o.max[0] - p[0], p[1] - o.min[1], o.max[1] - p[1], p[2] - o.min[2], o.max[2] - p[2]);
      const w = 1 - clamp((m - 0.15) / 0.85, 0, 1), wb = w * w * (3 - 2 * w);
      if (wb > 0) {
        // relax to the nearest capsule alone: scale the blend down and add that capsule with the remaining weight
        const t = clamp(dot(sub(p, best.a), best.axis) / best.L, 0, 1);
        A = mul(A, (1 - wb) / Math.max(ws, 1e-9)); c = mul(c, (1 - wb) / Math.max(ws, 1e-9)); v *= (1 - wb) / Math.max(ws, 1e-9); ws = 1 - wb;
        one(best, t, wb);
      }
    }
    if (ws <= 0) return [[0, 1, 0], [0, 0, 0]];
    const An: V3 = dot(A, A) > 1e-12 ? norm(A) : [0, 1, 0];
    const cc = mul(c, 1 / ws), vv = v / ws;
    return [An, sub(cc, mul(An, vv))];
  };
  const blockCaps: (Cap[] | null)[] = new Array(bx * by * bz).fill(null);
  for (let K = 0; K < bz; K++) for (let J = 0; J < by; J++) for (let I = 0; I < bx; I++) {
    const c0 = pos(I * B, J * B, K * B), c1 = pos(Math.min(nx - 1, (I + 1) * B), Math.min(ny - 1, (J + 1) * B), Math.min(nz - 1, (K + 1) * B));
    const ctr: V3 = mul(add(c0, c1), 0.5), half = Math.sqrt(dot(sub(c1, c0), sub(c1, c0))) / 2;
    const list = caps.filter((c) => !(c1[0] < c.lo[0] - 0.3 || c1[1] < c.lo[1] - 0.3 || c1[2] < c.lo[2] - 0.3 || c0[0] > c.hi[0] + 0.3 || c0[1] > c.hi[1] + 0.3 || c0[2] > c.hi[2] + 0.3));
    const dc = list.length ? field(ctr, list).d : 1e3;
    const flareMargin = o.flare && ctr[1] - half < o.flare.top + 0.5 ? o.flare.depth * (1 + o.flare.slope) + 0.2 : 0;
    const active = Math.abs(dc) < half * 1.7 + 0.35 + flareMargin; // conservative: a missed block would leave a crack along its faces
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
    const flags = (node.dead ? 1 : 0) | (node.root ? 4 : 0) | 16 | (fq.cavity ? 32 : 0);
    const rr = fq.cap ? fq.cap.ra + (fq.cap.rb - fq.cap.ra) * fq.t : 1;
    const [FA, FC] = frameAt(p, list, fq.cap);
    vid[cid(i, j, k)] = out.vert(p, norm(g), node.root ? -1 : node.order, flags, rr, fq.bk, FA, FC);
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
    if (o.ground && [v0, v1, v2, v3].every((q) => { const w = out.v, b = q * VFLOATS; return w[b + 1] < o.ground!(w[b], w[b + 2]) - 0.1; })) return;
    if (flip) { out.tri(v0, v1, v2); out.tri(v0, v2, v3); } else { out.tri(v0, v2, v1); out.tri(v0, v3, v2); }
  }
  if (o.ground) compact(out, from, fromIdx);
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

/** Drop vertices in [from, end) that no triangle from `fromIdx` on references, remapping the indices. */
function compact(out: MeshOut, from: number, fromIdx: number): void {
  const n = out.count - from, used = new Int32Array(n).fill(-1);
  for (let k = fromIdx; k < out.i.length; k++) { const q = out.i[k] - from; if (q >= 0) used[q] = 1; }
  let w = 0;
  for (let q = 0; q < n; q++) if (used[q] > 0) {
    if (w !== q) for (let c = 0; c < VFLOATS; c++) out.v[(from + w) * VFLOATS + c] = out.v[(from + q) * VFLOATS + c];
    used[q] = w++;
  }
  out.v.length = (from + w) * VFLOATS;
  for (let k = fromIdx; k < out.i.length; k++) { const q = out.i[k] - from; if (q >= 0) out.i[k] = from + used[q]; }
}

