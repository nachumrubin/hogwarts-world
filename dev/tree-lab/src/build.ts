// Specimen build: grow → mesh every LOD → measure. Pure (no DOM, no GPU): runs in the lab's worker, in Node tools,
// and is what the Hogwarts world would call to get a tree's geometry.
import { MeshOut, meshChains, LODS, type BarkFn } from './framework/mesher.ts';
import type { Skeleton, Chain, TNode } from './framework/skeleton.ts';
import { type V3 } from './framework/math.ts';
import { SPECIES, type SpeciesDef, type Poi } from './species/index.ts';
import { growFoliage, type Foliage } from './framework/foliage.ts';

export interface LodMesh { v: Float32Array; i: Uint32Array; tris: number; verts: number; ms: number }
export interface Diagnostics {
  height: number; crownX: number; crownZ: number; crownWidth: number; dbh: number; baseDiameter: number;
  primaryLimbs: number; stemBranches: number; branches: number; liveTips: number; deadBranches: number; brokenEnds: number;
  nodes: number; hierarchy: number[]; maxOrder: number;
  growMs: number; meshMs: number[]; history: string[]; info: Record<string, unknown>;
}
export interface BuiltSpecimen {
  id: string; lods: LodMesh[]; diag: Diagnostics; poi: Poi;
  /** summer foliage per LOD (instances), from the same skeleton */
  foliage: Foliage;
  bounds: { min: V3; max: V3 }; // woody skeleton bounds (roots excluded), tree-local, metres
}

export function specimen(id: string): SpeciesDef {
  const d = SPECIES.find((s) => s.id === id);
  if (!d) throw new Error(`unknown specimen ${id}`);
  return d;
}

/** Radius of the main stem at height y (linear along the trunk chain). */
function stemRadiusAt(trunk: TNode[], y: number): number {
  for (let k = 1; k < trunk.length; k++) {
    const a = trunk[k - 1], b = trunk[k];
    if (b.p[1] >= y) { const t = Math.max(0, Math.min(1, (y - a.p[1]) / Math.max(1e-6, b.p[1] - a.p[1]))); return a.r + (b.r - a.r) * t; }
  }
  return trunk[trunk.length - 1]?.r ?? 0;
}

function diagnose(sk: Skeleton, chains: Chain[], info: Record<string, unknown>, growMs: number, meshMs: number[]): Diagnostics {
  const wood = sk.nodes.filter((n) => !n.root);
  const min: V3 = [1e9, 1e9, 1e9], max: V3 = [-1e9, -1e9, -1e9];
  for (const n of wood) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], n.p[k] - n.r); max[k] = Math.max(max[k], n.p[k] + n.r); }
  const stemChain = chains.find((c) => !c.attach || c.attach.root) ?? chains[0];
  const trunk = stemChain.nodes.filter((n) => !n.root);
  // chain nesting level = branch hierarchy (1 = main stem, 2 = limbs off the stem, ...)
  const level = new Map<Chain, number>();
  const lv = (c: Chain): number => { if (level.has(c)) return level.get(c)!; const v = c.parent ? lv(c.parent) + 1 : 1; level.set(c, v); return v; };
  const woody = chains.filter((c) => !c.nodes[0].root);
  const hierarchy: number[] = [];
  for (const c of woody) { const l = lv(c); hierarchy[l - 1] = (hierarchy[l - 1] || 0) + 1; }
  for (let k = 0; k < hierarchy.length; k++) hierarchy[k] = hierarchy[k] || 0;
  const offStem = woody.filter((c) => c.parent === stemChain);
  // primary (structural) limbs: live branches leaving the main stem with a base radius ≥ 20 % of the trunk radius at
  // breast height (1.3 m), plus the stem's own continuation once it has divided (in an oak the "stem" above the
  // first big fork is just one of the limbs)
  const R13 = stemRadiusAt(trunk, 1.3);
  const big = offStem.filter((c) => !c.nodes[0].dead && c.nodes[0].r >= 0.2 * R13);
  const primary = big.length ? [...big, stemChain] : big;
  return {
    height: +(max[1]).toFixed(2), crownX: +(max[0] - min[0]).toFixed(2), crownZ: +(max[2] - min[2]).toFixed(2),
    crownWidth: +Math.max(max[0] - min[0], max[2] - min[2]).toFixed(2),
    dbh: +(stemRadiusAt(trunk, 1.3) * 2).toFixed(2), baseDiameter: +((sk.stats() as any).baseDiameter ?? 0),
    primaryLimbs: primary.length, stemBranches: offStem.length, branches: woody.length,
    liveTips: sk.nodes.filter((n) => !n.children.length && !n.dead && !n.root && !n.broken).length,
    deadBranches: woody.filter((c) => c.nodes[0].dead).length, brokenEnds: sk.nodes.filter((n) => n.broken).length,
    nodes: sk.nodes.length, hierarchy, maxOrder: Math.max(...wood.map((n) => n.order)),
    growMs: Math.round(growMs), meshMs: meshMs.map((m) => Math.round(m)),
    history: (info.events as string[] | undefined) ?? [], info,
  };
}

/** Close-up of exposed wood: the thickest broken branch end below 12 m (storm breaks, snapped limbs, pine stubs),
 *  seen from beyond its end and to one side so the broken face and the splinters show. */
function brokenPoi(sk: Skeleton): Poi['broken'] {
  let best: TNode | null = null;
  for (const n of sk.nodes) if (n.broken && !n.root && n.parent && n.p[1] < 12 && n.r > 0.02 && (!best || n.r > best.r)) best = n;
  if (!best) return undefined;
  const d = [best.p[0] - best.parent!.p[0], best.p[1] - best.parent!.p[1], best.p[2] - best.parent!.p[2]];
  // of the two oblique viewpoints, the one on the daylight preset's sun side (so the end is lit, not in its limb's shadow)
  const b = Math.atan2(d[0], d[2]), sun = Math.atan2(0.55, 0.42), ang = (x: number) => Math.abs(Math.atan2(Math.sin(x - sun), Math.cos(x - sun)));
  const az = ang(b + 0.8) < ang(b - 0.8) ? b + 0.8 : b - 0.8;
  return { p: best.p, az, el: 0.15, dist: 0.9 + best.r * 9 };
}

/** Foliage viewpoints: a sunlit shoot on the crown's edge at about two-thirds of the crown's height (close-up and
 *  leaf macro look at it from outside the crown), and the crown's centre (interior, ground-level upward, aerial). */
function crownPoi(f: { lods: { sets: { kind: string; data: Float32Array; count: number }[] }[] }, min: V3, max: V3): Poi['crown'] {
  const set = f.lods[0].sets.find((s) => s.kind === 'leaf' || s.kind === 'needle'); if (!set || !set.count) return undefined;
  const d = set.data, n = set.count, F = 16;
  let cx = 0, cy = 0, cz = 0;
  for (let k = 0; k < n; k++) { cx += d[k * F]; cy += d[k * F + 1]; cz += d[k * F + 2]; }
  cx /= n; cy /= n; cz /= n;
  let lo = 1e9, hi = -1e9; for (let k = 0; k < n; k++) { lo = Math.min(lo, d[k * F + 1]); hi = Math.max(hi, d[k * F + 1]); }
  const want = lo + (hi - lo) * 0.62, sun = Math.atan2(0.55, 0.42);
  // local foliage density (0.4 m cells): the close-ups should land on a full spray or tuft, not a stray leaf
  const cell = (k: number) => `${Math.floor(d[k * F] / 0.4)},${Math.floor(d[k * F + 1] / 0.4)},${Math.floor(d[k * F + 2] / 0.4)}`;
  const dens = new Map<string, number>(); for (let k = 0; k < n; k++) { const c = cell(k); dens.set(c, (dens.get(c) ?? 0) + 1); }
  let dmax = 1; for (const v of dens.values()) dmax = Math.max(dmax, v);
  let best = -1, bs = -1e9, R = 0;
  for (let k = 0; k < n; k++) R = Math.max(R, Math.hypot(d[k * F] - cx, d[k * F + 2] - cz));
  for (let k = 0; k < n; k += 7) {
    const x = d[k * F] - cx, y = d[k * F + 1], z = d[k * F + 2] - cz, r = Math.hypot(x, z);
    const az = Math.atan2(x, z), da = Math.abs(Math.atan2(Math.sin(az - sun), Math.cos(az - sun)));
    const sc = r / Math.max(R, 1) * 3 - Math.abs(y - want) / Math.max(hi - lo, 1) * 4 - da * 1.2 + d[k * F + 12] * 2 + (dens.get(cell(k)) ?? 0) / dmax * 4;
    if (sc > bs) { bs = sc; best = k; }
  }
  const p: V3 = [d[best * F], d[best * F + 1], d[best * F + 2]];
  return { leaf: p, az: Math.atan2(p[0] - cx, p[2] - cz), center: [cx, cy, cz], radius: R, top: hi, low: lo };
}

export function buildSpecimen(id: string, lods: number[] = [0, 1, 2]): BuiltSpecimen {
  const def = specimen(id);
  const t0 = performance.now();
  const { sk, info } = def.grow();
  const growMs = performance.now() - t0;
  const chains = sk.chains();
  const meshes: LodMesh[] = [];
  const meshMs: number[] = [];
  for (const li of [0, 1, 2]) {
    if (!lods.includes(li)) { meshes.push({ v: new Float32Array(0), i: new Uint32Array(0), tris: 0, verts: 0, ms: 0 }); meshMs.push(0); continue; }
    const t1 = performance.now();
    const o = new MeshOut();
    def.mesh ? def.mesh(sk, chains, LODS[li], o) : meshChains(sk, chains, LODS[li], def.bark as BarkFn, o);
    const ms = performance.now() - t1;
    meshes.push({ v: new Float32Array(o.v), i: new Uint32Array(o.i), tris: o.i.length / 3, verts: o.count, ms });
    meshMs.push(ms);
  }
  const foliage = growFoliage(sk, def.foliage);
  const diag = diagnose(sk, chains, info, growMs, meshMs);
  const min: V3 = [1e9, 1e9, 1e9], max: V3 = [-1e9, -1e9, -1e9];
  for (const n of sk.nodes) if (!n.root) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], n.p[k] - n.r); max[k] = Math.max(max[k], n.p[k] + n.r); }
  min[1] = Math.min(min[1], 0);
  return { id, lods: meshes, diag, poi: { ...def.poi(sk), broken: brokenPoi(sk), crown: crownPoi(foliage, min, max) }, bounds: { min, max }, foliage };
}
