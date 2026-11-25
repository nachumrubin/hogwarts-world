// Pedunculate oak (Quercus robur) — one growth algorithm, several growth histories.
//
// Growth model: self-organizing tree growth (framework/sotm.ts) — buds compete for light in a shadow-propagation
// voxel grid, resource is allocated basipetally/acropetally with apical control (Borchert–Honda), branches that no
// longer pay for themselves are shed, and history events (storms, dieback) happen between growth periods.
// What makes one oak different from another is its *environment and history*, expressed in an OakConfig:
//   • open-grown (Oak A "Survivor", Oak B "Ancient Guardian"): light from everywhere, low clear bole, weak apical
//     control once the stem has formed → a broad crown of co-dominant, plagiotropic limbs;
//   • forest-grown (Oak C "Forest Veteran"): neighbours' canopies shade the sides and the lower trunk, so light
//     comes from above; strong apical control → tall clear stem, high narrow crown, irregular top.
// Afterwards: pipe-model radii scaled to the measured girth, self-weight sag, interior shade death, root flare.
import { type V3, add, mul, rng, noise3, fbm3, groundAt, clamp, smooth, barkSample } from '../framework/math.ts';
import { Skeleton, type TNode, growRoots } from '../framework/skeleton.ts';
import { growSOTM } from '../framework/sotm.ts';

export const OAK = { name: 'Ancient veteran oak', latin: 'Quercus robur', seed: 1603, targetHeight: 21, crownRadius: 13, baseRadius: 1.1 };

export interface OakEvent {
  /** storm: the heaviest low limb snaps `depth` nodes out; dieback: up to `count` top shoots die (stag-head);
   *  crownLoss: the young leader snaps at height `maxY` (lightning/wind), the limbs below take over. */
  kind: 'storm' | 'dieback' | 'crownLoss';
  at: number; maxY?: number; depth?: number; count?: number;
}
export interface OakConfig {
  seed: number;
  iterations: number; extent: [number, number, number]; voxel: number;
  shadowA: number; shadowB: number; shadowDepth: number;
  alphaYoung: number; alphaOld: number;
  /** apical control: [while the stem forms, stem afterwards, limbs]; the stem forms below `boleHeight` */
  lambda: [number, number, number]; youth: number; boleHeight: number;
  metamer: [number, number]; // initial length, decline per period
  /** horizontal pull on structural limbs: [below 9 m, above] ; twig up-turn */
  flat: [number, number]; twigUp: number; free: number;
  branchAngle: [number, number];
  shedRatio: number; budLife: number; maxTurn: number;
  /** light at the clear bole for non-leader buds, hydraulic height limit [start, end] and the share it removes */
  boleLight: number; heightLimit: [number, number, number];
  /** forest-grown: neighbours' canopy shades everything below `canopyBase` (light from above only); horizontal
   *  space limited to `room` m from the stem (beyond it light fades over 2 m) */
  forest?: { canopyBase: number; understorey: number; room: number };
  events: OakEvent[];
  baseRadius: number; radiusExp: number;
  sag: number; interiorDeath: number;
  roots: { count: number; length: [number, number]; startR: number; exposure: number };
  /** optional: fair the main stem above this height too (loops in a tall leader); die back any bare, unbranched
   *  shoot run longer than `whipLimit` m (shade-starved whips). Absent on Oak A (preserved checkpoint behaviour). */
  stemFairAbove?: number; whipLimit?: number;
  /** optional growth-model terms (absent on Oak A):
   *  outward — pull of secondary and finer shoots away from the stem axis (outward and oblique growth instead of
   *    a uniform up-turn); crownLobes — [m, wavelength m]: the hydraulic height limit varies over the crown with
   *    low-frequency noise (an uneven crown boundary instead of a flat ceiling); stemSway — [weight, wavelength m]:
   *    low-frequency lateral pull on the leader (trunk curvature, e.g. reaching for the gap); wander — deterministic
   *    position-noise pull on limbs (meander instead of dead-straight runs); lowDroop — shaded limbs below the
   *    canopy base sag before turning up. */
  outward?: number; crownLobes?: [number, number]; stemSway?: [number, number]; wander?: number; lowDroop?: number;
  /** structural fairing iterations (default 6) */
  fairIterations?: number;
}

/** Oak A — Survivor. The structural checkpoint 9c024fe (seed 1603): open-grown, storm-damaged, one-sided. */
export const OAK_A: OakConfig = {
  seed: 1603, iterations: 62, extent: [16.5, 24, 16.5], voxel: 0.55, shadowA: 0.2, shadowB: 1.7, shadowDepth: 7,
  alphaYoung: 2.4, alphaOld: 2.0, lambda: [0.7, 0.45, 0.52], youth: 9, boleHeight: 3.2, metamer: [0.56, 0.0045],
  flat: [0.36, 0.2], twigUp: 0.1, free: 0.4, branchAngle: [0.85, 0.35], shedRatio: 0.035, budLife: 3, maxTurn: 0.45,
  boleLight: 0.25, heightLimit: [15.5, 21.5, 0.75],
  events: [{ kind: 'storm', at: 44, maxY: 8, depth: 8 }, { kind: 'dieback', at: 54, count: 9 }],
  baseRadius: 1.1, radiusExp: 2.6, sag: 1.0, interiorDeath: 0.08,
  roots: { count: 9, length: [2.8, 5.5], startR: 0.5, exposure: 1.0 },
};

/** Oak B — Ancient Guardian. Open parkland, never lost a major limb; an old crown loss at the top made it
 *  spread rather than climb; slower height growth and a wider bole. */
export const OAK_B: OakConfig = {
  seed: 2206, iterations: 72, extent: [17, 22, 17], voxel: 0.55, shadowA: 0.2, shadowB: 1.75, shadowDepth: 7,
  alphaYoung: 2.4, alphaOld: 2.05, lambda: [0.68, 0.42, 0.5], youth: 8, boleHeight: 3.0, metamer: [0.55, 0.0042],
  flat: [0.62, 0.36], twigUp: 0.03, free: 0.3, branchAngle: [1.05, 0.3], shedRatio: 0.032, budLife: 3, maxTurn: 0.32,
  boleLight: 0.25, heightLimit: [15.5, 21, 0.8],
  events: [{ kind: 'crownLoss', at: 18, maxY: 6.5 }, { kind: 'dieback', at: 60, count: 5 }],
  baseRadius: 1.15, radiusExp: 2.6, sag: 1.0, interiorDeath: 0.06,
  roots: { count: 10, length: [3.2, 6.0], startR: 0.55, exposure: 1.1 }, whipLimit: 3,
  outward: 0.14, crownLobes: [2.6, 7], wander: 0.08, fairIterations: 14,
};

/** Oak C — Forest Veteran. Grew up in closed woodland: shaded sides, light from above, competition for the gap. */
export const OAK_C: OakConfig = {
  seed: 3119, iterations: 72, extent: [10, 30, 10], voxel: 0.5, shadowA: 0.2, shadowB: 1.7, shadowDepth: 7,
  alphaYoung: 2.5, alphaOld: 2.4, lambda: [0.74, 0.6, 0.44], youth: 16, boleHeight: 9, metamer: [0.6, 0.004],
  flat: [0.12, 0.08], twigUp: 0.1, free: 0.5, branchAngle: [0.7, 0.3], shedRatio: 0.038, budLife: 3, maxTurn: 0.35,
  boleLight: 0.12, heightLimit: [19, 25, 0.92],
  forest: { canopyBase: 10, understorey: 0.18, room: 7.5 },
  events: [{ kind: 'storm', at: 52, maxY: 20, depth: 5 }, { kind: 'dieback', at: 64, count: 6 }],
  baseRadius: 0.78, radiusExp: 2.6, sag: 1.1, interiorDeath: 0.12,
  roots: { count: 8, length: [2.4, 4.5], startR: 0.42, exposure: 0.8 }, stemFairAbove: 9.5, whipLimit: 2.5,
  outward: 0.06, crownLobes: [1.8, 5], stemSway: [0.16, 9], wander: 0.12, lowDroop: 0.12, fairIterations: 14,
};

export function growOak(cfg: OakConfig = OAK_A): { sk: Skeleton; info: Record<string, unknown> } {
  const r = rng(cfg.seed);
  const sk = new Skeleton([0, -0.6, 0]);
  const t0 = performance.now();
  const start = sk.add(sk.root, [0, 0.0, 0], 0);
  const events: string[] = [];
  const F = cfg.forest;
  const res = growSOTM(sk, start, [0.03, 1, -0.02], {
    iterations: cfg.iterations, voxel: cfg.voxel, extent: cfg.extent,
    shadowA: cfg.shadowA, shadowB: cfg.shadowB, shadowDepth: cfg.shadowDepth,
    alpha: (it) => (it < 10 ? cfg.alphaYoung : cfg.alphaOld),
    // strong apical control while the stem forms; afterwards the open-grown crown divides into co-dominant limbs
    lambda: (n, it) => (it < cfg.youth || (n.order === 0 && n.p[1] < cfg.boleHeight) ? cfg.lambda[0] : n.order === 0 ? cfg.lambda[1] : cfg.lambda[2]),
    metamer: (b, it) => Math.max(0.28, cfg.metamer[0] - cfg.metamer[1] * it) * (b.node.order === 0 && b.node.p[1] < cfg.boleHeight + 0.8 ? 1.1 : 1),
    maxMetamers: 3,
    weights: (b) => {
      const o = b.terminal ? b.node.order : b.node.order + 1;
      const low = b.node.p[1] < cfg.boleHeight + 0.3;
      const p = b.node.p;
      if (o === 0) {
        const trop: V3 = [0, low ? 0.9 : F ? 0.7 : 0.15, 0];
        if (cfg.stemSway && !low) {
          // low-frequency lateral pull: the stem wanders as it reaches for light (two incommensurate waves)
          // (fading out where the leader meets the height limit, so the top does not hook over)
          const [w0, L] = cfg.stemSway, w = w0 * (1 - smooth(cfg.heightLimit[0] - 4, cfg.heightLimit[0], p[1]));
          trop[0] += w * Math.sin(p[1] / L * 6.283 + 1.3); trop[2] += w * Math.sin(p[1] / (L * 1.37) * 6.283 + 4.1);
        }
        return { prev: 1, free: low ? 0.1 : F ? 0.2 : 0.35, tropism: trop };
      }
      // plagiotropic limbs: long, nearly horizontal stretches (stronger on the heavy, low, old limbs); twigs turn up
      const h: V3 = [b.dir[0], 0, b.dir[2]]; const hl = Math.hypot(h[0], h[2]) || 1;
      const flat = o <= 2 ? (p[1] < 9 ? cfg.flat[0] : cfg.flat[1]) : 0.06;
      let trop = add(mul([h[0] / hl, 0, h[2] / hl], flat), [0, o <= 2 ? -0.02 : cfg.twigUp, 0]);
      if (cfg.outward && o >= 2) { const rl = Math.hypot(p[0], p[2]) || 1; trop = add(trop, [p[0] / rl * cfg.outward, 0, p[2] / rl * cfg.outward]); }
      if (cfg.wander) trop = add(trop, mul([noise3(p[0] * 0.6, p[1] * 0.6, p[2] * 0.6, 61), noise3(p[0] * 0.6, p[1] * 0.6, p[2] * 0.6, 62) * 0.6, noise3(p[0] * 0.6, p[1] * 0.6, p[2] * 0.6, 63)], cfg.wander));
      if (cfg.lowDroop && F && o <= 2 && p[1] < F.canopyBase) trop = add(trop, [0, -cfg.lowDroop * (1 - p[1] / F.canopyBase) + cfg.lowDroop * 0.3, 0]);
      return { prev: 1, free: cfg.free, tropism: trop };
    },
    branchAngle: () => cfg.branchAngle[0] + cfg.branchAngle[1] * r(),
    shedRatio: cfg.shedRatio, budLife: cfg.budLife, maxTurn: cfg.maxTurn,
    lightCap: (p, b) => {
      // youth: shaded by its own crown below the clear bole; old age: hydraulic height limit
      const lobe = cfg.crownLobes ? cfg.crownLobes[0] * fbm3(p[0] / cfg.crownLobes[1], 0, p[2] / cfg.crownLobes[1], 64, 2) * 2 : 0;
      let L = (p[1] < cfg.boleHeight && !(b.terminal && b.node.order === 0) ? cfg.boleLight : 1) * (1 - cfg.heightLimit[2] * smooth(cfg.heightLimit[0] + lobe, cfg.heightLimit[1] + lobe, p[1]));
      if (F) {
        // neighbours: below their canopy only diffuse understorey light; sideways, the gap is only so wide
        // (the leader's tip stands in the gap's light shaft; everything else below the canopy is in shade)
        if (!(b.terminal && b.node.order === 0)) L *= F.understorey + (1 - F.understorey) * smooth(F.canopyBase - 3, F.canopyBase + 2, p[1]);
        L *= 1 - 0.85 * smooth(F.room, F.room + 2, Math.hypot(p[0], p[2]));
      }
      return L;
    },
    event: (it, sk2, buds) => {
      for (const e of cfg.events) {
        if (e.at !== it) continue;
        if (e.kind === 'storm') {
          // storm: the heaviest low limb snaps part-way along its length; the crown regrows around the gap
          let best: TNode | null = null, bm = 0;
          for (const n of sk2.nodes) if (n.order === 1 && n.parent && n.parent.order === 0 && n.p[1] < (e.maxY ?? 8)) { const m = sk2.descendants(n).length; if (m > bm) { bm = m; best = n; } }
          if (best) {
            let m: TNode = best; let k = 0; while (m.children.length && k < (e.depth ?? 8)) { m = m.children.find((c) => c.order === m.order) || m.children[0]; k++; }
            sk2.breakAt(m); events.push(`storm at period ${it}: limb lost at ${m.p[1].toFixed(1)} m`);
            const alive = new Set(sk2.nodes); for (const b of buds) if (!alive.has(b.node)) b.alive = false;
          }
        } else if (e.kind === 'dieback') {
          // dieback (root loss in old age): the topmost shoots die and stay as stag-headed deadwood
          const maxY = Math.max(...sk2.nodes.map((n) => n.p[1]));
          let k = 0;
          for (const n of sk2.nodes) if (n.order >= 2 && n.p[1] > maxY - 3 && n.parent && n.parent.order < n.order && sk2.descendants(n).length < 90 && r() < 0.6 && k < (e.count ?? 9)) { sk2.kill(n); k++; }
          const dead = new Set(sk2.nodes.filter((n) => n.dead)); for (const b of buds) if (dead.has(b.node)) b.alive = false;
          if (k) events.push(`dieback at period ${it}: ${k} top branches`);
        } else if (e.kind === 'crownLoss') {
          // the young leader snaps at height maxY; the laterals below it take over and spread instead of climbing
          const lead = sk2.nodes.filter((n) => n.order === 0 && !n.root);
          const m = lead.reduce((a, b) => (Math.abs(b.p[1] - (e.maxY ?? 6)) < Math.abs(a.p[1] - (e.maxY ?? 6)) ? b : a), lead[0]);
          sk2.breakAt(m); events.push(`crown loss at period ${it}: leader broken at ${m.p[1].toFixed(1)} m`);
          const alive = new Set(sk2.nodes); for (const b of buds) if (!alive.has(b.node)) b.alive = false;
        }
      }
    },
    shed: (n) => !(n.order === 1 && n.p[1] > 3.5 && r() < 0.3), // some shed limbs persist as dead stubs
  }, r);
  const growMs = performance.now() - t0;
  // a leader that kept extending as a bare whip above the crown (no side shoots for > 2.5 m) is not something an
  // old oak carries: it dies back to where it last branched
  for (const leaf of sk.nodes.filter((n) => n.order === 0 && !n.children.length && !n.root)) {
    const bare: TNode[] = []; let m: TNode | null = leaf, L = 0;
    while (m && m.parent && m.parent.children.length === 1) { bare.push(m); L += Math.hypot(m.p[0] - m.parent.p[0], m.p[1] - m.parent.p[1], m.p[2] - m.parent.p[2]); m = m.parent; }
    if (L > 2.5 && bare.length > 1) { sk.removeMany([bare[bare.length - 2]]); events.push(`bare leader whip (${L.toFixed(1)} m) died back`); }
  }
  sk.computeRadii({ tipR: 0.006, n: cfg.radiusExp, taper: 0.03, targetBase: cfg.baseRadius });
  if (cfg.whipLimit) {
    // shade-starved whips: any terminal shoot that ran on bare (unbranched) for longer than the limit dies back
    let n2 = 0;
    for (const leaf of sk.nodes.filter((n) => !n.children.length && !n.root && n.order > 0)) {
      const bare: TNode[] = []; let m: TNode | null = leaf, L = 0;
      while (m && m.parent && m.parent.children.length === 1) { bare.push(m); L += Math.hypot(m.p[0] - m.parent.p[0], m.p[1] - m.parent.p[1], m.p[2] - m.parent.p[2]); m = m.parent; }
      if (L > cfg.whipLimit && bare.length > 2) { sk.removeMany([bare[Math.floor(bare.length / 2)]]); n2++; }
    }
    if (n2) events.push(`${n2} bare shade whips died back`);
    sk.computeRadii({ tipR: 0.006, n: cfg.radiusExp, taper: 0.03, targetBase: cfg.baseRadius });
  }
  sk.fair(0.05, cfg.fairIterations ?? 6, 0.5, cfg.stemFairAbove); // relax loops and hooks in the woody limbs (structural fairing)
  sk.sag({ stiffness: cfg.sag, maxAngle: 0.04, minOrder: 1, upturn: 0.005 });
  // a few interior secondary branches die in the shade of the outer crown (they keep their wood for decades)
  const inner = sk.nodes.filter((n) => n.order === 3 && n.parent && n.parent.order === 2 && Math.hypot(n.p[0], n.p[2]) < 7 && n.p[1] < 12 && n.children.length);
  for (const n of inner) if (r() < cfg.interiorDeath) sk.kill(n);
  // dead wood sheds its finest twigs first
  sk.removeMany(sk.nodes.filter((n) => n.dead && !n.children.length && n.r < 0.01 && !n.broken && r() < 0.7));
  growRoots(sk, { count: cfg.roots.count, length: cfg.roots.length, seed: r, ground: groundAt, startR: cfg.roots.startR, exposure: cfg.roots.exposure });
  sk.computeRadii({ tipR: 0.006, n: cfg.radiusExp, taper: 0.03, targetBase: cfg.baseRadius });
  sk.rootRadii(cfg.roots.startR, 0.02);
  sk.root.r = cfg.baseRadius * 1.12;
  return { sk, info: { growMs: Math.round(growMs), ...res.stats, events, ...sk.stats() } };
}

/** Oak bark: deep, blocky vertical fissures, ridged; amplitude grows with girth. */
export function oakBark(p: V3, axis: V3, r: number, _node?: TNode, at?: [number, number]): number {
  // fissures run along the branch axis: stretch the noise along it
  const s = 3.2 / Math.max(0.25, Math.min(r, 1.2));
  return barkSample(p, axis, (a, along, tube) => {
    const ridge = 1 - Math.abs(noise3(a * r * s * 1.1, along * 0.9, r * 3, 11));
    const plates = tube ? 0 : noise3(a * r * 9, along * 4.5, 0, 12) * 0.25; // fine plates: geometry only where resolved
    // full relief on the bole, about half on limbs (fine fissures there are for the bark material, not geometry)
    return clamp(r, 0.03, 1.5) * 0.065 * (0.45 + 0.55 * smooth(0.45, 0.9, r)) * (Math.pow(ridge, 3) - 0.35 + plates);
  }, at);
}
