import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndexPatterns, EDGE_Z0, EDGE_X1, EDGE_Z1, EDGE_X0 } from '../src/terrain/index-patterns.js';
import { WORLD } from '../src/config.js';

const Q = WORLD.chunkQuads, V = Q + 1;
const P = buildIndexPatterns();
const xy = (v) => [v % V, Math.floor(v / V)];

for (let mask = 0; mask < 16; mask++) {
  test(`index pattern ${mask}: clockwise from above (X east, Z north), no degenerate triangles, exact coverage, watertight, stitched edges`, () => {
    const idx = P.indices.subarray(P.offsets[mask], P.offsets[mask] + P.counts[mask]);
    assert.equal(idx.length % 3, 0);
    let area = 0;
    const edges = new Map();
    for (let t = 0; t < idx.length; t += 3) {
      const [ax, az] = xy(idx[t]), [bx, bz] = xy(idx[t + 1]), [cx, cz] = xy(idx[t + 2]);
      // clockwise seen from +y on a map with x (east) right and z (north) up: cross of (b−a, c−a) in (x, z) is negative
      const a2 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
      assert.ok(a2 < 0, `triangle ${t / 3} not clockwise / degenerate`);
      area += -a2 / 2;
      for (const [p, q] of [[idx[t], idx[t + 1]], [idx[t + 1], idx[t + 2]], [idx[t + 2], idx[t]]]) {
        const k = Math.min(p, q) * 65536 + Math.max(p, q);
        const e = edges.get(k) || { n: 0, dir: 0 };
        e.n++; e.dir += p < q ? 1 : -1; edges.set(k, e);
      }
    }
    assert.equal(area, Q * Q);
    for (const [k, e] of edges) {
      const p = Math.floor(k / 65536), q = k % 65536, [px, pz] = xy(p), [qx, qz] = xy(q);
      const onBoundary = (pz === 0 && qz === 0) || (pz === Q && qz === Q) || (px === 0 && qx === 0) || (px === Q && qx === Q);
      if (onBoundary) {
        assert.equal(e.n, 1, 'boundary edge used once');
        const len = Math.abs(px - qx) + Math.abs(pz - qz);
        const flagged = (pz === 0 && qz === 0 && (mask & EDGE_Z0)) || (pz === Q && qz === Q && (mask & EDGE_Z1)) || (px === 0 && qx === 0 && (mask & EDGE_X0)) || (px === Q && qx === Q && (mask & EDGE_X1));
        assert.equal(len, flagged ? 2 : 1, 'stitched edges have coarse segments, others fine ones');
      } else {
        assert.equal(e.n, 2, 'interior edge shared by exactly two triangles');
        assert.equal(e.dir, 0, 'consistent orientation across the edge');
      }
    }
  });
}
