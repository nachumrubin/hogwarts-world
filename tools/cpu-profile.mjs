// CPU-side measurements that do not depend on a GPU: chunk generation cost, LOD selection cost, and the
// number of chunks / triangles / draw calls each preset would submit along the benchmark route (full residency,
// before frustum culling). node tools/cpu-profile.mjs
import { TerrainGenerator } from '../src/terrain/generator.js';
import { buildChunk } from '../src/terrain/chunk-mesher.js';
import { TerrainQuadtree, keyDepth, keyIx, keyIz } from '../src/terrain/quadtree.js';
import { buildIndexPatterns } from '../src/terrain/index-patterns.js';
import { buildRoute, routePose } from '../src/debug/route.js';
import { WORLD, PRESETS } from '../src/config.js';

const gen = new TerrainGenerator(WORLD.seed);
const out = { machine: { cpus: (await import('node:os')).cpus().length, node: process.version } };

// 1. chunk generation
{
  const t = [];
  for (let k = 0; k < 120; k++) { const d = 3 + (k % 6), n = 2 ** d; const t0 = performance.now(); buildChunk(gen, d, (k * 7) % n, (k * 13) % n); t.push(performance.now() - t0); }
  t.sort((a, b) => a - b);
  out.chunkGenerationMs = { samples: t.length, median: +t[60].toFixed(2), p95: +t[113].toFixed(2), max: +t[119].toFixed(2), heightSamplesPerChunk: 37 * 37 };
}

// 2. selection + counts along the route, per preset
const route = buildRoute(gen), pose = {}, pat = buildIndexPatterns();
const cache = new Map();
const bounds = (k) => { if (!cache.has(k)) { const c = buildChunk(gen, keyDepth(k), keyIx(k), keyIz(k)); cache.set(k, { minY: c.minY, maxY: c.maxY }); } return cache.get(k); };
out.presets = {};
for (const [name, p] of Object.entries(PRESETS)) {
  const tree = new TerrainQuadtree({ lodFactor: p.lodFactor, isResident: () => true, boundsOf: bounds });
  for (let s = 0; s <= route.length; s += 20) { routePose(route, s, pose); tree.select(pose.x, pose.y, pose.z); } // warm the bounds cache
  let sel = [], leaves = [], tris = [], distinct = new Set();
  for (let s = 0; s <= route.length; s += 20) {
    routePose(route, s, pose);
    const t0 = performance.now();
    tree.select(pose.x, pose.y, pose.z);
    sel.push(performance.now() - t0);
    leaves.push(tree.leaves.length);
    let tr = 0; for (const l of tree.leaves) { tr += pat.counts[l.coarser] / 3; distinct.add(l.key); }
    tris.push(tr);
  }
  const st = (a) => { const b = [...a].sort((x, y) => x - y); return { avg: +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(2), p95: +b[Math.floor(b.length * 0.95)].toFixed(2), max: +b[b.length - 1].toFixed(2) }; };
  out.presets[name] = { lodFactor: p.lodFactor, selectMs: st(sel), leavesBeforeCulling: st(leaves), trianglesBeforeCulling: st(tris), distinctChunksVisited: distinct.size, poolSlots: p.poolSlots };
}
console.log(JSON.stringify(out, null, 2));
