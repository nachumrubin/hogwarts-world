// First-person free flight: smooth acceleration, banking, altitude control, terrain collision.
//
// State is f64 world space. Mouse look goes through two cascaded low-pass stages (adapted from Abyssal Garden,
// MIT © 2026 Maksymilian Dendura, main.js frame()); velocity approaches the commanded velocity exponentially, so
// starting, stopping and turning are smooth and frame-rate independent. Roll (banking) follows the turn rate and
// lateral acceleration and is purely visual.
//
// Collision keeps the eye above max(analytic height, rendered surface height) + clearance, with extra samples on a
// ring the size of the near plane so the view can never clip into a steep slope.

import { clamp, damp, wrapAngle } from '../core/math.js';
import { WORLD } from '../config.js';

export const FLIGHT = Object.freeze({
  baseSpeed: 28, boost: 4.5, slow: 0.25, accel: 2.2, lookSmooth: 28, sensitivity: 0.0021,
  keyTurnRate: 1.4, maxPitch: 1.45, bankPerTurn: 0.55, bankPerLateral: 0.018, maxBank: 0.55, bankSmooth: 4,
  eyeClearance: 1.7, ringRadius: 0.6, ringClearance: 0.4, cushion: 4, cushionRate: 7, edgeSoft: 60, maxClimb: 1.2,
});

/** Walking (first person on foot). */
export const WALK = Object.freeze({
  eye: 1.7, walk: 2.4, run: 6.0, accel: 10, gravity: 9.81, jump: 4.6, maxSlope: 0.85, stepUp: 0.45, wadeDepth: 1.1,
});

export class FlightModel {
  constructor() {
    this.x = 0; this.y = 100; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.speedScale = 1;
    this._l1x = 0; this._l1y = 0; this._l2x = 0; this._l2y = 0; this._yawRate = 0;
    this.groundHeight = 0; this.agl = 0; this.collided = false;
    /** 'broom' or 'walk'. */
    this.mode = 'broom'; this.onGround = false;
    this._m = new Float64Array(2);
  }

  place(x, y, z, yaw, pitch) { this.x = x; this.y = y; this.z = z; this.yaw = yaw; this.pitch = pitch; this.vx = this.vy = this.vz = 0; this.roll = 0; this._l1x = this._l1y = this._l2x = this._l2y = 0; }

  /**
   * @param {number} dt seconds
   * @param {import('./input.js').Input} input
   * @param {(x:number,z:number)=>number} groundAt  max of analytic and rendered terrain height
   */
  update(dt, input, groundAt) {
    const C = FLIGHT;
    // --- look
    const m = input.consumeMouse(this._m);
    const kq = damp(C.lookSmooth, dt);
    this._l1x += m[0] * C.sensitivity + input.axis(['ArrowLeft'], ['ArrowRight']) * C.keyTurnRate * dt;
    this._l1y += m[1] * C.sensitivity - input.axis(['ArrowDown'], ['ArrowUp']) * C.keyTurnRate * dt;
    const ax = this._l1x * kq, ay = this._l1y * kq; this._l1x -= ax; this._l1y -= ay; this._l2x += ax; this._l2y += ay;
    const dyaw = this._l2x * kq, dpitch = this._l2y * kq; this._l2x -= dyaw; this._l2y -= dpitch;
    this.yaw = wrapAngle(this.yaw + dyaw);
    this.pitch = clamp(this.pitch - dpitch, -C.maxPitch, C.maxPitch);
    const yawRate = dt > 0 ? dyaw / dt : 0;
    this._yawRate += (yawRate - this._yawRate) * damp(8, dt);

    if (this.mode === 'walk') { this._walk(dt, input, groundAt); return; }
    // --- thrust
    if (input.wheel) { this.speedScale = clamp(this.speedScale * Math.pow(1.15, -input.wheel), 0.1, 8); input.wheel = 0; }
    let sp = C.baseSpeed * this.speedScale;
    if (input.down('ShiftLeft', 'ShiftRight')) sp *= C.boost;
    if (input.down('AltLeft', 'ControlLeft')) sp *= C.slow;
    const fwd = input.axis(['KeyS'], ['KeyW']), strafe = input.axis(['KeyA'], ['KeyD']), lift = input.axis(['KeyQ', 'KeyC'], ['KeyE', 'Space']);
    const cp = Math.cos(this.pitch), sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const fx = sy * cp, fy = Math.sin(this.pitch), fz = cy * cp, rx = cy, rz = -sy; // X east, Z north
    const tvx = (fx * fwd + rx * strafe) * sp, tvy = (fy * fwd + lift) * sp, tvz = (fz * fwd + rz * strafe) * sp;
    const k = damp(C.accel, dt);
    const ovx = this.vx, ovz = this.vz;
    this.vx += (tvx - this.vx) * k; this.vy += (tvy - this.vy) * k; this.vz += (tvz - this.vz) * k;
    // lateral acceleration in the camera's right direction drives part of the bank
    const lat = dt > 0 ? ((this.vx - ovx) * rx + (this.vz - ovz) * rz) / dt : 0;
    const speedH = Math.hypot(this.vx, this.vz);
    const bankTarget = clamp(this._yawRate * C.bankPerTurn * clamp(speedH / 30, 0, 1.5) + lat * C.bankPerLateral, -C.maxBank, C.maxBank);
    this.roll += (bankTarget - this.roll) * damp(C.bankSmooth, dt);

    // --- integrate
    let x = this.x + this.vx * dt, y = this.y + this.vy * dt, z = this.z + this.vz * dt;
    // soft walls at the edge of the playable square, hard ceiling
    const P = WORLD.playable;
    for (let axis = 0; axis < 2; axis++) {
      const lo = axis ? P.minZ : P.minX, hi = axis ? P.maxZ : P.maxX, c = (lo + hi) / 2, half = (hi - lo) / 2;
      const p = axis ? z : x, over = Math.abs(p - c) - (half - C.edgeSoft);
      if (over > 0) {
        const s = Math.sign(p - c), push = Math.min(over, C.edgeSoft) / C.edgeSoft;
        if (axis) { z -= s * over * damp(3, dt); if (this.vz * s > 0) this.vz *= 1 - push; z = clamp(z, lo, hi); }
        else { x -= s * over * damp(3, dt); if (this.vx * s > 0) this.vx *= 1 - push; x = clamp(x, lo, hi); }
      }
    }
    const ceil = WORLD.ceiling;
    if (y > ceil) { y = ceil; if (this.vy > 0) this.vy = 0; }

    // --- collision
    const floorAt = (px, pz) => {
      let fl = groundAt(px, pz) + C.eyeClearance;
      for (let a = 0; a < 8; a++) {
        const g = groundAt(px + C.ringRadius * RING[a * 2], pz + C.ringRadius * RING[a * 2 + 1]) + C.ringClearance;
        if (g > fl) fl = g;
      }
      const water = WORLD.waterLevel + 0.8; // do not dive into the loch either
      return water > fl ? water : fl;
    };
    let floor = floorAt(x, z);
    // a rise steeper than maxClimb over this frame's horizontal step blocks (or slides) the horizontal motion instead
    // of lifting the camera abruptly
    const climb = (fl, dx, dz) => fl - this.y - C.maxClimb * Math.hypot(dx, dz) - 0.05;
    if (floor > y && climb(floor, x - this.x, z - this.z) > 0) {
      const fa = floorAt(x, this.z), fb = floorAt(this.x, z);
      if (climb(fa, x - this.x, 0) <= 0) { z = this.z; this.vz = 0; floor = fa; }
      else if (climb(fb, 0, z - this.z) <= 0) { x = this.x; this.vx = 0; floor = fb; }
      else { x = this.x; z = this.z; this.vx = 0; this.vz = 0; floor = floorAt(x, z); }
    }
    const ground = groundAt(x, z);
    this.groundHeight = ground;
    this.collided = false;
    if (y < floor + C.cushion) {
      // cushion: a smooth push upward before the hard limit, so terrain-following low flight is not jittery
      y += (floor + C.cushion - y) * damp(C.cushionRate, dt) * clamp((floor + C.cushion - y) / C.cushion, 0, 1);
    }
    if (y < floor) { y = floor; this.collided = true; if (this.vy < 0) this.vy = 0; }
    this.x = x; this.y = y; this.z = z;
    this.agl = y - ground;
  }
}

FlightModel.prototype.setMode = function (mode) {
  this.mode = mode;
  if (mode === 'broom') this.vy = Math.max(this.vy, 3); // a little lift on mounting
  this.roll = 0;
};

/** Walking step: horizontal movement on the ground, gravity, jumping, slope and deep-water limits. */
FlightModel.prototype._walk = function (dt, input, groundAt) {
  const C = WALK;
  const fwd = input.axis(['KeyS'], ['KeyW']), strafe = input.axis(['KeyA'], ['KeyD']);
  const sp = input.down('ShiftLeft', 'ShiftRight') ? C.run : C.walk;
  const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
  let tx = sy * fwd + cy * strafe, tz = cy * fwd - sy * strafe; // X east, Z north
  const tl = Math.hypot(tx, tz); if (tl > 1) { tx /= tl; tz /= tl; }
  const k = damp(C.accel, dt);
  this.vx += (tx * sp - this.vx) * k; this.vz += (tz * sp - this.vz) * k;
  const foot = this.y - C.eye;
  let x = this.x + this.vx * dt, z = this.z + this.vz * dt;
  // blocked by steep ground or deep water: the step is refused, sliding along the axis that is allowed
  const ok = (px, pz) => {
    const g = groundAt(px, pz), d = Math.hypot(px - this.x, pz - this.z) || 1e-6;
    if (g < WORLD.waterLevel - C.wadeDepth) return false;
    return !(this.onGround && g - foot > C.stepUp && (g - foot) / d > C.maxSlope);
  };
  if (!ok(x, z)) { if (ok(x, this.z)) { z = this.z; this.vz = 0; } else if (ok(this.x, z)) { x = this.x; this.vx = 0; } else { x = this.x; z = this.z; this.vx = this.vz = 0; } }
  const P = WORLD.playable; x = clamp(x, P.minX, P.maxX); z = clamp(z, P.minZ, P.maxZ);
  const g = groundAt(x, z);
  if (this.onGround && input.down('Space')) { this.vy = C.jump; this.onGround = false; }
  this.vy -= C.gravity * dt;
  let y = this.y + this.vy * dt;
  if (y - C.eye <= g) { y = g + C.eye; this.vy = 0; this.onGround = true; } else if (this.onGround && y - C.eye - g < 0.6 && this.vy <= 0) { y = g + C.eye; this.vy = 0; } else this.onGround = false;
  this.x = x; this.y = y; this.z = z; this.groundHeight = g; this.agl = y - g; this.roll *= 1 - damp(6, dt);
};

const RING = new Float64Array(16);
for (let a = 0; a < 8; a++) { RING[a * 2] = Math.cos(a * Math.PI / 4); RING[a * 2 + 1] = Math.sin(a * Math.PI / 4); }
