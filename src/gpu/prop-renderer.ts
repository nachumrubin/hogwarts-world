// Instanced static meshes (Stage C placeholders, railway, viaduct, river water). Mirrors the terrain design: CPU keeps
// world-space (f64) instance data; every frame positions are made relative to the floating origin, frustum-culled per
// instance, and drawn in runs of instances sharing a mesh (one drawIndexed per visible mesh run).

import type { BuiltMesh } from '../meshes/mesh-builder.ts';
import { PROPS_WGSL } from './shaders/props.wgsl.ts';
import { boxInFrustum } from '../core/math.js';

export interface PropInstance { mesh: number; x: number; y: number; z: number; rot: number; scale: number; tint: [number, number, number] }
interface MeshEntry { firstIndex: number; indexCount: number; baseVertex: number; radius: number; minY: number; maxY: number }

const STRIDE = 32;

export class PropRenderer {
  private device!: GPUDevice;
  private pipeline!: GPURenderPipeline;
  private bindGroup!: GPUBindGroup;
  private vbuf: GPUBuffer | null = null; private ibuf: GPUBuffer | null = null; private ibufInst: GPUBuffer | null = null;
  private meshes: BuiltMesh[] = []; private table: MeshEntry[] = [];
  private instances: PropInstance[] = [];
  private data = new ArrayBuffer(0); private f32 = new Float32Array(0);
  private runs: number[] = []; // mesh, firstInstance, count triples
  private opts: { sampleCount: number; colorFormat: GPUTextureFormat; depthFormat: GPUTextureFormat; frameBuffer: GPUBuffer; overviewView: GPUTextureView; sampler: GPUSampler };
  stats = { draws: 0, triangles: 0, visible: 0, total: 0 };

  constructor(device: GPUDevice, opts: PropRenderer['opts']) { this.opts = opts; this.recreate(device, opts); }

  /** Build (or rebuild after a device loss) all GPU objects from the CPU-side data. */
  recreate(device: GPUDevice, opts: PropRenderer['opts']): void {
    this.device = device; this.opts = opts;
    const module = device.createShaderModule({ label: 'props', code: PROPS_WGSL });
    this.pipeline = device.createRenderPipeline({
      label: 'props', layout: 'auto',
      vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'snorm8x4' }] }] },
      fragment: { module, entryPoint: 'fs', targets: [{ format: opts.colorFormat }] },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
      depthStencil: { format: opts.depthFormat, depthWriteEnabled: true, depthCompare: 'greater' },
      multisample: { count: opts.sampleCount },
    });
    this.vbuf = this.ibuf = this.ibufInst = null;
    if (this.meshes.length) this.setMeshes(this.meshes);
    if (this.instances.length) this.setInstances(this.instances);
  }

  setOverview(view: GPUTextureView): void { this.opts.overviewView = view; this.bind(); }

  setMeshes(meshes: BuiltMesh[]): void {
    this.meshes = meshes;
    let nv = 0, ni = 0;
    this.table = meshes.map((m) => { const e = { firstIndex: ni, indexCount: m.indices.length, baseVertex: nv, radius: m.radius, minY: m.minY, maxY: m.maxY }; nv += m.vertexCount; ni += m.indices.length; return e; });
    const vb = new Uint8Array(Math.max(16, nv * 16)), ib = new Uint32Array(Math.max(4, ni));
    meshes.forEach((m, k) => { vb.set(new Uint8Array(m.vertices), this.table[k].baseVertex * 16); ib.set(m.indices, this.table[k].firstIndex); });
    this.vbuf = this.device.createBuffer({ label: 'prop vertices', size: vb.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.ibuf = this.device.createBuffer({ label: 'prop indices', size: ib.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.vbuf, 0, vb); this.device.queue.writeBuffer(this.ibuf, 0, ib);
  }

  /** Instances are sorted by mesh so that each visible mesh is one draw. */
  setInstances(list: PropInstance[]): void {
    this.instances = [...list].sort((a, b) => a.mesh - b.mesh);
    this.data = new ArrayBuffer(Math.max(STRIDE, this.instances.length * STRIDE));
    this.f32 = new Float32Array(this.data);
    this.ibufInst = this.device.createBuffer({ label: 'prop instances', size: this.data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.bind();
    this.stats.total = this.instances.length;
  }

  private bind(): void {
    if (!this.ibufInst) return;
    this.bindGroup = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.opts.frameBuffer } }, { binding: 1, resource: { buffer: this.ibufInst } },
      { binding: 2, resource: this.opts.overviewView }, { binding: 3, resource: this.opts.sampler }] });
  }

  /** Cull and pack instances relative to the render origin (ox, oz). `planes` = frustum planes in origin space. */
  update(ox: number, oz: number, planes: Float32Array, camX: number, camY: number, camZ: number, maxDist: number): void {
    const f = this.f32, runs = this.runs; runs.length = 0;
    let n = 0, cur = -1, start = 0;
    for (let i = 0; i < this.instances.length; i++) {
      const I = this.instances[i], m = this.table[I.mesh], r = m.radius * I.scale;
      const rx = I.x - ox, rz = I.z - oz;
      const dx = I.x - camX, dy = I.y - camY, dz = I.z - camZ;
      if (dx * dx + dy * dy + dz * dz > (maxDist + r) * (maxDist + r)) continue;
      if (!boxInFrustum(planes, rx - r, I.y + m.minY * I.scale - 1, rz - r, rx + r, I.y + m.maxY * I.scale + 1, rz + r)) continue;
      if (I.mesh !== cur) { if (cur >= 0) runs.push(cur, start, n - start); cur = I.mesh; start = n; }
      const o = n * 8;
      f[o] = rx; f[o + 1] = I.y; f[o + 2] = rz; f[o + 3] = I.rot; f[o + 4] = I.tint[0]; f[o + 5] = I.tint[1]; f[o + 6] = I.tint[2]; f[o + 7] = I.scale;
      n++;
    }
    if (cur >= 0) runs.push(cur, start, n - start);
    if (n && this.ibufInst) this.device.queue.writeBuffer(this.ibufInst, 0, this.data, 0, n * STRIDE);
    this.stats.visible = n;
  }

  record(pass: GPURenderPassEncoder): void {
    this.stats.draws = 0; this.stats.triangles = 0;
    if (!this.runs.length || !this.vbuf || !this.ibuf) return;
    pass.setPipeline(this.pipeline); pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.vbuf); pass.setIndexBuffer(this.ibuf, 'uint32');
    for (let k = 0; k < this.runs.length; k += 3) {
      const e = this.table[this.runs[k]];
      pass.drawIndexed(e.indexCount, this.runs[k + 2], e.firstIndex, e.baseVertex, this.runs[k + 1]);
      this.stats.draws++; this.stats.triangles += (e.indexCount / 3) * this.runs[k + 2];
    }
  }
}
