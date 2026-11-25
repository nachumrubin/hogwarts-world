// TREE C — mature silver birch (Betula pendula), 80–120 years in character.
//
// Growth model: tropism-driven axes with an explicit weeping twig layer (different from both the oak's space
// colonization and the pine's shoot simulation).
//   • A slender, gently S-curved stem keeps its leader almost to the top (narrow, oval crown).
//   • Primary branches leave the stem in a spiral (137.5°) at steep angles (35–55° from vertical), then arch
//     outwards: positive gravitropism grows with distance from the stem, so each primary is an arc.
//   • Secondaries leave the primaries on the outer side of the arc and droop further.
//   • Pendulous twigs (the "pendula"): long, thin, nearly vertical strands hanging from the secondaries, in
//     curtains. These carry the leaves later.
//   • Light: crowded primaries (too close to a neighbour in azimuth and height) are suppressed; the lowest die and
//     break off (old birches shed lower limbs), a few upper limbs are dead or snapped; crown density is uneven.
import { type V3, add, sub, mul, norm, len, rotate, rng, noise3, groundAt, clamp, smooth, perp, cross } from '../framework/math.ts';
import { Skeleton, type TNode, growRoots } from '../framework/skeleton.ts';

export const BIRCH = { name: 'Mature silver birch', latin: 'Betula pendula', seed: 1903, height: 21, baseRadius: 0.3, crownR: 5.6 };

export function growBirch(seed = BIRCH.seed): { sk: Skeleton; info: Record<string, unknown> } {
  const r = rng(seed);
  const sk = new Skeleton([0, -0.5, 0]);
  const t0 = performance.now();
  const H = BIRCH.height;
  // ---- stem: S-curve and lean (birches lean towards light), leader to the top
  const stem: TNode[] = [];
  let m = sk.root;
  const seg = 0.4, n = Math.round((H + 0.5) / seg);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const d: V3 = norm([0.06 + 0.07 * Math.sin(t * 5.2 + 0.4), 1, -0.03 + 0.06 * Math.sin(t * 3.7 + 1.9)]);
    m = sk.add(m, add(m.p, mul(d, seg)), 0); stem.push(m);
  }
  // ---- primaries: spiral, steep, arching
  const prims: { node: TNode; az: number; h: number; L: number }[] = [];
  let az = r() * 6.283;
  for (let i = Math.round(n * 0.2); i < n - 2; i++) {
    if (r() < 0.25) continue;
    az += 2.39996 + (r() - 0.5) * 0.4;
    const hn = (stem[i].p[1] - H * 0.2) / (H * 0.8);
    // narrow oval envelope, widest at 40 % of the crown
    const L = BIRCH.crownR * 1.25 * Math.pow(Math.sin(Math.PI * clamp(hn * 0.85 + 0.12, 0, 1)), 0.75) * (0.7 + 0.5 * r());
    if (L < 0.8) continue;
    // crowding: suppress a primary right above another at a similar azimuth (light competition)
    const crowded = prims.some((p) => Math.abs(p.h - stem[i].p[1]) < 1.2 && Math.abs(Math.atan2(Math.sin(p.az - az), Math.cos(p.az - az))) < 0.7);
    prims.push({ node: stem[i], az, h: stem[i].p[1], L: crowded ? L * 0.45 : L });
  }
  const primChains: TNode[][] = [];
  for (const p of prims) {
    const steep = 0.55 + 0.35 * r(); // angle from vertical (rad): 30–50°
    let d: V3 = norm([Math.cos(p.az) * Math.sin(steep), Math.cos(steep), Math.sin(p.az) * Math.sin(steep)]);
    const steps = Math.max(3, Math.round(p.L / 0.35));
    let q = p.node; const chain: TNode[] = [];
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      // arching: gravitropism increases along the branch; slight wander
      d = norm(add(d, [(r() - 0.5) * 0.08, -0.045 - 0.11 * t * t, (r() - 0.5) * 0.08]));
      q = sk.add(q, add(q.p, mul(d, p.L / steps)), 1); chain.push(q);
    }
    primChains.push(chain);
    // ---- secondaries on the outer side, drooping further; pendulous twigs hang from them
    for (let k = 2; k < chain.length - 1; k++) {
      if (r() < 0.35) continue;
      const base = chain[k];
      const pd = norm(sub(chain[k + 1].p, base.p));
      const side = rotate(perp(pd), pd, r() * 6.283);
      let d2 = norm(add(mul(pd, 0.6), mul(side, 0.8)));
      d2 = norm(add(d2, [0, -0.2, 0]));
      const L2 = (p.L * (1 - k / chain.length)) * (0.35 + 0.35 * r()) + 0.4;
      const st2 = Math.max(2, Math.round(L2 / 0.3));
      let s2 = base; const c2: TNode[] = [];
      for (let j = 0; j < st2; j++) {
        d2 = norm(add(d2, [(r() - 0.5) * 0.1, -0.12 - 0.1 * (j / st2), (r() - 0.5) * 0.1]));
        s2 = sk.add(s2, add(s2.p, mul(d2, L2 / st2)), 2); c2.push(s2);
      }
      // pendulous twigs
      for (const tn of [...c2, chain[k]]) {
        const nt = r() < 0.75 ? 1 + Math.floor(r() * 2) : 0;
        for (let w = 0; w < nt; w++) {
          let d3 = norm([(r() - 0.5) * 0.9, -0.25, (r() - 0.5) * 0.9]);
          const L3 = 0.7 + 1.9 * r() * (tn.p[1] > 8 ? 1 : 0.6);
          const st3 = Math.max(3, Math.round(L3 / 0.22));
          let s3 = tn;
          for (let j = 0; j < st3; j++) {
            d3 = norm(add(d3, [0, -0.45, 0]));
            s3 = sk.add(s3, add(s3.p, mul(d3, L3 / st3)), 3);
          }
        }
      }
    }
  }
  const growMs = performance.now() - t0;
  sk.computeRadii({ tipR: 0.0035, n: 2.2, taper: 0.012, targetBase: BIRCH.baseRadius });
  sk.sag({ stiffness: 0.6, maxAngle: 0.08, minOrder: 1, upturn: 0 });
  // ---- age: the lowest primaries die and snap, a couple of upper ones are dead; crown thinned unevenly
  const sorted = prims.map((p, i) => ({ ...p, chain: primChains[i] })).sort((a, b) => a.h - b.h);
  let lostLow = 0;
  for (const p of sorted.slice(0, 5)) {
    if (!sk.nodes.includes(p.chain[0])) continue;
    const cut = p.chain[Math.min(p.chain.length - 1, 1 + Math.floor(r() * 3))];
    sk.breakAt(cut); sk.kill(p.chain[0]); lostLow++;
  }
  for (const p of sorted.slice(8)) if (r() < 0.08 && sk.nodes.includes(p.chain[0])) sk.kill(p.chain[0]);
  // uneven foliage carriers: thin out pendulous twigs in patches (a 3D noise field over the crown)
  for (const nn of [...sk.nodes]) {
    if (!sk.nodes.includes(nn) || nn.order !== 3 || !nn.parent || nn.parent.order === 3) continue;
    if (noise3(nn.p[0] * 0.35, nn.p[1] * 0.35, nn.p[2] * 0.35, 5) > 0.25) sk.remove(nn);
  }
  for (const nn of [...sk.nodes]) if (sk.nodes.includes(nn) && nn.dead && !nn.broken && !nn.children.length && nn.order >= 2) sk.remove(nn);
  growRoots(sk, { count: 5, length: [1.0, 2.0], seed: r, ground: groundAt, startR: 0.14, exposure: 0.4 });
  sk.computeRadii({ tipR: 0.0035, n: 2.2, taper: 0.012, targetBase: BIRCH.baseRadius });
  sk.rootRadii(0.13, 0.015);
  sk.root.r = BIRCH.baseRadius * 1.25;
  const events = [`${prims.length} arching primaries`, `${lostLow} low limbs lost (broken stubs)`];
  return { sk, info: { growMs: Math.round(growMs), primaries: prims.length, lowLimbsLost: lostLow, events, ...sk.stats() } };
}

/** Birch bark: smooth papery upper stem with horizontal lenticel grooves; rough, dark fissured base. */
export function birchBark(p: V3, axis: V3, r: number): number {
  const a = Math.atan2(p[2], p[0]);
  const base = 1 - smooth(0.4, 2.6, p[1]);
  const fiss = Math.pow(1 - Math.abs(noise3(a * r * 10, p[1] * 2.2, 1, 31)), 4) - 0.35;
  const lent = Math.pow(Math.max(0, noise3(a * r * 6, p[1] * 26, 2, 32)), 3);
  return clamp(r, 0.02, 0.5) * (base * 0.09 * fiss - (1 - base) * 0.012 * lent);
}
