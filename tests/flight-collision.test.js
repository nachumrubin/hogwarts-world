import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightModel, FLIGHT } from '../src/flight/flight-model.js';
import { buildRoute, routePose } from '../src/debug/route.js';
import { WORLD } from '../src/config.js';
import { gen } from './helpers.js';

// minimal Input stand-in
function fakeInput(keys) {
  return { wheel: 0, keys: new Set(keys), down(...c) { return c.some((k) => this.keys.has(k)); }, axis(n, p) { return (this.down(...p) ? 1 : 0) - (this.down(...n) ? 1 : 0); }, consumeMouse(o) { o[0] = 0; o[1] = 0; return o; } };
}

test('flight: diving at full boost into cliffs and the loch never puts the eye below the clearance', () => {
  const f = new FlightModel();
  const ground = (x, z) => gen.heightAt(x, z);
  for (const [x, z, yawDeg] of [[-380, 60, 0], [-300, 300, 180], [600, -700, 250], [100, 100, 90]]) {
    f.place(x, Math.max(gen.heightAt(x, z), 0) + 60, z, yawDeg * Math.PI / 180, -0.6);
    const input = fakeInput(['KeyW', 'ShiftLeft', 'KeyQ']);
    let minClear = Infinity, maxStep = 0, prevY = f.y;
    for (let i = 0; i < 1200; i++) { // 20 s at 60 Hz
      f.update(1 / 60, input, ground);
      const g = Math.max(gen.heightAt(f.x, f.z), WORLD.waterLevel);
      minClear = Math.min(minClear, f.y - g);
      maxStep = Math.max(maxStep, Math.abs(f.y - prevY)); prevY = f.y;
      assert.ok(Math.abs(f.x) <= WORLD.playableHalf + 1e-9 && Math.abs(f.z) <= WORLD.playableHalf + 1e-9, 'stays inside the playable area');
    }
    assert.ok(minClear >= Math.min(FLIGHT.eyeClearance, 0.8) - 1e-6, `clearance ${minClear}`);
    assert.ok(maxStep < 4, `vertical jump per frame ${maxStep} m`);
  }
});

test('flight: acceleration is smooth (no velocity step larger than accel·dt allows)', () => {
  const f = new FlightModel();
  f.place(0, 300, 0, 0, 0);
  const input = fakeInput(['KeyW']);
  let prev = 0, maxDv = 0;
  for (let i = 0; i < 240; i++) { f.update(1 / 60, input, () => 0); const v = Math.hypot(f.vx, f.vy, f.vz); maxDv = Math.max(maxDv, v - prev); prev = v; }
  assert.ok(prev > FLIGHT.baseSpeed * 0.95, 'reaches cruise speed');
  assert.ok(maxDv < FLIGHT.baseSpeed * FLIGHT.accel / 60 * 1.01, `max Δv per frame ${maxDv}`);
});

test('benchmark route keeps ≥ 6 m terrain clearance everywhere (sampled every 1 m)', () => {
  const r = buildRoute(gen), pose = {};
  let minC = Infinity;
  for (let s = 0; s <= r.length; s += 1) {
    routePose(r, s, pose);
    minC = Math.min(minC, pose.y - Math.max(gen.heightAt(pose.x, pose.z), WORLD.waterLevel));
  }
  assert.ok(minC >= 5, `min clearance ${minC}`);
  assert.ok(r.length > 5000);
});
