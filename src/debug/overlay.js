// Debug overlay (DOM). Updated a few times per second to keep its own cost negligible.

export class Overlay {
  constructor(el) { this.el = el; this.visible = true; this._t = 0; this.frameTimes = new Float32Array(240); this._i = 0; this._n = 0; }
  toggle() { this.visible = !this.visible; this.el.hidden = !this.visible; }
  pushFrame(ms) { this.frameTimes[this._i] = ms; this._i = (this._i + 1) % this.frameTimes.length; this._n = Math.min(this._n + 1, this.frameTimes.length); }
  /** @param {() => string} text built only when the overlay is about to refresh */
  update(dtMs, text) {
    this._t += dtMs;
    if (!this.visible || this._t < 250) return;
    this._t = 0;
    this.el.textContent = text();
  }
  windowStats() {
    const a = Array.from(this.frameTimes.subarray(0, this._n)).sort((x, y) => x - y);
    if (!a.length) return { avg: 0, p95: 0, max: 0 };
    const avg = a.reduce((s, v) => s + v, 0) / a.length;
    return { avg, p95: a[Math.min(a.length - 1, Math.ceil(a.length * 0.95) - 1)], max: a[a.length - 1] };
  }
}
