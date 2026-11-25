// Performance monitor: frame cadence (between rendered frames), CPU time to encode/submit, GPU pass time
// (timestamp queries, when the adapter supports them). Rolling window; reports mean and 95th percentile.
export class PerfMonitor {
  private frames: number[] = []; private cpu: number[] = []; private gpu: number[] = [];
  private last = 0;
  private window: number;
  constructor(window = 120) { this.window = window; }
  /** Call once per rendered frame. `continuous` = frames are being requested back to back (live mode). */
  frame(now: number, cpuMs: number, gpuMs: number | null, continuous: boolean): void {
    if (this.last && continuous) push(this.frames, now - this.last, this.window);
    this.last = continuous ? now : 0;
    push(this.cpu, cpuMs, this.window);
    if (gpuMs !== null && gpuMs > 0) push(this.gpu, gpuMs, this.window);
  }
  reset(): void { this.frames = []; this.cpu = []; this.gpu = []; this.last = 0; }
  stats(): { fps: number | null; frameMs: number | null; frameP95: number | null; cpuMs: number | null; gpuMs: number | null } {
    const m = mean(this.frames);
    return { fps: m ? 1000 / m : null, frameMs: m, frameP95: p95(this.frames), cpuMs: mean(this.cpu), gpuMs: mean(this.gpu) };
  }
}
const push = (a: number[], v: number, n: number) => { a.push(v); if (a.length > n) a.shift(); };
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const p95 = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]; };
