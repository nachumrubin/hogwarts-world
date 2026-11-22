// Species of the Forbidden Forest test stand: native Scottish ancient woodland (Caledonian pinewood with oak and birch).
// Sizes are typical for mature trees in a sheltered Highland glen; veterans are larger.

export type Species = 'pine' | 'oak' | 'birch' | 'rowan' | 'holly' | 'hazel';
export const SPECIES: Species[] = ['pine', 'oak', 'birch', 'rowan', 'holly', 'hazel'];
export type AgeClass = 'sapling' | 'young' | 'mature' | 'veteran' | 'snag';

export interface SpeciesInfo {
  /** canopy tree or understorey */
  canopy: boolean;
  /** mature height range (m) */
  height: [number, number];
  /** crown radius as a fraction of height */
  crownFrac: number;
  /** leaf density for canopy shading (relative) */
  leafDensity: number;
  /** litter type under the crown: 0 broadleaf, 1 needles */
  litter: 0 | 1;
  /** archetypes generated per age class */
  archetypes: Partial<Record<AgeClass, number>>;
  /** wind stiffness (1 = average) */
  stiffness: number;
}

export const SPECIES_INFO: Record<Species, SpeciesInfo> = {
  pine: { canopy: true, height: [17, 24], crownFrac: 0.26, leafDensity: 0.7, litter: 1, archetypes: { sapling: 2, young: 3, mature: 7, snag: 2 }, stiffness: 1.25 },
  oak: { canopy: true, height: [15, 21], crownFrac: 0.42, leafDensity: 1.0, litter: 0, archetypes: { young: 3, mature: 7 }, stiffness: 1.4 },
  birch: { canopy: true, height: [12, 18], crownFrac: 0.26, leafDensity: 0.55, litter: 0, archetypes: { sapling: 2, young: 3, mature: 6, snag: 1 }, stiffness: 0.75 },
  rowan: { canopy: false, height: [6, 10], crownFrac: 0.35, leafDensity: 0.6, litter: 0, archetypes: { sapling: 1, young: 3 }, stiffness: 0.9 },
  holly: { canopy: false, height: [3.5, 7], crownFrac: 0.38, leafDensity: 1.4, litter: 0, archetypes: { young: 4 }, stiffness: 1.5 },
  hazel: { canopy: false, height: [3.5, 6], crownFrac: 0.5, leafDensity: 0.9, litter: 0, archetypes: { young: 3 }, stiffness: 0.85 },
};

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hashSeed = (...n: number[]): number => {
  let h = 0x811c9dc5;
  for (const v of n) { h ^= (v * 2654435761) >>> 0; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
};
