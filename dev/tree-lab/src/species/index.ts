// The three specimens. Each species has its own growth algorithm (oak: space colonization; pine: shoot-level growth
// simulation with light competition; birch: tropism-driven axes with a pendulous twig layer) on the shared
// framework (skeleton, pipe model, mechanics, ageing, meshing).
import type { Skeleton, Chain } from '../framework/skeleton.ts';
import type { LodSpec, MeshOut, BarkFn } from '../framework/mesher.ts';
import type { V3 } from '../framework/math.ts';
import { growOak, oakBark, OAK } from './oak.ts';
import { growPine, pineBark, PINE } from './pine.ts';
import { growBirch, birchBark, BIRCH } from './birch.ts';

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

export const SPECIES: SpeciesDef[] = [
  { id: 'pine', name: PINE.name, latin: PINE.latin, crownR: 6.5, grow: () => growPine(), bark: pineBark as BarkFn, figure: [3.2, 2.2],
    poi: (sk) => { const j = mainJunction(sk); return { trunkY: 1.5, trunkAz: 0.6, trunkDist: 4.5, junction: j.p, junctionAz: 0.9, junctionEl: 0.15, junctionDist: 3.2 + j.r * 6, interiorEye: [1.2, 8, -1.5], interiorYaw: 2.4, interiorPitch: 0.9 }; } },
  { id: 'oak', name: OAK.name, latin: OAK.latin, crownR: 13, grow: () => growOak(), bark: oakBark as BarkFn, figure: [4.2, 3.2],
    poi: () => ({ trunkY: 1.6, trunkAz: 0.5, trunkDist: 6.5, junction: [0.3, 4.2, -0.1], junctionAz: 0.7, junctionEl: 0.25, junctionDist: 5.5, interiorEye: [2.5, 5.5, 1.5], interiorYaw: 0.8, interiorPitch: 0.75 }) },
  { id: 'birch', name: BIRCH.name, latin: BIRCH.latin, crownR: 5.2, grow: () => growBirch(), bark: birchBark as BarkFn, figure: [2.2, 1.6],
    poi: (sk) => { const j = mainJunction(sk); return { trunkY: 1.4, trunkAz: 0.4, trunkDist: 3.2, junction: j.p, junctionAz: 0.6, junctionEl: 0.1, junctionDist: 2.2, interiorEye: [0.9, 8.5, 0.9], interiorYaw: 0.8, interiorPitch: 0.95 }; } },
];
