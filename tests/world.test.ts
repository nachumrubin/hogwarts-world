// World-model acceptance checks for the first milestone (brief §16). These test geography and data, not visual quality.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldTerrain } from '../src/world/world-terrain.ts';
import { WORLD_DB, validateWorldDB, landmark } from '../src/world/world-db.ts';
import { polygonArea, type P2 } from '../src/world/geometry.ts';

function convexHull(pts: P2[]): P2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: P2[] = [], up: P2[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

const T = new WorldTerrain();
const W = T.water;

// The approved master map (brief §4). A failing row means an anchor moved.
const APPROVED: [string, number, number][] = [
  ['hogwarts-castle', 3650, 2850], ['castle-courtyard', 3700, 2980], ['hagrids-hut', 3830, 3060], ['forest-entrance', 4000, 3290],
  ['greenhouses', 3950, 2720], ['whomping-willow', 4220, 2620], ['owlery', 4480, 3180], ['quidditch-pitch', 3000, 3750],
  ['hogsmeade', 1550, 4550], ['shrieking-shack', 1950, 4270], ['hogsmeade-station', 2850, 1650], ['boathouse', 2850, 2050],
  ['lakeside-landing', 3450, 2510], ['passage-entrance', 3570, 2690], ['merpeople-cove', 1900, 2850], ['giant-squid-deepwater', 2900, 2200],
  ['unicorn-glade', 5700, 3700], ['centaur-uplands', 6300, 4400], ['forest-waterfall', 6850, 5050], ['aragogs-hollow', 7600, 5500], ['south-viaduct', 5750, 750],
];

test('world database is valid and every landmark sits on its approved coordinate', () => {
  assert.deepEqual(validateWorldDB(WORLD_DB), []);
  assert.equal(WORLD_DB.landmarks.length, APPROVED.length);
  for (const [id, x, z] of APPROVED) { const l = landmark(WORLD_DB, id); assert.equal(l.x, x, id); assert.equal(l.z, z, id); }
  assert.deepEqual(WORLD_DB.playable, { minX: 0, minZ: 0, maxX: 8000, maxZ: 6000 });
});

test('reference elevations are honoured (±1.5 m)', () => {
  const expect: [string, number][] = [['hogsmeade-station', 338], ['boathouse', 305], ['lakeside-landing', 306], ['hogwarts-castle', 390], ['hagrids-hut', 375]];
  for (const [id, e] of expect) { const l = landmark(WORLD_DB, id); assert.ok(Math.abs(T.heightAt(l.x, l.z) - e) <= 1.5, `${id}: ${T.heightAt(l.x, l.z).toFixed(2)} vs ${e}`); }
  assert.equal(W, 300);
});

test('Hogwarts stands on a promontory connected to the mainland, not on an island', () => {
  const c = landmark(WORLD_DB, 'hogwarts-castle');
  // flood fill over dry land (10 m grid) from the castle; it must reach the grounds east of the castle
  const step = 10, x0 = 2500, z0 = 1800, nx = 260, nz = 220, seen = new Uint8Array(nx * nz), q: number[] = [];
  const dry = (i: number, j: number) => T.heightAt(x0 + i * step, z0 + j * step) > W + 0.5;
  const si = Math.round((c.x - x0) / step), sj = Math.round((c.z - z0) / step);
  q.push(si, sj); seen[sj * nx + si] = 1;
  let reached = false;
  while (q.length && !reached) {
    const j = q.pop()!, i = q.pop()!;
    if (x0 + i * step > 4400) reached = true;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz || seen[b * nx + a]) continue;
      seen[b * nx + a] = 1;
      if (dry(a, b)) q.push(a, b);
    }
  }
  assert.ok(reached, 'castle connects to the mainland over dry land');
  // and it is a promontory on the lake's eastern shore: water directly west, north-west and south-west of the castle
  for (const [dx, dz] of [[-340, 0], [-320, 180], [-260, -280]]) assert.ok(T.heightAt(c.x + dx, c.z + dz) < W, `water at castle ${dx},${dz}`);
  assert.ok(T.heightAt(c.x, c.z) - W >= 85, 'castle stands high above the lake');
});

test('the Great Lake is large, irregular, deep where the habitats need it, with shore landings', () => {
  const area = Math.abs(polygonArea(T.shore));
  let perim = 0; for (let i = 0; i < T.shore.length; i++) { const a = T.shore[i], b = T.shore[(i + 1) % T.shore.length]; perim += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  const compactness = (4 * Math.PI * area) / (perim * perim); // 1 = circle
  assert.ok(area > 3.5e6, `area ${(area / 1e6).toFixed(2)} km²`);
  // solidity = area / convex-hull area: 1 for any circle or ellipse, lower for an outline with bays and headlands
  const hull = convexHull(T.shore), solidity = area / Math.abs(polygonArea(hull));
  assert.ok(solidity < 0.85, `solidity ${solidity.toFixed(2)} (ellipse = 1)`);
  assert.ok(compactness < 0.75, `compactness ${compactness.toFixed(2)} (circle = 1)`);
  console.log(`  lake: ${(area / 1e6).toFixed(2)} km², shoreline ${(perim / 1000).toFixed(1)} km, solidity ${solidity.toFixed(2)}, compactness ${compactness.toFixed(2)}`);
  const depth = (id: string) => { const l = landmark(WORLD_DB, id); return W - T.heightAt(l.x, l.z); };
  assert.ok(depth('giant-squid-deepwater') >= 50, `squid deepwater ${depth('giant-squid-deepwater').toFixed(1)} m`);
  assert.ok(depth('merpeople-cove') >= 35, `merpeople ${depth('merpeople-cove').toFixed(1)} m`);
  // each water encounter zone has room: at least half of its disc deeper than its minimum depth
  for (const z of WORLD_DB.encounterZones.filter((e) => e.medium === 'water')) {
    let ok = 0, n = 0;
    for (let a = 0; a < 24; a++) for (const r of [0.2, 0.5, 0.8]) { n++; if (W - T.heightAt(z.x + Math.cos(a / 24 * 6.283) * r * z.radius, z.z + Math.sin(a / 24 * 6.283) * r * z.radius) >= (z.minDepth ?? 0)) ok++; }
    assert.ok(ok / n >= 0.5, `${z.id}: ${(ok / n * 100).toFixed(0)}% of the zone deep enough`);
  }
  for (const id of ['boathouse', 'lakeside-landing']) assert.ok(Math.abs(T.lakeDistance(landmark(WORLD_DB, id).x, landmark(WORLD_DB, id).z)) < 40, `${id} at the shore`);
});

test('no stray water: every point below lake level is in the lake or a river mouth', () => {
  let bad = 0, worst = '';
  for (let z = -800; z <= 6800; z += 25) for (let x = -800; x <= 8800; x += 25) {
    if (T.heightAt(x, z) >= W) continue;
    if (T.lakeDistance(x, z) < 30) continue;
    if (T.riverAt(x, z).dist < 20) continue;
    bad++; worst = `${x},${z}`;
  }
  assert.equal(bad, 0, `stray water samples (last at ${worst})`);
});

test('Hogsmeade and the Forbidden Forest are distinct; Aragog\'s Hollow is deep in the forest and far from the entrance', () => {
  const hg = landmark(WORLD_DB, 'hogsmeade'), ent = landmark(WORLD_DB, 'forest-entrance'), ar = landmark(WORLD_DB, 'aragogs-hollow');
  assert.ok(T.forestDepth(hg.x, hg.z) < -1000, 'Hogsmeade is more than 1 km outside the forest');
  assert.equal(T.forestZone(T.forestDepth(ent.x, ent.z)), 'familiar');
  assert.equal(T.forestZone(T.forestDepth(ar.x, ar.z)), 'deep');
  assert.ok(Math.hypot(ar.x - ent.x, ar.z - ent.z) > 3500, 'a long journey from the entrance');
  // the hollow is a real depression
  const rim = Math.max(...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => T.heightAt(ar.x + Math.cos(k * 0.785) * ar.radius * 1.2, ar.z + Math.sin(k * 0.785) * ar.radius * 1.2)));
  assert.ok(rim - T.heightAt(ar.x, ar.z) > 20, `hollow depth ${(rim - T.heightAt(ar.x, ar.z)).toFixed(1)} m`);
  // the castle grounds are not forest
  for (const id of ['hagrids-hut', 'greenhouses', 'owlery', 'quidditch-pitch']) assert.ok(T.forestDepth(landmark(WORLD_DB, id).x, landmark(WORLD_DB, id).z) < 0, `${id} outside the forest`);
});

test('railway: gradient, curvature, level station and a real viaduct at the South Viaduct', () => {
  const R = T.rail, rw = WORLD_DB.railway;
  let maxG = 0, minR = Infinity;
  for (let i = 5; i < R.pts.length; i += 5) maxG = Math.max(maxG, Math.abs(R.elev[i] - R.elev[i - 5]) / (R.s[i] - R.s[i - 5]));
  for (let i = 10; i < R.pts.length - 10; i += 5) {
    const [a, b, c] = [R.pts[i - 10], R.pts[i], R.pts[i + 10]];
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const area2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    if (area2 > 1e-6) minR = Math.min(minR, (ab * bc * ca) / (2 * area2));
  }
  assert.ok(maxG <= rw.maxGradient + 1e-9, `max gradient ${(maxG * 100).toFixed(2)}%`);
  assert.ok(minR >= rw.minCurveRadius, `min curve radius ${minR.toFixed(0)} m`);
  const st = landmark(WORLD_DB, 'hogsmeade-station'), ra = T.railAt(st.x, st.z)!;
  assert.ok(Math.abs(ra.elev - 338) < 0.01, `station rail ${ra.elev}`);
  const v = landmark(WORLD_DB, 'south-viaduct'), rv = T.railAt(v.x, v.z)!;
  assert.equal(rv.kind, 1, 'the line is on a viaduct at the South Viaduct');
  assert.ok(rv.elev - T.heightAt(v.x, v.z) >= rw.viaduct.minClearance, `viaduct clearance ${(rv.elev - T.heightAt(v.x, v.z)).toFixed(1)} m`);
  console.log(`  railway: max gradient ${(maxG * 100).toFixed(2)}%, min radius ${minR.toFixed(0)} m, viaduct clearance ${(rv.elev - T.heightAt(v.x, v.z)).toFixed(1)} m, length ${(R.s.at(-1)! / 1000).toFixed(2)} km`);
});

test('the Forest Burn falls at the Forest Waterfall and reaches the lake', () => {
  const r = T.rivers.find((q) => q.def.id === 'forest-burn')!;
  let maxDrop = 0;
  for (let i = 1; i < r.bed.length; i++) maxDrop = Math.max(maxDrop, r.bed[i - 1] - r.bed[i]);
  assert.ok(maxDrop >= 15, `waterfall drop ${maxDrop.toFixed(1)} m`);
  assert.ok(r.bed[r.bed.length - 1] < W, 'mouth below lake level');
  for (let i = 1; i < r.bed.length; i++) assert.ok(r.bed[i] <= r.bed[i - 1] + 1e-9, 'never flows uphill');
});

test('terrain is deterministic (golden hash) and identical across independent instances', () => {
  const A = new WorldTerrain();
  const f = new Float64Array(1), u = new Uint32Array(f.buffer);
  let h = 0x811c9dc5;
  for (let j = 0; j < 48; j++) for (let i = 0; i < 64; i++) {
    const x = -2000 + i * 190.37, z = -2000 + j * 210.11, v = A.heightAt(x, z);
    assert.ok(Object.is(v, T.heightAt(x, z)));
    f[0] = v; for (const w of u) for (let b = 0; b < 4; b++) { h ^= (w >>> (b * 8)) & 255; h = Math.imul(h, 0x01000193); }
  }
  const hex = (h >>> 0).toString(16).padStart(8, '0');
  console.log(`  world golden hash ${hex}`);
  assert.equal(hex, process.env.WORLD_GOLDEN || 'd12de9a3');
});
