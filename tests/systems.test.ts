// Coordinate convention, walking, creature integration and procedural mesh checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraBasis } from '../src/core/math.js';
import { FlightModel, WALK } from '../src/flight/flight-model.js';
import { WORLD } from '../src/config.js';
import { CreatureHost, zoneInfo } from '../src/creatures/host.ts';
import { PlaceholderCreature } from '../src/creatures/placeholder-module.ts';
import type { CreatureModule, WorldQueries } from '../src/creatures/types.ts';
import { MeshBuilder, MAT } from '../src/meshes/mesh-builder.ts';
import { WorldTerrain } from '../src/world/world-terrain.ts';
import { WORLD_DB } from '../src/world/world-db.ts';

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test('coordinate convention: yaw 0 looks north (+Z), yaw 90° looks east (+X); right is east when facing north; up is +Y', () => {
  const b: any = {};
  cameraBasis(0, 0, 0, b);
  assert.ok(near(b.fz, 1) && near(b.fx, 0), 'forward = +Z');
  assert.ok(near(b.rx, 1) && near(b.rz, 0), 'right = +X');
  assert.ok(near(b.uy, 1), 'up = +Y');
  cameraBasis(Math.PI / 2, 0, 0, b);
  assert.ok(near(b.fx, 1) && near(b.fz, 0), 'yaw 90° faces east');
  assert.ok(near(b.rz, -1), 'right is south when facing east');
  cameraBasis(0, -Math.PI / 2, 0, b);
  assert.ok(near(b.uz, 1), 'looking straight down, screen-up is north');
});

const T = new WorldTerrain();
function input(keys: string[]): any {
  return { wheel: 0, keys: new Set(keys), down(...c: string[]) { return c.some((k) => this.keys.has(k)); }, axis(n: string[], p: string[]) { return (this.down(...p) ? 1 : 0) - (this.down(...n) ? 1 : 0); }, consumeMouse(o: number[]) { o[0] = 0; o[1] = 0; return o; } };
}

test('walking: stays on the ground at eye height, cannot walk into deep water, can jump', () => {
  const f = new FlightModel();
  const ground = (x: number, z: number) => T.heightAt(x, z);
  // start on the station platform, walk north towards the boathouse and on into the lake
  f.place(2850, T.heightAt(2850, 1700) + 1.7, 1700, 0, 0); f.setMode('walk');
  const go = input(['KeyW', 'ShiftLeft']);
  let maxEyeErr = 0;
  for (let i = 0; i < 60 * 120; i++) {
    f.update(1 / 60, go, ground);
    if (f.onGround) maxEyeErr = Math.max(maxEyeErr, Math.abs(f.y - WALK.eye - T.heightAt(f.x, f.z)));
  }
  assert.ok(maxEyeErr < 0.65, `eye height error ${maxEyeErr}`);
  assert.ok(T.heightAt(f.x, f.z) >= WORLD.waterLevel - WALK.wadeDepth - 0.3, 'stopped at the water');
  assert.ok(f.z > 1900, `walked to the shore (z ${f.z.toFixed(0)})`);
  // jump
  const j = new FlightModel(); j.place(3830, T.heightAt(3830, 3060) + 1.7, 3060, 0, 0); j.setMode('walk');
  for (let i = 0; i < 30; i++) j.update(1 / 60, input([]), ground);
  let peak = 0; const g0 = j.y;
  for (let i = 0; i < 90; i++) { j.update(1 / 60, input(i < 2 ? ['Space'] : []), ground); peak = Math.max(peak, j.y - g0); }
  assert.ok(peak > 0.8 && peak < 1.5, `jump height ${peak.toFixed(2)} m`);
});

const worldQ: WorldQueries = {
  heightAt: (x, z) => T.heightAt(x, z), waterLevel: WORLD.waterLevel,
  waterDepthAt: (x, z) => Math.max(0, WORLD.waterLevel - T.heightAt(x, z)), forestDepthAt: (x, z) => T.forestDepth(x, z),
  viewerPosition: () => viewer,
};
let viewer = { x: 2900, y: 310, z: 2150 };

test('creature host: lifecycle, distance LOD, dormancy, bounds in world space, failure containment', async () => {
  const host = new CreatureHost(worldQ, null);
  const squidZone = WORLD_DB.encounterZones.find((z) => z.id === 'giant-squid')!;
  const squid = new PlaceholderCreature(12);
  await host.add('giant-squid', squid, zoneInfo(squidZone, worldQ));
  const broken: CreatureModule = { initialize: async () => { throw new Error('assets missing'); }, update() {}, setPosition() {}, setLOD() {}, getBounds: () => ({ min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }), dispose() {} };
  await host.add('broken', broken, zoneInfo(squidZone, worldQ));
  for (let i = 0; i < 120; i++) host.update(1 / 60);
  assert.ok(squid.updates > 100, 'updated while near');
  assert.ok(squid.level <= 2, `lod near ${squid.level}`);
  const b = host.bounds().find((e) => e.id === 'giant-squid')!.bounds;
  assert.ok(b.max.y < WORLD.waterLevel, 'squid stays underwater');
  assert.ok(T.heightAt((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2) < b.min.y, 'above the lake bed');
  assert.equal(host.status().find((s) => s.id === 'broken')!.ready, false);
  // far away: dormant, no updates
  viewer = { x: 7600, y: 700, z: 5500 };
  host.update(1 / 60); const u = squid.updates;
  for (let i = 0; i < 60; i++) host.update(1 / 60);
  assert.equal(squid.level, 3); assert.equal(squid.updates, u, 'dormant modules are not updated');
  host.dispose(); assert.ok(squid.disposed);
  assert.deepEqual([CreatureHost.lodFor(100), CreatureHost.lodFor(400), CreatureHost.lodFor(2000), CreatureHost.lodFor(5000)], [0, 1, 2, 3]);
});

test('procedural meshes: box, frustum and roofs have outward normals', () => {
  const m = new MeshBuilder('t').box(0, 0, 0, 4, 4, 4, MAT.STONE).frustum(10, 0, 0, 2, 1, 5, 8, MAT.STONE).gable(20, 0, 0, 6, 4, 3, MAT.SLATE).pyramid(30, 0, 0, 4, 4, 3, MAT.SLATE).build();
  const f = new Float32Array(m.vertices), s = new Int8Array(m.vertices);
  const centers = [[0, 2, 0], [10, 2.5, 0], [20, 0, 0], [30, 0, 0]];
  for (let t = 0; t < m.indices.length; t += 3) {
    let cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 3; k++) { const v = m.indices[t + k]; cx += f[v * 4] / 3; cy += f[v * 4 + 1] / 3; cz += f[v * 4 + 2] / 3; nx = s[v * 16 + 12]; ny = s[v * 16 + 13]; nz = s[v * 16 + 14]; }
    const c = centers.reduce((best, q) => (Math.hypot(q[0] - cx, q[2] - cz) < Math.hypot(best[0] - cx, best[2] - cz) ? q : best));
    assert.ok((cx - c[0]) * nx + (cy - c[1]) * ny + (cz - c[2]) * nz > -1e-6, `inward normal on triangle ${t / 3}`);
  }
});
