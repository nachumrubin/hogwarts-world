// The three specimens. Each species has its own growth algorithm (oak: space colonization; pine: shoot-level growth
// simulation with light competition; birch: tropism-driven axes with a pendulous twig layer) on the shared
// framework (skeleton, pipe model, mechanics, ageing, meshing).
import type { Skeleton, Chain } from '../framework/skeleton.ts';
import { type LodSpec, type MeshOut, type BarkFn, meshChains, FUSE_OVERLAP } from '../framework/mesher.ts';
import { fuse, tubeStarts, type FusionOpts } from '../framework/fusion.ts';
import { type V3, fbm3, noise3 } from '../framework/math.ts';
import { growOak, oakBark, OAK } from './oak.ts';
import { growPine, pineBark, PINE } from './pine.ts';
import { growBirch, birchBark, BIRCH } from './birch.ts';

/** Fused junction/root-base mesh where the tree is thick, swept tubes elsewhere. */
function fusedMesh(bark: BarkFn, region: (lod: number) => FusionOpts | null) {
  return (sk: Skeleton, chains: Chain[], lod: LodSpec, out: MeshOut) => {
    const li = lod.step < 2 ? 0 : lod.step < 4 ? 1 : 2;
    const o = region(li);
    if (!o) { meshChains(sk, chains, lod, bark, out); return; }
    const starts = tubeStarts(chains, o, FUSE_OVERLAP);
    fuse(sk, o, out);
    meshChains(sk, chains, lod, o.bark, out, { startCut: (c) => starts.get(c) ?? 0 });
  };
}

export interface Poi { trunkY: number; trunkAz: number; trunkDist: number; junction: V3; junctionAz: number; junctionEl: number; junctionDist: number; interiorEye: number[]; interiorYaw: number; interiorPitch: number }
export interface SpeciesDef {
  id: string; name: string; latin: string; crownR: number;
  grow: () => { sk: Skeleton; info: Record<string, unknown> };
  bark: BarkFn;
  mesh?: (sk: Skeleton, chains: Chain[], lod: LodSpec, out: MeshOut) => void;
  poi: (sk: Skeleton) => Poi;
  figure?: [number, number];
}

/** The biggest junction on the stem: where the first primary limb with the largest radius leaves the trunk. */
function mainJunction(sk: Skeleton): { p: V3; r: number } {
  let best = { p: [0, 3, 0] as V3, r: 0 };
  for (const n of sk.nodes) if (n.order === 0 && !n.root) for (const c of n.children) if (c.order === 1 && c.r > best.r) best = { p: n.p, r: c.r };
  return best;
}

// the oak's hollow: a cavity opening on the south-east side of the bole, the heartwood rotted out behind it
const oakCarve = (p: V3) => {
  // opening: a tall rotted cavity on the south-east face of the bole; behind it the heartwood is gone
  const a = 0.75, R = 1.05;
  const dx = p[0] - Math.cos(a) * R, dz = p[2] - Math.sin(a) * R, dy = p[1] - 0.95;
  // irregular, rotted edge: the outline wanders and the rim is uneven
  const opening = Math.sqrt((dx * dx + dz * dz) / (0.42 * 0.42) + (dy * dy) / (0.85 * 0.85)) - 1 + 0.35 * fbm3(p[0] * 2.2, p[1] * 1.6, p[2] * 2.2, 41, 3);
  const hollow = Math.max(Math.hypot(p[0] + 0.05, p[2] - 0.05) - 0.72 - 0.08 * noise3(p[0] * 3, p[1] * 2, p[2] * 3, 42), Math.abs(p[1] - 1.25) - 1.05);
  return Math.min(opening * 0.4, hollow);
};
const region = (min: V3, max: V3, cells: number[], minR: number, bark: BarkFn, blend: number, carve?: FusionOpts['carve']) =>
  (lod: number): FusionOpts | null => (lod >= cells.length ? null : { min, max, cell: cells[lod], minR, bark, blend, carve });

export const SPECIES: SpeciesDef[] = [
  { id: 'pine', name: PINE.name, latin: PINE.latin, crownR: 6.5, grow: () => growPine(), bark: pineBark as BarkFn, figure: [3.2, 2.2],
    mesh: fusedMesh(pineBark as BarkFn, region([-2.6, -0.8, -2.6], [2.6, 1.6, 2.6], [0.035, 0.08], 0.09, pineBark as BarkFn, 0.6)),
    poi: (sk) => { const j = mainJunction(sk); return { trunkY: 1.5, trunkAz: 0.6, trunkDist: 4.5, junction: j.p, junctionAz: 0.9, junctionEl: 0.15, junctionDist: 3.2 + j.r * 6, interiorEye: [1.2, 8, -1.5], interiorYaw: 2.4, interiorPitch: 0.9 }; } },
  { id: 'oak', name: OAK.name, latin: OAK.latin, crownR: 13, grow: () => growOak(), bark: oakBark as BarkFn, figure: [4.2, 3.2],
    mesh: fusedMesh(oakBark as BarkFn, region([-6, -0.9, -6], [6, 7, 6], [0.055, 0.12], 0.14, oakBark as BarkFn, 0.55, oakCarve)),
    poi: () => ({ trunkY: 1.6, trunkAz: 0.5, trunkDist: 6.5, junction: [0.3, 4.2, -0.1], junctionAz: 0.7, junctionEl: 0.25, junctionDist: 5.5, interiorEye: [2.5, 5.5, 1.5], interiorYaw: 0.8, interiorPitch: 0.75 }) },
  { id: 'birch', name: BIRCH.name, latin: BIRCH.latin, crownR: 5.2, grow: () => growBirch(), bark: birchBark as BarkFn, figure: [2.2, 1.6],
    mesh: fusedMesh(birchBark as BarkFn, region([-1.5, -0.7, -1.5], [1.5, 1.2, 1.5], [0.025, 0.06], 0.05, birchBark as BarkFn, 0.6)),
    poi: (sk) => { const j = mainJunction(sk); return { trunkY: 1.4, trunkAz: 0.4, trunkDist: 3.2, junction: j.p, junctionAz: 0.6, junctionEl: 0.1, junctionDist: 2.2, interiorEye: [0.9, 8.5, 0.9], interiorYaw: 0.8, interiorPitch: 0.95 }; } },
];
