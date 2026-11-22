// GPU side of the terrain: one storage buffer of fixed-size chunk slots, the shared stitching index buffer, a
// per-frame draw list, and the terrain pipeline. It knows nothing about generation or the quadtree: the streamer
// tells it which slot holds which chunk, the app hands it a list of draws.

import { CHUNK_BYTES } from '../config.js';
import { buildIndexPatterns } from '../terrain/index-patterns.js';
import { TERRAIN_WGSL, terrainWGSL } from './shaders/terrain.wgsl.js';

export const DRAW_STRIDE = 32; // bytes, matches struct Draw in terrain.wgsl.js

export class TerrainRenderer {
  constructor(device, { poolSlots, sampleCount, colorFormat, depthFormat, frameBuffer, overviewView, materialsView, sampler }) {
    this.device = device;
    this.poolSlots = poolSlots;
    this.pool = device.createBuffer({ label: 'chunk pool', size: poolSlots * CHUNK_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const pat = buildIndexPatterns();
    this.patterns = pat;
    this.index = device.createBuffer({ label: 'stitch indices', size: pat.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.index, 0, pat.indices);
    this.maxDraws = poolSlots;
    this.drawData = new ArrayBuffer(this.maxDraws * DRAW_STRIDE);
    this.drawF = new Float32Array(this.drawData); this.drawU = new Uint32Array(this.drawData);
    this.drawMask = new Uint8Array(this.maxDraws);
    this.draws = device.createBuffer({ label: 'terrain draws', size: this.drawData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.count = 0;

    const module = device.createShaderModule({ label: 'terrain', code: TERRAIN_WGSL });
    this.module = module;
    this.pipeline = device.createRenderPipeline({
      label: 'terrain',
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: colorFormat }] },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'cw' },
      depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' },
      multisample: { count: sampleCount },
    });
    this.frameBuffer = frameBuffer; this.sampler = sampler;
    this.opts = { sampleCount, colorFormat, depthFormat };
    this.forest = null;
    this.setOverview(overviewView, materialsView);
  }

  /**
   * Forest POC: switch to the terrain variant that also reads the forest bind group (group 1).
   * forest = { wgsl, bindGroupLayout, bindGroup }; null switches back.
   */
  setForest(forest) {
    this.forest = forest;
    if (!forest) return;
    const d = this.device, V = GPUShaderStage.VERTEX, Fr = GPUShaderStage.FRAGMENT;
    this.g0Layout = d.createBindGroupLayout({ label: 'terrain g0', entries: [
      { binding: 0, visibility: V | Fr, buffer: { type: 'uniform' } },
      { binding: 1, visibility: V, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: V, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: Fr, texture: { sampleType: 'float' } },
      { binding: 4, visibility: Fr, sampler: { type: 'filtering' } },
      { binding: 5, visibility: Fr, texture: { sampleType: 'float' } },
    ] });
    const module = d.createShaderModule({ label: 'terrain+forest', code: terrainWGSL(forest.wgsl) });
    const o = this.opts;
    this.forestPipeline = d.createRenderPipeline({
      label: 'terrain+forest', layout: d.createPipelineLayout({ bindGroupLayouts: [this.g0Layout, forest.bindGroupLayout] }),
      vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: o.colorFormat }] },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'cw' },
      depthStencil: { format: o.depthFormat, depthWriteEnabled: true, depthCompare: 'greater' },
      multisample: { count: o.sampleCount },
    });
    this._forestBG0();
  }

  _forestBG0() {
    if (!this.forest || !this._ovViews) return;
    this.forestBG0 = this.device.createBindGroup({ layout: this.g0Layout, entries: [
      { binding: 0, resource: { buffer: this.frameBuffer } }, { binding: 1, resource: { buffer: this.draws } }, { binding: 2, resource: { buffer: this.pool } },
      { binding: 3, resource: this._ovViews[0] }, { binding: 4, resource: this.sampler }, { binding: 5, resource: this._ovViews[1] }] });
  }

  setOverview(view, materialsView) {
    this._ovViews = [view, materialsView];
    this._forestBG0();
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.frameBuffer } },
        { binding: 1, resource: { buffer: this.draws } },
        { binding: 2, resource: { buffer: this.pool } },
        { binding: 3, resource: view },
        { binding: 4, resource: this.sampler },
        { binding: 5, resource: materialsView },
      ],
    });
  }

  upload(slot, buffer) { this.device.queue.writeBuffer(this.pool, slot * CHUNK_BYTES, buffer); }

  beginDraws() { this.count = 0; }

  /** Queue one chunk draw. originX/Z are relative to the render origin and must be exact (see floating-origin.js). */
  addDraw(originX, originZ, spacing, slot, morphRange, finer, depth, coarser) {
    if (this.count >= this.maxDraws) return false;
    const o = this.count * 8;
    this.drawF[o] = originX; this.drawF[o + 1] = originZ; this.drawF[o + 2] = spacing;
    this.drawU[o + 3] = slot; this.drawF[o + 4] = morphRange < 1e29 ? morphRange : 1e30;
    this.drawU[o + 5] = finer; this.drawU[o + 6] = depth; this.drawU[o + 7] = 0;
    this.drawMask[this.count] = coarser;
    this.count++;
    return true;
  }

  /** Upload the draw list and record the draws. Returns the triangle count. */
  record(pass) {
    if (!this.count) return 0;
    this.device.queue.writeBuffer(this.draws, 0, this.drawData, 0, this.count * DRAW_STRIDE);
    if (this.forest) { pass.setPipeline(this.forestPipeline); pass.setBindGroup(0, this.forestBG0); pass.setBindGroup(1, this.forest.bindGroup); }
    else { pass.setPipeline(this.pipeline); pass.setBindGroup(0, this.bindGroup); }
    pass.setIndexBuffer(this.index, this.patterns.format);
    let tris = 0;
    const off = this.patterns.offsets, cnt = this.patterns.counts;
    for (let i = 0; i < this.count; i++) {
      const m = this.drawMask[i];
      pass.drawIndexed(cnt[m], 1, off[m], 0, i);
      tris += cnt[m] / 3;
    }
    return tris;
  }

  destroy() { this.pool.destroy(); this.index.destroy(); this.draws.destroy(); }
}
