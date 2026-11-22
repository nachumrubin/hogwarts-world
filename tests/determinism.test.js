import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGenerator } from '../src/terrain/generator.js';
import { buildChunk } from '../src/terrain/chunk-mesher.js';
import { WORLD } from '../src/config.js';
import { rng } from './helpers.js';

// FNV-1a over the IEEE-754 bit patterns of a fixed sample grid. If the terrain recipe is changed on purpose,
// update GOLDEN (the failure message prints the new value); an unexpected change means generation is not deterministic.
const GOLDEN = process.env.GOLDEN_OVERRIDE || '6beafc7e';
function gridHash(gen) {
  const f = new Float64Array(1), u = new Uint32Array(f.buffer);
  let h = 0x811c9dc5;
  for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
    f[0] = gen.heightAt(-4000 + i * 125.37, -4000 + j * 125.37);
    for (const w of u) for (let b = 0; b < 4; b++) { h ^= (w >>> (b * 8)) & 255; h = Math.imul(h, 0x01000193); }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

test('same seed gives bit-identical heights, independent of evaluation order', () => {
  const a = new TerrainGenerator(WORLD.seed), b = new TerrainGenerator(WORLD.seed), r = rng(7);
  const pts = Array.from({ length: 5000 }, () => [(r() - 0.5) * 8192, (r() - 0.5) * 8192]);
  const ha = pts.map(([x, z]) => a.heightAt(x, z));
  const hb = pts.slice().reverse().map(([x, z]) => b.heightAt(x, z)).reverse();
  for (let i = 0; i < pts.length; i++) assert.ok(Object.is(ha[i], hb[i]), `mismatch at ${pts[i]}`);
});

test('different seeds give different worlds', () => {
  const a = new TerrainGenerator(1), b = new TerrainGenerator(2);
  let diff = 0;
  for (let i = 0; i < 200; i++) if (a.heightAt(i * 37.1 - 3000, i * 11.3 - 900) !== b.heightAt(i * 37.1 - 3000, i * 11.3 - 900)) diff++;
  assert.ok(diff > 190);
});

test('golden hash of the default world', () => {
  assert.equal(gridHash(new TerrainGenerator(WORLD.seed)), GOLDEN);
});

test('chunk generation is bit-identical when repeated', () => {
  const g = new TerrainGenerator(WORLD.seed);
  for (const [d, ix, iz] of [[0, 0, 0], [5, 13, 17], [8, 130, 121], [8, 127, 128]]) {
    const a = buildChunk(g, d, ix, iz), b = buildChunk(new TerrainGenerator(WORLD.seed), d, ix, iz);
    assert.deepEqual(new Uint32Array(a.buffer), new Uint32Array(b.buffer));
    assert.equal(a.minY, b.minY); assert.equal(a.maxY, b.maxY);
  }
});

test('the loch exists, is large and is not circular', () => {
  const g = new TerrainGenerator(WORLD.seed);
  let wet = 0, sx = 0, sz = 0, sxx = 0, szz = 0, sxz = 0;
  const N = 256, ext = 2048, step = ext / N;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -1024 + (i + 0.5) * step, z = -1024 + (j + 0.5) * step;
    if (g.heightAt(x, z) < WORLD.waterLevel - 0.5) { wet++; sx += x; sz += z; sxx += x * x; szz += z * z; sxz += x * z; }
  }
  const area = wet * step * step;
  assert.ok(area > 0.25e6, `loch area ${area} m²`);
  const mx = sx / wet, mz = sz / wet, cxx = sxx / wet - mx * mx, czz = szz / wet - mz * mz, cxz = sxz / wet - mx * mz;
  const tr = cxx + czz, det = cxx * czz - cxz * cxz, l1 = tr / 2 + Math.sqrt(tr * tr / 4 - det), l2 = tr / 2 - Math.sqrt(tr * tr / 4 - det);
  assert.ok(Math.sqrt(l1 / l2) > 1.8, `elongation ${Math.sqrt(l1 / l2)}`);
});
