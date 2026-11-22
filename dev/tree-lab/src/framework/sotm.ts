// Self-organizing growth with light competition and resource allocation (after Palubicki et al. 2009,
// "Self-organizing tree models for image synthesis", which combines Borchert–Honda resource allocation with
// shadow-propagation light). Each iteration (≈ one growth period):
//   1. light: every live bud casts shadow into a voxel pyramid below it; a bud's light Q is what is left in its
//      voxel. The least-shaded neighbouring voxel gives its preferred growth direction (towards free space).
//   2. basipetal pass: each branch's light = the sum of its buds' light (what it "earns").
//   3. acropetal pass: resource v = α·Q at the base is split at every branching point between the continuing axis
//      and the laterals by their light, biased by apical control λ (Borchert–Honda). Well-lit branches get more,
//      shaded ones less: competition and suppression.
//   4. growth: a bud receiving v grows ⌊v⌋ metamers along a blend of its previous direction, the free-space
//      direction and tropisms (species-specific, can change with age).
//   5. shedding: branches whose light no longer pays for their size (Q per internode below a threshold) die and
//      are shed. Old dormant buds lose the ability to sprout (no epicormic fans).
// History events (storm damage, dieback) are applied between iterations by the species module, and the model
// responds to them on the following iterations.
import { type V3, add, sub, mul, norm, len, dot, rotate, perp, clamp, type Rng } from './math.ts';
import { Skeleton, type TNode } from './skeleton.ts';

export interface Bud { node: TNode; dir: V3; terminal: boolean; alive: boolean; Q: number; v: number; born: number; idle: number }

export interface SotmParams {
  iterations: number;
  voxel: number; extent: [number, number, number]; // half-width x, height y, half-width z (m)
  shadowA: number; shadowB: number; shadowDepth: number;
  alpha: (it: number) => number;               // resource coefficient
  lambda: (node: TNode, it: number) => number; // apical control at this node
  metamer: (bud: Bud, it: number) => number;   // internode length (m)
  maxMetamers: number;
  weights: (bud: Bud, it: number) => { prev: number; free: number; tropism: V3 };
  branchAngle: (bud: Bud) => number;           // lateral bud angle from the shoot (rad)
  shedRatio: number;                            // Q per internode below which a branch is shed
  maxTurn?: number;                             // maximum direction change per metamer (rad)
  budLife: number;                              // iterations a lateral bud stays able to sprout
  lightCap?: (p: V3, b: Bud) => number;                 // extra light modulation by position (e.g. height limit)
  event?: (it: number, sk: Skeleton, buds: Bud[]) => void;
  shed?: (n: TNode, it: number) => boolean;     // may veto shedding (e.g. keep as dead stub)
}

export function growSOTM(sk: Skeleton, start: TNode, startDir: V3, P: SotmParams, r: Rng): { buds: Bud[]; stats: Record<string, number> } {
  const buds: Bud[] = [{ node: start, dir: norm(startDir), terminal: true, alive: true, Q: 0, v: 0, born: 0, idle: 0 }];
  const budsAt = new Map<TNode, Bud[]>(); budsAt.set(start, [buds[0]]);
  const [ex, ey, ez] = P.extent, s = P.voxel;
  const nx = Math.ceil((2 * ex) / s), ny = Math.ceil(ey / s), nz = Math.ceil((2 * ez) / s);
  const shadow = new Float32Array(nx * ny * nz);
  const vi = (p: V3) => { const i = Math.floor((p[0] + ex) / s), j = Math.floor(p[1] / s), k = Math.floor((p[2] + ez) / s); return i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : i + nx * (j + ny * k); };
  let shedCount = 0, grownTotal = 0, phyllo = r() * 6.283;
  const addBud = (node: TNode, dir: V3, terminal: boolean, it: number) => {
    const b: Bud = { node, dir, terminal, alive: true, Q: 0, v: 0, born: it, idle: 0 };
    buds.push(b); let l = budsAt.get(node); if (!l) budsAt.set(node, (l = [])); l.push(b);
  };
  for (let it = 0; it < P.iterations; it++) {
    // ---- 1. shadow propagation
    shadow.fill(0);
    for (const b of buds) {
      if (!b.alive) continue;
      const p = b.node.p;
      const i0 = Math.floor((p[0] + ex) / s), j0 = Math.floor(p[1] / s), k0 = Math.floor((p[2] + ez) / s);
      for (let q = 0; q <= P.shadowDepth; q++) {
        const j = j0 - q; if (j < 0) break;
        const sv = P.shadowA * Math.pow(P.shadowB, -q);
        for (let di = -q; di <= q; di++) for (let dk = -q; dk <= q; dk++) {
          const i = i0 + di, k = k0 + dk; if (i < 0 || k < 0 || i >= nx || k >= nz) continue;
          shadow[i + nx * (j + ny * k)] += sv;
        }
      }
    }
    // ---- light at buds, preferred direction
    const freeDir = new Map<Bud, V3>();
    for (const b of buds) {
      if (!b.alive) continue;
      const id = vi(b.node.p);
      if (id < 0) { b.Q = 0; continue; }
      b.Q = Math.max(1 - shadow[id] + P.shadowA, 0) * (P.lightCap ? P.lightCap(b.node.p, b) : 1);
      // least-shaded neighbour within the forward hemisphere
      let best: V3 = b.dir, bs = 1e9;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
        if (!di && !dj && !dk) continue;
        const d: V3 = norm([di, dj, dk]); if (dot(d, b.dir) < 0) continue;
        const nid = vi(add(b.node.p, mul(d, s)));
        const sh = nid < 0 ? 0 : shadow[nid];
        if (sh < bs) { bs = sh; best = d; }
      }
      freeDir.set(b, best);
    }
    // ---- 2. basipetal light
    const Qn = new Map<TNode, number>();
    const post = sk.postorder();
    for (const n of post) {
      let q = 0;
      for (const b of budsAt.get(n) || []) if (b.alive) q += b.Q;
      for (const c of n.children) if (!c.root) q += Qn.get(c) || 0;
      Qn.set(n, q);
    }
    // ---- 3. acropetal resource allocation (Borchert–Honda)
    const vin = new Map<TNode, number>();
    vin.set(sk.root, P.alpha(it) * (Qn.get(sk.root) || 0));
    for (const n of sk.preorder()) {
      const v = vin.get(n) || 0;
      if (v <= 0) continue;
      const lam = P.lambda(n, it);
      // candidates: children (continuing axis = same order, else lateral) and this node's live buds
      const items: { w: number; child?: TNode; bud?: Bud }[] = [];
      for (const c of n.children) { if (c.root) continue; const q = Qn.get(c) || 0; items.push({ w: (c.order === n.order ? lam : 1 - lam) * q, child: c }); }
      for (const b of budsAt.get(n) || []) if (b.alive) items.push({ w: (b.terminal ? lam : 1 - lam) * b.Q, bud: b });
      const W = items.reduce((a, x) => a + x.w, 0);
      if (W <= 0) continue;
      for (const x of items) { const share = v * x.w / W; if (x.child) vin.set(x.child, share); else x.bud!.v = share; }
    }
    // ---- 4. shoot growth
    let grown = 0;
    const current = buds.filter((b) => b.alive);
    for (const b of current) {
      if (!b.terminal && it - b.born > P.budLife) { b.alive = false; continue; } // old dormant buds lose vigour
      const n = Math.min(P.maxMetamers, Math.floor(b.v));
      if (n <= 0) { b.idle++; continue; }
      const w = P.weights(b, it);
      let dir = b.dir, node = b.node;
      const order = b.terminal ? node.order : node.order + 1;
      const fd = freeDir.get(b) || dir;
      for (let k = 0; k < n; k++) {
        const nd = norm(add(add(mul(dir, w.prev), mul(fd, w.free)), w.tropism));
        // wood cannot turn sharply in one internode: limit the turn per metamer (no hooks or loops)
        const c = dot(nd, dir);
        dir = c >= Math.cos(P.maxTurn ?? 0.45) ? nd : norm(add(mul(dir, 1), mul(norm(sub(nd, mul(dir, c))), Math.tan(P.maxTurn ?? 0.45))));
        const L = P.metamer(b, it);
        const nn = sk.add(node, add(node.p, mul(dir, L)), order);
        // a lateral bud at every new node, spiral phyllotaxis
        phyllo += 2.39996;
        const side = rotate(perp(dir), dir, phyllo);
        const a = P.branchAngle(b);
        addBud(nn, norm(add(mul(dir, Math.cos(a)), mul(side, Math.sin(a)))), false, it);
        node = nn; grown++;
      }
      // the bud moves to the new tip (terminal) or becomes the base of a new branch (lateral)
      b.alive = false;
      addBud(node, dir, true, it);
    }
    grownTotal += grown;
    // ---- 5. shedding: branches whose light no longer pays for their size
    const count = new Map<TNode, number>();
    for (const n of post) { let c = 1; for (const ch of n.children) c += count.get(ch) || 0; count.set(n, c); }
    const shedList: TNode[] = [];
    for (const n of sk.nodes) {
      if (!n.parent || n.root || n.order === 0 || n.parent.order === n.order) continue; // only lateral branch bases
      const c = count.get(n) || 1;
      if (c < 6) continue;
      if ((Qn.get(n) || 0) / c < P.shedRatio && it > 4) { if (!P.shed || P.shed(n, it)) shedList.push(n); }
    }
    if (shedList.length) {
      const kill = new Set<TNode>(); for (const n of shedList) { kill.add(n); for (const d of sk.descendants(n)) kill.add(d); }
      for (const b of buds) if (kill.has(b.node)) b.alive = false;
      sk.removeMany(shedList.filter((n) => !n.dead));
      shedCount += shedList.length;
    }
    { const alive = new Set(sk.nodes); for (const b of buds) if (b.alive && !alive.has(b.node)) b.alive = false; }
    if (P.event) P.event(it, sk, buds);
    // compact the bud list
    for (let i = buds.length - 1; i >= 0; i--) if (!buds[i].alive && buds[i].terminal === false && it - buds[i].born > P.budLife + 2) buds.splice(i, 1);
    budsAt.clear(); for (const b of buds) if (b.alive) { let l = budsAt.get(b.node); if (!l) budsAt.set(b.node, (l = [])); l.push(b); }
    if (!grown && it > 5) break;
  }
  return { buds, stats: { shed: shedCount, metamers: grownTotal } };
}

export { len, sub, clamp };
