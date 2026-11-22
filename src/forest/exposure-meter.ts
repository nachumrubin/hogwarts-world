// Eye adaptation: centre-weighted average log luminance of the HDR image, read back asynchronously, turned into an
// exposure multiplier with partial adaptation (dark interiors stay darker than the open landscape, as the eye sees
// them). Used by all three forest comparison modes so their exposure is handled the same way.

/** Average luminance of the open landscape at the base exposure (measured), the reference for adaptation. */
const METER_REF = 0.35;

const METER_WGSL = /* wgsl */ `
struct FsOut { @builtin(position) pos: vec4f };
@vertex fn vsFull(@builtin(vertex_index) i: u32) -> FsOut { var o: FsOut; o.pos = vec4f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1), 0.0, 1.0); return o; }
@group(0) @binding(0) var hdr: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@fragment fn fsMeter(i: FsOut) -> @location(0) vec4f {
  var s = 0.0;
  for (var y = 0; y < 3; y++) { for (var x = 0; x < 3; x++) {
    let uv = (i.pos.xy - 0.5 + (vec2f(f32(x), f32(y)) + 0.5) / 3.0) / vec2f(64.0, 36.0);
    let c = textureSampleLevel(hdr, smp, uv, 0.0).rgb;
    s += log2(max(dot(c, vec3f(0.2126, 0.7152, 0.0722)), 1e-4));
  } }
  return vec4f(s / 9.0, 0.0, 0.0, 1.0);
}
`;

export class ExposureMeter {
  autoExposure = 1;
  meteredLum = 0;
  /** meter every n-th frame (power of two); 1 for fixed-camera captures */
  every = 4;
  private device: GPUDevice | null = null;
  private tex: GPUTexture | null = null; private bufs: GPUBuffer[] = []; private busy = [false, false];
  private pipe: GPURenderPipeline | null = null; private bg: GPUBindGroup | null = null; private version = -1; private frame = 0;

  record(d: GPUDevice, enc: GPUCommandEncoder, r: { hdrView: GPUTextureView; targetsVersion: number }): void {
    if (this.device !== d) { this.device = d; this.pipe = null; this.version = -1; this.busy = [false, false]; }
    if (!this.pipe) {
      const m = d.createShaderModule({ code: METER_WGSL });
      this.pipe = d.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vsFull' }, fragment: { module: m, entryPoint: 'fsMeter', targets: [{ format: 'r32float' }] } });
      this.tex = d.createTexture({ size: [64, 36], format: 'r32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      this.bufs = [0, 1].map(() => d.createBuffer({ size: 256 * 36, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }));
    }
    if (this.version !== r.targetsVersion) {
      this.version = r.targetsVersion;
      this.bg = d.createBindGroup({ layout: this.pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: r.hdrView }, { binding: 1, resource: d.createSampler({ magFilter: 'linear', minFilter: 'linear' }) }] });
    }
    if ((this.frame++ & (this.every - 1)) !== 0) return;
    const slot = this.busy[0] ? (this.busy[1] ? -1 : 1) : 0;
    if (slot < 0) return;
    const p = enc.beginRenderPass({ colorAttachments: [{ view: this.tex!.createView(), loadOp: 'clear', storeOp: 'store' }] });
    p.setPipeline(this.pipe); p.setBindGroup(0, this.bg!); p.draw(3); p.end();
    enc.copyTextureToBuffer({ texture: this.tex! }, { buffer: this.bufs[slot], bytesPerRow: 256 }, [64, 36]);
    this.busy[slot] = true;
    const buf = this.bufs[slot];
    queueMicrotask(() => d.queue.onSubmittedWorkDone().then(() => buf.mapAsync(GPUMapMode.READ)).then(() => {
      const f = new Float32Array(buf.getMappedRange().slice(0));
      buf.unmap(); this.busy[slot] = false;
      let s = 0, w = 0;
      for (let y = 0; y < 36; y++) for (let x = 0; x < 64; x++) {
        const dx = (x - 31.5) / 32, dy = (y - 17.5) / 18, wt = Math.exp(-(dx * dx + dy * dy) * 1.2);
        s += f[y * 64 + x] * wt; w += wt;
      }
      this.meteredLum = Math.pow(2, s / w);
      const target = Math.pow(METER_REF / Math.max(this.meteredLum, 1e-4), 0.5);
      this.autoExposure = Math.min(1.9, Math.max(0.55, target));
    }, () => { this.busy[slot] = false; }));
  }
}
