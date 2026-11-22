// Procedural tree generator: species growth rules → branch skeleton → meshes at three levels of detail.
//
// Adapted from Abyssal Garden's recursive branching coral (world.js meshCoral: a branch is a short polyline whose
// direction is perturbed per segment, children fork off with a smaller radius and length, recursion depth limits
// the structure, a tube is swept along each polyline). Here the rules are botanical rather than random:
//   • Scots pine: excurrent stem, whorled branches above a self-pruned bole (dead stubs below), drooping lower limbs
//     with upturned tips, foliage in pads at branch ends, flat-topped and multi-leadered with age
//   • sessile oak: short bole forking into sinuous limbs, broad dome, dead limbs on veterans
//   • silver birch: slender, ascending branches, pendulous fine twigs, often multi-stemmed
//   • rowan, holly (conical, dense, evergreen), hazel (coppice stool of arching stems)
// Each archetype has its own seed, so no two share a branch structure; per-instance variation (lean, crown shift,
// stem bend, density, tint) is added in the vertex shader.

import { rng, type Species, type AgeClass, SPECIES_INFO } from './species.ts';

export type V3 = [number, number, number];
export const VERTEX_BYTES = 32;

export interface MeshData { vertices: ArrayBuffer; indices: Uint32Array; vertexCount: number; triangles: number; /** indices before this are opaque (bark), after it alpha-tested leaf cards */ split: number }
export interface TreeArchetype {
  species: Species; age: AgeClass; index: number; seed: number;
  height: number; crownR: number; crownY: number;
  lods: MeshData[]; // LOD0, LOD1, LOD2
  radius: number; // bounding radius around the base (m)
}

// leaf atlas tiles (4 × 4 grid on the atlas); must match textures.ts
export const LEAF_TILES = { oak: 0, oakMass: 1, pine: 2, pineMass: 3, birch: 4, birchMass: 5, rowan: 6, rowanMass: 7, holly: 8, hollyMass: 9, hazel: 10, hazelMass: 11 } as const;
// material ids (vertex attribute); must match the vegetation shader
export const MAT = { bark: 0, leaf: 1, deadwood: 2, rock: 3, cutWood: 4, root: 5, fungus: 6, soil: 7 } as const;
// bark layers in the baked texture array; must match textures.ts
export const BARK = { oak: 0, pineUpper: 1, pineLower: 2, birch: 3, smooth: 4, deadwood: 5 } as const;

interface Branch {
  pts: V3[]; rad: number[]; level: number; dead: boolean; phase: number; flex0: number;
  leaves: { p: V3; n: V3; size: number; id: number; flex: number; ao: number }[];
  bark: number; broken: boolean;
}

// ------------------------------------------------------------------------------------------------- vector helpers
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.sqrt(dot(a, a));
const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function perp(d: V3): V3 { return norm(Math.abs(d[1]) < 0.9 ? cross(d, [0, 1, 0]) : cross(d, [1, 0, 0])); }
/** Rotate v around unit axis k by angle a (Rodrigues). */
function rot(v: V3, k: V3, a: number): V3 {
  const c = Math.cos(a), s = Math.sin(a), kv = cross(k, v), kd = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}

// ------------------------------------------------------------------------------------------------- growth
interface Ctx {
  r: () => number; sp: Species; age: AgeClass; unique: boolean;
  H: number; crownR: number; crownBase: number; branches: Branch[];
  leafTile: number; leafSize: number; leafDensity: number; maxLevel: number;
  crownC: V3;
}

interface GrowOpts {
  level: number; length: number; radius: number; dead?: boolean;
  /** downward pull per metre (negative = upward); for pine limbs the sag reverses near the tip */
  sag: number; upturn?: number; wobble: number; leafy: boolean; bark: number;
  childEvery: number; childFrom: number; childAngle: number; childLen: number; roll?: number; planar?: boolean;
  tipRadius?: number; flex0?: number; broken?: boolean;
}

function grow(ctx: Ctx, start: V3, dir0: V3, o: GrowOpts): Branch {
  const r = ctx.r;
  if (!(o.length > 0.05) || !(o.radius > 0)) return { pts: [start], rad: [0], level: o.level, dead: true, phase: 0, flex0: 0, leaves: [], bark: o.bark, broken: false };
  const segLen = [0.8, 0.55, 0.4, 0.3, 0.22][Math.min(o.level, 4)];
  const n = Math.max(2, Math.ceil(o.length / segLen));
  const b: Branch = { pts: [start], rad: [o.radius], level: o.level, dead: !!o.dead, phase: r(), flex0: o.flex0 ?? 0, leaves: [], bark: o.bark, broken: !!o.broken };
  let dir = norm(dir0), p = start;
  let curl: V3 = norm([r() - 0.5, r() - 0.5, r() - 0.5]);
  const tipR = o.tipRadius ?? Math.max(0.006, o.radius * 0.12);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    // smoothly varying curl: sinuous oak limbs, kinked pines
    curl = norm(add(mul(curl, 0.8), mul([r() - 0.5, r() - 0.5, r() - 0.5], 0.9)));
    dir = norm(add(dir, mul(curl, o.wobble)));
    const s = o.upturn && t > 0.55 ? -o.upturn : o.sag;
    dir = norm(add(dir, [0, -s * segLen, 0]));
    if (o.level === 0) dir = norm(add(dir, [0, 0.08, 0])); // stems keep growing up
    p = add(p, mul(dir, o.length / n));
    b.pts.push(p);
    b.rad.push(o.radius + (tipR - o.radius) * Math.pow(t, o.level === 0 ? 1.15 : 0.9));
  }
  ctx.branches.push(b);
  // children
  if (o.level < ctx.maxLevel && !o.broken) {
    const L = o.length;
    let t = o.childFrom + r() * o.childEvery / L;
    let k = 0;
    const roll0 = r() * Math.PI * 2;
    while (t < 0.97) {
      const f = t * n, i = Math.min(n - 1, Math.floor(f));
      const pos = lerp3(b.pts[i], b.pts[i + 1], f - i);
      const pd = norm(sub(b.pts[i + 1], b.pts[i]));
      const prad = b.rad[i] + (b.rad[i + 1] - b.rad[i]) * (f - i);
      let side = perp(pd);
      const roll = o.planar ? (k % 2 ? Math.PI : 0) + (r() - 0.5) * 0.6 : roll0 + k * (o.roll ?? 2.4) + (r() - 0.5) * 0.5;
      side = rot(side, pd, roll);
      if (o.planar) { // keep sprays roughly horizontal: choose the side closest to horizontal
        const hz = norm([side[0], 0, side[2]]); if (len([side[0], 0, side[2]]) > 0.1) side = norm(lerp3(side, hz, 0.7));
      }
      const ang = o.childAngle * (0.8 + 0.4 * r());
      const cd = norm(add(mul(pd, Math.cos(ang)), mul(side, Math.sin(ang))));
      const cl = L * o.childLen * (1 - t * 0.55) * (0.65 + 0.6 * r());
      if (cl > 0.15) {
        const dead = o.dead || (ctx.unique && o.level <= 1 && r() < 0.06);
        grow(ctx, add(pos, mul(pd, -prad * 0.3)), cd, {
          ...o, level: o.level + 1, length: cl, radius: Math.min(prad * 0.72, Math.max(0.012, prad * (0.35 + 0.35 * cl / L))),
          dead, wobble: o.wobble * 1.15, sag: ctx.sp === 'oak' ? Math.max(o.sag, 0) * 1.1 + 0.03 : o.sag * 1.3, upturn: o.upturn ? o.upturn * 1.1 : undefined,
          childEvery: o.childEvery * 0.55, childFrom: 0.15, childLen: o.childLen * 0.95, flex0: Math.min(1, (o.flex0 ?? 0) + 0.25 + 0.2 * t), broken: dead && r() < 0.6,
        });
      }
      t += (o.childEvery * (0.7 + 0.6 * r())) / L;
      k++;
    }
  }
  // leaves on the outer, thin parts
  if (o.leafy && !b.dead && o.level >= ctx.maxLevel - 1) addLeaves(ctx, b);
  return b;
}

function addLeaves(ctx: Ctx, b: Branch): void {
  const r = ctx.r;
  let total = 0;
  for (let i = 1; i < b.pts.length; i++) total += len(sub(b.pts[i], b.pts[i - 1]));
  const from = ctx.sp === 'pine' ? 0.45 : ctx.sp === 'holly' ? 0.1 : 0.25;
  const count = Math.max(1, Math.round(total * (1 - from) * ctx.leafDensity));
  for (let c = 0; c < count; c++) {
    const t = from + (1 - from) * (c + r()) / count;
    const f = t * (b.pts.length - 1), i = Math.min(b.pts.length - 2, Math.floor(f));
    const p = lerp3(b.pts[i], b.pts[i + 1], f - i);
    const out = norm(sub(p, ctx.crownC));
    const dist = len(sub(p, ctx.crownC)) / Math.max(ctx.crownR, 1);
    const jitter: V3 = [(r() - 0.5) * ctx.leafSize * 0.6, (r() - 0.5) * ctx.leafSize * 0.4, (r() - 0.5) * ctx.leafSize * 0.6];
    let n: V3;
    if (ctx.sp === 'pine') n = norm(add([0, 1.4, 0], mul([r() - 0.5, r() - 0.5, r() - 0.5], 1.6))); // pads
    else if (ctx.sp === 'birch') n = norm(add(mul(out, 0.6), [r() - 0.5, (r() - 0.5) * 0.3, r() - 0.5])); // hanging, vertical-ish
    else n = norm(add(mul(out, 0.9), [r() - 0.5, r() - 0.3, r() - 0.5]));
    b.leaves.push({ p: add(p, jitter), n, size: ctx.leafSize * (0.75 + 0.5 * r()), id: Math.floor(r() * 256), flex: Math.min(1, b.flex0 + 0.35), ao: Math.min(1, 0.35 + 0.75 * dist) });
  }
}

/** Grow one archetype's skeleton. */
function growTree(sp: Species, age: AgeClass, seed: number, unique: boolean, heightOverride?: number): Ctx {
  const r = rng(seed);
  const info = SPECIES_INFO[sp];
  let H = heightOverride ?? (info.height[0] + (info.height[1] - info.height[0]) * r());
  if (!heightOverride) {
    if (age === 'young') H *= 0.5 + 0.2 * r();
    if (age === 'sapling') H *= 0.15 + 0.1 * r();
    if (age === 'snag') H *= 0.6 + 0.25 * r();
  }
  const vet = age === 'veteran';
  const crownR = H * info.crownFrac * (vet ? (sp === 'oak' ? 1.45 : 1.6) : 1) * (age === 'young' ? 0.8 : 1);
  const tiles: Record<Species, number> = { pine: LEAF_TILES.pine, oak: LEAF_TILES.oak, birch: LEAF_TILES.birch, rowan: LEAF_TILES.rowan, holly: LEAF_TILES.holly, hazel: LEAF_TILES.hazel };
  const ctx: Ctx = {
    r, sp, age, unique, H, crownR, crownBase: 0, branches: [],
    leafTile: tiles[sp], leafSize: { pine: 0.75, oak: 0.95, birch: 0.62, rowan: 0.7, holly: 0.5, hazel: 0.7 }[sp] * (age === 'sapling' ? 0.6 : 1),
    leafDensity: { pine: 4.4, oak: 4.2, birch: 4.6, rowan: 4.0, holly: 7.5, hazel: 4.2 }[sp], maxLevel: 3, crownC: [0, H * 0.65, 0],
  };
  const up: V3 = [0, 1, 0];
  const lean = (k: number): V3 => norm([(r() - 0.5) * k, 1, (r() - 0.5) * k]);
  const dbh = H * (sp === 'oak' ? 0.042 : sp === 'pine' ? 0.03 : 0.024) * (vet ? 2.1 : 1) * (age === 'young' ? 0.7 : age === 'sapling' ? 0.5 : 1);
  const R0 = dbh * 0.5;

  if (sp === 'pine') {
    const cb = H * (age === 'young' || age === 'sapling' ? 0.25 : vet ? 0.38 : 0.55 + 0.1 * r());
    ctx.crownBase = cb; ctx.crownC = [0, cb + (H - cb) * 0.55, 0];
    const snag = age === 'snag';
    // stem with kinks; veterans often split into several leaders
    const stem = grow(ctx, [0, -0.6, 0], lean(0.12), { level: 0, length: H + 0.6, radius: R0, sag: 0, wobble: vet ? 0.1 : 0.05, leafy: false, bark: BARK.pineLower, childEvery: 99, childFrom: 1, childAngle: 0, childLen: 0, broken: snag });
    ctx.maxLevel = age === 'sapling' ? 2 : 3;
    const pts = stem.pts;
    const at = (h: number) => { const i = Math.min(pts.length - 2, Math.max(0, Math.floor((h + 0.6) / ((H + 0.6) / (pts.length - 1))))); return { p: pts[i], d: norm(sub(pts[i + 1], pts[i])), r: stem.rad[i] }; };
    // whorls
    for (let h = H * 0.12; h < H * (snag ? 0.95 : 0.97); h += 0.55 + 0.4 * r()) {
      const living = h > cb && !snag;
      const w = at(h);
      const nb = living ? 3 + Math.floor(r() * 3) : 2 + Math.floor(r() * 3);
      const roll0 = r() * 6.28;
      for (let k = 0; k < nb; k++) {
        if (living && r() < 0.35) continue; // irregular whorls
        if (!living && r() < 0.55) continue;
        const hn = Math.max(0, (h - cb) / (H - cb));
        const env = vet ? Math.pow(Math.sin(Math.PI * Math.min(1, hn * 0.95 + 0.05)), 0.5) : age === 'young' || age === 'sapling' ? 1 - hn * 0.9 : Math.pow(Math.sin(Math.PI * Math.min(1, hn * 0.92 + 0.08)), 0.7);
        const side = rot(perp(w.d), w.d, roll0 + k * 6.283 / nb + (r() - 0.5) * 0.6);
        const elev = living ? (0.2 - hn * 0.9 + (r() - 0.5) * 0.3) : -0.1; // lower limbs down, upper up
        const d = norm(add(side, [0, elev, 0]));
        const L = living ? crownR * env * (0.6 + 0.6 * r()) : 0.25 + 0.7 * r();
        if (L < 0.2) continue;
        grow(ctx, add(w.p, mul(d, -w.r * 0.3)), d, {
          level: 1, length: L, radius: Math.min(w.r * 0.55, 0.03 + L * 0.028 * (vet ? 1.6 : 1)), dead: !living, broken: !living,
          sag: 0.18, upturn: 0.32, wobble: 0.18, leafy: true, bark: BARK.pineUpper,
          childEvery: 0.45, childFrom: 0.2, childAngle: 0.9, childLen: 0.45, planar: true, flex0: 0.2,
        });
      }
    }
    // veteran: two or three heavy leaders breaking out of the stem top third
    if (vet) for (let k = 0; k < 2; k++) {
      const w = at(H * (0.6 + 0.1 * k));
      const d = norm(add(rot(perp(w.d), w.d, r() * 6.28), [0, 1.3, 0]));
      grow(ctx, w.p, d, { level: 1, length: H * 0.35, radius: w.r * 0.6, sag: -0.05, wobble: 0.12, leafy: true, bark: BARK.pineUpper, childEvery: 0.6, childFrom: 0.3, childAngle: 1.0, childLen: 0.5, planar: true, flex0: 0.15 });
    }
  } else if (sp === 'oak') {
    const fork = H * (vet ? 0.22 : age === 'young' ? 0.35 : 0.28 + 0.12 * r());
    ctx.crownBase = fork * 0.8; ctx.crownC = [0, fork + (H - fork) * 0.45, 0];
    const stem = grow(ctx, [0, -0.6, 0], lean(0.15), { level: 0, length: fork + 0.6, radius: R0, tipRadius: R0 * 0.75, sag: 0, wobble: 0.12, leafy: false, bark: BARK.oak, childEvery: 99, childFrom: 1, childAngle: 0, childLen: 0 });
    const top = stem.pts[stem.pts.length - 1];
    ctx.maxLevel = 3;
    const nl = vet ? 5 : 2 + Math.floor(r() * 3);
    const roll0 = r() * 6.28;
    for (let k = 0; k < nl; k++) {
      const a = roll0 + k * 6.283 / nl + (r() - 0.5) * 0.7;
      const out: V3 = [Math.cos(a), 0, Math.sin(a)];
      const steep = vet ? 0.55 + 0.6 * r() : 0.9 + 0.8 * r();
      const d = norm(add(out, [0, steep, 0]));
      const dead = vet && k === 1;
      grow(ctx, add(top, mul(d, -R0 * 0.4)), d, {
        level: 1, length: (H - fork) * (0.75 + 0.35 * r()) * (vet ? 1.05 : 1), radius: R0 * (0.62 - 0.05 * nl) * (0.85 + 0.3 * r()), dead, broken: dead,
        sag: -0.015, upturn: vet ? 0.05 : undefined, wobble: 0.28, leafy: true, bark: dead ? BARK.deadwood : BARK.oak,
        childEvery: 0.85, childFrom: 0.15, childAngle: 0.85, childLen: 0.6, roll: 2.4, flex0: 0.1,
      });
    }
    // epicormic sprigs / lower branches on veterans
    if (vet || r() < 0.5) for (let k = 0; k < (vet ? 4 : 2); k++) {
      const i = 1 + Math.floor(r() * (stem.pts.length - 2));
      const d = norm(add(rot(perp([0, 1, 0]), [0, 1, 0], r() * 6.28), [0, 0.2, 0]));
      grow(ctx, stem.pts[i], d, { level: 2, length: crownR * 0.45 * (0.5 + r()), radius: 0.06, sag: 0.15, wobble: 0.3, leafy: true, bark: BARK.oak, childEvery: 0.4, childFrom: 0.2, childAngle: 0.9, childLen: 0.5, flex0: 0.35 });
    }
  } else if (sp === 'birch') {
    const stems = age !== 'sapling' && r() < 0.35 ? 2 + Math.floor(r() * 2) : 1;
    ctx.crownBase = H * 0.35; ctx.crownC = [0, H * 0.62, 0];
    ctx.maxLevel = age === 'sapling' ? 2 : 3;
    const snag = age === 'snag';
    for (let s = 0; s < stems; s++) {
      const d0 = stems > 1 ? norm([Math.cos(s * 2.4 + r()) * 0.25, 1, Math.sin(s * 2.4 + r()) * 0.25]) : lean(0.15);
      const sh = H * (stems > 1 ? 0.85 + 0.15 * r() : 1);
      const stem = grow(ctx, [0, -0.5, 0], d0, { level: 0, length: sh + 0.5, radius: R0 * (stems > 1 ? 0.7 : 1), sag: 0, wobble: 0.07, leafy: false, bark: BARK.birch, childEvery: 99, childFrom: 1, childAngle: 0, childLen: 0, broken: snag });
      if (snag) {
        // bracket fungi on the dead stem
        for (let k = 0; k < 4; k++) ctx.branches.push(fungus(stem, 0.2 + 0.5 * r(), r));
        continue;
      }
      const pts = stem.pts;
      for (let i = 2; i < pts.length - 1; i++) {
        const h = pts[i][1]; if (h < ctx.crownBase * (0.6 + 0.4 * r())) continue;
        const nb = r() < 0.6 ? 1 : 2;
        for (let k = 0; k < nb; k++) {
          const hn = Math.max(0, (h - ctx.crownBase) / (H - ctx.crownBase));
          const pd = norm(sub(pts[i + 1], pts[i]));
          const side = rot(perp(pd), pd, r() * 6.28);
          const d = norm(add(side, [0, 0.9 + 0.4 * r(), 0]));
          const L = crownR * Math.pow(Math.sin(Math.PI * Math.min(1, hn * 0.9 + 0.1)), 0.8) * (0.7 + 0.6 * r()) * 1.2;
          if (L < 0.3) continue;
          grow(ctx, pts[i], d, { level: 1, length: L, radius: Math.min(stem.rad[i] * 0.5, 0.02 + L * 0.012), sag: 0.25, wobble: 0.15, leafy: true, bark: BARK.birch, childEvery: 0.35, childFrom: 0.2, childAngle: 0.8, childLen: 0.55, flex0: 0.25 });
        }
      }
    }
  } else if (sp === 'rowan' || sp === 'holly') {
    const holly = sp === 'holly';
    const stems = holly ? 1 + (r() < 0.3 ? 1 : 0) : 1 + Math.floor(r() * 2.2);
    ctx.crownBase = H * (holly ? 0.08 : 0.35); ctx.crownC = [0, H * (holly ? 0.45 : 0.62), 0];
    ctx.maxLevel = age === 'sapling' ? 2 : 3;
    for (let s = 0; s < stems; s++) {
      const stem = grow(ctx, [0, -0.4, 0], lean(stems > 1 ? 0.5 : 0.15), { level: 0, length: H + 0.4, radius: R0, sag: 0, wobble: 0.08, leafy: false, bark: BARK.smooth, childEvery: 99, childFrom: 1, childAngle: 0, childLen: 0 });
      const pts = stem.pts;
      for (let i = 1; i < pts.length - 1; i++) {
        const h = pts[i][1]; if (h < ctx.crownBase) continue;
        const hn = Math.max(0, (h - ctx.crownBase) / (H - ctx.crownBase));
        for (let k = 0; k < (holly ? 3 : 1 + (r() < 0.5 ? 1 : 0)); k++) {
          const pd = norm(sub(pts[i + 1], pts[i]));
          const side = rot(perp(pd), pd, r() * 6.28);
          const d = norm(add(side, [0, holly ? 0.15 : 1.0, 0]));
          const env = holly ? (1 - hn) * 1.05 + 0.15 : Math.sin(Math.PI * Math.min(1, hn * 0.85 + 0.15));
          const L = crownR * env * (0.6 + 0.6 * r());
          if (L < 0.2) continue;
          grow(ctx, pts[i], d, { level: 1, length: L, radius: 0.015 + L * 0.015, sag: holly ? 0.1 : 0.05, wobble: 0.2, leafy: true, bark: BARK.smooth, childEvery: holly ? 0.25 : 0.4, childFrom: 0.15, childAngle: 0.8, childLen: 0.55, flex0: 0.25 });
        }
      }
    }
  } else { // hazel: coppice stool
    ctx.crownBase = H * 0.25; ctx.crownC = [0, H * 0.55, 0]; ctx.maxLevel = 2;
    const stems = 6 + Math.floor(r() * 7);
    for (let s = 0; s < stems; s++) {
      const a = r() * 6.28, sp0 = 0.15 + 0.5 * r();
      const d = norm([Math.cos(a) * sp0, 1, Math.sin(a) * sp0]);
      grow(ctx, [Math.cos(a) * 0.25, -0.3, Math.sin(a) * 0.25], d, { level: 0, length: H * (0.7 + 0.35 * r()), radius: 0.025 + 0.025 * r(), sag: 0.05, wobble: 0.05, leafy: true, bark: BARK.smooth, childEvery: 0.45, childFrom: 0.35, childAngle: 0.7, childLen: 0.35, flex0: 0.15 });
    }
  }
  return ctx;
}

/** A shelf of bracket fungus on a stem: a flattened half-disc (built as a tiny branch with special material). */
function fungus(stem: Branch, t: number, r: () => number): Branch {
  const i = Math.min(stem.pts.length - 2, Math.floor(t * (stem.pts.length - 1)));
  const p = stem.pts[i], rad = stem.rad[i];
  const a = r() * 6.28, out: V3 = [Math.cos(a), 0, Math.sin(a)];
  const w = 0.08 + 0.1 * r();
  const c = add(p, mul(out, rad * 0.9));
  return { pts: [c, add(c, mul(out, w))], rad: [w * 0.9, w * 0.2], level: 9, dead: true, phase: 0, flex0: 0, leaves: [], bark: -1, broken: false };
}

// ------------------------------------------------------------------------------------------------- meshing
export class Builder {
  f: number[] = []; // packed later
  verts: { p: V3; n: V3; t: V3; u: number; v: number; flex: number; phase: number; level: number; ao: number; mat: number; tile: number; id: number; varr: number }[] = [];
  idx: number[] = [];
  split = -1;
  v(p: V3, n: V3, t: V3, u: number, v: number, flex: number, phase: number, level: number, ao: number, mat: number, tile: number, id: number, varr = 0): number {
    this.verts.push({ p, n, t, u, v, flex, phase, level, ao, mat, tile, id, varr });
    return this.verts.length - 1;
  }
  tri(a: number, b: number, c: number) { this.idx.push(a, b, c); }
  build(): MeshData {
    const n = this.verts.length, buf = new ArrayBuffer(n * VERTEX_BYTES), f = new Float32Array(buf), i8 = new Int8Array(buf), u8 = new Uint8Array(buf), u16 = new Uint16Array(buf);
    const sn = (x: number) => Math.max(-127, Math.min(127, Math.round(x * 127)));
    const un = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
    for (let k = 0; k < n; k++) {
      const q = this.verts[k], o = k * VERTEX_BYTES;
      f[o / 4] = q.p[0]; f[o / 4 + 1] = q.p[1]; f[o / 4 + 2] = q.p[2];
      i8[o + 12] = sn(q.n[0]); i8[o + 13] = sn(q.n[1]); i8[o + 14] = sn(q.n[2]); i8[o + 15] = 0;
      i8[o + 16] = sn(q.t[0]); i8[o + 17] = sn(q.t[1]); i8[o + 18] = sn(q.t[2]); i8[o + 19] = 0;
      u16[o / 2 + 10] = f16(q.u); u16[o / 2 + 11] = f16(q.v);
      u8[o + 24] = un(q.flex); u8[o + 25] = un(q.phase); u8[o + 26] = un(q.level / 4); u8[o + 27] = un(q.ao);
      u8[o + 28] = q.mat; u8[o + 29] = q.tile; u8[o + 30] = q.id; u8[o + 31] = un(q.varr);
    }
    return { vertices: buf, indices: Uint32Array.from(this.idx), vertexCount: n, triangles: this.idx.length / 3, split: this.split < 0 ? this.idx.length : this.split };
  }
}

const _f32 = new Float32Array(1), _u32 = new Uint32Array(_f32.buffer);
export function f16(v: number): number {
  _f32[0] = v; const x = _u32[0];
  const sign = (x >>> 16) & 0x8000; let e = ((x >>> 23) & 0xff) - 127 + 15; let m = x & 0x7fffff;
  if (e <= 0) { if (e < -10) return sign; m = (m | 0x800000) >> (1 - e); return sign | ((m + 0x1000) >> 13); }
  if (e >= 31) return sign | 0x7c00;
  const h = sign | (e << 10) | ((m + 0x1000) >> 13);
  return h;
}

interface LodSpec { sidesFor(r: number, level: number): number; minRadius: number; ringStep: number; leafKeep: number; leafScale: number; mass: boolean }
const LOD_SPECS: LodSpec[] = [
  { sidesFor: (r, l) => (l === 0 ? (r > 0.5 ? 16 : r > 0.2 ? 12 : 8) : r > 0.12 ? 8 : r > 0.05 ? 6 : r > 0.025 ? 4 : 3), minRadius: 0, ringStep: 1, leafKeep: 1, leafScale: 1, mass: false },
  { sidesFor: (r, l) => (l === 0 ? (r > 0.3 ? 8 : 6) : r > 0.1 ? 5 : r > 0.04 ? 4 : 3), minRadius: 0.022, ringStep: 2, leafKeep: 0.36, leafScale: 1.65, mass: true },
  { sidesFor: (r, l) => (l === 0 ? 5 : r > 0.1 ? 4 : 3), minRadius: 0.055, ringStep: 3, leafKeep: 0.09, leafScale: 3.1, mass: true },
];

function sweep(B: Builder, br: Branch, spec: LodSpec, sp: Species, H: number, barkScale: number): void {
  const n = br.pts.length;
  if (br.rad[0] < spec.minRadius && br.level > 0) return;
  // ring selection (keep both ends)
  const rings: number[] = [];
  for (let i = 0; i < n; i += spec.ringStep) rings.push(i);
  if (rings[rings.length - 1] !== n - 1) rings.push(n - 1);
  const isFungus = br.level === 9;
  const sides = isFungus ? 6 : spec.sidesFor(br.rad[0], br.level);
  // parallel-transport frames
  let T = norm(sub(br.pts[1], br.pts[0])), N = perp(T);
  let vacc = 0;
  let prevRing: number[] | null = null;
  const mat = isFungus ? MAT.fungus : br.dead ? MAT.deadwood : MAT.bark;
  const bark = isFungus ? 0 : br.dead ? BARK.deadwood : br.bark;
  // circumference repeats of the bark tile (≈ 0.5 m tile), integer so u wraps seamlessly
  const repU = Math.max(1, Math.round((2 * Math.PI * br.rad[0]) / (0.55 * barkScale)));
  for (let ri = 0; ri < rings.length; ri++) {
    const i = rings[ri];
    const Tn = i < n - 1 ? norm(sub(br.pts[i + 1], br.pts[i])) : T;
    const Tavg = norm(add(T, Tn));
    // transport N
    N = norm(sub(N, mul(Tavg, dot(N, Tavg))));
    T = Tn;
    const Bv = cross(Tavg, N);
    if (ri > 0) vacc += len(sub(br.pts[i], br.pts[rings[ri - 1]]));
    const p = br.pts[i], rr = br.rad[i];
    const ring: number[] = [];
    const h = p[1];
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      let rad = rr;
      if (br.level === 0 && !isFungus) {
        // root flare: lobes spreading at the base (buttress), bark ridges higher up (LOD0 silhouettes)
        const flare = Math.max(0, 1 - (h + 0.6) / (sp === 'oak' ? 2.2 : 1.6));
        const lobes = sp === 'oak' ? 5 : sp === 'pine' ? 4 : 3;
        rad *= 1 + flare * flare * (0.9 + 0.55 * Math.cos(a * lobes + br.phase * 6.28)) * (sp === 'birch' ? 0.5 : 1);
        if (spec.ringStep === 1 && (sp === 'oak' || sp === 'pine')) rad *= 1 + 0.035 * Math.cos(a * Math.round(rr * 40) + h * 1.3) + 0.02 * Math.sin(a * 3 + h * 0.7);
      }
      if (isFungus) { // flat shelf: squash vertically
        const c = Math.cos(a), sn = Math.sin(a);
        const dir = add(mul(N, c), mul(Bv, sn));
        const flat: V3 = [dir[0], dir[1] * 0.25, dir[2]];
        const pp = add(p, mul(flat, rad));
        ring.push(B.v(pp, norm([dir[0], dir[1] + 0.6, dir[2]]), Tavg, s / sides, vacc, 0, 0, 0, 0.8, mat, 0, 0, br.phase));
        continue;
      }
      const dir = add(mul(N, Math.cos(a)), mul(Bv, Math.sin(a)));
      const pp = add(p, mul(dir, rad));
      const t = vacc / Math.max(0.01, totalLen(br));
      const flex = br.level === 0 ? 0 : Math.min(1, br.flex0 + 0.35 * t);
      const ao = br.level === 0 ? Math.min(1, 0.55 + 0.45 * Math.min(1, (h + 0.6) / 2.5)) : 0.9;
      ring.push(B.v(pp, dir, Tavg, (s / sides) * repU, vacc / barkScale, flex, br.phase, br.level, ao, mat, bark, 0, br.dead ? 1 : 0));
    }
    if (prevRing) for (let s = 0; s < sides; s++) {
      const a = prevRing[s], b = prevRing[s + 1], c = ring[s + 1], d = ring[s];
      B.tri(a, c, b); B.tri(a, d, c);
    }
    prevRing = ring;
  }
  // broken ends: a jagged cap of pale wood
  if ((br.broken || br.level === 0) && !isFungus && prevRing && spec.ringStep < 3) {
    const p = br.pts[n - 1], Tn = norm(sub(br.pts[n - 1], br.pts[n - 2]));
    if (br.rad[n - 1] > 0.02) {
      const c = B.v(add(p, mul(Tn, br.rad[n - 1] * 0.6)), Tn, Tn, 0.5, 0.5, Math.min(1, br.flex0 + 0.35), br.phase, br.level, 0.8, MAT.cutWood, bark, 0);
      for (let s = 0; s < sides; s++) B.tri(prevRing[s], prevRing[s + 1], c);
    }
  }
  void H;
}
const _tl = new WeakMap<Branch, number>();
function totalLen(b: Branch): number {
  let v = _tl.get(b); if (v !== undefined) return v;
  v = 0; for (let i = 1; i < b.pts.length; i++) v += len(sub(b.pts[i], b.pts[i - 1]));
  _tl.set(b, v); return v;
}

function leafCards(B: Builder, ctx: Ctx, spec: LodSpec, r: () => number): void {
  const tile = spec.mass ? ctx.leafTile + 1 : ctx.leafTile;
  const all = ctx.branches.flatMap((b) => b.leaves.map((l) => ({ l, b })));
  for (const { l, b } of all) {
    if (spec.leafKeep < 1 && r() > spec.leafKeep) continue;
    const s = l.size * spec.leafScale;
    // card frame: normal n, a random in-plane rotation
    const n = l.n;
    let t1 = perp(n);
    t1 = rot(t1, n, r() * Math.PI * 2);
    const t2 = cross(n, t1);
    const fol = norm(add(mul(norm(sub(l.p, ctx.crownC)), 0.75), mul(n, 0.25))); // crown-spherical normal for shading
    const c = l.p;
    const corners: [number, number][] = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
    const ids = corners.map(([a, bb]) => B.v(add(c, add(mul(t1, a * s), mul(t2, bb * s))), fol, n, a + 0.5, bb + 0.5, l.flex, b.phase, 3, l.ao, MAT.leaf, tile, l.id));
    B.tri(ids[0], ids[1], ids[2]); B.tri(ids[0], ids[2], ids[3]);
  }
}

export function buildTreeArchetype(sp: Species, age: AgeClass, index: number, seed: number, unique = false, heightOverride?: number): TreeArchetype {
  const ctx = growTree(sp, age, seed, unique, heightOverride);
  const lods: MeshData[] = [];
  const barkScale = sp === 'birch' ? 0.8 : sp === 'oak' ? 1.0 : 1.0;
  for (let k = 0; k < 3; k++) {
    const B = new Builder();
    for (const b of ctx.branches) sweep(B, b, LOD_SPECS[k], sp, ctx.H, barkScale);
    B.split = B.idx.length;
    leafCards(B, ctx, LOD_SPECS[k], rng(seed + 77 + k));
    lods.push(B.build());
  }
  let rad = 0;
  for (const b of ctx.branches) for (const p of b.pts) rad = Math.max(rad, Math.hypot(p[0], p[2]));
  return { species: sp, age, index, seed, height: ctx.H, crownR: ctx.crownR, crownY: ctx.crownC[1], lods, radius: rad + ctx.leafSize };
}

/** Every archetype the stand needs: SPECIES_INFO archetype counts per species and age, plus the unique veterans. */
export function buildAllArchetypes(veterans: { species: Species; seed: number; height: number }[]): { list: TreeArchetype[]; key: (sp: Species, age: AgeClass, i: number) => number; veteran: (i: number) => number; ms: number } {
  const t0 = performance.now();
  const list: TreeArchetype[] = [];
  const map = new Map<string, number>();
  let s = 1000;
  for (const sp of Object.keys(SPECIES_INFO) as Species[]) {
    for (const [age, n] of Object.entries(SPECIES_INFO[sp].archetypes) as [AgeClass, number][]) {
      for (let i = 0; i < n; i++) { map.set(`${sp}/${age}/${i}`, list.length); list.push(buildTreeArchetype(sp, age, i, s++ * 7919)); }
    }
  }
  const vstart = list.length;
  veterans.forEach((v, i) => list.push(buildTreeArchetype(v.species, 'veteran', i, v.seed, true, v.height)));
  return {
    list, ms: performance.now() - t0,
    key: (sp, age, i) => { const k = map.get(`${sp}/${age}/${i}`); return k === undefined ? map.get(`${sp}/${Object.keys(SPECIES_INFO[sp].archetypes)[0]}/0`)! : k; },
    veteran: (i) => vstart + i,
  };
}
