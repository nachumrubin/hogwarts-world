// Frame graph and GPU resource ownership.
//   pass 1 (HDR, optional MSAA, reverse-Z depth): terrain chunks → sky (where depth is still clear) → loch surface
//   pass 2: tonemap + dither + upscale to the canvas
// Everything here is rebuilt from scratch by build() after a device loss.

import { TerrainRenderer } from './terrain-renderer.js';
import { SKY_WGSL, WATER_WGSL, POST_WGSL } from './shaders/sky-water-post.wgsl.js';
import { FRAME_FLOATS } from './shaders/common.wgsl.js';

const HDR = 'rgba16float', DEPTH = 'depth32float';

export class Renderer {
  constructor(gpu, preset) {
    this.gpu = gpu;
    this.preset = preset;
    this.frame = new Float32Array(FRAME_FLOATS);
    this.post = new Float32Array(4);
    this.width = 0; this.height = 0;
    this.overviewData = null;
    this.stats = { triangles: 0, drawCalls: 0, terrainDraws: 0 };
  }

  build() {
    const d = this.device = this.gpu.device;
    const sc = this.sampleCount = this.preset.msaa;
    this.frameBuffer = d.createBuffer({ label: 'frame', size: FRAME_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.postBuffer = d.createBuffer({ label: 'post', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this._createOverviewTexture();
    this.terrain = new TerrainRenderer(d, {
      poolSlots: this.preset.poolSlots, sampleCount: sc, colorFormat: HDR, depthFormat: DEPTH,
      frameBuffer: this.frameBuffer, overviewView: this.overviewView, sampler: this.sampler,
    });
    const sky = d.createShaderModule({ label: 'sky', code: SKY_WGSL });
    this.skyPipe = d.createRenderPipeline({
      label: 'sky', layout: 'auto',
      vertex: { module: sky, entryPoint: 'vsFull' }, fragment: { module: sky, entryPoint: 'fsSky', targets: [{ format: HDR }] },
      depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: 'equal' }, multisample: { count: sc },
    });
    this.skyBG = d.createBindGroup({ layout: this.skyPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.frameBuffer } }] });
    const water = d.createShaderModule({ label: 'water', code: WATER_WGSL });
    const pm = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' };
    this.waterPipe = d.createRenderPipeline({
      label: 'water', layout: 'auto',
      vertex: { module: water, entryPoint: 'vsWater' },
      fragment: { module: water, entryPoint: 'fsWater', targets: [{ format: HDR, blend: { color: pm, alpha: pm } }] },
      primitive: { topology: 'triangle-strip', cullMode: 'none' },
      depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: 'greater' }, multisample: { count: sc },
    });
    this._waterBG();
    const post = d.createShaderModule({ label: 'post', code: POST_WGSL });
    this.postPipe = d.createRenderPipeline({
      label: 'post', layout: 'auto',
      vertex: { module: post, entryPoint: 'vsFull' }, fragment: { module: post, entryPoint: 'fsPost', targets: [{ format: this.gpu.format }] },
    });
    this.width = this.height = 0; // force target creation
    this.targets = [];
    if (this.overviewData) this.setOverview(this.overviewData);
  }

  _createOverviewTexture(res = 1, data = null) {
    if (this.overview) this.overview.destroy();
    this.overview = this.device.createTexture({ label: 'overview', size: [res, res], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    const px = data || new Uint16Array([0x3c00, 0x3c00, 0xd780, 0x3c00]); // (1, 1, -120, 1) in half floats
    this.device.queue.writeTexture({ texture: this.overview }, px, { bytesPerRow: res * 8 }, [res, res]);
    this.overviewView = this.overview.createView();
  }

  _waterBG() {
    this.waterBG = this.device.createBindGroup({ layout: this.waterPipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.frameBuffer } }, { binding: 1, resource: this.overviewView }, { binding: 2, resource: this.sampler }] });
  }

  /** Overview map: {res, halfExtent, data: Uint16Array rgba16f}. Kept on the CPU for device-loss recovery. */
  setOverview(ov) {
    this.overviewData = ov;
    this._createOverviewTexture(ov.res, ov.data);
    this.terrain.setOverview(this.overviewView);
    this._waterBG();
  }

  /** Internal resolution = canvas size × scale. Recreates targets only when the size changes. */
  resize(canvasW, canvasH, scale) {
    const w = Math.max(2, Math.round(canvasW * scale)), h = Math.max(2, Math.round(canvasH * scale));
    if (w === this.width && h === this.height) return false;
    this.width = w; this.height = h;
    for (const t of this.targets) t.destroy();
    const d = this.device, sc = this.sampleCount;
    this.hdr = d.createTexture({ label: 'hdr', size: [w, h], format: HDR, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.depth = d.createTexture({ label: 'depth', size: [w, h], format: DEPTH, sampleCount: sc, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.targets = [this.hdr, this.depth];
    if (sc > 1) { this.msaa = d.createTexture({ label: 'msaa', size: [w, h], format: HDR, sampleCount: sc, usage: GPUTextureUsage.RENDER_ATTACHMENT }); this.targets.push(this.msaa); }
    const hdrView = this.hdr.createView();
    this.scenePass = {
      label: 'scene',
      colorAttachments: [sc > 1
        ? { view: this.msaa.createView(), resolveTarget: hdrView, loadOp: 'clear', storeOp: 'discard', clearValue: [0, 0, 0, 1] }
        : { view: hdrView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
      depthStencilAttachment: { view: this.depth.createView(), depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'discard' },
    };
    this.postPass = { label: 'post', colorAttachments: [{ view: null, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] };
    this.postBG = d.createBindGroup({ layout: this.postPipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: hdrView }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: this.postBuffer } }] });
    return true;
  }

  /** Records and submits one frame. The terrain draw list must already be filled (this.terrain.addDraw). */
  render(time, exposure) {
    const d = this.device, f = this.frame;
    f[40] = this.width; f[41] = this.height; f[42] = 1 / this.width; f[43] = 1 / this.height;
    d.queue.writeBuffer(this.frameBuffer, 0, f);
    this.post[0] = exposure; this.post[1] = time;
    d.queue.writeBuffer(this.postBuffer, 0, this.post);

    const enc = d.createCommandEncoder({ label: 'frame' });
    const ts = this.gpu.beginTimestamps();
    this.scenePass.timestampWrites = ts ? ts.begin : undefined;
    this.postPass.timestampWrites = ts ? ts.end : undefined;
    const pass = enc.beginRenderPass(this.scenePass);
    const tris = this.terrain.record(pass);
    pass.setPipeline(this.skyPipe); pass.setBindGroup(0, this.skyBG); pass.draw(3);
    pass.setPipeline(this.waterPipe); pass.setBindGroup(0, this.waterBG); pass.draw(4);
    pass.end();
    const canvasTex = this.gpu.context.getCurrentTexture();
    this.postPass.colorAttachments[0].view = canvasTex.createView();
    const pp = enc.beginRenderPass(this.postPass);
    pp.setPipeline(this.postPipe); pp.setBindGroup(0, this.postBG); pp.draw(3);
    pp.end();
    if (ts) this.gpu.resolveTimestamps(enc, ts);
    let cap = null;
    if (this._captureResolve) cap = this._recordCapture(enc, canvasTex);
    d.queue.submit([enc.finish()]);
    if (cap) this._finishCapture(cap);
    this.gpu.afterSubmit(ts);
    const s = this.stats;
    s.terrainDraws = this.terrain.count;
    s.drawCalls = this.terrain.count + 3;
    s.triangles = tris + 1 + 2 + 1;
    return s;
  }

  /** Resolves with a PNG data URL of the next presented frame (GPU readback; works where compositor capture does not). */
  capture() { return new Promise((r) => { this._captureResolve = r; }); }

  _recordCapture(enc, tex) {
    const w = tex.width, h = tex.height, bpr = Math.ceil(w * 4 / 256) * 256;
    const buf = this.device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
    const r = this._captureResolve; this._captureResolve = null;
    return { buf, w, h, bpr, resolve: r, bgra: tex.format.startsWith('bgra') };
  }

  async _finishCapture({ buf, w, h, bpr, resolve, bgra }) {
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange()), px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * bpr + x * 4, o = (y * w + x) * 4;
      px[o] = src[i + (bgra ? 2 : 0)]; px[o + 1] = src[i + 1]; px[o + 2] = src[i + (bgra ? 0 : 2)]; px[o + 3] = 255;
    }
    buf.unmap(); buf.destroy();
    const cv = new OffscreenCanvas(w, h);
    cv.getContext('2d').putImageData(new ImageData(px, w, h), 0, 0);
    const blob = await cv.convertToBlob({ type: 'image/png' });
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.readAsDataURL(blob);
  }

  destroy() {
    for (const t of this.targets || []) t.destroy();
    if (this.terrain) this.terrain.destroy();
    if (this.overview) this.overview.destroy();
  }
}
