// Specimen build: grow → mesh every LOD → measure. Pure (no DOM, no GPU): runs in the lab's worker, in Node tools,
// and is what the Hogwarts world would call to get a tree's geometry.
import { MeshOut, meshChains, LODS, type BarkFn } from './framework/mesher.ts';
import type { Skeleton, Chain, TNode } from './framework/skeleton.ts';
import { type V3 } from './framework/math.ts';
import { SPECIES, type SpeciesDef, type Poi } from './species/index.ts';

export interface LodMesh { v: Float32Array; i: Uint32Array; tris: number; verts: number; ms: number }
export interface Diagnostics {
  height: number; crownX: number; crownZ: number; crownWidth: number; dbh: number; baseDiameter: number;
  primaryLimbs: number; stemBranches: number; branches: number; liveTips: number; deadBranches: number; brokenEnds: number;
  nodes: number; hierarchy: number[]; maxOrder: number;
  growMs: number; meshMs: number[]; history: string[]; info: Record<string, unknown>;
}
export interface BuiltSpecimen {
  id: string; lods: LodMesh[]; diag: Diagnostics; poi: Poi;
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
  const diag = diagnose(sk, chains, info, growMs, meshMs);
  const min: V3 = [1e9, 1e9, 1e9], max: V3 = [-1e9, -1e9, -1e9];
  for (const n of sk.nodes) if (!n.root) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], n.p[k] - n.r); max[k] = Math.max(max[k], n.p[k] + n.r); }
  min[1] = Math.min(min[1], 0);
  return { id, lods: meshes, diag, poi: def.poi(sk), bounds: { min, max } };
}
