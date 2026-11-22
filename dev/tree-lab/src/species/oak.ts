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

export const OAK = { name: 'Ancient veteran oak', latin: 'Quercus robur', seed: 1606, targetHeight: 21, crownRadius: 13, baseRadius: 1.1 };

export function growOak(seed = OAK.seed): { sk: Skeleton; info: Record<string, unknown> } {
  const r = rng(seed);
  const sk = new Skeleton([0, -0.6, 0]);
  const t0 = performance.now();
  // ---- 1. bole: short, thick, leaning a little, twisting; it carries on as one of the limbs (decurrent habit),
  // the other primaries leave it at staggered heights rather than all from one point
  let m: TNode = sk.root;
  let d: V3 = norm([0.06, 1, -0.04]);
  const stem: TNode[] = [];
  for (let y = -0.6; y < 6.8; y += 0.35) {
    const lean = smooth(3, 6.8, y) * 0.35;
    d = norm(add(d, [noise3(y * 0.4, 0, 0, seed) * 0.05 + lean * 0.05, 0.03, noise3(0, y * 0.4, 0, seed) * 0.05 - lean * 0.03]));
    m = sk.add(m, add(m.p, mul(d, 0.35)), 0); stem.push(m);
  }
  const stemAt = (h: number) => stem.reduce((a, b) => (Math.abs(b.p[1] - h) < Math.abs(a.p[1] - h) ? b : a));
  const limbs: TNode[][] = [];
  const spec = [
    { h: 3.1, az: 0.3, el: 0.42, L: 9.5 }, { h: 3.6, az: 2.6, el: 0.36, L: 10.5 }, { h: 4.3, az: 1.4, el: 0.55, L: 8.5 },
    { h: 4.9, az: 4.0, el: 0.5, L: 8.5 }, { h: 5.5, az: 5.2, el: 0.62, L: 8 },
  ];
  const growLimb = (from: TNode, az: number, el: number, Lm: number, order: number, sinuous: number): TNode[] => {
    let dir: V3 = norm([Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)]);
    let n = from; const pts: TNode[] = [];
    const seg = 0.42, steps = Math.round(Lm / seg);
    let curl: V3 = norm([r() - 0.5, r() - 0.5, r() - 0.5]);
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      curl = norm(add(mul(curl, 0.8), mul([r() - 0.5, (r() - 0.5) * 0.5, r() - 0.5], 0.6)));
      // rises, levels out, the tip lifts again towards light: the oak limb's long S
      const lift = t < 0.3 ? 0.0 : t < 0.75 ? -0.035 : 0.03;
      dir = norm(add(dir, add(mul(curl, sinuous), [0, lift, 0])));
      if (dir[1] < -0.15) dir = norm([dir[0], -0.15, dir[2]]);
      n = sk.add(n, add(n.p, mul(dir, seg)), order); pts.push(n);
    }
    return pts;
  };
  for (const s of spec) limbs.push(growLimb(stemAt(s.h), s.az + (r() - 0.5) * 0.3, s.el + (r() - 0.5) * 0.1, s.L, 1, 0.14));
  // the stem top itself continues as a sixth, steeper limb
  limbs.push(growLimb(stem[stem.length - 1], 3.3, 1.0, 6.5, 0, 0.12));
  // scaffold secondaries: two or three per limb, leaving the outer half at wide angles
  for (const L of limbs) {
    const ns = 2 + Math.floor(r() * 2);
    for (let k = 0; k < ns; k++) {
      const node = L[Math.floor(L.length * (0.35 + 0.5 * (k + r() * 0.5) / ns))];
      if (!node) continue;
      const pd = norm(sub(node.p, node.parent!.p));
      const az = Math.atan2(pd[2], pd[0]) + (k % 2 ? 1 : -1) * (0.7 + 0.4 * r());
      growLimb(node, az, 0.3 + 0.3 * r(), 3 + 2.5 * r(), 2, 0.2);
    }
  }
  const fork = stemAt(3.1);
  // ---- 2. space colonization in an irregular crown envelope
  const C: V3 = [0, 12.2, 0];
  const lobes: { c: V3; r: number }[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + r() * 0.5, rad = 5.5 + r() * 3;
    lobes.push({ c: [Math.cos(a) * rad, 10.5 + r() * 6, Math.sin(a) * rad], r: 4.5 + r() * 2 });
  }
  lobes.push({ c: [0, 15, 0], r: 6.5 });
  const gaps: { c: V3; r: number }[] = [];
  for (let i = 0; i < 6; i++) { const a = r() * Math.PI * 2, rad = 3 + r() * 8; gaps.push({ c: [Math.cos(a) * rad, 9 + r() * 9, Math.sin(a) * rad], r: 2.5 + r() * 2.5 }); }
  const inCrown = (p: V3) => {
    if (p[1] < 5.5) return false;
    let inside = false;
    for (const l of lobes) if (len(sub(p, l.c)) < l.r) { inside = true; break; }
    if (!inside) return false;
    for (const g of gaps) if (len(sub(p, g.c)) < g.r) return false;
    return true;
  };
  const pts: V3[] = [];
  let tries = 0;
  while (pts.length < 16000 && tries++ < 900000) {
    const p: V3 = [(r() - 0.5) * 30, 4 + r() * 18, (r() - 0.5) * 30];
    if (!inCrown(p)) continue;
    // outer shell bias: leaves (and therefore shoots) concentrate where the light is
    const q = len(sub([p[0], p[1] * 1.4, p[2]], [C[0], C[1] * 1.4, C[2]])) / 13;
    if (r() > 0.15 + 0.85 * smooth(0.35, 1.0, q)) continue;
    pts.push(p);
  }
  const Di = 3.2, Dk = 1.0, D = 0.4;
  const live = new Set<TNode>();
  // shoots only from the limbs' outer parts: no water sprouts from the bole or the inner limbs
  for (const n of sk.nodes) if (n.order >= 1 && Math.hypot(n.p[0], n.p[2]) > 3.2) live.add(n);
  const alive = pts.map(() => true);
  const cell = Di;
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  let iters = 0;
  for (; iters < 260; iters++) {
    const grid = new Map<string, TNode[]>();
    for (const n of live) { const k = key(n.p[0], n.p[1], n.p[2]); let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(n); }
    const pull = new Map<TNode, V3>();
    let any = false;
    for (let i = 0; i < pts.length; i++) {
      if (!alive[i]) continue;
      const p = pts[i];
      let best: TNode | null = null, bd = Di;
      const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const l = grid.get(`${cx + dx},${cy + dy},${cz + dz}`); if (!l) continue;
        for (const n of l) { const dd = len(sub(p, n.p)); if (dd < bd) { bd = dd; best = n; } }
      }
      if (!best) continue;
      if (bd < Dk) { alive[i] = false; continue; }
      const v = norm(sub(p, best.p));
      const cur = pull.get(best); pull.set(best, cur ? add(cur, v) : v);
      any = true;
    }
    if (!any) break;
    let grew = 0;
    for (const [n, v] of pull) {
      if (n.children.length >= 3 || n.dead) continue;
      // tropism: a little phototropism (up) and outward growth into free space
      const out: V3 = norm([n.p[0], 0, n.p[2]]);
      // crooked, zig-zag growth (sympodial shoots of oak) on top of the pull towards free space
      const crook: V3 = [r() - 0.5, (r() - 0.5) * 0.6, r() - 0.5];
      const dir = norm(add(norm(v), add(add([0, 0.08, 0], mul(out, 0.14)), mul(crook, 0.55))));
      const np = add(n.p, mul(dir, D));
      // avoid doubling back along the parent
      if (n.parent && dot(norm(sub(n.p, n.parent.p)), dir) < -0.2) continue;
      const order = n.children.length === 0 ? n.order : n.order + 1;
      const c = sk.add(n, np, Math.min(order, 6));
      live.add(c); grew++;
    }
    if (!grew) break;
  }
  const growMs = performance.now() - t0;
  // ---- 3. radii and sag
  sk.computeRadii({ tipR: 0.007, n: 2.8, taper: 0.035, targetBase: OAK.baseRadius });
  if (!(globalThis as any).NOSAG) sk.sag({ stiffness: 1.0, maxAngle: 0.05, minOrder: 1, upturn: 0.01 });
  // ---- 4. ageing (structural, not random damage)
  // storm loss: the longest low limb snapped 3.5 m out (heavy, horizontal, the one that fails in a gale)
  const lost = limbs[1];
  if (lost[9]) sk.breakAt(lost[9]);
  // a second, smaller break high on another limb
  const l4 = limbs[3]; if (l4[15] && sk.nodes.includes(l4[15])) sk.breakAt(l4[15]);
  // stag-headed: the highest shoots die back first in veterans (root loss, drought)
  const maxY = Math.max(...sk.nodes.map((n) => n.p[1]));
  const top = sk.nodes.filter((n) => n.order >= 2 && n.p[1] > maxY - 3.2 && n.parent && n.parent.p[1] < n.p[1]);
  for (const n of top.slice(0, 18)) if (r() < 0.45) sk.kill(n);
  // interior: shaded secondary branches die, many fine twigs are shed (crown thinning)
  for (const n of [...sk.nodes]) {
    if (!sk.nodes.includes(n)) continue;
    if (n.order === 3 && n.children.length && Math.hypot(n.p[0], n.p[2]) < 6 && n.p[1] < 13 && r() < 0.1) sk.kill(n);
  }
  // dead limbs keep their bark for a while, then lose twigs: strip the finest dead shoots
  for (const n of [...sk.nodes]) if (n.dead && !n.children.length && n.r < 0.012 && sk.nodes.includes(n) && r() < 0.6) sk.remove(n);
  // trunk flare and roots
  growRoots(sk, { count: 9, length: [2.8, 5.5], seed: r, ground: groundAt, startR: 0.5, exposure: 1.0 });
  sk.computeRadii({ tipR: 0.007, n: 2.8, taper: 0.035, targetBase: OAK.baseRadius });
  sk.rootRadii(0.48, 0.02);
  sk.root.r = OAK.baseRadius * 1.15;
  return { sk, info: { growMs: Math.round(growMs), scIterations: iters, attractionPoints: pts.length, ...sk.stats() } };
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
