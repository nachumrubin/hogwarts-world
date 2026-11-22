// Scripted camera route over the prototype area (benchmark + demo). Catmull-Rom through control points, sampled
// by arc length for constant speed (approach adapted from Abyssal Garden's dev fly-through, MIT © 2026 Maksymilian
// Dendura). Heights are computed from the terrain: ground + requested clearance, with limited climb/descent slopes
// and smoothing, so the route can never pass through the terrain.

import { WORLD } from '../config.js';

// x (east), z (north) in metres, clearance above ground or water (m). Station → boat crossing → castle → grounds →
// Forbidden Forest → Aragog's Hollow → high pass back → pitch → Hogsmeade → western lake.
export const ROUTE_POINTS = [
  [2700, 1500, 20], [2850, 1700, 14], [2850, 2000, 10], [2950, 2200, 8], [3200, 2380, 8], [3400, 2500, 10],
  [3500, 2650, 40], [3650, 2850, 60], [3830, 3060, 25], [4000, 3290, 25], [4600, 3550, 45], [5300, 3700, 45],
  [5700, 3700, 30], [6300, 4400, 50], [6850, 5050, 40], [7400, 5400, 45], [7600, 5500, 55], [7200, 5700, 300],
  [5500, 5000, 500], [3500, 4200, 350], [3000, 3750, 80], [2400, 4150, 60], [1950, 4270, 40], [1550, 4550, 40],
  [1200, 4100, 80], [900, 3400, 30], [1300, 3000, 25], [1900, 2850, 20], [2500, 2500, 60],
];

export function buildRoute(gen, { points = ROUTE_POINTS, step = 2, maxSlope = 0.38, smoothWindow = 70 } = {}) {
  const P = points;
  const cr = (a, b, c, d, u) => 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u);
  // dense raw curve
  const raw = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    for (let k = 0; k < 400; k++) {
      const u = k / 400;
      raw.push([cr(p0[0], p1[0], p2[0], p3[0], u), cr(p0[1], p1[1], p2[1], p3[1], u), cr(p0[2], p1[2], p2[2], p3[2], u)]);
    }
  }
  raw.push(P[P.length - 1].slice());
  // resample at constant arc length
  const pts = [raw[0]];
  let acc = 0;
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1], b = raw[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    acc += d;
    while (acc >= step) {
      acc -= step;
      const t = 1 - acc / d;
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  const n = pts.length;
  const ground = new Float64Array(n), y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let g = -Infinity;
    for (const [ox, oz] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]]) g = Math.max(g, gen.heightAt(pts[i][0] + ox, pts[i][1] + oz));
    ground[i] = Math.max(g, WORLD.waterLevel);
    y[i] = ground[i] + pts[i][2];
  }
  // slope limiting in both directions keeps clearance ahead of rising terrain
  for (let i = 1; i < n; i++) y[i] = Math.max(y[i], y[i - 1] - maxSlope * step);
  for (let i = n - 2; i >= 0; i--) y[i] = Math.max(y[i], y[i + 1] - maxSlope * step);
  // smoothing, then re-enforce a minimum clearance
  const w = Math.max(1, Math.round(smoothWindow / step)), ys = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let k = -w; k <= w; k++) { const j = Math.min(n - 1, Math.max(0, i + k)); s += y[j]; c++; } ys[i] = s / c; }
  for (let i = 0; i < n; i++) ys[i] = Math.max(ys[i], ground[i] + 6);
  return { x: pts.map((p) => p[0]), z: pts.map((p) => p[1]), y: ys, ground, step, length: (n - 1) * step };
}

/** Camera pose at distance s along the route: position, yaw/pitch looking ahead, bank from curvature. */
export function routePose(route, s, out) {
  const n = route.y.length, f = Math.max(0, Math.min(n - 1.001, s / route.step)), i = f | 0, t = f - i;
  const L = (a) => a[i] + (a[i + 1] - a[i]) * t;
  out.x = L(route.x); out.y = L(route.y); out.z = L(route.z);
  const ahead = Math.min(n - 1, i + Math.round(110 / route.step));
  const dx = route.x[ahead] - out.x, dy = route.y[ahead] - out.y - 6, dz = route.z[ahead] - out.z;
  out.yaw = Math.atan2(dx, dz); // clockwise from north (Z north)
  out.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  // heading change over ±40 m → horizontal curvature → coordinated-turn bank angle
  const a = Math.max(0, i - 20), b = Math.min(n - 1, i + 20);
  const h1 = Math.atan2(route.x[i] - route.x[a], route.z[i] - route.z[a]), h2 = Math.atan2(route.x[b] - route.x[i], route.z[b] - route.z[i]);
  let dh = h2 - h1; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
  out.curvature = dh / Math.max(1, (b - a) * route.step);
  return out;
}
