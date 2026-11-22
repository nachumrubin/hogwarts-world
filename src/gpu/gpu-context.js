// WebGPU adapter/device acquisition, capability checks, device-loss detection and GPU timestamp queries.
// Pattern (timestamp ring, uncaptured-error logging) adapted from Abyssal Garden (MIT, © 2026 Maksymilian Dendura),
// main.js; recovery is in-place instead of a page reload. See NOTICE.md.

export class UnsupportedError extends Error {}

export class GpuContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.device = null;
    this.adapter = null;
    this.context = null;
    this.format = null;
    this.hasTimestamps = false;
    this.onLost = null; // (info) => void
    this.simulatedLoss = false;
    this.errors = [];
    this.adapterInfo = {};
  }

  static unsupportedReason() {
    if (!('gpu' in navigator)) return 'This browser does not expose WebGPU (navigator.gpu is missing). Use a current desktop Chrome, Edge, or a browser with WebGPU enabled.';
    if (!window.isSecureContext) return 'WebGPU needs a secure context: open the prototype via http://localhost (npm start) rather than file://.';
    return null;
  }

  async init() {
    const why = GpuContext.unsupportedReason();
    if (why) throw new UnsupportedError(why);
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new UnsupportedError('No WebGPU adapter is available (the GPU may be blocklisted or WebGPU disabled).');
    // vertex pulling needs storage buffers in the vertex stage
    const vsLimit = adapter.limits.maxStorageBuffersInVertexStage;
    if (vsLimit !== undefined && vsLimit < 2) throw new UnsupportedError('This GPU/browser does not allow storage buffers in vertex shaders (WebGPU compatibility mode).');
    this.adapter = adapter;
    const info = adapter.info || {};
    this.adapterInfo = { vendor: info.vendor || '', architecture: info.architecture || '', description: info.description || '', device: info.device || '' };
    this.hasTimestamps = adapter.features.has('timestamp-query');
    const need = 64 * 1024 * 1024;
    const device = await adapter.requestDevice({
      requiredFeatures: this.hasTimestamps ? ['timestamp-query'] : [],
      requiredLimits: {
        maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, Math.max(need, 128 * 1024 * 1024)),
        maxBufferSize: Math.min(adapter.limits.maxBufferSize, 256 * 1024 * 1024),
      },
    });
    this.device = device;
    device.addEventListener('uncapturederror', (e) => {
      const msg = e.error && e.error.message ? e.error.message : String(e.error);
      this.errors.push(msg);
      console.error('WebGPU error:', msg);
    });
    device.lost.then((info) => {
      if (this.device !== device) return; // an old device
      const simulated = this.simulatedLoss;
      this.simulatedLoss = false;
      if (info.reason === 'destroyed' && !simulated) return; // page teardown or deliberate
      this.device = null;
      if (this.onLost) this.onLost({ reason: info.reason, message: info.message, simulated });
    });
    this.context = this.canvas.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device, format: this.format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    this._initTimestamps();
    return device;
  }

  /** Debug: destroy the device and treat it as a loss, to exercise the recovery path. */
  simulateLoss() { if (this.device) { this.simulatedLoss = true; this.device.destroy(); } }

  _initTimestamps() {
    this.gpuMs = 0;
    this.gpuSamples = [];
    if (!this.hasTimestamps) return;
    const d = this.device;
    this.querySet = d.createQuerySet({ type: 'timestamp', count: 2 });
    this.resolveBuf = d.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    this.readRing = [];
    for (let i = 0; i < 6; i++) {
      const buf = d.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      this.readRing.push({ buf, busy: false });
    }
  }

  /** Returns {begin, end, slot} timestampWrites for this frame, or null when unavailable / all readbacks busy. */
  beginTimestamps() {
    if (!this.hasTimestamps) return null;
    const slot = this.readRing.find((s) => !s.busy);
    if (!slot) return null;
    return { slot, begin: { querySet: this.querySet, beginningOfPassWriteIndex: 0 }, end: { querySet: this.querySet, endOfPassWriteIndex: 1 } };
  }

  resolveTimestamps(encoder, ts) {
    encoder.resolveQuerySet(this.querySet, 0, 2, this.resolveBuf, 0);
    encoder.copyBufferToBuffer(this.resolveBuf, 0, ts.slot.buf, 0, 16);
  }

  afterSubmit(ts) {
    if (!ts) return;
    const s = ts.slot; s.busy = true;
    const dev = this.device;
    s.buf.mapAsync(GPUMapMode.READ).then(() => {
      const a = new BigInt64Array(s.buf.getMappedRange());
      const ms = Number(a[1] - a[0]) / 1e6;
      s.buf.unmap(); s.busy = false;
      if (ms > 0 && ms < 1000) { this.gpuMs = ms; this.gpuSamples.push(ms); if (this.gpuSamples.length > 4096) this.gpuSamples.splice(0, 2048); }
    }, () => { if (dev === this.device) s.busy = false; });
  }
}
