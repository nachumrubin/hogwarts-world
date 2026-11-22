// Dynamic resolution: keeps frame cost near a budget by scaling the internal render resolution.
// Logic adapted from Abyssal Garden (MIT © 2026 Maksymilian Dendura), main.js frame(): with GPU timestamps it
// steers GPU time into a band; without them it only reacts to frames that are clearly slow, and probes upward rarely.

export class DynamicResolution {
  constructor({ maxScale, minScale, targetMs = 16.7 }) {
    this.max = maxScale; this.min = minScale; this.scale = maxScale; this.targetMs = targetMs;
    this.enabled = true; this._acc = 0; this._n = 0; this._gpu = 0; this._gn = 0; this._t = 0; this._slow = 0; this._ok = 0; this._wait = 3;
  }
  /** Feed one frame; returns true when the scale changed. */
  update(frameMs, gpuMs) {
    if (!this.enabled || frameMs > 500) return false;
    this._t += frameMs; this._acc += frameMs; this._n++;
    if (gpuMs > 0) { this._gpu += gpuMs; this._gn++; }
    if (this._t < 1000) return false;
    const avg = this._acc / this._n, g = this._gn ? this._gpu / this._gn : 0;
    this._t = this._acc = this._n = this._gpu = this._gn = 0;
    let k = 1;
    const lo = this.targetMs * 0.6, hi = this.targetMs * 0.82;
    if (g) { if (g > hi || g < lo) k = Math.sqrt((this.targetMs * 0.72) / g); }
    else if (avg > this.targetMs * 1.08) { this._ok = 0; if (++this._slow > 1) { k = Math.sqrt(this.targetMs / avg); this._slow = 0; this._wait = Math.min(this._wait * 2, 60); } }
    else { this._slow = 0; if (++this._ok > this._wait) { k = 1.08; this._ok = 0; } }
    const next = Math.round(Math.min(this.max, Math.max(this.min, this.scale * Math.min(1.25, Math.max(0.75, k)))) * 20) / 20;
    if (next === this.scale) return false;
    this.scale = next;
    return true;
  }
}
