// Tree skeleton shared by every species: a rooted graph of nodes. Species modules grow it with their own rules;
// this module supplies what is common to all trees:
//   • pipe-model radii (da Vinci / Shinozaki): a branch's cross-section carries the sum of what it supports,
//     r_parent^n = Σ r_child^n, plus taper along unbranched lengths
//   • approximate structural mechanics: each segment bends under the moment of the mass it carries, stiffness ∝ r^4
//     (so heavy limbs sag and thin twigs droop, but a thick trunk stays straight)
//   • ageing tools: limb loss with a jagged stub, deadwood, crown thinning
//   • decomposition into branch chains (the continuation of a branch follows its thickest child) for meshing
import { type V3, add, sub, mul, norm, len, dot, cross, rotate, clamp } from './math.ts';

export interface TNode {
  id: number; p: V3; parent: TNode | null; children: TNode[];
  r: number;          // radius (m), from computeRadii
  order: number;      // 0 trunk, 1 primary limb, 2 secondary, …; roots use -1
  dead: boolean; broken: boolean; root: boolean;
  /** free per-species data */
  age: number; vigor: number;
  mass?: number;      // supported mass (kg-ish units), from mechanics
  pr?: number;        // pipe-model radius before girth scaling (broken stubs keep the value they had when they broke)
}

export class Skeleton {
  nodes: TNode[] = [];
  root: TNode;
  constructor(base: V3) { this.root = this.make(base, null, 0); }
  make(p: V3, parent: TNode | null, order: number): TNode {
    const n: TNode = { id: this.nodes.length, p, parent, children: [], r: 0, order, dead: false, broken: false, root: false, age: 0, vigor: 1 };
    this.nodes.push(n); if (parent) parent.children.push(n);
    return n;
  }
  add(parent: TNode, p: V3, order = parent.order): TNode { return this.make(p, parent, order); }

  /** Remove many subtrees in one sweep (O(n)). */
  removeMany(list: TNode[]): void {
    if (!list.length) return;
    const kill = new Set<TNode>(); const st = [...list];
    while (st.length) { const m = st.pop()!; if (kill.has(m)) continue; kill.add(m); st.push(...m.children); }
    for (const m of this.nodes) if (!kill.has(m) && m.children.some((c) => kill.has(c))) m.children = m.children.filter((c) => !kill.has(c));
    this.nodes = this.nodes.filter((m) => !kill.has(m));
    this.nodes.forEach((m, i) => { m.id = i; });
  }
  /** Remove a subtree (all descendants of n, and n itself). */
  remove(n: TNode): void {
    const kill = new Set<TNode>(); const st = [n];
    while (st.length) { const m = st.pop()!; kill.add(m); st.push(...m.children); }
    if (n.parent) n.parent.children = n.parent.children.filter((c) => c !== n);
    this.nodes = this.nodes.filter((m) => !kill.has(m));
    this.nodes.forEach((m, i) => { m.id = i; });
  }
  descendants(n: TNode): TNode[] { const out: TNode[] = []; const st = [...n.children]; while (st.length) { const m = st.pop()!; out.push(m); st.push(...m.children); } return out; }
  /** Path length from n to its farthest tip. */
  depth(n: TNode): number { let best = 0; for (const c of n.children) best = Math.max(best, len(sub(c.p, n.p)) + this.depth(c)); return best; }

  /**
   * Pipe model. tipR: radius of terminal shoots; n: exponent (2 = area-preserving, 2.5–3 thicker parents);
   * taper: radius growth per metre along unbranched stretches; rootBoost: extra thickening of the trunk base.
   */
  computeRadii(o: { tipR: number; n: number; taper: number; maxR?: number; deadTip?: number; targetBase?: number }): void {
    const post = this.postorder();
    for (const m of post) {
      if (!m.children.length) { m.r = m.broken ? Math.max(m.pr ?? m.r, o.tipR * 3) : (m.dead && o.deadTip ? o.deadTip : o.tipR); m.pr = m.r; continue; }
      let s = 0, maxc = 0;
      for (const c of m.children) { const seg = len(sub(c.p, m.p)); const rc = c.r * (1 + o.taper * seg); s += Math.pow(rc, o.n); maxc = Math.max(maxc, rc); }
      m.r = Math.max(Math.pow(s, 1 / o.n), maxc);
      if (o.maxR) m.r = Math.min(m.r, o.maxR);
      m.pr = m.r;
    }
    // old trees: scale everything above twig size so the trunk reaches its measured girth (limbs thicken too)
    const trunk = this.root.children.find((c) => !c.root);
    if (o.targetBase && trunk && trunk.r > o.tipR) {
      const K = (o.targetBase - o.tipR) / (trunk.r - o.tipR);
      for (const m of this.nodes) if (!m.root) m.r = o.tipR + (m.r - o.tipR) * K;
    }
  }

  /** Root radii: taper from startR at the trunk to a thin tip, independent of the pipe model. */
  rootRadii(startR: number, tip = 0.015): void {
    for (const c of this.root.children) {
      if (!c.root) continue;
      const chain: TNode[] = []; let m: TNode | undefined = c;
      while (m) { chain.push(m); m = m.children[0]; }
      chain.forEach((n, i) => { const s = i / Math.max(1, chain.length - 1); n.r = tip + (startR - tip) * Math.pow(1 - s, 1.6); });
    }
  }

  /**
   * Bending under self-weight. Each node's subtree is rotated down about the horizontal axis perpendicular to the
   * segment, by an angle ∝ (moment of the supported mass) / (stiffness · r^4); thin, long, horizontal branches sag
   * most. Applied from the root outwards so deflections accumulate like a real cantilever. `upturn` lets shoot
   * tips recover upwards (phototropism of live shoots).
   */
  sag(o: { stiffness: number; maxAngle: number; minOrder?: number; upturn?: number }): void {
    // supported mass and its centroid per node
    const post = this.postorder();
    const cm = new Map<TNode, V3>();
    for (const m of post) {
      let mass = 0, c: V3 = [0, 0, 0];
      for (const ch of m.children) {
        const seg = len(sub(ch.p, m.p));
        const own = Math.PI * ch.r * ch.r * seg * 900 + (ch.children.length ? 0 : 0.6); // green wood ~900 kg/m³; each shoot tip carries ~0.6 kg of foliage
        const cc = cm.get(ch)!;
        mass += own + (ch.mass || 0);
        c = add(c, add(mul(lerp3(m.p, ch.p, 0.5), own), mul(cc, ch.mass || 0)));
      }
      m.mass = mass;
      cm.set(m, mass > 0 ? mul(c, 1 / mass) : m.p);
    }
    const pre = this.preorder();
    for (const m of pre) {
      if (!m.parent || m.root || m.order < (o.minOrder ?? 1) || !m.mass) continue;
      const d = sub(m.p, m.parent.p), L = len(d); if (L < 1e-4) continue;
      const dir = mul(d, 1 / L);
      const arm = sub(cm.get(m)!, m.parent.p);
      const horiz = Math.sqrt(arm[0] * arm[0] + arm[2] * arm[2]);
      // Euler–Bernoulli: dθ = M·L / (E·I), I = π r⁴ / 4; E is an effective long-term modulus of green wood
      // (≈ 1.5 GPa including creep) times the species' stiffness factor
      const moment = (m.mass + Math.PI * m.r * m.r * L * 900) * 9.81 * horiz;
      const r = Math.max(m.r, 0.004);
      const EI = o.stiffness * 1.5e9 * Math.PI * Math.pow(r, 4) / 4;
      let ang = clamp(moment * L / EI, 0, o.maxAngle);
      if (o.upturn && !m.dead && m.children.length === 0) ang -= o.upturn;
      // axis: horizontal, perpendicular to the branch direction (rotating about it tips the branch downward)
      const ax = cross(dir, [0, 1, 0]); const al = len(ax); if (al < 1e-3) continue;
      const axis = mul(ax, 1 / al);
      const pivot = m.parent.p;
      for (const q of [m, ...this.descendants(m)]) q.p = add(pivot, rotate(sub(q.p, pivot), axis, -ang));
    }
  }

  /** Break a limb at node n (keeps n as a jagged stub end, removes everything beyond). */
  breakAt(n: TNode): void { for (const c of [...n.children]) this.remove(c); n.broken = true; n.dead = true; }
  /** Mark a subtree dead. */
  kill(n: TNode): void { n.dead = true; for (const d of this.descendants(n)) d.dead = true; }

  postorder(): TNode[] { const out: TNode[] = []; const st: [TNode, boolean][] = [[this.root, false]]; while (st.length) { const [m, done] = st.pop()!; if (done) out.push(m); else { st.push([m, true]); for (const c of m.children) st.push([c, false]); } } return out; }
  preorder(): TNode[] { const out: TNode[] = []; const st = [this.root]; while (st.length) { const m = st.pop()!; out.push(m); for (const c of m.children) st.push(c); } return out; }

  /**
   * Decompose into chains: each chain is a list of nodes; it continues through the child with the largest radius
   * (the leader), other children start new chains attached to this one.
   */
  chains(): Chain[] {
    const out: Chain[] = [];
    const walk = (start: TNode, parentChain: Chain | null) => {
      const ch: Chain = { nodes: [start], parent: parentChain, attach: start.parent, order: start.order, id: out.length };
      out.push(ch);
      let m = start;
      for (;;) {
        if (!m.children.length) break;
        let lead = m.children[0];
        for (const c of m.children) if (c.r > lead.r) lead = c;
        for (const c of m.children) if (c !== lead) walk(c, ch);
        ch.nodes.push(lead); m = lead;
      }
    };
    for (const c of this.root.children) walk(c, null);
    // the root node itself starts the trunk chain
    const trunk = out.find((c) => c.attach === this.root && !c.nodes[0].root);
    if (trunk) { trunk.nodes.unshift(this.root); trunk.attach = null; }
    return out;
  }

  stats() {
    let segs = 0, dead = 0, broken = 0, maxOrder = 0, height = 0, w = 0;
    for (const n of this.nodes) { if (n.parent) segs++; if (n.dead) dead++; if (n.broken) broken++; maxOrder = Math.max(maxOrder, n.order); height = Math.max(height, n.p[1]); w = Math.max(w, Math.hypot(n.p[0], n.p[2])); }
    return { nodes: this.nodes.length, segments: segs, dead, broken, maxOrder, height: +height.toFixed(2), crownRadius: +w.toFixed(2), baseDiameter: +(this.root.r * 2).toFixed(2) };
  }
}
export interface Chain { nodes: TNode[]; parent: Chain | null; attach: TNode | null; order: number; id: number }

const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Grow a polyline of nodes from `from` along a direction field. Helper used by all species. */
export function growChain(sk: Skeleton, from: TNode, steps: number, segLen: number, order: number, dirAt: (i: number, prevDir: V3, p: V3) => V3, init: V3): TNode[] {
  const out: TNode[] = [];
  let d = norm(init), m = from;
  for (let i = 0; i < steps; i++) { d = norm(dirAt(i, d, m.p)); const n = sk.add(m, add(m.p, mul(d, segLen)), order); out.push(n); m = n; }
  return out;
}

/**
 * Exposed roots: radial roots from the trunk base that hug the ground, thin out and dive into the soil.
 * They are part of the skeleton (root = true, order −1), so radii come from the pipe model too.
 */
export function growRoots(sk: Skeleton, o: { count: number; length: [number, number]; seed: () => number; ground: (x: number, z: number) => number; startR: number; exposure: number }): void {
  const r = o.seed;
  for (let i = 0; i < o.count; i++) {
    const a = (i / o.count) * Math.PI * 2 + (r() - 0.5) * 0.7;
    let dx = Math.cos(a), dz = Math.sin(a);
    const L = o.length[0] + (o.length[1] - o.length[0]) * r();
    let m = sk.root, x = 0, z = 0;
    const segs = Math.max(6, Math.round(L / 0.35));
    for (let k = 1; k <= segs; k++) {
      const s = k / segs;
      dx += (r() - 0.5) * 0.35; dz += (r() - 0.5) * 0.35; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
      const step = L / segs;
      x += dx * step; z += dz * step;
      // radius falls quickly; the root rides at the surface (half buried), then dives
      const hump = o.exposure * Math.sin(Math.PI * Math.min(1, s * 1.3)) * o.startR * (1 - s) * 0.8;
      const y = o.ground(x, z) + hump - s * s * o.startR * 1.4 - 0.05;
      const n = sk.add(m, [x, y, z], -1); n.root = true; m = n;
    }
  }
}

export function dirTo(a: V3, b: V3): V3 { return norm(sub(b, a)); }
export { dot };
