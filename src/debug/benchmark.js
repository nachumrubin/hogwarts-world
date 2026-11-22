// Benchmark: flies the scripted route at constant speed and records every frame. Reports FPS and frame-time
// percentiles (and GPU time when timestamp queries are available), plus load metrics. Result is exposed as
// window.__benchResult, logged as JSON and downloadable.

import { percentile } from '../core/math.js';
import { routePose } from './route.js';

export class Benchmark {
  constructor(route, { duration = 90, warmup = 1.0 } = {}) {
    this.route = route; this.duration = duration; this.warmup = warmup;
    this.speed = route.length / duration;
    this.t = 0; this.active = false; this.done = false;
    this.frames = []; this.gpu = []; this.tris = []; this.draws = []; this.pending = [];
    this.pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, curvature: 0 };
    this.bank = 0;
  }
  start() { this.t = 0; this.active = true; this.done = false; this.frames.length = this.gpu.length = this.tris.length = this.draws.length = this.pending.length = 0; this.hitches = 0; this.startedAt = performance.now(); }

  /** Advance by real time and return the camera pose. */
  step(dt) {
    this.t += dt;
    const p = routePose(this.route, Math.min(this.t, this.duration) * this.speed, this.pose);
    const target = Math.max(-0.5, Math.min(0.5, Math.atan(this.speed * this.speed * p.curvature / 9.81)));
    this.bank += (target - this.bank) * (1 - Math.exp(-3 * dt));
    p.roll = this.bank;
    if (this.t >= this.duration) { this.active = false; this.done = true; }
    return p;
  }

  record(frameMs, gpuMs, stats, pending) {
    if (this.t < this.warmup) return;
    this.frames.push(frameMs);
    if (gpuMs > 0) this.gpu.push(gpuMs);
    this.tris.push(stats.triangles); this.draws.push(stats.drawCalls); this.pending.push(pending);
  }

  result(meta) {
    const sorted = (a) => Float64Array.from(a).sort();
    const f = sorted(this.frames), g = sorted(this.gpu);
    const sum = (a) => a.reduce((s, v) => s + v, 0);
    const stat = (a) => a.length ? { avg: sum(a) / a.length, p50: percentile(a, 50), p90: percentile(a, 90), p95: percentile(a, 95), p99: percentile(a, 99), p999: percentile(a, 99.9), max: a[a.length - 1], min: a[0] } : null;
    const ft = stat(f);
    const r = {
      kind: 'highlands-benchmark', version: 1,
      date: new Date().toISOString(),
      ...meta,
      route: { lengthM: Math.round(this.route.length), durationS: this.duration, speedMps: +this.speed.toFixed(1), warmupS: this.warmup },
      frames: f.length,
      fps: { avg: ft ? 1000 / ft.avg : 0, low1pct: ft ? 1000 / ft.p99 : 0 },
      frameTimeMs: ft,
      gpuTimeMs: stat(g),
      hitches: { over33ms: this.frames.filter((v) => v > 33.4).length, over50ms: this.frames.filter((v) => v > 50).length, over100ms: this.frames.filter((v) => v > 100).length },
      triangles: { avg: Math.round(sum(this.tris) / Math.max(1, this.tris.length)), max: Math.max(0, ...this.tris) },
      drawCalls: { avg: Math.round(sum(this.draws) / Math.max(1, this.draws.length)), max: Math.max(0, ...this.draws) },
      missingChunks: { avg: +(sum(this.pending) / Math.max(1, this.pending.length)).toFixed(1), max: Math.max(0, ...this.pending) },
    };
    return r;
  }
}

export function formatResult(r) {
  const ms = (o) => o ? `avg ${o.avg.toFixed(2)}  p50 ${o.p50.toFixed(2)}  p90 ${o.p90.toFixed(2)}  p95 ${o.p95.toFixed(2)}  p99 ${o.p99.toFixed(2)}  max ${o.max.toFixed(2)} ms` : 'n/a';
  return [
    `BENCHMARK  ${r.preset}  ${r.resolution}  (${r.frames} frames, ${r.route.durationS} s, ${r.route.lengthM} m route)`,
    `FPS        avg ${r.fps.avg.toFixed(1)}   1% low ${r.fps.low1pct.toFixed(1)}`,
    `frame      ${ms(r.frameTimeMs)}`,
    `GPU        ${r.gpuTimeMs ? ms(r.gpuTimeMs) : 'timestamp-query unavailable'}`,
    `hitches    >33ms ${r.hitches.over33ms}   >50ms ${r.hitches.over50ms}   >100ms ${r.hitches.over100ms}`,
    `load       tris avg ${r.triangles.avg.toLocaleString()} max ${r.triangles.max.toLocaleString()}   draws avg ${r.drawCalls.avg} max ${r.drawCalls.max}   missing chunks avg ${r.missingChunks.avg} max ${r.missingChunks.max}`,
    `adapter    ${r.adapter}`,
  ].join('\n');
}
