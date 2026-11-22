// Builds the vertex data of one quadtree node ("chunk"). CPU only; runs in workers and in node tests.
//
// Every chunk is a (Q+1)×(Q+1) vertex grid (Q = WORLD.chunkQuads). Per vertex we store, packed in 16 bytes:
//   u32 0  height (f32 bits)
//   u32 1  morph-target height: the parent level's surface height at this vertex's xz (f32 bits)
//   u32 2  normal xz as 2 × snorm16 (y is reconstructed, the terrain is a heightfield so y > 0)
//   u32 3  morph-target normal xz as 2 × snorm16
//
// Morph targets: the parent chunk has vertices at the even positions. Its triangles use the same diagonal
// direction (i,j)→(i+1,j+1) as ours, so the parent surface at an odd vertex is the average of exactly two even
// neighbours: along the edge for edge-midpoints, along the diagonal for quad centres. A fully morphed chunk
// therefore reproduces the parent's geometry exactly, which is what makes LOD switches invisible.
//
// World positions are computed from integers: x = rootMinX + (ix·Q + i)·s, with s a power of two. That is exact in
// f64, so a vertex shared by two chunks (same or different level) gets a bit-identical height.

import { WORLD, CHUNK_VERTS, CHUNK_VERTEX_COUNT } from '../config.js';

const Q = WORLD.chunkQuads;
const B = 2; // border samples on each side (normals need ±1, morph-target normals need ±2)
const SN = CHUNK_VERTS + 2 * B; // sample grid side

export function nodeSize(depth, rootSize = WORLD.rootSize) { return rootSize / 2 ** depth; }
export function nodeSpacing(depth, rootSize = WORLD.rootSize) { return rootSize / 2 ** depth / Q; }
/** World-space minimum corner of a node. */
export function nodeOrigin(depth, ix, iz, rootSize = WORLD.rootSize) {
  const s = nodeSize(depth, rootSize);
  return [WORLD.rootMinX + ix * s, WORLD.rootMinZ + iz * s];
}

function packSnorm16x2(a, b) {
  const qa = Math.round(Math.max(-1, Math.min(1, a)) * 32767) & 0xffff;
  const qb = Math.round(Math.max(-1, Math.min(1, b)) * 32767) & 0xffff;
  return (qa | (qb << 16)) >>> 0;
}
export function unpackSnorm16x2(u, out) {
  let a = u & 0xffff, b = u >>> 16;
  if (a > 32767) a -= 65536;
  if (b > 32767) b -= 65536;
  out[0] = Math.max(-1, a / 32767); out[1] = Math.max(-1, b / 32767);
  return out;
}

/**
 * Generate one chunk.
 * @param {{heightAt(x:number,z:number):number}} gen
 * @returns {{buffer: ArrayBuffer, minY: number, maxY: number}}
 */
export function buildChunk(gen, depth, ix, iz, rootSize = WORLD.rootSize) {
  const s = nodeSpacing(depth, rootSize), x0 = WORLD.rootMinX, z0 = WORLD.rootMinZ;
  const bx = ix * Q, bz = iz * Q;
  const H = new Float64Array(SN * SN);
  for (let j = 0; j < SN; j++) {
    const z = z0 + (bz + j - B) * s;
    for (let i = 0; i < SN; i++) H[j * SN + i] = gen.heightAt(x0 + (bx + i - B) * s, z);
  }
  const h = (i, j) => H[(j + B) * SN + (i + B)];

  const buffer = new ArrayBuffer(CHUNK_VERTEX_COUNT * 16);
  const f32 = new Float32Array(buffer), u32 = new Uint32Array(buffer);
  // per-vertex normals (own spacing) and parent-level normals at even vertices (2× spacing)
  const NX = new Float64Array(CHUNK_VERTEX_COUNT), NZ = new Float64Array(CHUNK_VERTEX_COUNT);
  const CX = new Float64Array(CHUNK_VERTEX_COUNT), CZ = new Float64Array(CHUNK_VERTEX_COUNT);
  let minY = Infinity, maxY = -Infinity;
  for (let j = 0; j < CHUNK_VERTS; j++) for (let i = 0; i < CHUNK_VERTS; i++) {
    const v = j * CHUNK_VERTS + i;
    let nx = -(h(i + 1, j) - h(i - 1, j)) / (2 * s), nz = -(h(i, j + 1) - h(i, j - 1)) / (2 * s), l = Math.sqrt(nx * nx + 1 + nz * nz);
    NX[v] = nx / l; NZ[v] = nz / l;
    if (!(i & 1) && !(j & 1)) {
      nx = -(h(i + 2, j) - h(i - 2, j)) / (4 * s); nz = -(h(i, j + 2) - h(i, j - 2)) / (4 * s); l = Math.sqrt(nx * nx + 1 + nz * nz);
      CX[v] = nx / l; CZ[v] = nz / l;
    }
    const y = h(i, j);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  for (let j = 0; j < CHUNK_VERTS; j++) for (let i = 0; i < CHUNK_VERTS; i++) {
    const v = j * CHUNK_VERTS + i, oi = i & 1, oj = j & 1;
    // the two even neighbours whose average is the parent surface here (same vertex twice when even/even)
    const a = (j - oj) * CHUNK_VERTS + (i - oi), b = (j + oj) * CHUNK_VERTS + (i + oi);
    const ha = h(i - oi, j - oj), hb = h(i + oi, j + oj);
    let cx = (CX[a] + CX[b]) * 0.5, cz = (CZ[a] + CZ[b]) * 0.5;
    const cy2 = Math.sqrt(1 - CX[a] * CX[a] - CZ[a] * CZ[a]) + Math.sqrt(1 - CX[b] * CX[b] - CZ[b] * CZ[b]);
    const l = Math.sqrt(cx * cx + cz * cz + cy2 * cy2 * 0.25);
    cx /= l; cz /= l;
    f32[v * 4] = h(i, j);
    f32[v * 4 + 1] = (oi || oj) ? (ha + hb) * 0.5 : h(i, j);
    u32[v * 4 + 2] = packSnorm16x2(NX[v], NZ[v]);
    u32[v * 4 + 3] = packSnorm16x2(cx, cz);
  }
  return { buffer, minY, maxY };
}

/** Decoded accessors for a chunk buffer (tests, collision). */
export function chunkHeights(buffer) { return new Float32Array(buffer); }
