import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainQuadtree, nodeKey } from '../src/terrain/quadtree.js';
import { EDGE_N, EDGE_E, EDGE_S, EDGE_W } from '../src/terrain/index-patterns.js';
import { WORLD } from '../src/config.js';
import { rng } from './helpers.js';

const OPP = { [EDGE_N]: EDGE_S, [EDGE_S]: EDGE_N, [EDGE_E]: EDGE_W, [EDGE_W]: EDGE_E };
const DIRS = [[0, -1, EDGE_N], [1, 0, EDGE_E], [0, 1, EDGE_S], [-1, 0, EDGE_W]];

function checkTree(tree) {
  // coverage: leaf areas sum to the root area and no leaf is inside another leaf or an internal node's sibling chain
  let area = 0;
  for (const l of tree.leaves) {
    area += (WORLD.rootSize / 2 ** l.depth) ** 2;
    for (let d = l.depth - 1, x = l.ix >> 1, z = l.iz >> 1; d >= 0; d--, x >>= 1, z >>= 1) {
      assert.ok(tree.internal.has(nodeKey(d, x, z)), 'every ancestor of a leaf is internal');
      assert.ok(!tree.leafSet.has(nodeKey(d, x, z)), 'no overlapping leaves');
    }
  }
  assert.equal(area, WORLD.rootSize ** 2, 'leaves tile the root exactly');
  assert.ok(tree.isBalanced(), '2:1 balanced');
  // edge masks agree from both sides
  for (const l of tree.leaves) for (const [dx, dz, bit] of DIRS) {
    if (l.coarser & bit) {
      const nd = tree.neighbourDepth(l.depth, l.ix + dx, l.iz + dz);
      assert.equal(nd, l.depth - 1);
      const n = tree.leaves.find((o) => o.depth === nd && o.ix === (l.ix + dx) >> 1 && o.iz === (l.iz + dz) >> 1);
      assert.ok(n && (n.finer & OPP[bit]), 'coarser neighbour flags the shared edge as finer');
    }
  }
}

test('full residency: balanced, exact cover, consistent edge masks at many camera positions', () => {
  const r = rng(11);
  for (let k = 0; k < 60; k++) {
    const tree = new TerrainQuadtree({ lodFactor: [2, 2.5, 3.2, 4.5][k % 4], isResident: () => true, boundsOf: () => null });
    tree.select((r() - 0.5) * 2200, r() * 900, (r() - 0.5) * 2200);
    checkTree(tree);
    assert.ok(tree.leaves.some((l) => l.depth === WORLD.maxDepth), 'finest level reached near the camera');
  }
});

test('partial residency: still a hole-free, balanced cover (fallback + forced collapse)', () => {
  const r = rng(99);
  for (let k = 0; k < 60; k++) {
    const resident = new Set();
    const p = 0.55 + 0.4 * r();
    const isResident = (key) => { if (!resident.has(key) && !resident.has(-key - 1)) (r() < p ? resident.add(key) : resident.add(-key - 1)); return resident.has(key); };
    const tree = new TerrainQuadtree({ lodFactor: 3, isResident, boundsOf: () => null });
    tree.select((r() - 0.5) * 2000, 20 + r() * 400, (r() - 0.5) * 2000);
    checkTree(tree);
    for (const l of tree.leaves) if (l.depth > 0) assert.ok(isResident(l.key), 'only resident nodes are drawn');
  }
});

test('requests: missing children of a node that wants to split come before prefetches', () => {
  const tree = new TerrainQuadtree({ lodFactor: 3, isResident: (k) => k === nodeKey(0, 0, 0), boundsOf: () => null });
  tree.select(0, 100, 0);
  const pri = [...tree.requests.values()];
  assert.equal(tree.requests.size, 4);
  assert.ok(pri.every((p) => p < 1000));
});
