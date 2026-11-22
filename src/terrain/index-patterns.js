// The 16 index buffers shared by all chunks: one per combination of edges that face a coarser neighbour.
//
// Edge bits by grid side: 1 = z-min edge (j = 0, south), 2 = x-max (i = Q, east), 4 = z-max (j = Q, north), 8 = x-min (i = 0, west).
// On a flagged edge every odd vertex is collapsed onto the even vertex before it, so the edge consists of
// exactly the coarse neighbour's vertices (no T-junctions). Triangles that collapse to zero area are dropped.
// Every quad (i,j)-(i+1,j+1) is split along the same diagonal, which the morph targets rely on.
// Winding: with X east and Z north (a left-handed frame) these triangles are clockwise seen from above (+y), so the
// terrain pipeline uses `frontFace: 'cw'` with back-face culling.

import { WORLD, CHUNK_VERTS } from '../config.js';

export const EDGE_Z0 = 1, EDGE_X1 = 2, EDGE_Z1 = 4, EDGE_X0 = 8;

export function buildIndexPatterns(Q = WORLD.chunkQuads) {
  const V = Q + 1;
  const variants = [];
  for (let mask = 0; mask < 16; mask++) {
    const remap = (i, j) => {
      if (j === 0 && (mask & EDGE_Z0) && (i & 1)) i -= 1;
      else if (j === Q && (mask & EDGE_Z1) && (i & 1)) i -= 1;
      if (i === Q && (mask & EDGE_X1) && (j & 1)) j -= 1;
      else if (i === 0 && (mask & EDGE_X0) && (j & 1)) j -= 1;
      return j * V + i;
    };
    const out = [];
    const tri = (a, b, c) => { if (a !== b && b !== c && a !== c) out.push(a, b, c); };
    for (let j = 0; j < Q; j++) for (let i = 0; i < Q; i++) {
      const a = remap(i, j), b = remap(i + 1, j), c = remap(i, j + 1), d = remap(i + 1, j + 1);
      tri(a, d, b); // clockwise from above in the X-east/Z-north frame
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
