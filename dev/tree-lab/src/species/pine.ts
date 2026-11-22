// TREE A — ancient Scots pine (Pinus sylvestris), 250–350 years in character.
//
// Growth model: a shoot-by-shoot simulation in growth periods (≈ 6 years each), not a recursive fractal.
//   • Apical control: the leader extends fast while young, then slows; each period it lays down a whorl of 3–5
//     laterals. Laterals extend nearly horizontally and fork into flat sprays (Scots pine's planar branch habit).
//   • Light competition: live shoot tips shade each other through a coarse voxel grid; a shoot's vigour is the
//     light reaching it. Shaded shoots slow, then die; lower branches die in turn and are shed, leaving dead stubs
//     on the bole (self-pruning) and a clear stem.
//   • Old age: after ≈ 150 years the leader all but stops; upper laterals turn upwards and compete — the flat,
//     multi-leadered, umbrella crown of old Caledonian pines. Wind from the south-west suppresses windward growth
//     and bends shoots leeward (crown asymmetry). Occasional leader loss leaves a kink in the stem.
//   • Pipe-model radii scaled to the measured girth, sag under self-weight, lower branches broken.
import { type V3, add, sub, mul, norm, len, rotate, rng, noise3, groundAt, clamp, smooth } from '../framework/math.ts';
import { Skeleton, type TNode, growRoots } from '../framework/skeleton.ts';

export const PINE = { name: 'Ancient Scots pine', latin: 'Pinus sylvestris', seed: 1714, baseRadius: 0.62 };

interface Shoot { node: TNode; dir: V3; order: number; age: number; vigor: number; shaded: number; alive: boolean; leader: boolean; born: number; dom?: boolean; vig?: number }

export function growPine(seed = PINE.seed): { sk: Skeleton; info: Record<string, unknown> } {
  const r = rng(seed);
  const sk = new Skeleton([0, -0.6, 0]);
  const t0 = performance.now();
  const PERIODS = 50; // × ~6 years ≈ 300 years
  const wind: V3 = norm([0.75, 0, 0.66]); // prevailing wind blows towards the north-east (from the south-west)
  const shoots: Shoot[] = [];
  let leaderDir: V3 = [0, 1, 0];
  const root2 = sk.add(sk.root, [0, 0, 0], 0);
  shoots.push({ node: root2, dir: leaderDir, order: 0, age: 0, vigor: 1, shaded: 0, alive: true, leader: true, born: 0 });
  const VOX = 1.2;
  let leaderLosses = 0, domCount = 0;
  for (let t = 0; t < PERIODS; t++) {
    // light: count live tips per voxel, then shade = sum of tips above within a widening cone
    const grid = new Map<string, number>();
    const k = (x: number, y: number, z: number) => `${x},${y},${z}`;
    for (const s of shoots) if (s.alive) { const p = s.node.p; const kk = k(Math.floor(p[0] / VOX), Math.floor(p[1] / VOX), Math.floor(p[2] / VOX)); grid.set(kk, (grid.get(kk) || 0) + 1); }
    const lightAt = (p: V3) => {
      const ix = Math.floor(p[0] / VOX), iy = Math.floor(p[1] / VOX), iz = Math.floor(p[2] / VOX);
      let sh = 0;
      for (let dy = 1; dy <= 6; dy++) { const w = Math.min(2, Math.floor(dy / 2)); for (let dx = -w; dx <= w; dx++) for (let dz = -w; dz <= w; dz++) sh += (grid.get(k(ix + dx, iy + dy, iz + dz)) || 0) / (1 + dy * 0.6); }
      return Math.exp(-0.05 * sh);
    };
    const old = t > 28;
    const next: Shoot[] = [];
    for (const s of shoots) {
      if (!s.alive) continue;
      s.age++;
      s.vigor = lightAt(s.node.p);
      if (s.vigor < 0.22) s.shaded++; else s.shaded = Math.max(0, s.shaded - 1);
      // self-pruning with age: branches laid down while young die once the crown has risen far above them
      if (!s.leader && !s.dom && s.order === 1 && t > 30 && s.node.p[1] < 11) { s.alive = false; continue; }
      if (!s.leader && !s.dom && (s.shaded > 4 || (s.order === 2 && s.age > 9) || (s.order === 3 && s.age > 4))) { s.alive = false; continue; }
      // extension
      let L: number;
      if (s.leader) L = (old ? 0.08 : 1.15 * Math.exp(-t / 13) + 0.18) * (0.85 + 0.3 * r());
      // laterals slow down as they age (and as the tree ages): old pines do not have endlessly long limbs
      // laterals slow down with age; dominant upper limbs (fed by the crown they carry) keep growing for a century
      else L = (s.order === 1 ? 0.5 : s.order === 2 ? 0.36 : 0.2) * (0.4 + 0.6 * s.vigor) * (s.vig ?? 1) * Math.exp(-s.age / (s.dom ? 19 : s.order === 1 ? 13 : 6));
      // wind: less growth on the windward side, shoots bend leeward
      const h = [s.dir[0], 0, s.dir[2]]; const hl = Math.hypot(h[0], h[2]);
      if (hl > 0.2) L *= 1 + 0.25 * (h[0] * wind[0] + h[2] * wind[2]) / hl;
      let d = s.dir;
      if (s.leader) {
        d = norm(add(d, [(r() - 0.5) * 0.22 + wind[0] * 0.02, 0.4, (r() - 0.5) * 0.22 + wind[2] * 0.02]));
        if (!old && r() < 0.035) { // leader lost (weevil, storm): a lateral takes over at an angle → kink in the stem
          d = norm(add(d, [(r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5])); leaderLosses++;
        }
      } else {
        // laterals: near horizontal, tips turning up towards light; old upper laterals rise to form the flat crown
        const up = s.dom ? (s.age > 12 ? 0.06 : 0.02) : s.order === 1 && old && s.node.p[1] > 13 ? 0.09 : 0.03 * s.vigor;
        d = norm(add(d, [(r() - 0.5) * 0.25 + wind[0] * 0.04, up - 0.02 * s.order, (r() - 0.5) * 0.25 + wind[2] * 0.04]));
      }
      s.dir = d;
      const nn = sk.add(s.node, add(s.node.p, mul(d, Math.max(0.05, L))), s.order);
      s.node = nn;
      // branching
      if (s.leader && (!old || r() < 0.5)) {
        // irregular whorls: 2–5 laterals, sometimes a whole whorl missing (frost, browsing)
        if (r() < 0.22) { /* skipped whorl */ } else {
        const nw = 2 + Math.floor(r() * 4), a0 = r() * 6.283;
        for (let i = 0; i < nw; i++) {
          if (r() < 0.2) continue;
          const az = a0 + (i / nw) * 6.283 + (r() - 0.5) * 0.5;
          const el = 0.18 - t * 0.008 + (r() - 0.5) * 0.25; // lower whorls (laid down early) end up drooping
          // dominant limbs: a few laterals laid down in the upper stem when the tree was 100–170 years old
          const dom = t >= 14 && t <= 28 && r() < 0.28 && domCount < 6;
          if (dom) domCount++;
          next.push({ node: nn, dir: norm([Math.cos(az), dom ? 0.12 : el, Math.sin(az)]), order: 1, age: 0, vigor: 1, shaded: 0, alive: true, leader: false, born: t, dom, vig: dom ? 1.05 : 0.5 + 0.7 * r() });
        }
        }
      } else if (!s.leader && s.order < 3 && r() < (s.order === 1 ? 0.85 : 0.55)) {
        // planar sprays: forks to either side in the branch plane
        const side = norm([-d[2], 0, d[0]]);
        const nf = s.order === 1 ? 2 : 1;
        for (let i = 0; i < nf; i++) {
          const sg = i === 0 ? 1 : -1;
          next.push({ node: nn, dir: norm(add(add(mul(d, 0.65), mul(side, sg * (0.7 + 0.3 * r()))), [0, (r() - 0.4) * 0.5, 0])), order: s.order + 1, age: 0, vigor: s.vigor, shaded: 0, alive: true, leader: false, born: t, vig: 0.7 + 0.6 * r() });
        }
      }
      if (old && s.leader && r() < 0.15) s.alive = false; // the old leader dies back
    }
    shoots.push(...next);
  }
  const growMs = performance.now() - t0;
  // ---- radii, sag
  sk.computeRadii({ tipR: 0.006, n: 2.75, taper: 0.03, targetBase: PINE.baseRadius });
  sk.sag({ stiffness: 1.6, maxAngle: 0.025, minOrder: 1, upturn: 0.01 });
  // ---- self-pruning: branches whose every tip is dead are dead wood; the lowest are shed, leaving stubs
  const liveTips = new Set<TNode>();
  for (const s of shoots) if (s.alive) liveTips.add(s.node);
  const hasLive = new Map<TNode, boolean>();
  for (const n of sk.postorder()) hasLive.set(n, liveTips.has(n) || n.children.some((c) => hasLive.get(c)));
  for (const n of sk.nodes) if (!hasLive.get(n) && n.order >= 1) n.dead = true;
  // primaries (order 1 first nodes): dead ones low on the stem are broken off as stubs, some are shed entirely
  const primaries = sk.nodes.filter((n) => n.order === 1 && n.parent && n.parent.order === 0);
  const shed: TNode[] = [];
  for (const p of primaries) {
    if (!p.dead) continue;
    const h = p.p[1];
    // the lowest few metres were cleared long ago (occluded knots); higher up: a mix of long dead branches still
    // carrying their twigs, snapped stubs of every length, and bare knots
    if (h < 4 || r() < (h < 8 ? 0.6 : 0.35)) { shed.push(p); continue; }
    const q = r();
    let m: TNode = p;
    if (q < 0.25) continue; // whole dead branch still attached
    const keep = q < 0.6 ? 1 + Math.floor(r() * 2) : 2 + Math.floor(r() * 5);
    for (let i = 0; i < keep && m.children.length; i++) m = m.children.find((c) => c.order === 1) || m.children[0];
    shed.push(...m.children); m.broken = true;
  }
  sk.removeMany(shed);
  // dead twigs and sprays drop off live branches; dead side shoots inside the crown mostly gone
  sk.removeMany(sk.nodes.filter((n) => n.dead && n.order >= 2 && n.parent && !n.parent.dead && r() < 0.85));
  sk.removeMany(sk.nodes.filter((n) => n.dead && n.order >= 2 && n.parent && n.parent.dead && n.parent.order < n.order));
  growRoots(sk, { count: 6, length: [1.8, 3.5], seed: r, ground: groundAt, startR: 0.32, exposure: 0.6 });
  sk.computeRadii({ tipR: 0.006, n: 2.75, taper: 0.03, targetBase: PINE.baseRadius });
  sk.rootRadii(0.3, 0.02);
  sk.root.r = PINE.baseRadius * 1.1;
  return { sk, info: { growMs: Math.round(growMs), periods: PERIODS, leaderLosses, ...sk.stats() } };
}

/** Scots pine bark: deep fissures between thick plates at the base, thin papery flakes up the stem. */
export function pineBark(p: V3, axis: V3, r: number): number {
  const a = Math.atan2(p[2], p[0]);
  const upper = smooth(5, 11, p[1]);
  const s = 2.6 / Math.max(0.2, Math.min(r, 1));
  const plates = 1 - Math.abs(noise3(a * r * s, p[1] * 1.6, 3, 21));
  const deep = Math.pow(plates, 4) - 0.4;
  const flakes = noise3(a * r * 14, p[1] * 7, 5, 22) * 0.4;
  return clamp(r, 0.03, 1) * ((1 - upper) * 0.075 * deep + upper * 0.012 * flakes);
}
