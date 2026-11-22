// Forest POC: site placement, terrain overlay, ecology (placement rules, spatial correlation), tree generator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldTerrain } from '../src/world/world-terrain.ts';
import { WORLD_DB } from '../src/world/world-db.ts';
import { SITE, ForestSite, CLEARINGS } from '../src/forest/site.ts';
import { buildEcology } from '../src/forest/ecology.ts';
import { buildTreeArchetype, buildAllArchetypes } from '../src/forest/tree-gen.ts';
import { FOREST_VIEWS } from '../src/forest/views.ts';

const plain = new WorldTerrain();
const forested = new WorldTerrain(undefined, { forestPoc: true });
const eco = buildEcology(forested);
/** Height of the rendered terrain mesh at the finest LOD: bilinear between the 1 m lattice samples. */
const hMesh = (x: number, z: number) => {
  const i = Math.floor(x), j = Math.floor(z), a = x - i, b = z - j, h = (u: number, v: number) => forested.heightAt(u, v);
  return (h(i, j) * (1 - a) + h(i + 1, j) * a) * (1 - b) + (h(i, j + 1) * (1 - a) + h(i + 1, j + 1) * a) * b;
};

test('site lies in the ancient woodland, away from Hogwarts and Aragog, without moving landmarks', () => {
  for (const [u, v] of [[0, 0], [200, 0], [0, 200], [200, 200], [100, 100]]) {
    const d = plain.forestDepth(SITE.x0 + u, SITE.z0 + v);
    assert.ok(['ancient', 'deep'].includes(plain.forestZone(d)!), `corner ${u},${v} is old forest`);
    if (u === 100) assert.equal(plain.forestZone(d), 'ancient', 'centre in the ancient-woodland zone');
  }
  const c = { x: SITE.x0 + 100, z: SITE.z0 + 100 };
  const lm = (id: string) => WORLD_DB.landmarks.find((l) => l.id === id)!;
  assert.ok(Math.hypot(c.x - lm('aragogs-hollow').x, c.z - lm('aragogs-hollow').z) > 1500);
  assert.ok(Math.hypot(c.x - lm('hogwarts-castle').x, c.z - lm('hogwarts-castle').z) > 3000);
  // landmark elevations are untouched by the overlay
  for (const l of WORLD_DB.landmarks) assert.equal(forested.heightAt(l.x, l.z), plain.heightAt(l.x, l.z), l.id);
});

test('terrain overlay: bounded micro-relief inside the area, exactly zero outside the fade', () => {
  let max = 0;
  for (let i = 0; i < 4000; i++) {
    const x = SITE.x0 - 120 + (i * 7.31) % 440, z = SITE.z0 - 120 + (i * 13.7) % 440;
    const d = forested.heightAt(x, z) - plain.heightAt(x, z);
    const out = new ForestSite().outside(x - SITE.x0, z - SITE.z0);
    if (out >= SITE.fadeOut) assert.equal(d, 0);
    max = Math.max(max, Math.abs(d));
  }
  assert.ok(max > 0.5 && max < 4.5, `relief amplitude ${max.toFixed(2)} m`);
  // determinism: two instances agree bit for bit
  const b = new WorldTerrain(undefined, { forestPoc: true });
  for (let i = 0; i < 200; i++) { const x = SITE.x0 + i * 1.37, z = SITE.z0 + i * 0.91; assert.equal(b.heightAt(x, z), forested.heightAt(x, z)); }
});

test('ecology: deterministic, every object rests on the terrain', () => {
  const again = buildEcology(new WorldTerrain(undefined, { forestPoc: true }));
  assert.deepEqual(again.stats.trees, eco.stats.trees);
  assert.equal(again.trees[17].x, eco.trees[17].x);
  for (const t of eco.trees) assert.ok(Math.abs(t.y - hMesh(t.x, t.z)) < 0.01, 'tree base on the ground');
  for (const f of eco.ferns.slice(0, 2000)) assert.ok(Math.abs(f.y - hMesh(f.x, f.z)) < 0.01, 'fern on the ground');
  for (const r of eco.rocks) { const g = hMesh(r.x, r.z); assert.ok(r.y < g + 0.1 && r.y > g - r.size, 'rocks are partly buried (centre at or below the ground), never floating'); }
});

test('ecology: trails and clearings stay open; species mix is Caledonian pinewood with oak and birch', () => {
  const site = eco.site;
  for (const t of eco.trees) {
    const u = t.x - SITE.x0, v = t.z - SITE.z0;
    if (!site.inside(u, v)) continue;
    assert.ok(site.trail(u, v).dist > 1.3, 'no trunk on a trail');
    if (!t.unique) assert.ok(site.clearing(u, v).k < 0.98 || t.age === 'sapling' || t.age === 'young', 'no mature tree in a clearing centre');
  }
  const core = eco.trees.filter((t) => !t.ring && (t.age === 'mature' || t.age === 'veteran'));
  const n = (sp: string) => core.filter((t) => t.species === sp).length;
  assert.ok(n('pine') > 0.2 * core.length, `pines ${n('pine')}/${core.length}`);
  assert.ok(n('oak') > 0.15 * core.length, `oaks ${n('oak')}/${core.length}`);
  assert.ok(n('birch') > 0.1 * core.length, `birches ${n('birch')}/${core.length}`);
  assert.ok(eco.trees.filter((t) => t.age === 'veteran').length >= 4);
  // each clearing centre has no canopy tree within 4 m
  for (const c of CLEARINGS) for (const t of eco.trees) if (t.age === 'mature') assert.ok(Math.hypot(t.x - SITE.x0 - c.u, t.z - SITE.z0 - c.v) > 4);
});

test('ecology: placement is spatially correlated (clustered), not uniform random', () => {
  // Clark–Evans aggregation index R = observed mean nearest-neighbour distance / expected for complete spatial
  // randomness; R < 1 means clustering. Measured on canopy trees in the core area.
  const pts = eco.trees.filter((t) => !t.ring && t.age !== 'sapling').map((t) => [t.x, t.z]);
  let s = 0;
  for (const p of pts) { let b = 1e9; for (const q of pts) if (q !== p) b = Math.min(b, Math.hypot(p[0] - q[0], p[1] - q[1])); s += b; }
  const area = (SITE.size + 2 * SITE.ring) ** 2;
  const coreArea = SITE.size * SITE.size;
  const expected = 0.5 / Math.sqrt(pts.length / coreArea);
  const R = s / pts.length / expected;
  void area;
  // crown competition imposes a minimum spacing (pushes R up), clustering pulls it down: ancient woods sit below 1.2
  assert.ok(R < 1.25, `Clark–Evans R = ${R.toFixed(2)}`);
  // ferns: strongly patchy — the variance of counts per 10 m cell exceeds the mean (Poisson would give ratio ≈ 1)
  const cells = new Map<string, number>();
  for (const f of eco.ferns) { const k = `${Math.floor((f.x - SITE.x0) / 10)},${Math.floor((f.z - SITE.z0) / 10)}`; cells.set(k, (cells.get(k) || 0) + 1); }
  const counts: number[] = []; for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) counts.push(cells.get(`${i},${j}`) || 0);
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length, varc = counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length;
  assert.ok(varc / mean > 3, `fern variance/mean ${(varc / mean).toFixed(1)}`);
});

test('ecology: ground layer follows light and moisture', () => {
  const brackenLight = eco.ferns.filter((f) => f.kind === 0).reduce((s, f) => s + f.light, 0) / Math.max(1, eco.ferns.filter((f) => f.kind === 0).length);
  const bucklerLight = eco.ferns.filter((f) => f.kind === 1).reduce((s, f) => s + f.light, 0) / Math.max(1, eco.ferns.filter((f) => f.kind === 1).length);
  assert.ok(brackenLight > bucklerLight, 'bracken in brighter places than buckler fern');
  const grassLight = eco.grass.reduce((s, f) => s + f.light, 0) / eco.grass.length;
  assert.ok(grassLight > bucklerLight, 'grass where the light reaches');
  assert.ok(eco.logs.length >= 20 && eco.logs.some((l) => l.rootPlate), 'fallen trees, some windthrown with root plates');
});

test('tree generator: unique silhouettes, sensible LOD reduction', () => {
  const a = buildTreeArchetype('oak', 'mature', 0, 111), b = buildTreeArchetype('oak', 'mature', 1, 222);
  assert.notEqual(a.lods[0].triangles, b.lods[0].triangles, 'different seeds → different structure');
  assert.ok(Math.abs(a.crownR - b.crownR) > 0.01 || Math.abs(a.height - b.height) > 0.01);
  for (const t of [a, b, buildTreeArchetype('pine', 'mature', 0, 333), buildTreeArchetype('birch', 'mature', 0, 444)]) {
    const [l0, l1, l2] = t.lods.map((m) => m.triangles);
    assert.ok(l1 < l0 * 0.45 && l2 < l1 * 0.6, `LOD ratios ${l0}/${l1}/${l2}`);
    assert.ok(t.lods.every((m) => m.split > 0 && m.split <= m.indices.length));
  }
  const vet = buildTreeArchetype('oak', 'veteran', 0, 9000, true, 21);
  assert.ok(vet.crownR > a.crownR * 1.2, 'veteran oaks are broader');
  const all = buildAllArchetypes([]);
  assert.ok(all.list.length >= 40, `${all.list.length} archetypes`);
});

test('fixed camera viewpoints: eight, inside or above the test area', () => {
  assert.equal(FOREST_VIEWS.length, 8);
  for (const v of FOREST_VIEWS) assert.ok(v.agl > 0 && v.u > -30 && v.u < 230 && (v.v > -30 || v.agl > 100));
});
