// TREE B — ancient veteran pedunculate oak (Quercus robur), 400–600 years in character.
//
// Growth model: space colonization (Runions, Lane & Prusinkiewicz 2007) seeded with the oak's actual architecture.
//   1. A short, thick, twisting bole forks low (≈ 4 m) into five enormous primary limbs; the limbs are grown first
//      as curved axes that spread almost horizontally — the oak's open-grown, light-demanding habit.
//   2. Attraction points fill an irregular, lobed crown envelope biased to its outer shell (leaves where the light
//      is) with real gaps carved out; every live limb then competes for them (competition for light and space).
//      The trunk itself does not sprout, so the crown is built from the limbs outwards, not as a central bush.
//   3. Pipe-model radii scaled to a 2.2 m girth; branches then sag under their own weight (stiffness ∝ r⁴).
//   4. Ageing: one primary limb lost to a storm (a jagged stub left), a dead stag-headed top, dead and thinned
//      interior branches, a hollow at the base (meshed by the SDF trunk), buttress roots.
import { type V3, add, sub, mul, norm, len, dot, rng, noise3, groundAt, clamp, smooth } from '../framework/math.ts';
import { Skeleton, type TNode, growRoots } from '../framework/skeleton.ts';
import { growSOTM } from '../framework/sotm.ts';

export const OAK = { name: 'Ancient veteran oak', latin: 'Quercus robur', seed: 1603, targetHeight: 21, crownRadius: 13, baseRadius: 1.1 };

export function growOak(seed = OAK.seed): { sk: Skeleton; info: Record<string, unknown> } {
  const r = rng(seed);
  const sk = new Skeleton([0, -0.6, 0]);
  const t0 = performance.now();
  const start = sk.add(sk.root, [0, 0.0, 0], 0);
  const events: string[] = [];
  let stormNode: TNode | null = null;
  const res = growSOTM(sk, start, [0.03, 1, -0.02], {
    iterations: 62, voxel: 0.55, extent: [16.5, 24, 16.5],
    shadowA: 0.2, shadowB: 1.7, shadowDepth: 7,
    alpha: (it) => (it < 10 ? 2.4 : 2.0),
    // strong apical control while the stem forms; weak afterwards: the oak's crown divides into co-dominant limbs
    lambda: (n, it) => (it < 9 || (n.order === 0 && n.p[1] < 3.2) ? 0.7 : n.order === 0 ? 0.45 : 0.52),
    metamer: (b, it) => Math.max(0.28, 0.56 - 0.0045 * it) * (b.node.order === 0 && b.node.p[1] < 4 ? 1.1 : 1),
    maxMetamers: 3,
    weights: (b, it) => {
      const o = b.terminal ? b.node.order : b.node.order + 1;
      if (o === 0) return { prev: 1, free: b.node.p[1] < 3.5 ? 0.1 : 0.35, tropism: [0, b.node.p[1] < 3.5 ? 0.9 : 0.15, 0] };
      // plagiotropic limbs: long, nearly horizontal stretches (stronger on the heavy, low, old limbs); twigs turn up
      const h: V3 = [b.dir[0], 0, b.dir[2]]; const hl = Math.hypot(h[0], h[2]) || 1;
      const flat = o <= 2 ? (b.node.p[1] < 9 ? 0.36 : 0.2) : 0.06;
      return { prev: 1, free: 0.4, tropism: add(mul([h[0] / hl, 0, h[2] / hl], flat), [0, o <= 2 ? -0.02 : 0.1, 0]) };
    },
    branchAngle: (b) => 0.85 + 0.35 * r(),
    shedRatio: 0.035, budLife: 3, maxTurn: 0.45,
    // youth: shaded by its own crown and neighbours below 3 m (clear bole); old age: hydraulic height limit
    lightCap: (p, b) => (p[1] < 3.2 && !(b.terminal && b.node.order === 0) ? 0.25 : 1) * (1 - 0.75 * smooth(15.5, 21.5, p[1])),
    event: (it, sk2, buds) => {
      if (it === 44) {
        // storm: the heaviest low limb snaps 40 % along its length; the crown regrows around the gap
        let best: TNode | null = null, bm = 0;
        for (const n of sk2.nodes) if (n.order === 1 && n.parent && n.parent.order === 0 && n.p[1] < 8) { const m = sk2.descendants(n).length; if (m > bm) { bm = m; best = n; } }
        if (best) {
          let m: TNode = best; let k = 0; while (m.children.length && k < 8) { m = m.children.find((c) => c.order === m.order) || m.children[0]; k++; }
          sk2.breakAt(m); stormNode = m; events.push(`storm at period ${it}: limb lost at ${m.p[1].toFixed(1)} m`);
          const alive = new Set(sk2.nodes); for (const b of buds) if (!alive.has(b.node)) b.alive = false;
        }
      }
      if (it === 54) {
        // dieback (root loss in old age): the topmost shoots die and stay as stag-headed deadwood
        const maxY = Math.max(...sk2.nodes.map((n) => n.p[1]));
        let k = 0;
        for (const n of sk2.nodes) if (n.order >= 2 && n.p[1] > maxY - 3 && n.parent && n.parent.order < n.order && sk2.descendants(n).length < 90 && r() < 0.6 && k < 9) { sk2.kill(n); k++; }
        const dead = new Set(sk2.nodes.filter((n) => n.dead)); for (const b of buds) if (dead.has(b.node)) b.alive = false;
        events.push(`dieback at period ${it}: ${k} top branches`);
      }
    },
    shed: (n) => !(n.order === 1 && n.p[1] > 3.5 && r() < 0.3), // some shed limbs persist as dead stubs (handled below)
  }, r);
  const growMs = performance.now() - t0;
  sk.computeRadii({ tipR: 0.006, n: 2.6, taper: 0.03, targetBase: OAK.baseRadius });
  sk.sag({ stiffness: 1.0, maxAngle: 0.04, minOrder: 1, upturn: 0.005 });
  // a few interior secondary branches die in the shade of the outer crown (they keep their wood for decades)
  const inner = sk.nodes.filter((n) => n.order === 3 && n.parent && n.parent.order === 2 && Math.hypot(n.p[0], n.p[2]) < 7 && n.p[1] < 12 && n.children.length);
  for (const n of inner) if (r() < 0.08) sk.kill(n);
  // dead wood sheds its finest twigs first
  sk.removeMany(sk.nodes.filter((n) => n.dead && !n.children.length && n.r < 0.01 && !n.broken && r() < 0.7));
  growRoots(sk, { count: 9, length: [2.8, 5.5], seed: r, ground: groundAt, startR: 0.5, exposure: 1.0 });
  sk.computeRadii({ tipR: 0.006, n: 2.6, taper: 0.03, targetBase: OAK.baseRadius });
  sk.rootRadii(0.5, 0.02);
  sk.root.r = OAK.baseRadius * 1.12;
  void stormNode;
  return { sk, info: { growMs: Math.round(growMs), ...res.stats, events, ...sk.stats() } };
}

/** Oak bark: deep, blocky vertical fissures, ridged; amplitude grows with girth. */
export function oakBark(p: V3, axis: V3, r: number): number {
  const up = Math.abs(axis[1]);
  const a = Math.atan2(p[2], p[0]);
  // fissures run along the branch axis: stretch the noise along it
  const s = 3.2 / Math.max(0.25, Math.min(r, 1.2));
  const along = p[1] * up + (p[0] * axis[0] + p[2] * axis[2]) * (1 - up);
  const ridge = 1 - Math.abs(noise3(a * r * s * 1.1, along * 0.9, r * 3, 11));
  const plates = noise3(a * r * 9, along * 4.5, 0, 12) * 0.25;
  return clamp(r, 0.03, 1.5) * 0.065 * (Math.pow(ridge, 3) - 0.35 + plates);
}
