// GPU texture bakes for the forest: detail layers (ground + bark, one 2D array) and the leaf atlas, with mip chains.
// Baked once at startup on the GPU (Abyssal Garden bakes its rock detail texture the same way); nothing is downloaded.

import { BAKE_HEIGHT_WGSL, BAKE_FINAL_WGSL, MIP_WGSL, BAKE_LEAF_WGSL } from './shaders/bake.wgsl.ts';

export const DETAIL_LAYERS = 13; // soil, moss, mud, rock, turf, broadleaf litter, needles, 6 barks

export interface ForestTextures { detail: GPUTexture; leafAlb: GPUTexture; leafNrm: GPUTexture; bytes: number; ms: number }

const mipCount = (n: number) => Math.floor(Math.log2(n)) + 1;

export function bakeForestTextures(device: GPUDevice, opts: { detailSize?: number; atlasSize?: number } = {}): ForestTextures {
  const t0 = performance.now();
  const N = opts.detailSize ?? 1024, A = opts.atlasSize ?? 2048;
  const RA = GPUTextureUsage.RENDER_ATTACHMENT, TB = GPUTextureUsage.TEXTURE_BINDING;
  const detail = device.createTexture({ label: 'forest detail', size: [N, N, DETAIL_LAYERS], format: 'rgba8unorm', mipLevelCount: mipCount(N), usage: RA | TB });
  const height = device.createTexture({ label: 'forest detail height (temp)', size: [N, N], format: 'rgba16float', usage: RA | TB });
  const ub = device.createBuffer({ size: 16 * 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const enc = device.createCommandEncoder({ label: 'forest bake' });
  const mk = (code: string, entry: string, formats: GPUTextureFormat[]) => {
    const m = device.createShaderModule({ code });
    return device.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vsFull' }, fragment: { module: m, entryPoint: entry, targets: formats.map((format) => ({ format })) }, primitive: { topology: 'triangle-list' } });
  };
  const pH = mk(BAKE_HEIGHT_WGSL, 'fsHeight', ['rgba16float']);
  const pF = mk(BAKE_FINAL_WGSL, 'fsFinal', ['rgba8unorm']);
  const pM = mk(MIP_WGSL, 'fsDown', ['rgba8unorm']);
  let slot = 0;
  const uni = (a: number, b: number, c = 0, d = 0) => { const off = slot++ * 256; device.queue.writeBuffer(ub, off, new Float32Array([a, b, c, d])); return off; };
  // uniform slots need 256-byte alignment: allocate a bigger buffer
  const ubBig = device.createBuffer({ size: 256 * 512, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const uniB = (a: number, b: number, c = 0, d = 0) => { const off = slot++ * 256; device.queue.writeBuffer(ubBig, off, new Float32Array([a, b, c, d])); return off; };
  void uni;
  const slopeScale = [0.06, 0.05, 0.03, 0.075, 0.035, 0.05, 0.04, 0.05, 0.035, 0.06, 0.02, 0.02, 0.04];
  for (let L = 0; L < DETAIL_LAYERS; L++) {
    const o1 = uniB(L, N);
    let pass = enc.beginRenderPass({ colorAttachments: [{ view: height.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    pass.setPipeline(pH);
    pass.setBindGroup(0, device.createBindGroup({ layout: pH.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubBig, offset: o1, size: 16 } }] }));
    pass.draw(3); pass.end();
    const o2 = uniB(L, N, slopeScale[L]);
    pass = enc.beginRenderPass({ colorAttachments: [{ view: detail.createView({ dimension: '2d', baseArrayLayer: L, arrayLayerCount: 1, baseMipLevel: 0, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pF);
    pass.setBindGroup(0, device.createBindGroup({ layout: pF.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubBig, offset: o2, size: 16 } }, { binding: 1, resource: height.createView() }] }));
    pass.draw(3); pass.end();
    // mips
    for (let m = 1; m < mipCount(N); m++) {
      const om = uniB(0, 1);
      const p = enc.beginRenderPass({ colorAttachments: [{ view: detail.createView({ dimension: '2d', baseArrayLayer: L, arrayLayerCount: 1, baseMipLevel: m, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store' }] });
      p.setPipeline(pM);
      p.setBindGroup(0, device.createBindGroup({ layout: pM.getBindGroupLayout(0), entries: [{ binding: 0, resource: detail.createView({ dimension: '2d', baseArrayLayer: L, arrayLayerCount: 1, baseMipLevel: m - 1, mipLevelCount: 1 }) }, { binding: 1, resource: { buffer: ubBig, offset: om, size: 16 } }] }));
      p.draw(3); p.end();
    }
  }
  // leaf atlas
  const leafAlb = device.createTexture({ label: 'leaf albedo', size: [A, A], format: 'rgba8unorm', mipLevelCount: mipCount(A) - 2, usage: RA | TB });
  const leafNrm = device.createTexture({ label: 'leaf normal', size: [A, A], format: 'rgba8unorm', mipLevelCount: mipCount(A) - 2, usage: RA | TB });
  {
    const m = device.createShaderModule({ code: BAKE_LEAF_WGSL });
    const p = device.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vsFull' }, fragment: { module: m, entryPoint: 'fsLeaf', targets: [{ format: 'rgba8unorm' }, { format: 'rgba8unorm' }] } });
    const o = uniB(A, A / 4);
    const pass = enc.beginRenderPass({ colorAttachments: [
      { view: leafAlb.createView({ baseMipLevel: 0, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
      { view: leafNrm.createView({ baseMipLevel: 0, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: [0.5, 0.5, 0, 0] }] });
    pass.setPipeline(p);
    pass.setBindGroup(0, device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubBig, offset: o, size: 16 } }] }));
    pass.draw(3); pass.end();
    for (const [tex, coverage] of [[leafAlb, true], [leafNrm, false]] as [GPUTexture, boolean][]) {
      for (let lv = 1; lv < tex.mipLevelCount; lv++) {
        const om = uniB(coverage ? 1 : 0, 1.0 + 0.18 * lv);
        const q = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView({ baseMipLevel: lv, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store' }] });
        q.setPipeline(pM);
        q.setBindGroup(0, device.createBindGroup({ layout: pM.getBindGroupLayout(0), entries: [{ binding: 0, resource: tex.createView({ baseMipLevel: lv - 1, mipLevelCount: 1 }) }, { binding: 1, resource: { buffer: ubBig, offset: om, size: 16 } }] }));
        q.draw(3); q.end();
      }
    }
  }
  device.queue.submit([enc.finish()]);
  height.destroy(); ub.destroy();
  const bytes = Math.round(N * N * 4 * DETAIL_LAYERS * 4 / 3 + A * A * 8 * 4 / 3);
  return { detail, leafAlb, leafNrm, bytes, ms: performance.now() - t0 };
}
