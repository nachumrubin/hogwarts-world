// Forest POC renderer: owns every GPU object of the forest and plugs into the existing frame graph through the
// renderer's hooks (pre-scene: shadow map; scene: draw callback; post-scene: light shafts) and the terrain's
// optional forest bind group. Nothing in the base renderer is replaced.
//
// Culling and LOD (CPU, per frame):
//   • trees, rocks, fallen branches: per instance — sphere vs frustum, LOD by distance scaled with tree size,
//     dithered cross-fade bands between LOD0 → LOD1 → LOD2 → impostor (no pops, works at broom speed)
//   • ground cover: per 16 m cell (Abyssal Garden drawCells: frustum + distance per cell, contiguous runs merged
//     into one instanced draw), two row-count LODs, shrink-out at the far end of the range in the vertex shader
//   • logs and roots: unique static geometry per 32 m cell, three LODs by cell distance

import { SITE } from './site.ts';
import type { Ecology, TreeInst, Cover } from './ecology.ts';
import { SPECIES_INFO, type Species } from './species.ts';
import { buildAllArchetypes, Builder, MAT, VERTEX_BYTES, type MeshData, type TreeArchetype } from './tree-gen.ts';
import { buildRockArchetypes, buildGroundWood, buildFallenBranches } from './props-gen.ts';
import { bakeForestTextures, type ForestTextures } from './textures.ts';
import { VEGETATION_WGSL } from './shaders/vegetation.wgsl.ts';
import { COVER_WGSL } from './shaders/cover.wgsl.ts';
import { IMPOSTOR_WGSL, SHAFTS_WGSL } from './shaders/impostor-shafts.wgsl.ts';
import { FOREST_STRUCT_WGSL, FOREST_BINDINGS_WGSL, FOREST_FUNCS_WGSL } from './shaders/forest-common.wgsl.ts';
import { LIGHT_PRESETS, type LightPreset } from './presets.ts';

export type ForestMode = 'B' | 'C';
export const FOREST_UNIFORM_FLOATS = 16 + 4 * 10;
const INST_FLOATS = 16, INST_BYTES = 64;
const SHADOW_SIZE = 4096;
const IMP_TILE = 96, IMP_SIZE = IMP_TILE * 3;
const COVER_CELL = 16;

interface MeshEntry { baseVertex: number; firstIndex: number; count: number; split: number; triangles: number }
interface CoverSet { buf: GPUBuffer | null; data: Float32Array; cells: { start: number; count: number; cx: number; cz: number; y0: number; y1: number }[]; total: number; kind: number }

export interface ForestStats {
  draws: number; triangles: number; instances: number; lod: number[]; impostors: number; cover: number; coverDraws: number;
  shadowMs: number; buildMs: Record<string, number>; gpuBytes: number;
}

export class ForestRenderer {
  readonly mode: ForestMode;
  eco: Ecology;
  preset: LightPreset;
  device!: GPUDevice;
  // CPU-side data (kept for device-loss rebuilds)
  private arch!: ReturnType<typeof buildAllArchetypes>;
  private meshes: MeshData[] = [];
  private table: MeshEntry[] = [];
  private treeLod: number[][] = [];     // archetype → mesh ids per LOD
  private rockLod: number[][] = [];
  private branchLod: number[][] = [];
  private woodCells: { cx: number; cz: number; lod: number[]; y: number }[] = [];
  private terrainMesh = -1;
  private treeArchOf: number[] = [];   // instance → archetype index
  private treeData!: Float32Array;     // per instance static 16 floats
  private rockData!: Float32Array; private branchData!: Float32Array;
  private covers: CoverSet[] = [];
  // GPU
  private vbuf: GPUBuffer | null = null; private ibuf: GPUBuffer | null = null;
  private instBuf: GPUBuffer | null = null; private instCap = 0; private instCPU = new Float32Array(0);
  private impBuf: GPUBuffer | null = null; private impCap = 0; private impCPU = new Float32Array(0);
  private staticInst: GPUBuffer | null = null;
  private ubuf!: GPUBuffer; private uni: Float32Array = new Float32Array(FOREST_UNIFORM_FLOATS);
  private tex!: ForestTextures;
  private matA!: GPUTexture; private matB!: GPUTexture; private canopy!: GPUTexture;
  private shadowTex!: GPUTexture; private dummyDepth!: GPUTexture;
  private impAlb!: GPUTexture; private impNrm!: GPUTexture;
  private frameBGL!: GPUBindGroupLayout; private forestBGL!: GPUBindGroupLayout; private impBGL!: GPUBindGroupLayout;
  private frameBG!: GPUBindGroup; private forestBG!: GPUBindGroup; private forestBGNoShadow!: GPUBindGroup; private impBG!: GPUBindGroup;
  private pipes: Record<string, GPURenderPipeline> = {};
  private shadowDirty = true;
  terrainHook: { wgsl: string; bindGroupLayout: GPUBindGroupLayout; bindGroup: GPUBindGroup } | null = null;
  // shafts
  private shaftTex: GPUTexture[] = []; private shaftVersion = -1; private shaftBG: GPUBindGroup[] = [];
  private shaftBGL!: GPUBindGroupLayout; private texBGL!: GPUBindGroupLayout;
  // per frame
  private shadowVP = new Float32Array(16);
  private drawList: { mesh: number; first: number; count: number }[] = [];
  private impDraws: { first: number; count: number }[] = [];
  private woodDraws: number[] = [];
  private coverRuns: { set: number; far: boolean; first: number; count: number }[] = [];
  private planes = new Float32Array(20);
  private sun: [number, number, number];
  private renderer: any;
  opts: { sampleCount: number; colorFormat: GPUTextureFormat; depthFormat: GPUTextureFormat; lodScale: number; shafts: boolean; dynamicShadows: boolean; detailSize: number };
  stats: ForestStats = { draws: 0, triangles: 0, instances: 0, lod: [0, 0, 0, 0], impostors: 0, cover: 0, coverDraws: 0, shadowMs: 0, buildMs: {}, gpuBytes: 0 };
  windOn = true;

  constructor(eco: Ecology, mode: ForestMode, preset: string, opts: Partial<ForestRenderer['opts']> = {}) {
    this.eco = eco; this.mode = mode;
    this.preset = LIGHT_PRESETS[preset] || LIGHT_PRESETS.day;
    this.sun = this.preset.sun;
    this.opts = { sampleCount: 4, colorFormat: 'rgba16float', depthFormat: 'depth32float', lodScale: 1, shafts: mode === 'C', dynamicShadows: false, detailSize: 1024, ...opts };
    const t0 = performance.now();
    this.buildCPU();
    this.stats.buildMs.cpuMeshes = Math.round(performance.now() - t0);
  }

  // ------------------------------------------------------------------------------------------------ CPU build
  private addMesh(m: MeshData): number { this.meshes.push(m); return this.meshes.length - 1; }

  private buildCPU(): void {
    const eco = this.eco, basic = this.mode === 'B';
    const vets = eco.trees.filter((t) => t.unique);
    this.arch = buildAllArchetypes(vets.map((t) => ({ species: t.species, seed: t.seed, height: t.height })));
    this.stats.buildMs.trees = Math.round(this.arch.ms);
    for (const a of this.arch.list) this.treeLod.push(a.lods.map((m) => this.addMesh(m)));
    const rocks = buildRockArchetypes(8);
    for (const r of rocks) this.rockLod.push(r.lods.map((m) => this.addMesh(m)));
    const br = buildFallenBranches(6);
    for (const b of br) this.branchLod.push(b.map((m) => this.addMesh(m)));
    const hAt = this.heightFn();
    if (!basic) {
      const wood = buildGroundWood(eco, hAt);
      for (const c of wood.cells.values()) {
        const y = hAt(SITE.x0 + (c.cx + 0.5) * 32, SITE.z0 + (c.cz + 0.5) * 32);
        this.woodCells.push({ cx: c.cx, cz: c.cz, lod: c.lods.map((m) => this.addMesh(m)), y });
      }
    }
    // the site's terrain as a shadow caster (2 m grid over the planted area)
    {
      const B = new Builder();
      const g = eco.hGrid, step = 2, nx = Math.floor((g.nx - 1) / step), nz = Math.floor((g.nz - 1) / step);
      const id: number[] = [];
      for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
        const x = g.x0 + i * step, z = g.z0 + j * step;
        id.push(B.v([x - SITE.x0, eco.heights[(j * step) * g.nx + i * step], z - SITE.z0], [0, 1, 0], [1, 0, 0], 0, 0, 0, 0, 0, 1, MAT.soil, 0, 0));
      }
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = id[j * (nx + 1) + i], b = a + 1, c = a + nx + 1, d = c + 1; B.tri(a, c, b); B.tri(b, c, d); }
      this.terrainMesh = this.addMesh(B.build());
    }
    // ----- instances
    const trees = eco.trees;
    this.treeData = new Float32Array(trees.length * INST_FLOATS);
    trees.forEach((t, k) => {
      let ai: number;
      if (t.unique) ai = this.arch.veteran(vets.indexOf(t));
      else if (basic) ai = this.arch.key(t.species, SPECIES_INFO[t.species].archetypes.mature ? 'mature' : 'young', 0);
      else ai = this.arch.key(t.species, t.age, t.arch);
      this.treeArchOf.push(ai);
      const a = this.arch.list[ai];
      const scale = t.unique ? 1 : Math.min(1.35, Math.max(0.7, t.height / a.height));
      const o = k * INST_FLOATS, d = this.treeData;
      d[o] = t.x - SITE.x0; d[o + 1] = t.y; d[o + 2] = t.z - SITE.z0; d[o + 3] = t.yaw;
      d[o + 4] = scale; d[o + 5] = 1 / (a.height * scale); d[o + 6] = basic ? 0 : t.leanX; d[o + 7] = basic ? 0 : t.leanZ;
      d[o + 8] = basic ? 0 : t.shiftX; d[o + 9] = basic ? 0 : t.shiftZ; d[o + 10] = basic ? 0 : t.bend * scale; d[o + 11] = (t.seed % 1000) / 1000;
      d[o + 12] = 0; d[o + 13] = basic ? 1 : Math.min(1, 0.55 + 0.5 * t.health); d[o + 14] = basic ? 0.5 : ((t.seed >>> 10) % 1000) / 1000; d[o + 15] = basic ? 1 : SPECIES_INFO[t.species].stiffness * (t.age === 'young' ? 0.8 : 1);
    });
    this.rockData = new Float32Array(eco.rocks.length * INST_FLOATS);
    eco.rocks.forEach((r, k) => {
      const o = k * INST_FLOATS, d = this.rockData;
      d[o] = r.x - SITE.x0; d[o + 1] = r.y; d[o + 2] = r.z - SITE.z0; d[o + 3] = r.yaw;
      d[o + 4] = r.size; d[o + 5] = 0; d[o + 6] = r.tiltX * 0.3; d[o + 7] = r.tiltZ * 0.3;
      d[o + 11] = (r.seed % 1000) / 1000; d[o + 13] = r.size; d[o + 14] = 0.5; d[o + 15] = r.moss;
    });
    this.branchData = new Float32Array(eco.branches.length * INST_FLOATS);
    eco.branches.forEach((b, k) => {
      const o = k * INST_FLOATS, d = this.branchData;
      d[o] = b.x - SITE.x0; d[o + 1] = b.y; d[o + 2] = b.z - SITE.z0; d[o + 3] = b.yaw;
      d[o + 4] = b.size; d[o + 11] = (b.seed % 1000) / 1000; d[o + 13] = 1; d[o + 14] = 0.5; d[o + 15] = 0.8;
    });
    // ----- ground cover, sorted by cell
    this.covers = [this.coverSet(eco.ferns, 0), this.coverSet(eco.grass, 1), this.coverSet(eco.berries, 2)];
  }

  heightFn(): (x: number, z: number) => number {
    const g = this.eco.hGrid, H = this.eco.heights;
    return (x, z) => {
      const fx = Math.min(Math.max(x - g.x0, 0), g.nx - 1.001), fz = Math.min(Math.max(z - g.z0, 0), g.nz - 1.001);
      const i = Math.floor(fx), j = Math.floor(fz), a = fx - i, b = fz - j, k = j * g.nx + i;
      return (H[k] * (1 - a) + H[k + 1] * a) * (1 - b) + (H[k + g.nx] * (1 - a) + H[k + g.nx + 1] * a) * b;
    };
  }

  private coverSet(list: Cover[], kind: number): CoverSet {
    const key = (c: Cover) => { const cx = Math.floor((c.x - SITE.x0 + 32) / COVER_CELL), cz = Math.floor((c.z - SITE.z0 + 32) / COVER_CELL); return [cx, cz]; };
    const sorted = list.map((c) => ({ c, k: key(c) })).sort((a, b) => a.k[1] - b.k[1] || a.k[0] - b.k[0]);
    const data = new Float32Array(sorted.length * 8);
    const cells: CoverSet['cells'] = [];
    let cur: CoverSet['cells'][0] | null = null;
    sorted.forEach(({ c, k }, i) => {
      if (!cur || cur.cx !== k[0] || cur.cz !== k[1]) { cur = { start: i, count: 0, cx: k[0], cz: k[1], y0: 1e9, y1: -1e9 }; cells.push(cur); }
      cur.count++; cur.y0 = Math.min(cur.y0, c.y); cur.y1 = Math.max(cur.y1, c.y + 1.6);
      const o = i * 8;
      data[o] = c.x - SITE.x0; data[o + 1] = c.y; data[o + 2] = c.z - SITE.z0; data[o + 3] = c.yaw;
      data[o + 4] = c.size; data[o + 5] = (c.seed % 10007) / 10007; data[o + 6] = c.kind; data[o + 7] = c.light;
    });
    return { buf: null, data, cells, total: sorted.length, kind };
  }

  // ------------------------------------------------------------------------------------------------ GPU build
  /** Create (or recreate after device loss) all GPU objects. */
  build(device: GPUDevice, renderer: any): void {
    const t0 = performance.now();
    this.device = device; this.renderer = renderer;
    const d = device;
    // geometry
    let vBytes = 0, iCount = 0;
    for (const m of this.meshes) { vBytes += m.vertices.byteLength; iCount += m.indices.length; }
    this.vbuf = d.createBuffer({ label: 'forest vertices', size: vBytes, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.ibuf = d.createBuffer({ label: 'forest indices', size: iCount * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    let vo = 0, io = 0;
    this.table = [];
    for (const m of this.meshes) {
      d.queue.writeBuffer(this.vbuf, vo, m.vertices);
      d.queue.writeBuffer(this.ibuf, io * 4, m.indices);
      this.table.push({ baseVertex: vo / VERTEX_BYTES, firstIndex: io, count: m.indices.length, split: m.split, triangles: m.triangles });
      vo += m.vertices.byteLength; io += m.indices.length;
    }
    this.staticInst = d.createBuffer({ size: INST_BYTES, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(this.staticInst, 0, new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0.5, 0, 1, 0.5, 1]));
    for (const c of this.covers) {
      c.buf = d.createBuffer({ size: Math.max(32, c.data.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      if (c.data.byteLength) d.queue.writeBuffer(c.buf, 0, c.data);
    }
    this.instCap = 0; this.impCap = 0;
    // textures
    this.tex = bakeForestTextures(d, { detailSize: this.opts.detailSize });
    this.stats.buildMs.textureBake = Math.round(this.tex.ms);
    const eco = this.eco;
    const mk2 = (data: Uint8Array, nx: number, nz: number, label: string) => {
      const t = d.createTexture({ label, size: [nx, nz], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      d.queue.writeTexture({ texture: t }, data, { bytesPerRow: nx * 4 }, [nx, nz]); return t;
    };
    this.matA = mk2(eco.matA, eco.mGrid.nx, eco.mGrid.nz, 'forest matA');
    this.matB = mk2(eco.matB, eco.mGrid.nx, eco.mGrid.nz, 'forest matB');
    const v = eco.vol;
    this.canopy = d.createTexture({ label: 'canopy volume', size: [v.nx, v.ny, v.nz], dimension: '3d', format: 'rg8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    d.queue.writeTexture({ texture: this.canopy }, v.data, { bytesPerRow: v.nx * 2, rowsPerImage: v.ny }, [v.nx, v.ny, v.nz]);
    this.shadowTex = d.createTexture({ label: 'forest shadow map', size: [SHADOW_SIZE, SHADOW_SIZE], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.dummyDepth = d.createTexture({ size: [1, 1], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.ubuf = d.createBuffer({ label: 'forest uniforms', size: FOREST_UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    // layouts
    const V = GPUShaderStage.VERTEX, Fr = GPUShaderStage.FRAGMENT;
    this.frameBGL = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: V | Fr, buffer: { type: 'uniform' } }] });
    this.forestBGL = d.createBindGroupLayout({ label: 'forest', entries: [
      { binding: 0, visibility: V | Fr, buffer: { type: 'uniform' } },
      { binding: 1, visibility: Fr, texture: { sampleType: 'depth' } },
      { binding: 2, visibility: Fr, sampler: { type: 'comparison' } },
      { binding: 3, visibility: Fr, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 4, visibility: Fr, sampler: { type: 'filtering' } },
      { binding: 5, visibility: Fr, texture: { sampleType: 'float' } },
      { binding: 6, visibility: Fr, texture: { sampleType: 'float' } },
      { binding: 7, visibility: Fr, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 8, visibility: Fr, texture: { sampleType: 'float' } },
      { binding: 9, visibility: Fr, texture: { sampleType: 'float' } },
      { binding: 10, visibility: Fr, sampler: { type: 'filtering' } },
    ] });
    this.impBGL = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: Fr, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 1, visibility: Fr, texture: { sampleType: 'float', viewDimension: '2d-array' } }] });
    const ms = this.opts.sampleCount > 1;
    this.shaftBGL = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: Fr, texture: { sampleType: 'depth', multisampled: ms } }] });
    this.texBGL = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: Fr, texture: { sampleType: 'unfilterable-float' } }] });
    this.frameBG = d.createBindGroup({ layout: this.frameBGL, entries: [{ binding: 0, resource: { buffer: renderer.frameBuffer } }] });
    this.forestBG = this.makeForestBG(this.shadowTex, this.ubuf);
    this.forestBGNoShadow = this.makeForestBG(this.dummyDepth, this.ubuf);
    this.buildPipelines();
    this.terrainHook = { wgsl: FOREST_STRUCT_WGSL + FOREST_BINDINGS_WGSL + FOREST_FUNCS_WGSL, bindGroupLayout: this.forestBGL, bindGroup: this.forestBG };
    // impostors
    const tImp = performance.now();
    this.bakeImpostors();
    this.stats.buildMs.impostorBake = Math.round(performance.now() - tImp);
    this.shadowDirty = true;
    this.shaftVersion = -1;
    this.stats.gpuBytes = vBytes + iCount * 4 + this.tex.bytes + SHADOW_SIZE * SHADOW_SIZE * 4 + eco.mGrid.nx * eco.mGrid.nz * 8 + v.nx * v.ny * v.nz * 2
      + this.covers.reduce((s, c) => s + c.data.byteLength, 0) + this.arch.list.length * IMP_SIZE * IMP_SIZE * 8 * 4 / 3;
    this.stats.buildMs.gpu = Math.round(performance.now() - t0);
  }

  private makeForestBG(shadow: GPUTexture, ub: GPUBuffer, offset = 0): GPUBindGroup {
    const d = this.device;
    const rep = d.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8 });
    const clamp = d.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
    const cmp = d.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' });
    return d.createBindGroup({ layout: this.forestBGL, entries: [
      { binding: 0, resource: { buffer: ub, offset, size: FOREST_UNIFORM_FLOATS * 4 } },
      { binding: 1, resource: shadow.createView() }, { binding: 2, resource: cmp },
      { binding: 3, resource: this.tex.detail.createView({ dimension: '2d-array' }) }, { binding: 4, resource: rep },
      { binding: 5, resource: this.matA.createView() }, { binding: 6, resource: this.matB.createView() },
      { binding: 7, resource: this.canopy.createView() },
      { binding: 8, resource: this.tex.leafAlb.createView() }, { binding: 9, resource: this.tex.leafNrm.createView() },
      { binding: 10, resource: clamp },
    ] });
  }

  private buildPipelines(): void {
    const d = this.device, o = this.opts;
    const vlay: GPUVertexBufferLayout[] = [
      { arrayStride: VERTEX_BYTES, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'snorm8x4' },
        { shaderLocation: 2, offset: 16, format: 'snorm8x4' }, { shaderLocation: 3, offset: 20, format: 'float16x2' },
        { shaderLocation: 4, offset: 24, format: 'unorm8x4' }, { shaderLocation: 5, offset: 28, format: 'uint8x4' }] },
      { arrayStride: INST_BYTES, stepMode: 'instance', attributes: [0, 1, 2, 3].map((k) => ({ shaderLocation: 6 + k, offset: k * 16, format: 'float32x4' as GPUVertexFormat })) },
    ];
    const layout = (groups: GPUBindGroupLayout[]) => d.createPipelineLayout({ bindGroupLayouts: groups });
    const L01 = layout([this.frameBGL, this.forestBGL]);
    const veg = d.createShaderModule({ label: 'forest vegetation', code: VEGETATION_WGSL });
    const depth = (write = true): GPUDepthStencilState => ({ format: o.depthFormat, depthWriteEnabled: write, depthCompare: 'greater' });
    const ms = { count: o.sampleCount, alphaToCoverageEnabled: false };
    const msA2C = { count: o.sampleCount, alphaToCoverageEnabled: o.sampleCount > 1 };
    this.pipes.solid = d.createRenderPipeline({ label: 'forest solid', layout: L01, vertex: { module: veg, entryPoint: 'vs', buffers: vlay },
      fragment: { module: veg, entryPoint: 'fsSolid', targets: [{ format: o.colorFormat }] }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: depth(), multisample: ms });
    this.pipes.leaf = d.createRenderPipeline({ label: 'forest leaves', layout: L01, vertex: { module: veg, entryPoint: 'vs', buffers: vlay },
      fragment: { module: veg, entryPoint: 'fsLeaf', targets: [{ format: o.colorFormat }] }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: depth(), multisample: msA2C });
    // shadow pipelines (depth only, standard Z)
    const sDepth: GPUDepthStencilState = { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2.0, depthBiasClamp: 0.01 };
    this.pipes.shadowSolid = d.createRenderPipeline({ label: 'forest shadow solid', layout: L01, vertex: { module: veg, entryPoint: 'vsShadow', buffers: vlay }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: sDepth });
    this.pipes.shadowLeaf = d.createRenderPipeline({ label: 'forest shadow leaf', layout: L01, vertex: { module: veg, entryPoint: 'vsShadow', buffers: vlay }, fragment: { module: veg, entryPoint: 'fsShadowLeaf', targets: [] }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: sDepth });
    // impostor bake
    const bakeT = [{ format: 'rgba8unorm' as GPUTextureFormat }, { format: 'rgba8unorm' as GPUTextureFormat }];
    const bDepth: GPUDepthStencilState = { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' };
    this.pipes.bakeSolid = d.createRenderPipeline({ label: 'imp bake solid', layout: L01, vertex: { module: veg, entryPoint: 'vsBake', buffers: vlay }, fragment: { module: veg, entryPoint: 'fsBakeSolid', targets: bakeT }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: bDepth });
    this.pipes.bakeLeaf = d.createRenderPipeline({ label: 'imp bake leaf', layout: L01, vertex: { module: veg, entryPoint: 'vsBake', buffers: vlay }, fragment: { module: veg, entryPoint: 'fsBakeLeaf', targets: bakeT }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: bDepth });
    // impostor draw
    const imp = d.createShaderModule({ label: 'forest impostors', code: IMPOSTOR_WGSL });
    this.pipes.impostor = d.createRenderPipeline({ label: 'forest impostor', layout: layout([this.frameBGL, this.forestBGL, this.impBGL]),
      vertex: { module: imp, entryPoint: 'vs', buffers: [vlay[1]] }, fragment: { module: imp, entryPoint: 'fs', targets: [{ format: o.colorFormat }] },
      primitive: { topology: 'triangle-strip', cullMode: 'none' }, depthStencil: depth(), multisample: msA2C });
    // ground cover
    const cov = d.createShaderModule({ label: 'forest cover', code: COVER_WGSL });
    const cl: GPUVertexBufferLayout = { arrayStride: 32, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }] };
    const covPipe = (kind: number, rows: number, far: number, shadow: boolean) => d.createRenderPipeline({
      label: `cover ${kind}/${rows}${shadow ? ' shadow' : ''}`, layout: L01,
      vertex: { module: cov, entryPoint: 'vs', buffers: [cl], constants: { ROWS: rows, FAR: far, KIND: kind, SHADOW: shadow ? 1 : 0 } },
      fragment: shadow ? { module: cov, entryPoint: 'fsShadow', targets: [], constants: { KIND: kind, SHADOW: 1 } } : { module: cov, entryPoint: 'fs', targets: [{ format: o.colorFormat }], constants: { KIND: kind, SHADOW: 0 } },
      primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: shadow ? sDepth : depth(), multisample: shadow ? undefined : msA2C,
    });
    const far = [58, 38, 45];
    this.coverRows = [[9, 5], [4, 3], [2, 2]];
    for (let k = 0; k < 3; k++) {
      this.pipes[`cover${k}n`] = covPipe(k, this.coverRows[k][0], far[k] * o.lodScale, false);
      this.pipes[`cover${k}f`] = covPipe(k, this.coverRows[k][1], far[k] * o.lodScale, false);
      this.pipes[`cover${k}s`] = covPipe(k, this.coverRows[k][1], 1e6, true);
    }
    this.coverFar = far.map((f) => f * o.lodScale);
    // shafts
    if (this.opts.shafts) {
      const sm = d.createShaderModule({ label: 'forest shafts', code: SHAFTS_WGSL(o.sampleCount > 1) });
      const empty = d.createBindGroupLayout({ entries: [] });
      this.pipes.shafts = d.createRenderPipeline({ label: 'shafts', layout: layout([this.frameBGL, this.forestBGL, this.shaftBGL]), vertex: { module: sm, entryPoint: 'vsFull' }, fragment: { module: sm, entryPoint: 'fsShafts', targets: [{ format: 'rgba16float' }] } });
      this.pipes.shaftBlur = d.createRenderPipeline({ label: 'shaft blur', layout: layout([empty, empty, empty, this.texBGL]), vertex: { module: sm, entryPoint: 'vsFull' }, fragment: { module: sm, entryPoint: 'fsBlur', targets: [{ format: 'rgba16float' }] } });
      const add: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } };
      this.texBGLf = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }] });
      this.pipes.shaftComp = d.createRenderPipeline({ label: 'shaft composite', layout: layout([empty, this.forestBGL, empty, this.texBGLf]), vertex: { module: sm, entryPoint: 'vsFull' }, fragment: { module: sm, entryPoint: 'fsComposite', targets: [{ format: o.colorFormat, blend: add }] } });
      this.emptyBG = d.createBindGroup({ layout: empty, entries: [] });
    }
  }
  private coverRows: number[][] = [];
  private coverFar: number[] = [];
  private texBGLf!: GPUBindGroupLayout;
  private emptyBG!: GPUBindGroup;

  // ------------------------------------------------------------------------------------------------ impostors
  private bakeImpostors(): void {
    const d = this.device, n = this.arch.list.length;
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    const mips = 4;
    this.impAlb = d.createTexture({ label: 'impostor albedo', size: [IMP_SIZE, IMP_SIZE, n], format: 'rgba8unorm', mipLevelCount: mips, usage });
    this.impNrm = d.createTexture({ label: 'impostor normal', size: [IMP_SIZE, IMP_SIZE, n], format: 'rgba8unorm', mipLevelCount: mips, usage });
    const depthT = d.createTexture({ size: [IMP_SIZE, IMP_SIZE], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    // one uniform slot per (archetype, view): the bake camera goes in shadowVP
    const slots = n * 9, ub = d.createBuffer({ size: slots * 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const inst = d.createBuffer({ size: INST_BYTES, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(inst, 0, new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0.5, 0, 1, 0.5, 1]));
    const base = this.uniformBase();
    const enc = d.createCommandEncoder({ label: 'impostor bake' });
    for (let a = 0; a < n; a++) {
      const A = this.arch.list[a];
      const R = A.radius, H = A.height;
      const lod = this.treeLod[a][1], e = this.table[lod];
      const pass = enc.beginRenderPass({
        colorAttachments: [
          { view: this.impAlb.createView({ dimension: '2d', baseArrayLayer: a, arrayLayerCount: 1, baseMipLevel: 0, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: [0.035, 0.055, 0.02, 0] },
          { view: this.impNrm.createView({ dimension: '2d', baseArrayLayer: a, arrayLayerCount: 1, baseMipLevel: 0, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: [0.5, 1, 0.5, 0.6] }],
        depthStencilAttachment: { view: depthT.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      });
      pass.setBindGroup(0, this.frameBG);
      pass.setVertexBuffer(0, this.vbuf); pass.setVertexBuffer(1, inst); pass.setIndexBuffer(this.ibuf!, 'uint32');
      for (let k = 0; k < 9; k++) {
        const m = impostorMatrix(k, R, H);
        const u = base.slice(); u.set(m, 0);
        const slot = a * 9 + k;
        d.queue.writeBuffer(ub, slot * 256, u);
        const bg = this.makeForestBG(this.dummyDepth, ub, slot * 256);
        pass.setBindGroup(1, bg);
        pass.setViewport((k % 3) * IMP_TILE, Math.floor(k / 3) * IMP_TILE, IMP_TILE, IMP_TILE, 0, 1);
        pass.setPipeline(this.pipes.bakeSolid); if (e.split > 0) pass.drawIndexed(e.split, 1, e.firstIndex, e.baseVertex, 0);
        pass.setPipeline(this.pipes.bakeLeaf); if (e.count > e.split) pass.drawIndexed(e.count - e.split, 1, e.firstIndex + e.split, e.baseVertex, 0);
      }
      pass.end();
    }
    d.queue.submit([enc.finish()]);
    // mips (alpha-coverage preserving for albedo)
    const mipMod = d.createShaderModule({ code: MIP_ARRAY_WGSL });
    const mp = d.createRenderPipeline({ layout: 'auto', vertex: { module: mipMod, entryPoint: 'vsFull' }, fragment: { module: mipMod, entryPoint: 'fsDown', targets: [{ format: 'rgba8unorm' }] } });
    const e2 = d.createCommandEncoder();
    const ub2 = d.createBuffer({ size: 256 * 2 * mips, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    for (let lv = 1; lv < mips; lv++) { d.queue.writeBuffer(ub2, (lv * 2) * 256, new Float32Array([1, 1.0 + 0.15 * lv, 0, 0])); d.queue.writeBuffer(ub2, (lv * 2 + 1) * 256, new Float32Array([0, 1, 0, 0])); }
    for (const [tex, cvg] of [[this.impAlb, 0], [this.impNrm, 1]] as [GPUTexture, number][]) for (let a = 0; a < n; a++) for (let lv = 1; lv < mips; lv++) {
      const p = e2.beginRenderPass({ colorAttachments: [{ view: tex.createView({ dimension: '2d', baseArrayLayer: a, arrayLayerCount: 1, baseMipLevel: lv, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store' }] });
      p.setPipeline(mp);
      p.setBindGroup(0, d.createBindGroup({ layout: mp.getBindGroupLayout(0), entries: [
        { binding: 0, resource: tex.createView({ dimension: '2d', baseArrayLayer: a, arrayLayerCount: 1, baseMipLevel: lv - 1, mipLevelCount: 1 }) },
        { binding: 1, resource: { buffer: ub2, offset: (lv * 2 + cvg) * 256, size: 16 } }] }));
      p.draw(3); p.end();
    }
    d.queue.submit([e2.finish()]);
    depthT.destroy();
    this.impBG = d.createBindGroup({ layout: this.impBGL, entries: [{ binding: 0, resource: this.impAlb.createView({ dimension: '2d-array' }) }, { binding: 1, resource: this.impNrm.createView({ dimension: '2d-array' }) }] });
  }

  // ------------------------------------------------------------------------------------------------ uniforms
  setPreset(id: string): void { this.preset = LIGHT_PRESETS[id] || this.preset; this.sun = this.preset.sun; this.shadowDirty = true; }

  private uniformBase(): Float32Array {
    const u = new Float32Array(FOREST_UNIFORM_FLOATS);
    const e = this.eco, p = this.preset;
    u.set(this.shadowVP, 0);
    // mapRect
    u[20] = e.mGrid.x0 - SITE.x0; u[21] = e.mGrid.z0 - SITE.z0; u[22] = 1 / (e.mGrid.nx * e.mGrid.cell); u[23] = 1 / (e.mGrid.nz * e.mGrid.cell);
    const v = e.vol;
    u[24] = v.x0 - SITE.x0; u[25] = v.z0 - SITE.z0; u[26] = 1 / (v.nx * v.cell); u[27] = 1 / (v.nz * v.cell);
    u[28] = v.y0; u[29] = 1 / (v.ny * v.cellY); u[30] = this.mode === 'C' ? 1 : 0; u[31] = 1 / SHADOW_SIZE;
    const wa = 0.9; // wind from the south-west quarter, towards the north-east
    u[32] = Math.sin(wa); u[33] = Math.cos(wa); u[34] = this.mode === 'C' && this.windOn ? p.wind : 0; u[35] = 6.0;
    u[36] = this.mode === 'C' ? p.mist : 0; u[37] = p.mistHeight; u[38] = this.floorY(); u[39] = p.overcast;
    u[40] = this.mode === 'C' ? 2 : 1; u[41] = this.opts.shafts ? p.shafts : 0; u[42] = this.mode === 'C' && this.windOn ? 1 : 0; u[43] = this.mode === 'C' ? 1 : 0;
    u[44] = 40; u[45] = 90; u[46] = 180; u[47] = 0.12;
    u[48] = this.sun[0]; u[49] = this.sun[1]; u[50] = this.sun[2]; u[51] = 1.6 + 2.2 * p.overcast;
    return u;
  }
  private _floorY = 0;
  private floorY(): number { if (!this._floorY) { let s = 0; for (const t of this.eco.trees) s += t.y; this._floorY = s / Math.max(1, this.eco.trees.length); } return this._floorY; }

  private computeShadowVP(): void {
    const L = this.sun;
    const f: [number, number, number] = [-L[0], -L[1], -L[2]];
    let r: [number, number, number] = [f[2], 0, -f[0]]; const rl = Math.hypot(r[0], r[2]); r = [r[0] / rl, 0, r[2] / rl];
    const u: [number, number, number] = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
    const g = this.eco.hGrid;
    let ymin = 1e9, ymax = -1e9; for (const h of this.eco.heights) { ymin = Math.min(ymin, h); ymax = Math.max(ymax, h); }
    ymax += 32;
    const xs = [g.x0 - SITE.x0, g.x0 - SITE.x0 + g.nx], zs = [g.z0 - SITE.z0, g.z0 - SITE.z0 + g.nz], ys = [ymin, ymax];
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9, mnz = 1e9, mxz = -1e9;
    for (const x of xs) for (const y of ys) for (const z of zs) {
      const a = x * r[0] + y * r[1] + z * r[2], b = x * u[0] + y * u[1] + z * u[2], c = x * f[0] + y * f[1] + z * f[2];
      mnx = Math.min(mnx, a); mxx = Math.max(mxx, a); mny = Math.min(mny, b); mxy = Math.max(mxy, b); mnz = Math.min(mnz, c); mxz = Math.max(mxz, c);
    }
    const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2, hw = (mxx - mnx) / 2, hh = (mxy - mny) / 2, dz = mxz - mnz + 2;
    const m = this.shadowVP;
    m[0] = r[0] / hw; m[4] = r[1] / hw; m[8] = r[2] / hw; m[12] = -cx / hw;
    m[1] = u[0] / hh; m[5] = u[1] / hh; m[9] = u[2] / hh; m[13] = -cy / hh;
    m[2] = f[0] / dz; m[6] = f[1] / dz; m[10] = f[2] / dz; m[14] = -(mnz - 1) / dz;
    m[3] = 0; m[7] = 0; m[11] = 0; m[15] = 1;
  }

  // ------------------------------------------------------------------------------------------------ per frame
  /**
   * cam: world position; origin: render origin (x, z); planes: frustum planes in render-relative coordinates.
   */
  update(time: number, cam: { x: number; y: number; z: number }, origin: { x: number; z: number }, planes: Float32Array): void {
    const offX = SITE.x0 - origin.x, offZ = SITE.z0 - origin.z;
    if (this.shadowDirty) this.computeShadowVP();
    const u = this.uniformBase();
    u[16] = offX; u[17] = 0; u[18] = offZ; u[19] = time;
    this.uni = u;
    this.device.queue.writeBuffer(this.ubuf, 0, u);
    // normalised planes, shifted into site-local space
    for (let p = 0; p < 5; p++) {
      const a = planes[p * 4], b = planes[p * 4 + 1], c = planes[p * 4 + 2], d = planes[p * 4 + 3], l = Math.hypot(a, b, c) || 1;
      this.planes[p * 4] = a / l; this.planes[p * 4 + 1] = b / l; this.planes[p * 4 + 2] = c / l; this.planes[p * 4 + 3] = (d + a * offX + c * offZ) / l;
    }
    const cx = cam.x - SITE.x0, cy = cam.y, cz = cam.z - SITE.z0;
    const pl = this.planes;
    const vis = (x: number, y: number, z: number, r: number) => { for (let p = 0; p < 20; p += 4) if (pl[p] * x + pl[p + 1] * y + pl[p + 2] * z + pl[p + 3] < -r) return false; return true; };
    // ---- per-instance LOD
    const buckets = new Map<number, number[]>(); // mesh → list of [srcKind, index, fade] packed
    const imp: number[] = [];
    const push = (mesh: number, src: number, i: number, fade: number) => { let l = buckets.get(mesh); if (!l) buckets.set(mesh, (l = [])); l.push(src, i, fade); };
    const lod = [0, 0, 0, 0];
    const T = [40 * this.opts.lodScale, 90 * this.opts.lodScale, 180 * this.opts.lodScale], band = 0.12;
    const trees = this.eco.trees, td = this.treeData;
    for (let k = 0; k < trees.length; k++) {
      const o = k * INST_FLOATS, a = this.arch.list[this.treeArchOf[k]], s = td[o + 4];
      const H = a.height * s, R = Math.max(a.radius * s, H * 0.5);
      const x = td[o], y = td[o + 1] + H * 0.5, z = td[o + 2];
      if (!vis(x, y, z, R)) continue;
      const dist = Math.hypot(x - cx, y - cy, z - cz);
      const size = Math.min(1.6, Math.max(0.35, H / 20));
      const dd = dist / size;
      let L = 0; while (L < 3 && dd > T[L] * (1 + band)) L++;
      const lo = L < 3 ? T[L] * (1 - band) : 0;
      let fade = 0;
      if (L < 3 && dd > lo) fade = (dd - lo) / (T[L] * 2 * band); // 0..1 towards the next level
      const tiny = H < 5;
      const draw = (lv: number, f: number) => {
        if (lv < 3) push(this.treeLod[this.treeArchOf[k]][lv], 0, k, f);
        else if (!tiny) imp.push(k, f);
      };
      if (fade > 0) { draw(L, -fade); draw(L + 1, fade); lod[L]++; }
      else { draw(L, 0); lod[L]++; }
    }
    // rocks and branches: two LODs + fade out
    const rocks = this.eco.rocks, rd = this.rockData;
    for (let k = 0; k < rocks.length; k++) {
      const o = k * INST_FLOATS, x = rd[o], y = rd[o + 1], z = rd[o + 2], r = rd[o + 4] * 1.6;
      if (!vis(x, y, z, r)) continue;
      const dd = Math.hypot(x - cx, y - cy, z - cz) / Math.max(0.5, r);
      const L = dd < 20 ? 0 : dd < 60 ? 1 : dd < 220 ? 2 : -1;
      if (L >= 0) push(this.rockLod[this.eco.rocks[k].arch][L], 1, k, 0);
    }
    const brs = this.eco.branches, bd = this.branchData;
    for (let k = 0; k < brs.length; k++) {
      const o = k * INST_FLOATS, x = bd[o], y = bd[o + 1], z = bd[o + 2], r = bd[o + 4];
      if (!vis(x, y, z, r)) continue;
      const dist = Math.hypot(x - cx, y - cy, z - cz);
      if (dist > 70 * this.opts.lodScale) continue;
      push(this.branchLod[brs[k].kind % this.branchLod.length][dist < 18 ? 0 : 1], 2, k, dist > 55 ? -Math.min(1, (dist - 55) / 15) : 0);
    }
    // pack instances
    let total = 0; for (const l of buckets.values()) total += l.length / 3;
    this.ensureInst(total, imp.length / 2);
    const out = this.instCPU;
    this.drawList = [];
    let w = 0;
    let tris = 0;
    for (const [mesh, l] of buckets) {
      const first = w;
      for (let q = 0; q < l.length; q += 3) {
        const src = l[q] === 0 ? td : l[q] === 1 ? rd : bd;
        out.set(src.subarray(l[q + 1] * INST_FLOATS, l[q + 1] * INST_FLOATS + INST_FLOATS), w * INST_FLOATS);
        out[w * INST_FLOATS + 12] = l[q + 2];
        w++;
      }
      this.drawList.push({ mesh, first, count: w - first });
      tris += this.table[mesh].triangles * (w - first);
    }
    if (w) this.device.queue.writeBuffer(this.instBuf!, 0, out.buffer, 0, w * INST_BYTES);
    // impostors
    const io = this.impCPU;
    for (let q = 0; q < imp.length; q += 2) {
      const k = imp[q], o = k * INST_FLOATS, a = this.arch.list[this.treeArchOf[k]], b = (q / 2) * INST_FLOATS;
      io[b] = td[o]; io[b + 1] = td[o + 1]; io[b + 2] = td[o + 2]; io[b + 3] = td[o + 3];
      io[b + 4] = td[o + 4]; io[b + 5] = a.height; io[b + 6] = a.radius; io[b + 7] = 0;
      io[b + 8] = this.treeArchOf[k]; io[b + 9] = 0; io[b + 10] = 0; io[b + 11] = td[o + 11];
      io[b + 12] = imp[q + 1]; io[b + 13] = 1; io[b + 14] = td[o + 14]; io[b + 15] = 0;
    }
    if (imp.length) this.device.queue.writeBuffer(this.impBuf!, 0, io.buffer, 0, (imp.length / 2) * INST_BYTES);
    this.impCount = imp.length / 2;
    tris += this.impCount * 2;
    // wood cells
    this.woodDraws = [];
    for (const c of this.woodCells) {
      const x = (c.cx + 0.5) * 32, z = (c.cz + 0.5) * 32;
      if (!vis(x, c.y, z, 30)) continue;
      const dist = Math.hypot(x - cx, c.y - cy, z - cz);
      const L = dist < 45 ? 0 : dist < 110 ? 1 : dist < 260 ? 2 : -1;
      if (L >= 0) { this.woodDraws.push(c.lod[L]); tris += this.table[c.lod[L]].triangles; }
    }
    // ground cover runs (Abyssal Garden drawCells: merge contiguous visible cells)
    this.coverRuns = [];
    let coverCount = 0;
    this.covers.forEach((cs, si) => {
      const farD = this.coverFar[si];
      const nearD = si === 0 ? 18 : si === 1 ? 12 : 20;
      let run: { set: number; far: boolean; first: number; count: number } | null = null;
      for (const c of cs.cells) {
        const x0 = c.cx * COVER_CELL - 32, z0 = c.cz * COVER_CELL - 32;
        const ex = Math.max(0, Math.abs(cx - (x0 + 8)) - 8), ez = Math.max(0, Math.abs(cz - (z0 + 8)) - 8);
        const ey = Math.max(0, cy - c.y1, c.y0 - cy);
        const dist = Math.hypot(ex, ey, ez);
        const ok = dist < farD && vis(x0 + 8, (c.y0 + c.y1) / 2, z0 + 8, 12 + (c.y1 - c.y0) / 2);
        const far = dist > nearD;
        if (ok && run && run.far === far && run.first + run.count === c.start) { run.count += c.count; }
        else { if (run) this.coverRuns.push(run); run = ok ? { set: si, far, first: c.start, count: c.count } : null; }
        if (ok) coverCount += c.count;
      }
      if (run) this.coverRuns.push(run);
    });
    this.stats.instances = w; this.stats.lod = lod; lod[3] = this.impCount; this.stats.impostors = this.impCount; this.stats.cover = coverCount;
    this.stats.triangles = tris; // cover triangles are added in record()
  }
  private impCount = 0;

  private ensureInst(n: number, nImp: number): void {
    const d = this.device;
    if (n > this.instCap) { this.instCap = Math.ceil(n * 1.5) + 64; this.instBuf?.destroy(); this.instBuf = d.createBuffer({ label: 'forest instances', size: this.instCap * INST_BYTES, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }); this.instCPU = new Float32Array(this.instCap * INST_FLOATS); }
    if (nImp > this.impCap || !this.impBuf) { this.impCap = Math.ceil(Math.max(nImp, 16) * 1.5); this.impBuf?.destroy(); this.impBuf = d.createBuffer({ label: 'forest impostors', size: this.impCap * INST_BYTES, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }); this.impCPU = new Float32Array(this.impCap * INST_FLOATS); }
  }

  /** Scene-pass draws. which: 'all' | 'trees' | 'cover' (profiling split). */
  record(pass: GPURenderPassEncoder, which: 'all' | 'trees' | 'cover' = 'all'): void {
    let draws = 0, tris = this.stats.triangles;
    pass.setBindGroup(0, this.frameBG); pass.setBindGroup(1, this.forestBG);
    if (which !== 'cover') {
      pass.setVertexBuffer(0, this.vbuf); pass.setIndexBuffer(this.ibuf!, 'uint32');
      pass.setPipeline(this.pipes.solid);
      pass.setVertexBuffer(1, this.instBuf);
      for (const dl of this.drawList) { const e = this.table[dl.mesh]; if (e.split > 0) { pass.drawIndexed(e.split, dl.count, e.firstIndex, e.baseVertex, dl.first); draws++; } }
      pass.setVertexBuffer(1, this.staticInst);
      for (const m of this.woodDraws) { const e = this.table[m]; pass.drawIndexed(e.count, 1, e.firstIndex, e.baseVertex, 0); draws++; }
      pass.setPipeline(this.pipes.leaf);
      pass.setVertexBuffer(1, this.instBuf);
      for (const dl of this.drawList) { const e = this.table[dl.mesh]; if (e.count > e.split) { pass.drawIndexed(e.count - e.split, dl.count, e.firstIndex + e.split, e.baseVertex, dl.first); draws++; } }
      if (this.impCount) { pass.setPipeline(this.pipes.impostor); pass.setBindGroup(2, this.impBG); pass.setVertexBuffer(0, this.impBuf); pass.draw(4, this.impCount, 0, 0); draws++; }
    }
    if (which !== 'trees') {
      for (const r of this.coverRuns) {
        const cs = this.covers[r.set];
        pass.setPipeline(this.pipes[`cover${r.set}${r.far ? 'f' : 'n'}`]);
        pass.setVertexBuffer(0, cs.buf);
        const rows = this.coverRows[r.set][r.far ? 1 : 0];
        const strips = r.set === 0 ? 12 : r.set === 1 ? 26 : 9;
        const vc = strips * (rows - 1) * 6;
        pass.draw(vc, r.count, 0, r.first); draws++;
        tris += r.count * strips * (rows - 1) * 2 * (r.set === 0 ? 0.45 : 1); // ferns: on average ~45 % of the frond slots are used
      }
      this.stats.coverDraws = this.coverRuns.length;
    }
    this.stats.draws = draws; this.stats.triangles = Math.round(tris);
  }

  /** Pre-scene: (re)render the static sun shadow map when the sun changed. */
  recordShadow(enc: GPUCommandEncoder): void {
    if (!this.shadowDirty || this.mode !== 'C') { this.shadowDirty = false; return; }
    const t0 = performance.now();
    this.computeShadowVP();
    const u = this.uniformBase(); u.set(this.uni.subarray(16, 20), 16);
    this.device.queue.writeBuffer(this.ubuf, 0, u);
    const pass = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: this.shadowTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    pass.setBindGroup(0, this.frameBG); pass.setBindGroup(1, this.forestBGNoShadow);
    pass.setVertexBuffer(0, this.vbuf); pass.setIndexBuffer(this.ibuf!, 'uint32');
    // all trees at LOD1, rocks, wood, the site terrain; every instance, regardless of the camera
    const trees = this.eco.trees, n = trees.length;
    const all = new Float32Array((n + this.eco.rocks.length + this.eco.branches.length) * INST_FLOATS);
    const byMesh = new Map<number, number[]>();
    for (let k = 0; k < n; k++) { const m = this.treeLod[this.treeArchOf[k]][1]; let l = byMesh.get(m); if (!l) byMesh.set(m, (l = [])); l.push(0, k); }
    this.eco.rocks.forEach((r, k) => { const m = this.rockLod[r.arch][1]; let l = byMesh.get(m); if (!l) byMesh.set(m, (l = [])); l.push(1, k); });
    this.eco.branches.forEach((b, k) => { const m = this.branchLod[b.kind % this.branchLod.length][1]; let l = byMesh.get(m); if (!l) byMesh.set(m, (l = [])); l.push(2, k); });
    let w = 0; const runs: { mesh: number; first: number; count: number }[] = [];
    for (const [mesh, l] of byMesh) {
      const first = w;
      for (let q = 0; q < l.length; q += 2) { const src = l[q] === 0 ? this.treeData : l[q] === 1 ? this.rockData : this.branchData; all.set(src.subarray(l[q + 1] * INST_FLOATS, (l[q + 1] + 1) * INST_FLOATS), w * INST_FLOATS); all[w * INST_FLOATS + 12] = 0; w++; }
      runs.push({ mesh, first, count: w - first });
    }
    const sb = this.device.createBuffer({ size: all.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(sb, 0, all);
    pass.setVertexBuffer(1, sb);
    pass.setPipeline(this.pipes.shadowSolid);
    for (const r of runs) { const e = this.table[r.mesh]; if (e.split > 0) pass.drawIndexed(e.split, r.count, e.firstIndex, e.baseVertex, r.first); }
    pass.setVertexBuffer(1, this.staticInst);
    for (const c of this.woodCells) { const e = this.table[c.lod[1]]; pass.drawIndexed(e.count, 1, e.firstIndex, e.baseVertex, 0); }
    { const e = this.table[this.terrainMesh]; pass.drawIndexed(e.count, 1, e.firstIndex, e.baseVertex, 0); }
    pass.setPipeline(this.pipes.shadowLeaf);
    pass.setVertexBuffer(1, sb);
    for (const r of runs) { const e = this.table[r.mesh]; if (e.count > e.split) pass.drawIndexed(e.count - e.split, r.count, e.firstIndex + e.split, e.baseVertex, r.first); }
    // ground cover casts too (contact shadows of ferns and tussocks)
    this.covers.forEach((cs, si) => {
      if (!cs.total) return;
      pass.setPipeline(this.pipes[`cover${si}s`]); pass.setVertexBuffer(0, cs.buf);
      const strips = si === 0 ? 12 : si === 1 ? 26 : 9;
      pass.draw(strips * (this.coverRows[si][1] - 1) * 6, cs.total, 0, 0);
    });
    pass.end();
    this.shadowDirty = false;
    this.stats.shadowMs = performance.now() - t0;
    setTimeout(() => sb.destroy(), 2000);
  }

  /** Post-scene: light shafts into the HDR image. */
  recordShafts(enc: GPUCommandEncoder, r: any): void {
    if (!this.opts.shafts || !this.pipes.shafts || this.preset.shafts <= 0) return;
    const d = this.device;
    if (this.shaftVersion !== r.targetsVersion) {
      this.shaftVersion = r.targetsVersion;
      for (const t of this.shaftTex) t.destroy();
      const w = Math.max(1, Math.floor(r.width / 2)), h = Math.max(1, Math.floor(r.height / 2));
      const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
      this.shaftTex = [d.createTexture({ size: [w, h], format: 'rgba16float', usage }), d.createTexture({ size: [w, h], format: 'rgba16float', usage })];
      this.shaftBG = [
        d.createBindGroup({ layout: this.shaftBGL, entries: [{ binding: 0, resource: r.depth.createView() }] }),
        d.createBindGroup({ layout: this.texBGL, entries: [{ binding: 0, resource: this.shaftTex[0].createView() }] }),
        d.createBindGroup({ layout: this.texBGLf, entries: [{ binding: 0, resource: this.shaftTex[1].createView() }] }),
      ];
    }
    let p = enc.beginRenderPass({ colorAttachments: [{ view: this.shaftTex[0].createView(), loadOp: 'clear', storeOp: 'store' }] });
    p.setPipeline(this.pipes.shafts); p.setBindGroup(0, this.frameBG); p.setBindGroup(1, this.forestBG); p.setBindGroup(2, this.shaftBG[0]); p.draw(3); p.end();
    p = enc.beginRenderPass({ colorAttachments: [{ view: this.shaftTex[1].createView(), loadOp: 'clear', storeOp: 'store' }] });
    p.setPipeline(this.pipes.shaftBlur); for (let g = 0; g < 3; g++) p.setBindGroup(g, this.emptyBG); p.setBindGroup(3, this.shaftBG[1]); p.draw(3); p.end();
    p = enc.beginRenderPass({ colorAttachments: [{ view: r.hdrView, loadOp: 'load', storeOp: 'store' }] });
    p.setPipeline(this.pipes.shaftComp); p.setBindGroup(0, this.emptyBG); p.setBindGroup(1, this.forestBG); p.setBindGroup(2, this.emptyBG); p.setBindGroup(3, this.shaftBG[2]); p.draw(3); p.end();
  }

  // ------------------------------------------------------------------------------------------------ eye adaptation
  /** Exposure multiplier from the metered scene (smoothed by the app). 1 = the preset's exposure. */
  autoExposure = 1;
  /** meter every n-th frame (power of two); 1 for fixed-camera captures */
  meterEvery = 4;
  meteredLum = 0;
  private meterTex: GPUTexture | null = null; private meterBuf: GPUBuffer[] = []; private meterBusy = [false, false]; private meterPipe: GPURenderPipeline | null = null; private meterBG: GPUBindGroup | null = null; private meterVersion = -1; private meterFrame = 0;
  /** Post-scene: centre-weighted average log luminance of the HDR image (read back asynchronously every 4th frame). */
  recordMeter(enc: GPUCommandEncoder, r: any): void {
    const d = this.device;
    if (!this.meterPipe) {
      const m = d.createShaderModule({ code: METER_WGSL });
      this.meterPipe = d.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vsFull' }, fragment: { module: m, entryPoint: 'fsMeter', targets: [{ format: 'r32float' }] } });
      this.meterTex = d.createTexture({ size: [64, 36], format: 'r32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      this.meterBuf = [0, 1].map(() => d.createBuffer({ size: 256 * 36, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }));
    }
    if (this.meterVersion !== r.targetsVersion) {
      this.meterVersion = r.targetsVersion;
      this.meterBG = d.createBindGroup({ layout: this.meterPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: r.hdrView }, { binding: 1, resource: d.createSampler({ magFilter: 'linear', minFilter: 'linear' }) }] });
    }
    if ((this.meterFrame++ & (this.meterEvery - 1)) !== 0) return;
    const slot = this.meterBusy[0] ? (this.meterBusy[1] ? -1 : 1) : 0;
    if (slot < 0) return;
    const p = enc.beginRenderPass({ colorAttachments: [{ view: this.meterTex!.createView(), loadOp: 'clear', storeOp: 'store' }] });
    p.setPipeline(this.meterPipe); p.setBindGroup(0, this.meterBG!); p.draw(3); p.end();
    enc.copyTextureToBuffer({ texture: this.meterTex! }, { buffer: this.meterBuf[slot], bytesPerRow: 256 }, [64, 36]);
    this.meterBusy[slot] = true;
    const buf = this.meterBuf[slot];
    queueMicrotask(() => d.queue.onSubmittedWorkDone().then(() => buf.mapAsync(GPUMapMode.READ)).then(() => {
      const f = new Float32Array(buf.getMappedRange().slice(0));
      buf.unmap(); this.meterBusy[slot] = false;
      let s = 0, w = 0;
      for (let y = 0; y < 36; y++) for (let x = 0; x < 64; x++) {
        const dx = (x - 31.5) / 32, dy = (y - 17.5) / 18, wt = Math.exp(-(dx * dx + dy * dy) * 1.2);
        s += f[y * 64 + x] * wt; w += wt;
      }
      this.meteredLum = Math.pow(2, s / w);
      // key value: interiors are allowed to stay darker than the open landscape (partial adaptation)
      const target = Math.pow(METER_REF / Math.max(this.meteredLum, 1e-4), 0.62);
      this.autoExposure = Math.min(2.6, Math.max(0.5, target));
    }, () => { this.meterBusy[slot] = false; }));
  }

  /** Trees per species and archetype triangle counts, for the report. */
  summary(): Record<string, unknown> {
    const per: Record<string, number> = {};
    for (const t of this.eco.trees) per[t.species] = (per[t.species] || 0) + 1;
    return { archetypes: this.arch.list.length, trianglesPerLod: [0, 1, 2].map((k) => this.arch.list.reduce((s, a) => s + a.lods[k].triangles, 0)), trees: per, eco: this.eco.stats };
  }
}

/** Orthographic bake camera for impostor view k (0–7 around, 8 from above), archetype radius R and height H. */
function impostorMatrix(k: number, R: number, H: number): Float32Array {
  const m = new Float32Array(16);
  if (k < 8) {
    const th = k * Math.PI / 4;
    const cdir = [Math.sin(th), 0, Math.cos(th)]; // camera position direction
    const f = [-cdir[0], 0, -cdir[2]], r = [Math.cos(th), 0, -Math.sin(th)], u = [0, 1, 0];
    const yc = 0.48 * H, hh = 0.52 * H, dz = 4 * R;
    m[0] = r[0] / R; m[4] = r[1] / R; m[8] = r[2] / R; m[12] = 0;
    m[1] = u[0] / hh; m[5] = u[1] / hh; m[9] = u[2] / hh; m[13] = -yc / hh;
    m[2] = f[0] / dz; m[6] = f[1] / dz; m[10] = f[2] / dz; m[14] = 0.5;
  } else {
    const dz = 2 * H + 4;
    m[0] = 1 / R; m[9] = 1 / R; m[6] = -1 / dz; m[14] = (H + 2) / dz;
  }
  m[15] = 1;
  return m;
}

/** Average luminance of the open landscape at the base exposure (measured), the eye-adaptation reference. */
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

const MIP_ARRAY_WGSL = /* wgsl */ `
struct FsOut { @builtin(position) pos: vec4f };
@vertex fn vsFull(@builtin(vertex_index) i: u32) -> FsOut { var o: FsOut; o.pos = vec4f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1), 0.0, 1.0); return o; }
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> U: vec4f;
@fragment fn fsDown(i: FsOut) -> @location(0) vec4f {
  let p = vec2i(i.pos.xy) * 2;
  let a = textureLoad(src, p, 0); let b = textureLoad(src, p + vec2i(1, 0), 0); let c = textureLoad(src, p + vec2i(0, 1), 0); let d = textureLoad(src, p + vec2i(1, 1), 0);
  if (U.x > 0.5) {
    let w = a.a + b.a + c.a + d.a;
    let col = select((a.rgb * a.a + b.rgb * b.a + c.rgb * c.a + d.rgb * d.a) / w, (a.rgb + b.rgb + c.rgb + d.rgb) * 0.25, w < 1e-4);
    return vec4f(col, min(1.0, w * 0.25 * U.y));
  }
  return (a + b + c + d) * 0.25;
}
`;

export type { TreeArchetype, Species, TreeInst };
