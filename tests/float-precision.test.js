import test from 'node:test';
import assert from 'node:assert/strict';
import { snapOrigin } from '../src/world/floating-origin.js';
import { rng } from './helpers.js';

// With the render origin snapped to a power-of-two grid, every chunk origin and vertex position relative to it
// must be exactly representable in float32, for a world far larger than the prototype (64 km root, 1 m spacing).
test('render-origin-relative vertex coordinates are exact in f32 across a 64 km world', () => {
  const root = 65536, maxDepth = 11, Q = 32, snap = 256, r = rng(3);
  for (let k = 0; k < 400; k++) {
    const cam = [(r() - 0.5) * root, (r() - 0.5) * root];
    const o = [snapOrigin(cam[0], snap), snapOrigin(cam[1], snap)];
    for (let d = 0; d <= maxDepth; d++) {
      const size = root / 2 ** d, s = size / Q, n = 2 ** d;
      const ix = Math.min(n - 1, Math.max(0, Math.floor((cam[0] + root / 2) / size) + Math.floor(r() * 5) - 2));
      const rel = ix * size - root / 2 - o[0];
      for (let i = 0; i <= Q; i++) {
        const v = rel + i * s;
        assert.equal(Math.fround(rel), rel); assert.equal(Math.fround(i * s), i * s);
        assert.equal(Math.fround(Math.fround(rel) + Math.fround(i * s)), v, `inexact at depth ${d}`);
      }
    }
  }
});
