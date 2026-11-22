import { WorldTerrain } from '../src/world/world-terrain.ts';
import { buildChunk } from '../src/terrain/chunk-mesher.js';
import { WORLD } from '../src/config.js';

export const gen = new WorldTerrain();
const cache = new Map();
/** Cached chunk generation keyed by depth/ix/iz (tests only). */
export function chunk(d, ix, iz) {
  const k = `${d}/${ix}/${iz}`;
  if (!cache.has(k)) cache.set(k, buildChunk(gen, d, ix, iz));
  return cache.get(k);
}
/** Deterministic test RNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
