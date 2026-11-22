// The 16 index buffers shared by all chunks: one per combination of edges that face a coarser neighbour.
//
// Edge bits: 1 = north (j = 0, −z), 2 = east (i = Q), 4 = south (j = Q), 8 = west (i = 0).
// On a flagged edge every odd vertex is collapsed onto the even vertex before it, so the edge consists of
// exactly the coarse neighbour's vertices (no T-junctions). Triangles that collapse to zero area are dropped.
// Every quad (i,j)-(i+1,j+1) is split along the same diagonal, which the morph targets rely on.
// Winding: counter-clockwise seen from above (+y), so `frontFace: 'ccw'` with back-face culling keeps the top side.

import { WORLD, CHUNK_VERTS } from '../config.js';

export const EDGE_N = 1, EDGE_E = 2, EDGE_S = 4, EDGE_W = 8;

export function buildIndexPatterns(Q = WORLD.chunkQuads) {
  const V = Q + 1;
  const variants = [];
  for (let mask = 0; mask < 16; mask++) {
    const remap = (i, j) => {
      if (j === 0 && (mask & EDGE_N) && (i & 1)) i -= 1;
      else if (j === Q && (mask & EDGE_S) && (i & 1)) i -= 1;
      if (i === Q && (mask & EDGE_E) && (j & 1)) j -= 1;
      else if (i === 0 && (mask & EDGE_W) && (j & 1)) j -= 1;
      return j * V + i;
    };
    const out = [];
    const tri = (a, b, c) => { if (a !== b && b !== c && a !== c) out.push(a, b, c); };
    for (let j = 0; j < Q; j++) for (let i = 0; i < Q; i++) {
      const a = remap(i, j), b = remap(i + 1, j), c = remap(i, j + 1), d = remap(i + 1, j + 1);
      tri(a, d, b); // CCW from above: see docs/ARCHITECTURE.md §3.2
      tri(a, c, d);
    }
    variants.push(out);
  }
  const total = variants.reduce((n, v) => n + v.length, 0);
  const indices = new (V * V > 65535 ? Uint32Array : Uint16Array)(total + (total & 1)); // pad to 4 bytes
  const offsets = new Uint32Array(16), counts = new Uint32Array(16);
  let o = 0;
  variants.forEach((v, m) => { offsets[m] = o; counts[m] = v.length; indices.set(v, o); o += v.length; });
  return { indices, offsets, counts, format: indices instanceof Uint16Array ? 'uint16' : 'uint32' };
}

export const VERTS_PER_SIDE = CHUNK_VERTS;
