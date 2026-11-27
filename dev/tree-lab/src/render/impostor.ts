// Octahedral impostors (distant trees, broom-flight altitudes): each specimen is baked, unlit, from 9 × 9 directions
// over the upper hemisphere (hemi-octahedral layout, grid vertices, so the horizon and the zenith are both frames)
// into an atlas layer: albedo with coverage, and tree-local normal (octahedral-coded) with crown occlusion. At run
// time a camera-facing quad blends the three frames nearest to the view direction; each frame is sampled where the
// view ray meets that frame's own projection plane, so the image changes with direction as the tree would and never
// visibly turns with the camera. Lit at run time (sun, sky, translucency), casts shadows (frames towards the sun).
import { SHADER, type Viewer, type Draw } from './viewer.ts';
import { impostorCasts } from '../lab/lodstate.ts';

export const IMP_N = 9, IMP_FRAME = 112, IMP_SIZE = IMP_N * IMP_FRAME;
/** self-shadowing exponent (see fsImp) */
const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
export const IMP_SELF = +(Q?.get('impSelf') ?? 1.0);
/** impostor alpha: share of the sharpened (0.5-threshold) alpha mixed into the unsharpened coverage (see impAlpha) */
export const IMP_SHARP = +(Q?.get('impSharp') ?? 0.0);
/** atlas encoding version (part of the pre-baked atlas fingerprint): 2 = occlusion alone in the normal's b channel */
export const IMP_ENC = 2;
type V3 = [number, number, number];
export interface ImpostorSpec { id: string; layer: number; center: V3; radius: number; ms: number; loaded?: boolean }

const sub = (a: number[], b: number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** frame (i, j) → unit direction from the tree towards the camera (hemi-octahedral) */
export function frameDir(i: number, j: number): V3 {
  const ex = (i / (IMP_N - 1)) * 2 - 1, ey = (j / (IMP_N - 1)) * 2 - 1;
  const px = (ex + ey) / 2, pz = (ex - ey) / 2;
  return norm([px, Math.max(1 - Math.abs(px) - Math.abs(pz), 0), pz]);
}
/** a frame's basis, exactly as viewer.ts viewProj builds a camera (forward, right, up) */
export function frameBasis(d: V3): { f: V3; r: V3; u: V3 } {
  const f: V3 = [-d[0], -d[1], -d[2]];
  const up: V3 = Math.abs(f[1]) > 0.999 ? [0, 0, -1] : [0, 1, 0];
  const r = norm(cross(f, up)), u = cross(r, f);
  return { f, r, u };
}
const PAD = 1.04; // the tree's bounding sphere fills 1/PAD of a frame
function ortho(c: V3, R: number, d: V3): Float32Array {
  const { f, r, u } = frameBasis(d), s = R * PAD;
  const m = new Float32Array(16);
  // column-major (out[c * 4 + r]); clip x, y = projections on r, u; z: 0 at 2s in front of the centre, 1 at 2s behind
  m[0] = r[0] / s; m[4] = r[1] / s; m[8] = r[2] / s; m[12] = -dot(c, r) / s;
  m[1] = u[0] / s; m[5] = u[1] / s; m[9] = u[2] / s; m[13] = -dot(c, u) / s;
  m[2] = f[0] / (4 * s); m[6] = f[1] / (4 * s); m[10] = f[2] / (4 * s); m[14] = (-dot(c, f) + 2 * s) / (4 * s);
  m[15] = 1;
  return m;
}

const WGSL = /* wgsl */ `
const IMP_SELF = ${IMP_SELF.toFixed(3)};
const IN = ${IMP_N}.0;
const IPAD = ${PAD};
@group(1) @binding(0) var impAlb: texture_2d_array<f32>;
@group(1) @binding(1) var impNrm: texture_2d_array<f32>;
@group(1) @binding(2) var impSmp: sampler;
@group(1) @binding(3) var<uniform> impSpec: array<vec4f, 8>;   // per layer: centre (tree-local) xyz, radius
struct IIn { @location(0) q: vec2f, @location(1) p: vec4f, @location(2) x: vec4f };
struct IOut {
  @builtin(position) cp: vec4f, @location(0) wp: vec3f,
  @location(1) uv0: vec2f, @location(2) uv1: vec2f, @location(3) uv2: vec2f, @location(4) w: vec3f,
  @location(5) @interpolate(flat) layer: i32, @location(6) @interpolate(flat) yaw: f32, @location(7) @interpolate(flat) rad: f32,
  @location(8) @interpolate(flat) fade: vec2f,
};
fn hemiOct(d: vec3f) -> vec2f { let p = d.xz / (abs(d.x) + abs(d.y) + abs(d.z)); return vec2f(p.x + p.y, p.x - p.y); }
fn frameDir(g: vec2f) -> vec3f {
  let e = g / (IN - 1.0) * 2.0 - 1.0; let px = (e.x + e.y) * 0.5; let pz = (e.x - e.y) * 0.5;
  return normalize(vec3f(px, max(1.0 - abs(px) - abs(pz), 0.0), pz));
}
// where the view ray through local point pl (direction v) meets frame g's plane, in that frame's atlas texcoords
fn frameUV(g: vec2f, pl: vec3f, v: vec3f) -> vec2f {
  let d = frameDir(g); let f = -d;
  let up = select(vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, -1.0), abs(f.y) > 0.999);
  let r = normalize(cross(f, up)); let uu = cross(r, f);
  let q = pl - v * (dot(pl, d) / min(dot(v, d), -1e-3));
  let s = vec2f(dot(q, r), dot(q, uu)) / IPAD;   // −1…1 over the frame (pl is in units of the radius)
  return (g + vec2f(s.x * 0.5 + 0.5, 0.5 - s.y * 0.5)) / IN;
}
fn impVert(i: IIn, toView: vec3f, vp: mat4x4f, persp: bool) -> IOut {
  var o: IOut;
  let layer = i32(i.x.x + 0.5); let sp = impSpec[layer]; let yaw = i.p.w; let sc = i.x.y;
  let R = sp.w * sc; let c = i.p.xyz + rotY(sp.xyz * sc, yaw);
  // view direction in the tree's frame, kept to the upper hemisphere the frames cover
  var dl = rotY(normalize(toView), -yaw); dl.y = max(dl.y, 0.0); dl = normalize(dl);
  let g = (hemiOct(dl) * 0.5 + 0.5) * (IN - 1.0);
  let i0 = min(floor(g), vec2f(IN - 2.0)); let fr = g - i0;
  var g0 = i0; var g1 = i0 + vec2f(1.0, 0.0); var g2 = i0 + vec2f(0.0, 1.0); var w = vec3f(1.0 - fr.x - fr.y, fr.x, fr.y);
  if (fr.x + fr.y > 1.0) { g0 = i0 + vec2f(1.0); w = vec3f(fr.x + fr.y - 1.0, 1.0 - fr.y, 1.0 - fr.x); }
  // camera-facing quad over the bounding sphere
  let f = -normalize(toView);
  let up = select(vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, -1.0), abs(f.y) > 0.999);
  let r = normalize(cross(f, up)); let uu = cross(r, f);
  // the quad stands half a radius in front of the crown's centre (towards the viewer), so that it does not cut into
  // the ground or nearby geometry when seen from above; the frames are sampled along the view rays, so where the
  // quad stands does not change what is seen
  let wp = c - f * R * 0.5 + (r * i.q.x + uu * i.q.y) * R * IPAD;
  // the ray through wp (perspective: from the eye; shadow pass: the sun's direction), intersected with each frame's plane
  let ray = select(f, normalize(wp - u.cam.xyz), persp);
  let pl = rotY(wp - c, -yaw) / R; let v = rotY(ray, -yaw);
  o.uv0 = frameUV(g0, pl, v); o.uv1 = frameUV(g1, pl, v); o.uv2 = frameUV(g2, pl, v); o.w = w;
  o.cp = vp * vec4f(wp, 1.0); o.wp = wp; o.layer = layer; o.yaw = yaw; o.rad = R; o.fade = i.x.zw;
  return o;
}
@vertex fn vsImp(i: IIn) -> IOut {
  let layer = i32(i.x.x + 0.5); let c = i.p.xyz + rotY(impSpec[layer].xyz * i.x.y, i.p.w);
  return impVert(i, u.cam.xyz - c, u.vp, true);
}
@vertex fn vsImpShadow(i: IIn) -> IOut { return impVert(i, u.sun.xyz, u.sm, false); }
fn impSample(i: IOut) -> array<vec4f, 2> {
  let a = textureSample(impAlb, impSmp, i.uv0, i.layer) * i.w.x + textureSample(impAlb, impSmp, i.uv1, i.layer) * i.w.y + textureSample(impAlb, impSmp, i.uv2, i.layer) * i.w.z;
  let n = textureSample(impNrm, impSmp, i.uv0, i.layer) * i.w.x + textureSample(impNrm, impSmp, i.uv1, i.layer) * i.w.y + textureSample(impNrm, impSmp, i.uv2, i.layer) * i.w.z;
  return array<vec4f, 2>(a, n);
}
fn impAlpha(a: f32, uv: vec2f) -> f32 {
  // coverage straight to alpha-to-coverage: the frames are coverage-weighted (resolved MSAA, box-filtered mips) and
  // blended by weight, so their alpha is the mean coverage, and passing it on unchanged keeps that mean at every
  // distance. Sharpening it to a hard 0.5 threshold (as the leaves do) rounded every half-covered texel up and every
  // frame-blend mismatch to the union: the oak impostors gained 7–12 points of coverage. Only when the atlas is
  // magnified past 2× (closer than the impostor range) is the edge sharpened, so that it does not look blurred.
  let d = max(length(dpdx(uv)), length(dpdy(uv))) * ${IMP_SIZE}.0;
  let lvl = log2(max(d, 1e-4));
  let sharp = clamp((a - 0.5) / max(fwidth(a), 1e-4) + 0.5, 0.0, 1.0);
  return mix(a, sharp, max(${IMP_SHARP.toFixed(3)}, clamp(-lvl - 1.0, 0.0, 1.0)));
}
// pixel workload (render/viewer.ts measureOverdraw): every rasterized impostor fragment, counted in alpha
@fragment fn fsImpCount(i: IOut) -> @location(0) vec4f { return vec4f(0.0, 0.0, 0.0, 1.0); }
@fragment fn fsImpShadow(i: IOut) {
  // during a cross-fade only the side with more weight casts (render/viewer.ts draws: castShadow), so the shadow is
  // never the union of both representations: outgoing until halfway, incoming from halfway
  if (select((i.fade.x < 0.5), (i.fade.x >= 0.5), i.fade.y > 0.5)) { discard; }
  let s = impSample(i); if (s[0].a < 0.5) { discard; }
}
@fragment fn fsImp(i: IOut) -> @location(0) vec4f {
  let s = impSample(i); let A = s[0]; let Nn = s[1];
  let alpha = impAlpha(A.a, i.uv0);
  if (u32(u.mode.x + 0.5) == 2u) { return vec4f(0.0, 0.0, 0.0, alpha); }   // silhouette mode
  if (u.fx.z > 13.5) { return vec4f(1.0, 0.0, 1.0, 1.0); }                   // diagnostic 14: ground shadow only
  // the atlas holds coverage-weighted (resolved MSAA) values: divide by coverage
  let cov = max(A.a, 1e-3); let ncov = max(Nn.a, 1e-3);
  let ab = A.rgb / cov;
  // albedo as the geometry showed it from this frame's direction (undersides already paler): the frames are view
  // directions, so which side of each leaf is seen is geometry, not lighting
  let alb = select(pow((ab + 0.055) / 1.055, vec3f(2.4)), ab / 12.92, ab <= vec3f(0.04045));
  let N = rotY(octDec(Nn.xy / ncov * 2.0 - 1.0), i.yaw);   // the visible face's normal
  if (u32(u.mode.x + 0.5) == 6u) { return vec4f(srgb(alb), alpha); }   // albedo view (the bake modes' counterpart)
  if (u32(u.mode.x + 0.5) == 7u) { return vec4f(octEnc(rotY(N, -i.yaw)) * 0.5 + 0.5, Nn.z / ncov, alpha); }
  // b: occlusion (wood: bark occlusion; leaves: mix(0.3, 1, crown exposure)); leaf or wood by colour: leaves and
  // needles are green (g > r), bark and twigs brown or white (g ≤ r). Filtering blends the two smoothly
  let occ = clamp(Nn.z / ncov, 0.0, 1.0);
  let leaf = smoothstep(0.0, 0.05, (alb.g - alb.r) / max(alb.g + alb.r, 1e-4));
  let expo = mix(occ, clamp((occ - 0.3) / 0.7, 0.0, 1.0), leaf);
  let L = normalize(u.sun.xyz); let V = normalize(u.cam.xyz - i.wp);
  let sunC = u.sunc.xyz * u.sun.w;
  // shadows from other trees: tested a crown radius towards the sun (the quad is not the crown's surface)
  let shO = mix(1.0, shadow(i.wp + L * i.rad, L), u.hor.w);
  // the crown's shadow on itself (the geometry gets it from the shadow map): a leaf's chance of direct sun follows
  // its sky exposure; IMP_SELF is that exponent, measured against LOD1 (Phase 4.3: 1.0, tools/evidence/lodcheck.js variants)
  let sh = shO * mix(1.0, pow(expo, IMP_SELF), leaf * u.hor.w);
  // from here on the leaf shading of render/viewer.ts fsFol, term for term
  let ndl = max(dot(N, L), 0.0); let back = max(-dot(N, L), 0.0);
  let ao = mix(mix(0.55, 1.0, expo), occ, 1.0 - leaf);
  let skyUp = mix(u.hor.xyz, u.zen.xyz, 0.75) * u.zen.w;
  let sky = mix(u.hor.xyz, u.zen.xyz, 0.5 + 0.5 * N.y) * (0.65 + 0.35 * N.y) * u.zen.w;
  let bounce = vec3f(0.10, 0.10, 0.06) * (0.5 - 0.5 * N.y) * u.zen.w;
  let scatter = (skyUp * (1.0 - expo) * 0.3 + sunC * (1.0 - sh) * expo * 0.06) * leaf;
  let transCol = alb * vec3f(1.6, 1.8, 0.6) * 0.72 * leaf;
  var c = alb * (sunC * ndl * sh + (sky + bounce) * ao + scatter) + sunC * sh * transCol * back * (0.5 + 0.8 * pow(max(dot(V, -L), 0.0), 3.0));
  c += transCol * skyUp * (0.25 + 0.45 * max(-N.y, 0.0)) * ao;
  // the leaves' gloss: an atlas texel averages many leaves' normals (smoother than any one leaf), so its highlight is
  // spread by the normal's lost length (Toksvig), as the geometry's leaves would scatter it
  let nlen = clamp(length(Nn.xy / ncov * 2.0 - 1.0) * 0.0 + 1.0, 0.0, 1.0);
  c += sunC * sh * ggx(N, V, L, 0.9) * PI * 0.35 * leaf * nlen;
  if (u.env.x < 0.5) { let dd = length(u.cam.xyz - i.wp); c = mix(c, u.hor.xyz * 0.9, 1.0 - exp(-dd * 0.002)); }
  // LOD cross-fade (instance fade, outgoing flag): the complementary dither of render/viewer.ts fadeKeep
  let b = bayer(i.cp.xy);
  if (select((b >= i.fade.x), (b < i.fade.x), i.fade.y > 0.5)) { discard; }
  return vec4f(srgb(aces(c * u.mode.w)), alpha);
}`;

export class Impostors {
  specs = new Map<string, ImpostorSpec>();
  private alb: GPUTexture; private nrm: GPUTexture; private spec: GPUBuffer; private quad: GPUBuffer;
  private pipe: GPURenderPipeline; private shadowPipe: GPURenderPipeline; private countPipe: GPURenderPipeline;
  private bg!: GPUBindGroup; private bg0: GPUBindGroup[] = [];
  private viewer: Viewer; private levels: number;
  /** current instances: x, y, z, yaw, layer, scale, 0, 0 per tree */
  private inst: GPUBuffer | null = null; count = 0; private key = '';
  bytes = 0;
  constructor(viewer: Viewer, layers = 5) {
    this.viewer = viewer; const d = viewer.device;
    this.levels = Math.floor(Math.log2(IMP_SIZE)) + 1;
    const mk = () => d.createTexture({ size: [IMP_SIZE, IMP_SIZE, layers], format: viewer.format, mipLevelCount: this.levels, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT });
    this.alb = mk(); this.nrm = mk();
    for (let l = 0; l < this.levels; l++) this.bytes += Math.max(1, IMP_SIZE >> l) ** 2 * 4 * layers * 2;
    this.spec = d.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.quad = d.createBuffer({ size: 48, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(this.quad, 0, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]));
    const m = d.createShaderModule({ code: SHADER + WGSL });
    const bgl1 = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }] });
    const layout = d.createPipelineLayout({ bindGroupLayouts: [viewer.uniformLayout, bgl1] });
    const vb: GPUVertexBufferLayout[] = [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
      { arrayStride: 32, stepMode: 'instance', attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x4' }, { shaderLocation: 2, offset: 16, format: 'float32x4' }] }];
    this.pipe = d.createRenderPipeline({ layout, vertex: { module: m, entryPoint: 'vsImp', buffers: vb }, fragment: { module: m, entryPoint: 'fsImp', targets: [{ format: viewer.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' }, multisample: { count: 4, alphaToCoverageEnabled: true } });
    this.shadowPipe = d.createRenderPipeline({ layout, vertex: { module: m, entryPoint: 'vsImpShadow', buffers: vb }, fragment: { module: m, entryPoint: 'fsImpShadow', targets: [] },
      primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2 } });
    const add: GPUBlendState = { color: { operation: 'add', srcFactor: 'one', dstFactor: 'one' }, alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' } };
    this.countPipe = d.createRenderPipeline({ layout, vertex: { module: m, entryPoint: 'vsImp', buffers: vb }, fragment: { module: m, entryPoint: 'fsImpCount', targets: [{ format: 'rgba16float', blend: add }] }, primitive: { topology: 'triangle-list', cullMode: 'none' } });
    const smp = d.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.bg = d.createBindGroup({ layout: bgl1, entries: [{ binding: 0, resource: this.alb.createView({ dimension: '2d-array' }) }, { binding: 1, resource: this.nrm.createView({ dimension: '2d-array' }) }, { binding: 2, resource: smp }, { binding: 3, resource: { buffer: this.spec } }] });
    viewer.extra = {
      main: (pass) => this.draw(pass, false),
      shadow: (pass) => { this.draw(pass, true); },
      count: (pass) => { if (!this.count || !this.inst) return; pass.setPipeline(this.countPipe); pass.setBindGroup(0, this.viewer.globalBindGroup(false), [0]); pass.setBindGroup(1, this.bg); pass.setVertexBuffer(0, this.quad); pass.setVertexBuffer(1, this.inst); pass.draw(6, this.count); },
    };
  }
  has(id: string): boolean { return this.specs.has(id); }
  private setSpec(sp: ImpostorSpec): void {
    this.specs.set(sp.id, sp);
    const a = new Float32Array(32); for (const x of this.specs.values()) a.set([...x.center, x.radius], x.layer * 4);
    this.viewer.device.queue.writeBuffer(this.spec, 0, a);
  }
  /** Raw level-0 RGBA bytes of a layer's albedo and normal (for the offline atlas export). */
  async read(layer: number): Promise<{ albedo: Uint8Array; normal: Uint8Array }> {
    const d = this.viewer.device, row = IMP_SIZE * 4, bpr = Math.ceil(row / 256) * 256, bgra = this.viewer.format.startsWith('bgra');
    const one = async (t: GPUTexture) => {
      const buf = d.createBuffer({ size: bpr * IMP_SIZE, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = d.createCommandEncoder(); enc.copyTextureToBuffer({ texture: t, origin: [0, 0, layer] }, { buffer: buf, bytesPerRow: bpr }, [IMP_SIZE, IMP_SIZE]); d.queue.submit([enc.finish()]);
      await buf.mapAsync(GPUMapMode.READ); const m = new Uint8Array(buf.getMappedRange()), px = new Uint8Array(row * IMP_SIZE);
      for (let y = 0; y < IMP_SIZE; y++) px.set(m.subarray(y * bpr, y * bpr + row), y * row);
      buf.unmap(); buf.destroy();
      if (bgra) for (let i = 0; i < px.length; i += 4) { const r = px[i]; px[i] = px[i + 2]; px[i + 2] = r; }
      return px;
    };
    return { albedo: await one(this.alb), normal: await one(this.nrm) };
  }
  /** Load a pre-baked atlas layer (textures/impostors.json, written by tools/evidence/bake-impostors.js). */
  async load(id: string, layer: number, albedoUrl: string, normalUrl: string, center: V3, radius: number): Promise<ImpostorSpec> {
    const t0 = performance.now(), d = this.viewer.device;
    for (const [url, tex] of [[albedoUrl, this.alb], [normalUrl, this.nrm]] as [string, GPUTexture][]) {
      const bmp = await createImageBitmap(await (await fetch(url)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      d.queue.copyExternalImageToTexture({ source: bmp }, { texture: tex, origin: [0, 0, layer], premultipliedAlpha: false }, [IMP_SIZE, IMP_SIZE]);
      bmp.close();
    }
    this.viewer.mipsLayer(this.alb, this.nrm, layer, this.levels);
    const sp: ImpostorSpec = { id, layer, center, radius, ms: performance.now() - t0, loaded: true };
    this.setSpec(sp);
    return sp;
  }
  /** Bake a specimen into atlas layer `layer` from the given draws (tree at the origin, yaw 0). */
  bake(id: string, layer: number, draws: Draw[], center: V3, radius: number): ImpostorSpec {
    const t0 = performance.now(), v = this.viewer;
    const saved = v.bakeMode;
    for (const [mode, tex] of [[6, this.alb], [7, this.nrm]] as [number, GPUTexture][]) {
      v.bakeMode = mode;
      for (let j = 0; j < IMP_N; j++) for (let i = 0; i < IMP_N; i++) {
        const dir = frameDir(i, j), eye: V3 = [center[0] + dir[0] * radius * 3, center[1] + dir[1] * radius * 3, center[2] + dir[2] * radius * 3];
        v.bakeFrame(tex, layer, i * IMP_FRAME, j * IMP_FRAME, IMP_FRAME, ortho(center, radius, dir), [...eye, 0], draws);
      }
    }
    v.bakeMode = saved;
    v.mipsLayer(this.alb, this.nrm, layer, this.levels);
    const s: ImpostorSpec = { id, layer, center, radius, ms: performance.now() - t0 };
    this.setSpec(s);
    return s;
  }
  /** Set the impostor instances: [x, y, z, yaw, layer, scale, fade (1), outgoing (0/1)] per tree. */
  setInstances(list: number[][]): void {
    const d = this.viewer.device;
    this.count = list.length;
    if (!list.length) { if (this.key !== '') { this.key = ''; this.viewer.shadowDirty = true; } return; }
    const a = new Float32Array(list.length * 8); list.forEach((t, k) => a.set([t[0], t[1], t[2], t[3], t[4], t[5] ?? 1, t[6] ?? 1, t[7] ?? 0], k * 8));
    if (!this.inst || this.inst.size < a.byteLength) { this.inst?.destroy(); this.inst = d.createBuffer({ size: Math.max(256, a.byteLength * 2), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }); }
    d.queue.writeBuffer(this.inst, 0, a);
    // shadows change with the trees, not with a cross-fade's dither amounts
    // (the casting side: an outgoing impostor casts until halfway through its fade, an incoming one from halfway)
    const key = list.map((t) => t.slice(0, 6).join(',') + (impostorCasts(t) ? '' : 'x')).join('|');
    if (key !== this.key) { this.key = key; this.viewer.shadowDirty = true; }
  }
  private draw(pass: GPURenderPassEncoder, shadow: boolean): { calls: number; tris: number } {
    if (!this.count || !this.inst) return { calls: 0, tris: 0 };
    pass.setPipeline(shadow ? this.shadowPipe : this.pipe);
    pass.setBindGroup(0, this.viewer.globalBindGroup(shadow), [0]); pass.setBindGroup(1, this.bg);
    pass.setVertexBuffer(0, this.quad); pass.setVertexBuffer(1, this.inst); pass.draw(6, this.count);
    return { calls: 1, tris: 2 * this.count };
  }
  void(): void { void this.bg0; }
}
