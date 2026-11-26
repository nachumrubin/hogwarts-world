// Specimen catalogue: every tree the lab (or the world) can grow, as a stable, reproducible configuration.
// Each species has its own growth algorithm (oak: self-organizing light competition; pine: shoot-level period
// simulation with whorls and self-pruning; birch: tropism-driven arching axes with a pendulous twig layer), built on
// the shared framework (skeleton, pipe model, mechanics, ageing, meshing). Pure TypeScript, no DOM: usable by the
// Hogwarts world, the lab's worker and the Node tools alike.
import type { Skeleton, Chain } from '../framework/skeleton.ts';
import { type LodSpec, type MeshOut, type BarkFn, meshChains, FUSE_OVERLAP } from '../framework/mesher.ts';
import { fuse, tubeStarts, type FusionOpts } from '../framework/fusion.ts';
import { type V3, fbm3, noise3, groundAt } from '../framework/math.ts';
import { growOak, oakBark, OAK, OAK_A, OAK_B, OAK_C, type OakConfig } from './oak.ts';
import { growPine, pineBark, PINE } from './pine.ts';
import { growBirch, birchBark, BIRCH } from './birch.ts';
import type { FoliageSpec } from '../framework/foliage.ts';

// ---- summer foliage (framework/foliage.ts). Texture layers: sprites 0 oak, 1 birch, 2 pine; cards 3 oak, 4 birch, 5 pine.
const OAK_LEAVES: FoliageSpec = {
  type: 'broad', spriteLayer: 0, cardLayer: 3, seed: 11, maxR: 0.03, zone: 3.2, spacing: 0.2, shootLen: [0.4, 0.85], diverge: 0.9,
  perShoot: [5, 9], leafLen: [0.085, 0.125], leafy: 0.92, toLight: 0.7, droop: 0, extinction: 0.5, sideLight: 1, shedBelow: 0.15, density: 1,
  spray: { levels: 2, laterals: [3, 5], latLen: [0.45, 0.75], latAngle: [0.55, 1.05], volume: 0.6, sub: [1, 3], subLen: [0.35, 0.6] },
  leavesPerM: 18, reach: 0.6, fullness: 1, interiorCard: 0.3,
  twigR: 0.0025, card: [0.34, 0.34], clump: 1.6, clumpCell: 1.1,
};
const BIRCH_LEAVES: FoliageSpec = {
  // pendulous long shoots with short lateral spurs spreading sideways: wider, airy sprays, not hanging strings
  type: 'broad', spriteLayer: 1, cardLayer: 4, seed: 23, maxR: 0.009, zone: 2.6, spacing: 0.11, shootLen: [0.16, 0.34], diverge: 0.8,
  perShoot: [2, 4], leafLen: [0.05, 0.075], leafy: 1, toLight: 0.5, droop: 0.5, extinction: 0.45, sideLight: 1, shedBelow: 0.12, density: 1,
  spray: { levels: 2, laterals: [2, 4], latLen: [0.45, 0.85], latAngle: [0.8, 1.3], volume: 0.7, sub: [0, 2], subLen: [0.3, 0.55] },
  leavesPerM: 24, reach: 0.25, fullness: 1, interiorCard: 0.22,
  twigR: 0.0012, card: [0.22, 0.22], clump: 1.1, clumpCell: 0.9,
};
const PINE_NEEDLES: FoliageSpec = {
  // tufts: the last years' shoots with a few side shoots, turning up at the tips, needles splaying into rounded tufts
  type: 'pine', spriteLayer: 2, cardLayer: 5, seed: 37, maxR: 0.035, zone: 1.15, spacing: 0.06, shootLen: [0.06, 0.09], diverge: 0.15,
  perShoot: [20, 28], leafLen: [0.06, 0.08], leafy: 1, toLight: 0, droop: 0, extinction: 0.35, sideLight: 1, shedBelow: 0.12, density: 1,
  spray: { levels: 1, laterals: [0, 2], latLen: [0.5, 0.85], latAngle: [0.45, 0.85], volume: 1 }, upturn: 0.5, fullness: 1, interiorCard: 0.25,
  twigR: 0, card: [0.16, 0.16], clump: 1.3, clumpCell: 1.0,
};


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

export interface Poi { trunkY: number; trunkAz: number; trunkDist: number; junction: V3; junctionAz: number; junctionEl: number; junctionDist: number; broken?: { p: V3; az: number; el: number; dist: number };
  crown?: { leaf: V3; az: number; center: V3; radius: number; top: number; low: number } }
export type Status = 'preserved' | 'refined' | 'new' | 'in review';
export interface SpeciesDef {
  id: string; species: string; latin: string; variant: string; name: string; status: Status; summary: string;
  seed: number; preset: string; params: Record<string, unknown>;
  /** bark material family (renderer) */
  material: 'oak' | 'pine' | 'birch';
  /** summer foliage */
  foliage: FoliageSpec;
  crownR: number;
  grow: () => { sk: Skeleton; info: Record<string, unknown> };
  bark: BarkFn;
  mesh?: (sk: Skeleton, chains: Chain[], lod: LodSpec, out: MeshOut) => void;
  poi: (sk: Skeleton) => Poi;
  figure?: [number, number];
}

/** The biggest junction on the stem: where the primary limb with the largest radius leaves the trunk. */
function mainJunction(sk: Skeleton): { p: V3; r: number } {
  let best = { p: [0, 3, 0] as V3, r: 0 };
  for (const n of sk.nodes) if (n.order === 0 && !n.root) for (const c of n.children) if (c.order === 1 && c.r > best.r) best = { p: n.p, r: c.r };
  return best;
}

// Oak A's hollow: a rotted cavity opening on the south-east side of the bole, the heartwood gone behind it
const oakCarve = (p: V3) => {
  const a = 0.75, R = 1.05;
  const dx = p[0] - Math.cos(a) * R, dz = p[2] - Math.sin(a) * R, dy = p[1] - 0.95;
  const opening = Math.sqrt((dx * dx + dz * dz) / (0.42 * 0.42) + (dy * dy) / (0.85 * 0.85)) - 1 + 0.35 * fbm3(p[0] * 2.2, p[1] * 1.6, p[2] * 2.2, 41, 3);
  const hollow = Math.max(Math.hypot(p[0] + 0.05, p[2] - 0.05) - 0.72 - 0.08 * noise3(p[0] * 3, p[1] * 2, p[2] * 3, 42), Math.abs(p[1] - 1.25) - 1.05);
  return Math.min(opening * 0.4, hollow);
};
const region = (min: V3, max: V3, cells: number[], minR: number, bark: BarkFn, blend: number, carve?: FusionOpts['carve'], flare?: FusionOpts['flare']) =>
  (lod: number): FusionOpts | null => (lod >= cells.length ? null : { min, max, cell: cells[lod], minR, bark, blend, carve, ground: groundAt, flare });
// species root flares (see FusionOpts.flare): oaks buttress broadly; old pines swell moderately; birches barely
const OAK_FLARE = { top: 1.2, depth: 0.8, steps: 10, slope: 0.3 };
const PINE_FLARE = { top: 0.8, depth: 0.5, steps: 8, slope: 0.25 };
const BIRCH_FLARE = { top: 0.5, depth: 0.35, steps: 6, slope: 0.2 };

const oakParams = (c: OakConfig) => ({
  'growth model': 'self-organizing (light competition, Borchert–Honda allocation)', periods: c.iterations,
  'growth space (m)': `${c.extent[0] * 2} × ${c.extent[1]} × ${c.extent[2] * 2}`, 'apical control': c.lambda.join(' / '),
  'clear bole (m)': c.boleHeight, 'limb flattening': c.flat.join(' / '), 'shed ratio': c.shedRatio, 'max turn (rad/metamer)': c.maxTurn,
  'height limit (m)': `${c.heightLimit[0]}–${c.heightLimit[1]}`, environment: c.forest ? `closed woodland: canopy from ${c.forest.canopyBase} m, gap radius ${c.forest.room} m` : 'open-grown',
  history: c.events.map((e) => `${e.kind} @ ${e.at}`).join(', '), 'girth radius (m)': c.baseRadius,
  ...(c.outward ? { 'outward pull (secondaries)': c.outward } : {}), ...(c.crownLobes ? { 'crown lobes (m / wavelength m)': c.crownLobes.join(' / ') } : {}),
  ...(c.stemSway ? { 'stem sway (weight / wavelength m)': c.stemSway.join(' / ') } : {}), ...(c.wander ? { 'limb wander': c.wander } : {}),
  ...(c.lowDroop ? { 'shaded low-limb droop': c.lowDroop } : {}), 'structural fairing (iterations)': c.fairIterations ?? 6,
});

const junctionPoi = (sk: Skeleton, trunkY: number, trunkDist: number): Poi => {
  const j = mainJunction(sk);
  return { trunkY, trunkAz: 0.5, trunkDist, junction: j.p, junctionAz: 0.7, junctionEl: 0.2, junctionDist: 2.8 + j.r * 7 };
};

export const SPECIES: SpeciesDef[] = [
  {
    id: 'oak-a', species: 'Pedunculate oak', latin: OAK.latin, variant: 'Survivor', name: 'Oak A — Survivor', status: 'preserved', material: 'oak',
    summary: 'Open-grown veteran from checkpoint 9c024fe. Storm-lost limb, stag-headed top, basal hollow; the one-sided crown is its history.',
    seed: OAK_A.seed, preset: 'OAK_A (open-grown, storm-damaged)', params: oakParams(OAK_A), crownR: 13,
    grow: () => growOak(OAK_A), bark: oakBark as BarkFn, figure: [4.2, 3.2],
    // a declining veteran: a moderately thinner crown than the others, the dead top and storm-broken limb bare
    foliage: { ...OAK_LEAVES, seed: 101, density: 0.88, shedBelow: 0.18, fullness: 0.8 },
    mesh: fusedMesh(oakBark as BarkFn, region([-6, -0.9, -6], [6, 7, 6], [0.055, 0.12], 0.14, oakBark as BarkFn, 0.55, oakCarve, OAK_FLARE)),
    poi: () => ({ trunkY: 1.6, trunkAz: 0.5, trunkDist: 6.5, junction: [0.3, 4.2, -0.1], junctionAz: 0.7, junctionEl: 0.25, junctionDist: 5.5 }),
  },
  {
    id: 'oak-b', species: 'Pedunculate oak', latin: OAK.latin, variant: 'Ancient Guardian', name: 'Oak B — Ancient Guardian', status: 'refined', material: 'oak',
    summary: 'Parkland oak that lost its leader young and spread instead of climbing: broad, balanced crown of long horizontal limbs.',
    seed: OAK_B.seed, preset: 'OAK_B (open parkland, early crown loss)', params: oakParams(OAK_B), crownR: 14,
    grow: () => growOak(OAK_B), bark: oakBark as BarkFn, figure: [4.6, 3.4],
    // vigorous open-grown parkland oak: dense, full to the crown edge, low limbs leafy
    foliage: { ...OAK_LEAVES, seed: 202, density: 1.15, shedBelow: 0.12, reach: 0.45 },
    mesh: fusedMesh(oakBark as BarkFn, region([-7, -0.9, -7], [7, 7.5, 7], [0.055, 0.12], 0.14, oakBark as BarkFn, 0.55, undefined, OAK_FLARE)),
    poi: (sk) => junctionPoi(sk, 1.6, 7),
  },
  {
    id: 'oak-c', species: 'Pedunculate oak', latin: OAK.latin, variant: 'Forest Veteran', name: 'Oak C — Forest Veteran', status: 'refined', material: 'oak',
    summary: 'Grew up in closed woodland: tall clear stem, high narrow crown shaped by the race for the canopy gap.',
    seed: OAK_C.seed, preset: 'OAK_C (closed woodland, light from above)', params: oakParams(OAK_C), crownR: 8,
    grow: () => growOak(OAK_C), bark: oakBark as BarkFn, figure: [3.2, 2.4],
    // forest-grown: light from above only, so foliage gathers in a full upper crown and the shaded flanks are shed
    foliage: { ...OAK_LEAVES, seed: 303, density: 1.1, sideLight: 0.22, shedBelow: 0.2 },
    mesh: fusedMesh(oakBark as BarkFn, region([-3.4, -0.9, -3.4], [3.4, 13.5, 3.4], [0.06, 0.12], 0.12, oakBark as BarkFn, 0.55, undefined, OAK_FLARE)),
    poi: (sk) => junctionPoi(sk, 1.6, 5.5),
  },
  {
    id: 'pine', species: 'Scots pine', latin: PINE.latin, variant: 'Ancient', name: 'Scots Pine — Ancient', status: 'refined', material: 'pine',
    summary: 'Caledonian-type old pine: long self-pruned stem, flat umbrella crown of a few dominant limbs, deadwood and stubs.',
    seed: PINE.seed, preset: 'growPine (50 periods ≈ 300 years)', crownR: 7,
    params: { 'growth model': 'shoot-level period simulation (whorls, light, self-pruning)', periods: 50, 'dominant limbs': '≤ 6, laid down at periods 14–28', 'whorl skip rate': 0.22, wind: 'from SW', 'girth radius (m)': PINE.baseRadius },
    grow: () => growPine(), bark: pineBark as BarkFn, foliage: PINE_NEEDLES,
    mesh: fusedMesh(pineBark as BarkFn, region([-2.6, -0.8, -2.6], [2.6, 2.8, 2.6], [0.035, 0.08], 0.09, pineBark as BarkFn, 0.6, undefined, PINE_FLARE)),
    poi: (sk) => { const j = mainJunction(sk); return { trunkY: 1.5, trunkAz: 0.6, trunkDist: 4.5, junction: j.p, junctionAz: 0.9, junctionEl: 0.15, junctionDist: 3.2 + j.r * 6 }; },
  },
  {
    id: 'birch', species: 'Silver birch', latin: BIRCH.latin, variant: 'Mature', name: 'Silver Birch — Mature', status: 'refined', material: 'birch',
    summary: 'Mature birch: single stem, arching primaries with a pendulous twig layer, broken lower limbs.',
    seed: BIRCH.seed, preset: 'growBirch (tropism-driven axes)', crownR: 5.2, figure: [2.2, 1.6],
    params: { 'growth model': 'tropism-driven arching primaries + pendulous twig layer', 'crown radius (m)': BIRCH.crownR, 'girth radius (m)': BIRCH.baseRadius },
    grow: () => growBirch(), bark: birchBark as BarkFn, foliage: BIRCH_LEAVES,
    mesh: fusedMesh(birchBark as BarkFn, region([-1.5, -0.7, -1.5], [1.5, 2.2, 1.5], [0.025, 0.06], 0.05, birchBark as BarkFn, 0.6, undefined, BIRCH_FLARE)),
    poi: (sk) => { const j = mainJunction(sk); return { trunkY: 1.4, trunkAz: 0.4, trunkDist: 3.2, junction: j.p, junctionAz: 0.6, junctionEl: 0.1, junctionDist: 2.2 }; },
  },
];
