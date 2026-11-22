// Per-pass GPU timing (timestamp-query), for ?profile=1. WebGPU only allows timestamps at render-pass boundaries,
// so in profiling mode the scene is recorded as separate passes (terrain | trees | ground cover | sky + water) that
// load and store the multisampled targets. That adds memory traffic, so profiled totals are slightly higher than a
// normal frame; the split shows where the time goes. The whole-frame GPU time of a normal frame is measured by
// GpuContext as before.

export class GpuProfiler {
  readonly names: string[];
  private qs: GPUQuerySet; private resolve: GPUBuffer; private ring: { buf: GPUBuffer; busy: boolean }[] = [];
  private used = new Set<number>();
  /** rolling averages (ms) and the last 600 samples per pass */
  avg: Record<string, number> = {}; samples: Record<string, number[]> = {};
  constructor(device: GPUDevice, names: string[]) {
    this.names = names;
    this.qs = device.createQuerySet({ type: 'timestamp', count: names.length * 2 });
    this.resolve = device.createBuffer({ size: names.length * 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    for (let i = 0; i < 4; i++) this.ring.push({ buf: device.createBuffer({ size: names.length * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), busy: false });
    for (const n of names) { this.avg[n] = 0; this.samples[n] = []; }
  }
  /** timestampWrites for pass `name` this frame */
  writes(name: string): GPURenderPassTimestampWrites {
    const i = this.names.indexOf(name);
    this.used.add(i);
    return { querySet: this.qs, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 };
  }
  /** call once per frame after all passes were recorded */
  finish(enc: GPUCommandEncoder): (() => void) | null {
    const slot = this.ring.find((s) => !s.busy);
    if (!slot || !this.used.size) { this.used.clear(); return null; }
    const used = [...this.used]; this.used.clear();
    enc.resolveQuerySet(this.qs, 0, this.names.length * 2, this.resolve, 0);
    enc.copyBufferToBuffer(this.resolve, 0, slot.buf, 0, this.names.length * 16);
    slot.busy = true;
    return () => {
      slot.buf.mapAsync(GPUMapMode.READ).then(() => {
        const a = new BigInt64Array(slot.buf.getMappedRange());
        for (const i of used) {
          const ms = Number(a[i * 2 + 1] - a[i * 2]) / 1e6;
          if (ms >= 0 && ms < 1000) { const n = this.names[i]; const s = this.samples[n]; s.push(ms); if (s.length > 600) s.shift(); this.avg[n] = this.avg[n] ? this.avg[n] * 0.95 + ms * 0.05 : ms; }
        }
        slot.buf.unmap(); slot.busy = false;
      }, () => { slot.busy = false; });
    };
  }
  summary(): Record<string, { avg: number; p50: number; p95: number; n: number }> {
    const out: Record<string, { avg: number; p50: number; p95: number; n: number }> = {};
    for (const n of this.names) {
      const s = [...this.samples[n]].sort((a, b) => a - b);
      if (!s.length) continue;
      out[n] = { avg: +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(3), p50: +s[Math.floor(s.length * 0.5)].toFixed(3), p95: +s[Math.min(s.length - 1, Math.floor(s.length * 0.95))].toFixed(3), n: s.length };
    }
    return out;
  }
}
