import test from 'node:test';
import assert from 'node:assert/strict';
import { chunk } from './helpers.js';
import { WORLD } from '../src/config.js';

const Q = WORLD.chunkQuads, V = Q + 1;
const u32 = (c) => new Uint32Array(c.buffer), f32 = (c) => new Float32Array(c.buffer);

test('same-level neighbours share bit-identical edge vertices (height, morph target, normals)', () => {
  for (const d of [3, 6, 8]) {
    const n = 2 ** d, base = Math.floor(n / 2) - 1;
    for (let k = 0; k < 3; k++) {
      const ix = base + k, iz = base - k;
      const A = u32(chunk(d, ix, iz)), E = u32(chunk(d, ix + 1, iz)), S = u32(chunk(d, ix, iz + 1));
      for (let t = 0; t < V; t++) for (let w = 0; w < 4; w++) {
        assert.equal(A[(t * V + Q) * 4 + w], E[(t * V + 0) * 4 + w], `east edge d${d} t${t} w${w}`);
        assert.equal(A[(Q * V + t) * 4 + w], S[(0 * V + t) * 4 + w], `south edge d${d} t${t} w${w}`);
      }
    }
  }
});

test('fine chunk even edge vertices coincide with the coarse neighbour and are not morphed', () => {
  // fine node (8, 128, 120) west edge touches coarse node (7, 63, 60)'s east edge
  const fine = f32(chunk(8, 128, 120)), coarse = f32(chunk(7, 63, 60));
  // fine west edge spans z rows 0..Q, which is the upper half (rows 0..Q/2) of the coarse east edge (iz 120 = 2·60)
  for (let j = 0; j <= Q; j += 2) {
    const vf = j * V + 0, vc = (j / 2) * V + Q;
    assert.equal(fine[vf * 4], coarse[vc * 4], `height at fine row ${j}`);
    assert.equal(fine[vf * 4 + 1], fine[vf * 4], 'even vertices have morph target = own height');
  }
});

test('morph targets reproduce the parent surface exactly', () => {
  for (const [d, ix, iz] of [[8, 131, 126], [6, 30, 33], [3, 4, 3]]) {
    const child = f32(chunk(d, ix, iz)), parent = f32(chunk(d - 1, ix >> 1, iz >> 1));
    const oi = (ix & 1) * Q / 2, oj = (iz & 1) * Q / 2;
    const ph = (pi, pj) => parent[(pj * V + pi) * 4];
    let maxErr = 0;
    for (let j = 0; j <= Q; j++) for (let i = 0; i <= Q; i++) {
      // child vertex (i, j) sits at parent grid coordinate ((i/2)+oi, (j/2)+oj)
      const px = i / 2 + oi, pz = j / 2 + oj, pi = Math.min(Q - 1, Math.floor(px)), pj = Math.min(Q - 1, Math.floor(pz));
      const u = px - pi, w = pz - pj;
      let expect;
      if (u === 0 && w === 0) expect = ph(pi, pj);
      else if (u >= w) { const ha = ph(pi, pj), hb = ph(pi + 1, pj), hd = ph(pi + 1, pj + 1); expect = ha + (hb - ha) * u + (hd - hb) * w; }
      else { const ha = ph(pi, pj), hc = ph(pi, pj + 1), hd = ph(pi + 1, pj + 1); expect = ha + (hd - hc) * u + (hc - ha) * w; }
      maxErr = Math.max(maxErr, Math.abs(child[(j * V + i) * 4 + 1] - expect));
    }
    assert.ok(maxErr < 1e-3, `depth ${d}: morph target deviates ${maxErr} m from parent surface`);
  }
});
