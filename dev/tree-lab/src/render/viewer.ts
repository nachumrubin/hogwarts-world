// Tree lab renderer (WebGPU). Geometry is uploaded once per specimen and LOD (GpuMesh); a scene is a list of draws
// that place meshes (offset + material kind), so the same specimen can be shown alone, in a comparison line-up or
// in a thumbnail without re-uploading. Rendering is on demand (the lab asks for a frame when something changed, or
// continuously in live mode); captures render offscreen at a fixed resolution independent of the window.
// Display modes: materials (reserved: neutral placeholder tone), clay, silhouette, wireframe, normals, hierarchy.
// Lighting presets: neutral studio, daylight, overcast, low-angle sun. Sun shadow map, sky/fill ambient, ACES.
import { VFLOATS } from '../framework/mesher.ts';

export type Mode = 'lit' | 'clay' | 'silhouette' | 'wire' | 'normals' | 'hierarchy';
export const MODES: Mode[] = ['lit', 'clay', 'silhouette', 'wire', 'normals', 'hierarchy'];

/** Material kinds of a draw. */
export const KIND = { tree: 0, ground: 1, figure: 2, pole: 3 } as const;

export interface LightPreset {
  id: string; label: string;
  sun: [number, number, number]; intensity: number; sunColor: [number, number, number];
  zenith: [number, number, number]; horizon: [number, number, number]; ambient: number;
  shadow: number; fill: number; studio: boolean;
}
export const LIGHTS: LightPreset[] = [
  { id: 'studio', label: 'Neutral studio', sun: [0.45, 0.78, 0.48], intensity: 1.45, sunColor: [1, 1, 1], zenith: [0.78, 0.79, 0.8], horizon: [0.7, 0.7, 0.71], ambient: 0.95, shadow: 0.55, fill: 0.45, studio: true },
  { id: 'day', label: 'Daylight', sun: [0.55, 0.62, 0.42], intensity: 2.1, sunColor: [1, 0.95, 0.88], zenith: [0.55, 0.65, 0.85], horizon: [0.62, 0.7, 0.82], ambient: 0.6, shadow: 1, fill: 0, studio: false },
  { id: 'overcast', label: 'Overcast', sun: [0.25, 0.9, 0.35], intensity: 0.35, sunColor: [1, 1, 1], zenith: [0.85, 0.87, 0.9], horizon: [0.8, 0.82, 0.85], ambient: 1.45, shadow: 0.2, fill: 0, studio: false },
  { id: 'low', label: 'Low-angle sun', sun: [0.88, 0.2, 0.32], intensity: 2.5, sunColor: [1, 0.76, 0.52], zenith: [0.34, 0.44, 0.68], horizon: [0.88, 0.7, 0.58], ambient: 0.42, shadow: 1, fill: 0, studio: false },
];

export interface GpuMesh { vbuf: GPUBuffer; ibuf: GPUBuffer; lbuf: GPUBuffer | null; indexCount: number; lineCount: number; triangles: number; vertices: number; bytes: number }
export interface Draw { mesh: GpuMesh; offset: [number, number, number]; kind: number; castShadow?: boolean }

const SHADER = /* wgsl */ `
struct U {
  vp: mat4x4f, sm: mat4x4f,
  cam: vec4f,     // xyz eye
  sun: vec4f,     // xyz dir to sun, intensity
  mode: vec4f,    // mode id, -, -, -
  off: vec4f,     // per-draw offset xyz, kind (0 tree, 1 ground, 2 figure, 3 scale pole)
  sunc: vec4f,    // sun colour, fill intensity
  zen: vec4f,     // zenith colour, ambient scale
  hor: vec4f,     // horizon colour, shadow strength
  env: vec4f,     // studio backdrop, -, -, -
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var shadowMap: texture_depth_2d;
@group(0) @binding(2) var cmp: sampler_comparison;

struct VIn { @location(0) p: vec3f, @location(1) n: vec3f, @location(2) a: vec4f, @location(3) uv: vec2f };
struct VOut { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) @interpolate(flat) a: vec4f, @location(3) uv: vec2f };

@vertex fn vs(i: VIn) -> VOut {
  var o: VOut;
  let wp = i.p + u.off.xyz;
  o.cp = u.vp * vec4f(wp, 1.0); o.wp = wp; o.n = i.n; o.a = i.a; o.uv = i.uv;
  return o;
}
@vertex fn vsShadow(i: VIn) -> @builtin(position) vec4f { return u.sm * vec4f(i.p + u.off.xyz, 1.0); }

fn aces(x: vec3f) -> vec3f { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0)); }
fn srgb(c: vec3f) -> vec3f { return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308)); }
fn shadow(wp: vec3f, n: vec3f) -> f32 {
  let s = u.sm * vec4f(wp + n * 0.03, 1.0);
  let uv = vec2f(s.x * 0.5 + 0.5, 0.5 - s.y * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return 1.0; }
  var a = 0.0;
  let e = 1.0 / f32(textureDimensions(shadowMap).x);
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) { a += textureSampleCompareLevel(shadowMap, cmp, uv + vec2f(f32(x), f32(y)) * e * 1.5, s.z - 0.0004); } }
  return a / 9.0;
}
fn hierCol(order: f32, flags: f32) -> vec3f {
  let f = u32(flags + 0.5);
  if ((f & 1u) != 0u) { return vec3f(0.35, 0.35, 0.38); }       // dead
  if ((f & 4u) != 0u) { return vec3f(0.45, 0.2, 0.6); }         // roots
  let o = i32(order + 0.5);
  switch o { case 0: { return vec3f(0.35, 0.22, 0.12); } case 1: { return vec3f(0.85, 0.25, 0.15); } case 2: { return vec3f(0.95, 0.6, 0.15); }
    case 3: { return vec3f(0.9, 0.9, 0.2); } case 4: { return vec3f(0.35, 0.8, 0.3); } case 5: { return vec3f(0.2, 0.75, 0.85); } default: { return vec3f(0.4, 0.45, 0.95); } }
}

@fragment fn fs(i: VOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let mode = u32(u.mode.x + 0.5);
  var n = normalize(i.n);
  if (!ff) { n = -n; }
  let kind = u32(u.off.w + 0.5);
  if (mode == 2u) { return vec4f(select(vec3f(0.0), vec3f(0.92), kind == 1u), 1.0); }        // silhouette: black tree, light ground
  if (mode == 4u) { return vec4f(n * 0.5 + 0.5, 1.0); }
  var alb = vec3f(0.36);
  if (kind == 1u) {
    alb = vec3f(0.30, 0.31, 0.27);
    // 5 m survey grid on the ground (scale reference)
    let g = abs(fract(i.wp.xz / 5.0 + 0.5) - 0.5) * 5.0;
    let w = fwidth(i.wp.xz) * 1.2;
    let line = 1.0 - min(smoothstep(vec2f(0.0), w + 0.02, g).x, smoothstep(vec2f(0.0), w + 0.02, g).y);
    alb = mix(alb, alb * 0.72, line * 0.8);
  }
  if (kind == 2u) { alb = vec3f(0.55, 0.30, 0.20); }
  if (kind == 3u) {
    // ranging pole: alternate 1 m bands, a dark band every 5 m
    let b = floor(i.wp.y);
    alb = select(vec3f(0.75, 0.74, 0.7), vec3f(0.62, 0.12, 0.1), (i32(b) & 1) == 1);
    if (fract(i.wp.y / 5.0) > 0.96 || fract(i.wp.y / 5.0) < 0.04) { alb = vec3f(0.05); }
  }
  if (mode == 5u && kind == 0u) { alb = hierCol(i.a.x, i.a.y); }
  if (mode == 0u && kind == 0u) {
    // materials mode is reserved for the bark/foliage phase: a neutral placeholder tone (dead wood paler)
    let f = u32(i.a.y + 0.5);
    alb = vec3f(0.16, 0.13, 0.10);
    if ((f & 1u) != 0u) { alb = vec3f(0.30, 0.29, 0.27); }
    if ((f & 2u) != 0u) { alb = vec3f(0.45, 0.36, 0.24); }
  }
  let L = normalize(u.sun.xyz);
  let sh = mix(1.0, shadow(i.wp, n), u.hor.w);
  let ndl = max(dot(n, L), 0.0);
  let sky = mix(u.hor.xyz, u.zen.xyz, 0.5 + 0.5 * n.y) * (0.6 + 0.4 * n.y) * u.zen.w;
  let ground = vec3f(0.25, 0.24, 0.2) * (0.5 - 0.5 * n.y) * 0.5;
  let sunC = u.sunc.xyz * u.sun.w;
  let F = normalize(vec3f(-L.x, 0.45, -L.z));
  let fill = vec3f(u.sunc.w) * max(dot(n, F), 0.0);
  // cheap ambient occlusion towards the trunk base
  let ao = select(1.0, mix(0.55, 1.0, smoothstep(0.0, 1.2, i.wp.y)), kind == 0u);
  var c = alb * (sunC * ndl * sh + (sky + ground) * ao + fill * ao);
  let H = normalize(L + normalize(u.cam.xyz - i.wp));
  c += sunC * sh * pow(max(dot(n, H), 0.0), 40.0) * 0.04 * ndl;
  if (u.env.x < 0.5) {
    let d = length(u.cam.xyz - i.wp);
    c = mix(c, u.hor.xyz, 1.0 - exp(-d * 0.0025));
  }
  return vec4f(srgb(aces(c * 0.55)), 1.0);
}
@fragment fn fsWire(i: VOut) -> @location(0) vec4f {
  let kind = u32(u.off.w + 0.5);
  if (kind == 1u) { return vec4f(0.6, 0.6, 0.6, 1.0); }
  return vec4f(hierCol(i.a.x, i.a.y) * 0.9, 1.0);
}

struct SkyOut { @builtin(position) p: vec4f, @location(0) uv: vec2f };
@vertex fn vsSky(@builtin(vertex_index) k: u32) -> SkyOut { var o: SkyOut; let p = vec2f(f32(i32(k & 1u) * 4 - 1), f32(i32(k >> 1u) * 4 - 1)); o.p = vec4f(p, 1.0, 1.0); o.uv = p; return o; }
@fragment fn fsSky(i: SkyOut) -> @location(0) vec4f {
  let mode = u32(u.mode.x + 0.5);
  if (mode == 2u) { return vec4f(1.0); }
  if (mode == 3u || mode == 4u || mode == 5u) { return vec4f(0.12, 0.12, 0.13, 1.0); }
  let t = i.uv.y * 0.5 + 0.5;
  if (u.env.x > 0.5) { return vec4f(srgb(aces(mix(vec3f(0.62), vec3f(0.78), t) * 0.9)), 1.0); }
  let c = mix(u.hor.xyz, u.zen.xyz * 0.8, t);
  return vec4f(srgb(aces(c * 0.9)), 1.0);
}
`;

interface Target { w: number; h: number; msaa: GPUTexture; depth: GPUTexture }

export class Viewer {
  device!: GPUDevice; ctx!: GPUCanvasContext; format!: GPUTextureFormat;
  private pipe!: GPURenderPipeline; private wire!: GPURenderPipeline; private sky!: GPURenderPipeline; private shadowPipe!: GPURenderPipeline;
  private ubuf!: GPUBuffer; private bgs: GPUBindGroup[] = []; private shadowTex!: GPUTexture;
  private screen: Target | null = null;
  draws: Draw[] = [];
  mode: Mode = 'clay';
  light: LightPreset = LIGHTS[0];
  shadowVP = new Float32Array(16);
  shadowDirty = true;
  hasTs = false; private qs: GPUQuerySet | null = null; private qbuf: GPUBuffer | null = null; private qread: GPUBuffer[] = []; private qbusy = [false, false];
  adapterName = '';
  gpuMs = 0; cpuMs = 0; drawCalls = 0; tris = 0; verts = 0;
  geometryBytes = 0;
  shadowSize = 4096;

  async init(canvas: HTMLCanvasElement, shadowSize = 4096): Promise<void> {
    const ad = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
    if (!ad) throw new Error('WebGPU is not available in this browser.');
    this.hasTs = ad.features.has('timestamp-query');
    const info = (ad as any).info || {};
    this.adapterName = [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || 'WebGPU adapter';
    this.device = await ad.requestDevice({ requiredFeatures: this.hasTs ? ['timestamp-query'] : [], requiredLimits: { maxBufferSize: Math.min(ad.limits.maxBufferSize, 1 << 30), maxStorageBufferBindingSize: Math.min(ad.limits.maxStorageBufferBindingSize, 1 << 30) } });
    this.device.addEventListener('uncapturederror', (e: any) => { console.error('WebGPU', e.error?.message); (window as any).__errors = ((window as any).__errors || []).concat(e.error?.message); });
    this.ctx = canvas.getContext('webgpu')!;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device: this.device, format: this.format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const d = this.device;
    const m = d.createShaderModule({ code: SHADER });
    const bgl = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 256 } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } }] });
    const layout = d.createPipelineLayout({ bindGroupLayouts: [bgl] });
    const vb: GPUVertexBufferLayout[] = [{ arrayStride: VFLOATS * 4, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
      { shaderLocation: 2, offset: 24, format: 'float32x4' }, { shaderLocation: 3, offset: 40, format: 'float32x2' }] }];
    const ds: GPUDepthStencilState = { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' };
    this.pipe = d.createRenderPipeline({ layout, vertex: { module: m, entryPoint: 'vs', buffers: vb }, fragment: { module: m, entryPoint: 'fs', targets: [{ format: this.format }] }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: ds, multisample: { count: 4 } });
    this.wire = d.createRenderPipeline({ layout, vertex: { module: m, entryPoint: 'vs', buffers: vb }, fragment: { module: m, entryPoint: 'fsWire', targets: [{ format: this.format }] }, primitive: { topology: 'line-list' }, depthStencil: { ...ds, depthCompare: 'less-equal' }, multisample: { count: 4 } });
    this.sky = d.createRenderPipeline({ layout, vertex: { module: m, entryPoint: 'vsSky' }, fragment: { module: m, entryPoint: 'fsSky', targets: [{ format: this.format }] }, depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'less-equal' }, multisample: { count: 4 } });
    this.shadowPipe = d.createRenderPipeline({ layout, vertex: { module: m, entryPoint: 'vsShadow', buffers: vb }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2 } });
    this.ubuf = d.createBuffer({ size: 256 * 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.shadowSize = shadowSize;
    this.shadowTex = d.createTexture({ size: [shadowSize, shadowSize], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const dummy = d.createTexture({ size: [1, 1], format: 'depth32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
    const cmp = d.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' });
    this.bgs = [this.shadowTex, dummy].map((t) => d.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: this.ubuf, size: 256 } }, { binding: 1, resource: t.createView() }, { binding: 2, resource: cmp }] }));
    if (this.hasTs) {
      this.qs = d.createQuerySet({ type: 'timestamp', count: 2 });
      this.qbuf = d.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
      this.qread = [0, 1].map(() => d.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
    }
  }

  upload(v: Float32Array, idx: Uint32Array, lines = true): GpuMesh {
    const d = this.device;
    const vbuf = d.createBuffer({ size: v.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }); d.queue.writeBuffer(vbuf, 0, v);
    const ibuf = d.createBuffer({ size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST }); d.queue.writeBuffer(ibuf, 0, idx);
    let lbuf: GPUBuffer | null = null, lineCount = 0;
    if (lines) {
      const l = new Uint32Array(idx.length * 2);
      for (let k = 0; k < idx.length; k += 3) { l[k * 2] = idx[k]; l[k * 2 + 1] = idx[k + 1]; l[k * 2 + 2] = idx[k + 1]; l[k * 2 + 3] = idx[k + 2]; l[k * 2 + 4] = idx[k + 2]; l[k * 2 + 5] = idx[k]; }
      lbuf = d.createBuffer({ size: l.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST }); d.queue.writeBuffer(lbuf, 0, l); lineCount = l.length;
    }
    const bytes = v.byteLength + idx.byteLength + (lbuf ? lineCount * 4 : 0);
    this.geometryBytes += bytes;
    return { vbuf, ibuf, lbuf, indexCount: idx.length, lineCount, triangles: idx.length / 3, vertices: v.length / VFLOATS, bytes };
  }
  destroy(m: GpuMesh): void { m.vbuf.destroy(); m.ibuf.destroy(); m.lbuf?.destroy(); this.geometryBytes -= m.bytes; }

  setDraws(d: Draw[]): void { this.draws = d; this.shadowDirty = true; }

  /** Fit the sun shadow map around a box. */
  fitShadow(min: [number, number, number], max: [number, number, number]): void {
    const sun = this.light.sun;
    const f = [-sun[0], -sun[1], -sun[2]]; const fl = Math.hypot(f[0], f[1], f[2]); f[0] /= fl; f[1] /= fl; f[2] /= fl;
    let r = [f[2], 0, -f[0]]; const rl = Math.hypot(r[0], r[2]); r = [r[0] / rl, 0, r[2] / rl];
    const up = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
    let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9, c0 = 1e9, c1 = -1e9;
    for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
      const a = x * r[0] + y * r[1] + z * r[2], b = x * up[0] + y * up[1] + z * up[2], c = x * f[0] + y * f[1] + z * f[2];
      a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); c0 = Math.min(c0, c); c1 = Math.max(c1, c);
    }
    const hw = (a1 - a0) / 2, hh = (b1 - b0) / 2, ca = (a0 + a1) / 2, cb = (b0 + b1) / 2, dz = c1 - c0 + 2;
    this.shadowVP.set([r[0] / hw, up[0] / hh, f[0] / dz, 0, r[1] / hw, up[1] / hh, f[1] / dz, 0, r[2] / hw, up[2] / hh, f[2] / dz, 0, -ca / hw, -cb / hh, -(c0 - 1) / dz, 1]);
    this.shadowDirty = true;
  }

  private writeU(slot: number, vp: Float32Array, cam: number[], kind: number, off: number[]) {
    const L = this.light, s = L.sun, sl = Math.hypot(s[0], s[1], s[2]);
    const u = new Float32Array(64);
    u.set(vp, 0); u.set(this.shadowVP, 16); u.set([cam[0], cam[1], cam[2], 0], 32); u.set([s[0] / sl, s[1] / sl, s[2] / sl, L.intensity], 36);
    u.set([MODES.indexOf(this.mode), 0, 0, 0], 40); u.set([off[0], off[1], off[2], kind], 44);
    u.set([...L.sunColor, L.fill], 48); u.set([...L.zenith, L.ambient], 52); u.set([...L.horizon, L.shadow], 56); u.set([L.studio ? 1 : 0, 0, 0, 0], 60);
    this.device.queue.writeBuffer(this.ubuf, slot * 256, u);
  }

  private target(w: number, h: number, old: Target | null): Target {
    if (old && old.w === w && old.h === h) return old;
    old?.msaa.destroy(); old?.depth.destroy();
    const d = this.device;
    return { w, h, msaa: d.createTexture({ size: [w, h], format: this.format, sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT }), depth: d.createTexture({ size: [w, h], format: 'depth32float', sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT }) };
  }

  private encode(enc: GPUCommandEncoder, view: GPUTextureView, tg: Target, vp: Float32Array, cam: number[], draws: Draw[], timed: boolean): number {
    this.writeU(0, vp, cam, 0, [0, 0, 0]);
    draws.forEach((m, k) => this.writeU(1 + k, vp, cam, m.kind, m.offset));
    if (this.shadowDirty) {
      const p = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: this.shadowTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
      p.setPipeline(this.shadowPipe);
      draws.forEach((m, k) => { if (m.kind === 1 || m.castShadow === false) return; p.setBindGroup(0, this.bgs[1], [(1 + k) * 256]); p.setVertexBuffer(0, m.mesh.vbuf); p.setIndexBuffer(m.mesh.ibuf, 'uint32'); p.drawIndexed(m.mesh.indexCount); });
      p.end(); this.shadowDirty = false;
    }
    const tsSlot = timed && this.hasTs ? (this.qbusy[0] ? (this.qbusy[1] ? -1 : 1) : 0) : -1;
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: tg.msaa.createView(), resolveTarget: view, loadOp: 'clear', storeOp: 'discard', clearValue: [0, 0, 0, 1] }],
      depthStencilAttachment: { view: tg.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      timestampWrites: tsSlot >= 0 ? { querySet: this.qs!, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } : undefined,
    });
    let calls = 0, tris = 0, verts = 0;
    const wire = this.mode === 'wire';
    draws.forEach((m, k) => {
      pass.setBindGroup(0, this.bgs[0], [(1 + k) * 256]); pass.setVertexBuffer(0, m.mesh.vbuf);
      if (wire && m.mesh.lbuf) { pass.setPipeline(this.wire); pass.setIndexBuffer(m.mesh.lbuf, 'uint32'); pass.drawIndexed(m.mesh.lineCount); }
      else { pass.setPipeline(this.pipe); pass.setIndexBuffer(m.mesh.ibuf, 'uint32'); pass.drawIndexed(m.mesh.indexCount); }
      calls++; tris += m.mesh.triangles; verts += m.mesh.vertices;
    });
    pass.setPipeline(this.sky); pass.setBindGroup(0, this.bgs[0], [0]); pass.draw(3); calls++;
    pass.end();
    if (timed) { this.drawCalls = calls; this.tris = tris; this.verts = verts; }
    if (tsSlot >= 0) { enc.resolveQuerySet(this.qs!, 0, 2, this.qbuf!, 0); enc.copyBufferToBuffer(this.qbuf!, 0, this.qread[tsSlot], 0, 16); }
    return tsSlot;
  }

  /** Render the current draw list to the canvas. */
  render(vp: Float32Array, cam: number[]): void {
    if (this.draws.length > 127) throw new Error('too many draws');
    const t0 = performance.now();
    const d = this.device, cv = this.ctx.getCurrentTexture();
    this.screen = this.target(cv.width, cv.height, this.screen);
    const enc = d.createCommandEncoder();
    const tsSlot = this.encode(enc, cv.createView(), this.screen, vp, cam, this.draws, true);
    // optional read-back of the presented frame itself (tests that what reaches the canvas is right)
    let rb: { buf: GPUBuffer; bpr: number; w: number; h: number; done: (b: Blob) => void } | null = null;
    if (this.readback) {
      const w = cv.width, h = cv.height, bpr = Math.ceil(w * 4 / 256) * 256;
      const buf = d.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      enc.copyTextureToBuffer({ texture: cv }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
      rb = { buf, bpr, w, h, done: this.readback }; this.readback = null;
    }
    d.queue.submit([enc.finish()]);
    if (rb) { const r = rb; r.buf.mapAsync(GPUMapMode.READ).then(() => { const png = this.toPng(new Uint8Array(r.buf.getMappedRange()), r.bpr, r.w, r.h); r.buf.unmap(); r.buf.destroy(); png.then(r.done); }); }
    if (tsSlot >= 0) {
      const b = this.qread[tsSlot]; this.qbusy[tsSlot] = true;
      b.mapAsync(GPUMapMode.READ).then(() => { const a = new BigInt64Array(b.getMappedRange()); this.gpuMs = Number(a[1] - a[0]) / 1e6; b.unmap(); this.qbusy[tsSlot] = false; }, () => { this.qbusy[tsSlot] = false; });
    }
    this.cpuMs = performance.now() - t0;
  }

  /** Render a draw list offscreen at w×h and return a PNG blob. Does not touch the canvas. */
  async renderImage(w: number, h: number, vp: Float32Array, cam: number[], draws: Draw[] = this.draws): Promise<Blob> {
    const d = this.device;
    const tg = this.target(w, h, null);
    const color = d.createTexture({ size: [w, h], format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const enc = d.createCommandEncoder();
    this.shadowDirty = true; // the draw list may differ from the screen's
    this.encode(enc, color.createView(), tg, vp, cam, draws, false);
    this.shadowDirty = true;
    const bpr = Math.ceil(w * 4 / 256) * 256;
    const buf = d.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    enc.copyTextureToBuffer({ texture: color }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
    d.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const png = this.toPng(new Uint8Array(buf.getMappedRange()), bpr, w, h);
    buf.unmap(); buf.destroy(); color.destroy(); tg.msaa.destroy(); tg.depth.destroy();
    return png;
  }
  /** Set to receive a PNG of the next frame presented to the canvas. */
  readback: ((b: Blob) => void) | null = null;
  private toPng(src: Uint8Array, bpr: number, w: number, h: number): Promise<Blob> {
    const px = new Uint8ClampedArray(w * h * 4), bgra = this.format.startsWith('bgra');
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * bpr + x * 4, o = (y * w + x) * 4; px[o] = src[i + (bgra ? 2 : 0)]; px[o + 1] = src[i + 1]; px[o + 2] = src[i + (bgra ? 0 : 2)]; px[o + 3] = 255; }
    const cv = new OffscreenCanvas(w, h); cv.getContext('2d')!.putImageData(new ImageData(px, w, h), 0, 0);
    return cv.convertToBlob({ type: 'image/png' });
  }
}

/** Column-major perspective (standard depth 0..1) × look-at. */
export function viewProj(eye: number[], target: number[], fovY: number, aspect: number, near = 0.05, far = 2000): Float32Array {
  const f = norm3(sub3(target, eye));
  const upv = Math.abs(f[1]) > 0.999 ? [0, 0, -1] : [0, 1, 0];
  const r = norm3(cross3(f, upv)), u = cross3(r, f);
  const t = 1 / Math.tan(fovY / 2);
  const P = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, far / (near - far), -1, 0, 0, (far * near) / (near - far), 0];
  const V = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot3(r, eye), -dot3(u, eye), dot3(f, eye), 1];
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) { let s = 0; for (let k = 0; k < 4; k++) s += P[k * 4 + rr] * V[c * 4 + k]; out[c * 4 + rr] = s; }
  return out;
}
const sub3 = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
