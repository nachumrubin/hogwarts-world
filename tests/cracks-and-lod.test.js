// Simulates the vertex shader on the CPU (positions + morph) over real generated chunks and checks
// (1) watertightness between all drawn chunks and (2) how much geometry changes at LOD switches ("popping").
import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainQuadtree } from '../src/terrain/quadtree.js';
import { buildIndexPatterns, EDGE_N, EDGE_E, EDGE_S, EDGE_W } from '../src/terrain/index-patterns.js';
import { morphFactor } from '../src/terrain/morph.js';
import { WORLD, CHUNK_VERTS as V } from '../src/config.js';
import { chunk, gen, rng } from './helpers.js';

const Q = WORLD.chunkQuads, HALF = WORLD.rootSize / 2;
const P = buildIndexPatterns();
const keyToNode = (k) => [Math.floor(k / 4294967296), Math.floor(k / 65536) % 65536, k % 65536];
const boundsOf = (k) => { const [d, x, z] = keyToNode(k); return d <= 8 ? chunk(d, x, z) : null; };

function vertexPos(tree, l, i, j, cam) {
  const size = WORLD.rootSize / 2 ** l.depth, s = size / Q, x = l.ix * size - HALF + i * s, z = l.iz * size - HALF + j * s;
  const f = new Float32Array(chunk(l.depth, l.ix, l.iz).buffer), v = j * V + i, h = f[v * 4], hc = f[v * 4 + 1];
  const dist = Math.hypot(x - cam[0], h - cam[1], z - cam[2]);
  const m = morphFactor(dist, tree.morphRange(l.depth), l.finer, i, j, tree.morphStart);
  return [x, h + (hc - h) * m, z];
}

test('drawn chunks are watertight (no T-junctions, shared vertices bit-identical) with morphing active', () => {
  const r = rng(5);
  const cams = [[0, 60, 0], [-300, 25, 120], [420, 300, -380]];
  for (let k = 0; k < 3; k++) cams.push([(r() - 0.5) * 1800, 15 + r() * 250, (r() - 0.5) * 1800]);
  for (const cam of cams) {
    const tree = new TerrainQuadtree({ lodFactor: 2.5, isResident: () => true, boundsOf });
    tree.select(...cam);
    const pos = new Map(); // "x,z" → y
    const segs = [];
    let shared = 0;
    for (const l of tree.leaves) {
      const used = new Set();
      const idx = P.indices.subarray(P.offsets[l.coarser], P.offsets[l.coarser] + P.counts[l.coarser]);
      for (const v of idx) used.add(v);
      const edgeVerts = [[(t) => [t, 0], EDGE_N], [(t) => [Q, t], EDGE_E], [(t) => [t, Q], EDGE_S], [(t) => [0, t], EDGE_W]];
      for (const [f] of edgeVerts) {
        let prev = null;
        for (let t = 0; t <= Q; t++) {
          const [i, j] = f(t);
          if (!used.has(j * V + i)) continue;
          const p = vertexPos(tree, l, i, j, cam), key = p[0] + ',' + p[2];
          if (pos.has(key)) { assert.ok(Object.is(pos.get(key), p[1]), `shared vertex ${key} differs: ${pos.get(key)} vs ${p[1]}`); shared++; }
          else pos.set(key, p[1]);
          if (prev) segs.push([prev, p]);
          prev = p;
        }
      }
    }
    // T-junction: a vertex of some chunk lying strictly inside another chunk's edge segment
    for (const [a, b] of segs) {
      const len = Math.abs(b[0] - a[0]) + Math.abs(b[2] - a[2]);
      for (let q = 1; q < 4; q++) {
        const mx = a[0] + (b[0] - a[0]) * q / 4, mz = a[2] + (b[2] - a[2]) * q / 4;
        assert.ok(!pos.has(mx + ',' + mz), `T-junction at ${mx},${mz} on a segment of length ${len}`);
      }
    }
    assert.ok(shared > 100);
  }
});

test('LOD switches along a low flight are geometrically continuous (sub-pixel popping)', () => {
  // Flight over the loch shore and up a valley wall, 3 m steps. At every split/merge compare the surface just drawn
  // with the surface drawn the step before, at the vertices of the finer level, and project the difference to pixels
  // for a 1080p, 60° vertical FOV view.
  const K = 540 / Math.tan(Math.PI / 6);
  const tree = new TerrainQuadtree({ lodFactor: 2.5, isResident: () => true, boundsOf });
  const path = [];
  for (let t = 0; t <= 1; t += 1 / 400) {
    const x = -700 + 1300 * t, z = 140 - 520 * t * t;
    path.push([x, gen.heightAt(x, z) + 18 + 120 * t * t, z]);
  }
  const surface = (tr, l, i, j, cam) => vertexPos(tr, l, i, j, cam)[1];
  let prev = null, switches = 0, worstPx = 0, worstM = 0;
  for (const cam of path) {
    tree.select(...cam);
    const cur = new Map(tree.leaves.map((l) => [l.key, { ...l }]));
    if (prev) {
      for (const [k, l] of cur) {
        if (prev.has(k) || l.depth === 0) continue;
        // l is newly drawn: its parent (or itself as a merged parent of previous children) changed state
        const pk = ((l.depth - 1) * 65536 + (l.ix >> 1)) * 65536 + (l.iz >> 1);
        if (!prev.has(pk)) continue; // only parent → children splits here; merges are the mirror image
        switches++;
        const p = prev.get(pk);
        const pTree = { morphRange: (d) => tree.morphRange(d), morphStart: tree.morphStart };
        for (let j = 0; j <= Q; j++) for (let i = 0; i <= Q; i++) {
          const [x, yc, z] = vertexPos(tree, l, i, j, cam);
          // parent surface at the same xz, evaluated with the parent's triangle (child grid point = half parent grid)
          const pi = i / 2 + (l.ix & 1) * Q / 2, pj = j / 2 + (l.iz & 1) * Q / 2;
          const i0 = Math.min(Q - 1, Math.floor(pi)), j0 = Math.min(Q - 1, Math.floor(pj)), u = pi - i0, w = pj - j0;
          const sp = (a, b) => surface(pTree, p, a, b, cam);
          const yp = u >= w ? sp(i0, j0) + (sp(i0 + 1, j0) - sp(i0, j0)) * u + (sp(i0 + 1, j0 + 1) - sp(i0 + 1, j0)) * w
                            : sp(i0, j0) + (sp(i0 + 1, j0 + 1) - sp(i0, j0 + 1)) * u + (sp(i0, j0 + 1) - sp(i0, j0)) * w;
          const err = Math.abs(yc - yp), dist = Math.hypot(x - cam[0], yc - cam[1], z - cam[2]);
          worstM = Math.max(worstM, err); worstPx = Math.max(worstPx, err / dist * K);
        }
      }
    }
    prev = cur;
  }
  console.log(`  LOD splits observed: ${switches}, worst geometric change ${worstM.toFixed(4)} m = ${worstPx.toFixed(3)} px @1080p`);
  assert.ok(switches > 20);
  assert.ok(worstPx < 0.5, `popping ${worstPx} px`);
});
