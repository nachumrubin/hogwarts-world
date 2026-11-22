// CPU mirror of the terrain vertex shader's morph, used by tests and by collision against the *rendered* surface.
// Keep in sync with src/gpu/shaders/terrain.wgsl.js (function `morphFactor`).

import { WORLD, CHUNK_VERTS } from '../config.js';
import { EDGE_N, EDGE_E, EDGE_S, EDGE_W } from './index-patterns.js';
import { nodeKey } from './quadtree.js';

const Q = WORLD.chunkQuads;

/** Morph factor of a vertex at grid (i, j) of a chunk, given its distance to the camera. */
export function morphFactor(dist, morphRange, finerMask, i, j, morphStart) {
  if (!(morphRange < Infinity)) return 0;
  if (((finerMask & EDGE_N) && j === 0) || ((finerMask & EDGE_S) && j === Q) ||
      ((finerMask & EDGE_W) && i === 0) || ((finerMask & EDGE_E) && i === Q)) return 0;
  const m = (dist - morphStart * morphRange) / ((1 - morphStart) * morphRange);
  return m < 0 ? 0 : m > 1 ? 1 : m;
}

/**
 * Rendered (morphed) terrain height at world (x, z), from the drawn leaves of `tree` and CPU chunk buffers.
 * Returns NaN if no resident data covers the point. Stitched edges are approximated by the unstitched triangulation
 * (difference ≤ the morph delta of one edge vertex).
 */
export function renderedHeightAt(tree, getChunkF32, x, z, cx, cy, cz) {
  const root = tree.rootSize, half = root / 2;
  if (x < -half || z < -half || x >= half || z >= half) return NaN;
  // descend through internal nodes to the drawn leaf
  let d = 0, ix = 0, iz = 0;
  for (;;) {
    if (!tree.internal.has(nodeKey(d, ix, iz))) break;
    d++;
    const size = root / 2 ** d;
    ix = Math.floor((x + half) / size); iz = Math.floor((z + half) / size);
  }
  const key = nodeKey(d, ix, iz);
  const f32 = getChunkF32(key);
  if (!f32) return NaN;
  let leaf = null;
  for (const l of tree.leaves) if (l.key === key) { leaf = l; break; }
  const finer = leaf ? leaf.finer : 0;
  const size = root / 2 ** d, s = size / Q, x0 = ix * size - half, z0 = iz * size - half;
  const fx = (x - x0) / s, fz = (z - z0) / s;
  const i = Math.min(Q - 1, Math.max(0, Math.floor(fx))), j = Math.min(Q - 1, Math.max(0, Math.floor(fz)));
  const u = fx - i, w = fz - j;
  const R = tree.morphRange(d);
  const hv = (ii, jj) => {
    const v = jj * CHUNK_VERTS + ii, h = f32[v * 4], hc = f32[v * 4 + 1];
    const vx = x0 + ii * s - cx, vy = h - cy, vz = z0 + jj * s - cz;
    const m = morphFactor(Math.sqrt(vx * vx + vy * vy + vz * vz), R, finer, ii, jj, tree.morphStart);
    return h + (hc - h) * m;
  };
  // triangles (a, d, b) below the diagonal (u ≥ w) and (a, c, d) above it
  const ha = hv(i, j), hd = hv(i + 1, j + 1);
  if (u >= w) { const hb = hv(i + 1, j); return ha + (hb - ha) * u + (hd - hb) * w; }
  const hc = hv(i, j + 1); return ha + (hd - hc) * u + (hc - ha) * w;
}
