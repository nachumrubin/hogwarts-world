// Lab controller: state (specimen or comparison, view, display mode, lighting, LOD), render loop (on demand, or
// continuous in live mode), camera presets, standardized shots and review-sheet export. UI-agnostic: ui.ts binds the
// DOM to it, and the headless capture script drives the same API through window.__lab.
import { Viewer, viewProj, LIGHTS, MODES, KIND, MAT, type Mode, type FoliageRep, type Draw } from '../render/viewer.ts';
import { Impostors } from '../render/impostor.ts';
import { unpackPos } from '../framework/foliage.ts';
import { CameraController, FOV, type Box, type Preset, type V3 } from './camera.ts';
import { SpecimenStore, LabScene, COMPARISONS, STAND, standTrees } from './scene.ts';
import { PerfMonitor } from './perf.ts';
import { REVIEW_SET, MATERIAL_SET, FOLIAGE_SET, PROTOCOL, composeSheet, composeRows, zip, type ShotSpec, type ShotView } from './capture.ts';
import { SPECIES } from '../species/index.ts';
import type { BuiltSpecimen } from '../build.ts';

declare const __COMMIT__: string;
export const COMMIT = typeof __COMMIT__ === 'string' ? __COMMIT__ : 'dev';

export type View = Preset | 'trunk' | 'junction' | 'broken' | 'crown' | 'macro' | 'interior' | 'up' | 'elevated' | 'aerial' | 'backlit';
const CLOSE: View[] = ['trunk', 'junction', 'broken', 'crown', 'macro', 'interior', 'up'];
export interface LabState { kind: 'specimen' | 'compare'; specimen: string; compare: string; focus: string | null; mode: Mode; light: string; lod: number; live: boolean; view: View; foliage: boolean }

export class Lab {
  viewer = new Viewer();
  cam = new CameraController();
  perf = new PerfMonitor();
  store: SpecimenStore;
  scene!: LabScene;
  state: LabState = { kind: 'specimen', specimen: 'oak-a', compare: 'oaks', focus: null, mode: 'lit', light: 'day', lod: 0, live: true, view: 'three', foliage: true };
  private dirty = true; private last = 0; private busy = false;
  /** > 0 while an offscreen render has the viewer's mode/light switched: no canvas frames then (they would flash it) */
  private hold = 0;
  /** offscreen renders switch the shared viewer's mode and light: they run one at a time (thumbnails rendered
   *  while a review shot awaited its overdraw pass had switched it to clay mid-shot) */
  private gate: Promise<unknown> = Promise.resolve();
  private exclusive<T>(fn: () => Promise<T>): Promise<T> { const r = this.gate.then(fn, fn); this.gate = r.catch(() => {}); return r; }
  frames = 0;
  onState: () => void = () => {};
  onFrame: () => void = () => {};
  onStatus: (msg: string, busy: boolean) => void = () => {};

  private canvas: HTMLCanvasElement;
  constructor(canvas: HTMLCanvasElement, workerUrl: string | URL) {
    this.canvas = canvas;
    this.store = new SpecimenStore(workerUrl, Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1)), COMMIT);
  }

  async init(shadowSize = 4096): Promise<void> {
    await this.viewer.init(this.canvas, shadowSize);
    // bark textures (a few MB); without them the materials mode shows a flat placeholder tone
    try { await this.viewer.loadBark('textures/', COMMIT); } catch (e) { console.error('bark textures', e); }
    try { await this.viewer.loadFoliage('textures/', COMMIT); } catch (e) { console.error('foliage textures', e); }
    this.scene = new LabScene(this.viewer, this.store);
    this.impostors = new Impostors(this.viewer, SPECIES.length); this.scene.impostors = this.impostors;
    this.cam.attach(this.canvas);
    this.cam.onChange = () => this.invalidate();
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    this.resize();
    requestAnimationFrame((t) => this.tick(t));
  }

  private resize(): void {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr)), h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (w !== this.canvas.width || h !== this.canvas.height) { this.canvas.width = w; this.canvas.height = h; }
    this.cam.aspect = w / h; this.invalidate();
  }
  invalidate(): void { this.dirty = true; }

  private tick(t: number): void {
    const dt = Math.min(0.1, (t - this.last) / 1000 || 0); this.last = t;
    const moved = this.cam.update(dt);
    if ((this.dirty || moved || this.state.live) && this.viewer.draws.length && !this.hold) {
      const { eye, target } = this.cam.view();
      const vp = viewProj(eye, target, FOV, this.canvas.width / this.canvas.height, 0.05, 3000);
      if (this.scene.stand && !this.scene.pinned) this.standLod(eye, vp, t);
      this.viewer.render(vp, eye);
      this.perf.frame(t, this.viewer.cpuMs, this.viewer.hasTs ? this.viewer.gpuMs : null, this.state.live);
      this.frames++; this.dirty = false; this.onFrame();
    }
    requestAnimationFrame((tt) => this.tick(tt));
  }

  /** stand mode, live: projected-size LOD, culling and LOD0 residency follow the camera (re-assigned when the camera
   *  has moved, at most 4 times a second, so the shadow map is not redrawn every frame) */
  private lastLod = { t: 0, eye: [1e9, 0, 0] as number[], vp: '' };
  private standLod(eye: V3, vp: Float32Array, t: number): void {
    // re-assigned when the camera has moved (at most 10 times a second), and every frame while trees cross-fade
    const moved = Math.hypot(eye[0] - this.lastLod.eye[0], eye[1] - this.lastLod.eye[1], eye[2] - this.lastLod.eye[2]) > 0.5 || this.lastLod.vp !== vp.slice(0, 3).join();
    if (!this.scene.fading && (!moved || t - this.lastLod.t < 100)) return;
    const dt = Math.min(0.25, (t - (this.lastLod.t || t)) / 1000);
    this.lastLod = { t, eye: [...eye], vp: vp.slice(0, 3).join() };
    this.scene.eye = eye; this.scene.cullVP = vp; this.scene.lodPolicy.screenH = this.canvas.height;
    this.scene.apply(0, dt);
    if (this.scene.fading) this.invalidate();
    this.store.evictLod0(this.viewer, performance.now());
  }
  /** One step of the stand's LOD state for a scripted camera (videos, tests): cross-fades advance by dt seconds. */
  lodStep(eye: V3, target: V3, w: number, h: number, dt: number, policyH = h): Float32Array {
    const vp = viewProj(eye, target, FOV, w / h, 0.05, 3000);
    // policyH: the screen height the LOD thresholds are evaluated for (a small recording can choose LODs as at 1080p)
    this.scene.eye = eye; this.scene.cullVP = vp; this.scene.lodPolicy.screenH = policyH;
    this.scene.apply(0, dt);
    return vp;
  }
  /** Render the current draws from a camera offscreen (scripted frames). */
  async frame(eye: V3, target: V3, vp: Float32Array, w: number, h: number): Promise<Blob> {
    return this.exclusive(async () => { this.hold++; try { return await this.viewer.renderImage(w, h, vp, eye); } finally { this.hold--; } });
  }

  // ---------------------------------------------------------------- impostors, benchmark
  impostors!: Impostors;
  /** Bake the impostors of these specimens (once each; from LOD1 bark and spray cards). */
  async ensureImpostors(ids: string[]): Promise<void> {
    await this.ensure(ids);
    for (const id of ids) {
      if (this.impostors.has(id)) continue;
      const e = this.store.get(id), b = e.built!.bounds;
      // bounding sphere of what is baked (LOD1 bark vertices, spray-card bases plus a card's reach)
      const center: V3 = [(b.min[0] + b.max[0]) / 2, (Math.max(b.min[1], 0) + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
      let r2 = 0; const v = e.built!.lods[1].v;
      for (let k = 0; k < v.length; k += 16) if (v[k + 1] > -0.5) r2 = Math.max(r2, (v[k] - center[0]) ** 2 + (v[k + 1] - center[1]) ** 2 + (v[k + 2] - center[2]) ** 2);
      for (const set of e.built!.foliage.lods[1].sets) for (let k = 0; k < set.count; k++) { const p = unpackPos(set.data, k).p; r2 = Math.max(r2, (p[0] - center[0]) ** 2 + (p[1] - center[1]) ** 2 + (p[2] - center[2]) ** 2); }
      const radius = Math.sqrt(r2) + 0.8;
      // a pre-baked atlas made from this very generation (fingerprint) and these textures loads in milliseconds
      const pre = (await this.impostorManifest())[id];
      if (pre && pre.fingerprint === this.fingerprint(id) && this.store.density === 1) {
        try { await this.impostors.load(id, SPECIES.findIndex((d) => d.id === id), `textures/${pre.albedo}`, `textures/${pre.normal}`, pre.center, pre.radius); continue; } catch (err) { console.warn('impostor atlas', err); }
      }
      this.onStatus(`Baking impostor: ${this.store.get(id).def.name}…`, true);
      await this.exclusive(async () => {
        const src = this.impostorSource[id] ?? 1;
        const draws: Draw[] = [{ mesh: this.store.gpu(this.viewer, id, src), offset: [0, 0, 0], kind: KIND.tree, mat: MAT[e.def.material], foliage: this.store.foliage(this.viewer, id, src, 'hybrid'), yaw: 0 }];
        const saved = this.viewer.mode; this.viewer.mode = 'lit';
        this.impostors.bake(id, SPECIES.findIndex((d) => d.id === id), draws, center, radius);
        this.viewer.mode = saved;
        await this.viewer.device.queue.onSubmittedWorkDone();
      });
    }
    this.onStatus('', false);
  }
  /** Density experiments: rebuild the collection at a crown-density scale (fullness × d; 1 = as defined). */
  async setDensity(d: number): Promise<void> {
    if (d === this.store.density) return;
    this.hold++;
    try {
      await this.exclusive(async () => { this.store.density = d; this.viewer.setDraws([]); this.store.reset(this.viewer); this.impostors.specs.clear(); });
      await this.reloadAfterReset();
    } finally { this.hold--; this.invalidate(); }
  }
  private async reloadAfterReset(): Promise<void> {
    const ids = this.members(); await this.ensure(ids); await this.reloadSubject();
  }
  private impMan: Record<string, { fingerprint: string; albedo: string; normal: string; center: V3; radius: number }> | null = null;
  private async impostorManifest(): Promise<NonNullable<Lab['impMan']>> {
    if (!this.impMan) { try { this.impMan = await (await fetch(`textures/impostors.json?v=${COMMIT}`)).json(); } catch { this.impMan = {}; } }
    return this.impMan!;
  }
  /** which LOD each specimen's impostor is baked from (1 = spray cards, matched to LOD0; 0 = LOD0 itself) */
  impostorSource: Record<string, number> = {};
  /** What an impostor atlas depends on: the specimen's generated foliage and skeleton, and the foliage textures. */
  fingerprint(id: string): string {
    const b = this.store.get(id).built!, f = b.foliage;
    return [this.impostorSource[id] ?? 1, f.stats.leaves, f.stats.shoots, f.lods[1].instances, f.lods[1].triangles, b.lods[1].i.length, ...b.bounds.min.map((x) => x.toFixed(3)), ...b.bounds.max.map((x) => x.toFixed(3)), this.viewer.folTexKey].join(':');
  }
  /** The woodland stand of n trees (12: the review stand; 50 and 200: generated, for the benchmark). */
  async standOf(n: number): Promise<void> {
    this.state.kind = 'compare'; this.state.compare = 'stand'; this.state.focus = null;
    const ids = [...new Set(standTrees(n).map((t) => t.id))];
    await this.ensure(ids);
    if (n > 12) await this.ensureImpostors(ids);
    this.scene.standN = n; this.scene.custom = null;
    this.scene.set([], this.state.lod, true);
    this.lastLod.t = 0; this.lastLod.eye = [1e9, 0, 0];
    this.setView('three', false); this.onState();
  }
  /** Benchmark cameras: ground level (1.7 m, walking) and aerial (broom flight, 80 m), per scene. */
  benchCamera(scene: string, camera: 'ground' | 'aerial'): { eye: V3; target: V3 } {
    const single = SPECIES.find((d) => d.id === scene);
    if (single) {
      const H = this.store.get(scene).built!.bounds.max[1];
      return camera === 'ground' ? { eye: [0, 1.7, H * 1.6], target: [0, H * 0.45, 0] } : { eye: [-H * 1.4, H * 2.4, H * 1.4], target: [0, H * 0.35, 0] };
    }
    const n = +scene.replace('stand', ''), side = n <= 12 ? 80 : Math.sqrt(n) * 12.5;
    if (camera === 'ground') return n <= 12 ? { eye: [-14, 1.7, 46], target: [6, 9, 0] } : { eye: [side * 0.12, 1.7, side * 0.5 + 6], target: [0, 9, 0] };
    return { eye: [-side * 0.55, 80, side * 0.75], target: [0, 0, -side * 0.05] };
  }
  /** Run one benchmark configuration: scene ('oak-a' … 'birch', 'stand12', 'stand50', 'stand200'), camera, resolution,
   *  shadow-map size (0 = off), frames. Returns a JSON-ready record. On a software adapter (SwiftShader) the timings
   *  are CPU-rasterizer timings and say nothing about GPU performance. */
  async bench(o: { scene: string; camera: 'ground' | 'aerial'; width: number; height: number; shadow: number; frames: number }): Promise<Record<string, unknown>> {
    const single = SPECIES.find((d) => d.id === o.scene);
    const ids = single ? [o.scene] : [...new Set(standTrees(+o.scene.replace('stand', '')).map((t) => t.id))];
    await this.ensure(ids); await this.ensureImpostors(ids);
    return this.exclusive(async () => {
      this.hold++;
      const v = this.viewer, keepShadow = v.shadowSize, keepEnv = v.woodland;
      try {
        v.setShadowSize(o.shadow); v.woodland = true; v.mode = 'lit'; v.light = LIGHTS.find((l) => l.id === 'day')!;
        this.scene.pinned = true;
        this.scene.custom = single ? [{ id: o.scene, x: 0, z: 0, yaw: 0 }] : null;
        this.scene.standN = single ? 1 : +o.scene.replace('stand', '');
        this.scene.set([], 0, true);
        const { eye, target } = this.benchCamera(o.scene, o.camera);
        const vp = viewProj(eye, target, FOV, o.width / o.height, 0.05, 3000);
        this.scene.eye = eye; this.scene.cullVP = vp; this.scene.lodPolicy.screenH = o.height;
        const t0 = performance.now();
        this.scene.apply(0);
        const freed = this.store.evictLod0(v, t0, 0); // LOD0 resident only for the trees that use it now
        const draws = v.draws;
        const r = await v.benchFrames(o.width, o.height, vp, eye, o.frames);
        const med = (a: number[]) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
        const p95 = (a: number[]) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.ceil(b.length * 0.95) - 1)]; };
        const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
        const foliageInstances = draws.reduce((a, x) => a + (x.foliage?.instances ?? 0), 0) + this.impostors.count;
        const tex = (v.tex?.bytes ?? 0) + (v.folTex?.bytes ?? 0);
        const targets = o.width * o.height * (4 * 4 + 4 * 4 + 4);
        const sw = /swiftshader|software|llvmpipe/i.test(v.adapterName);
        return {
          tool: 'Tree Lab benchmark', commit: COMMIT, date: new Date().toISOString(), userAgent: navigator.userAgent,
          adapter: { name: v.adapterName, software: sw, timestampQueries: v.hasTs },
          settings: o,
          camera: { eye, target, fovDeg: 45 },
          frameMs: { median: med(r.wall), p95: p95(r.wall), mean: mean(r.wall), note: 'wall time submit → GPU done, one frame at a time (latency, includes the shadow pass)' },
          gpuMs: r.gpu.length ? { median: med(r.gpu), p95: p95(r.gpu), mean: mean(r.gpu), note: 'timestamp queries, main pass' } : null,
          drawCalls: r.calls, triangles: r.tris, foliageInstances,
          trees: this.scene.placed.length, lod: { lod0: this.scene.lodCounts[0], lod1: this.scene.lodCounts[1], lod2: this.scene.lodCounts[2], impostor: this.scene.lodCounts[3], culled: this.scene.lodCounts[4] },
          memory: { geometryBytes: v.geometryBytes, foliageInstanceBytes: v.foliageBytes, textureBytes: tex, impostorAtlasBytes: this.impostors.bytes, shadowMapBytes: o.shadow > 0 ? v.shadowSize ** 2 * 4 : 0, renderTargetBytes: targets, lod0Released: freed,
            total: v.geometryBytes + v.foliageBytes + tex + this.impostors.bytes + (o.shadow > 0 ? v.shadowSize ** 2 * 4 : 0) + targets },
          warning: sw ? 'Software adapter: these timings are CPU-rasterizer timings, not GPU performance.' : undefined,
        };
      } finally {
        v.setShadowSize(keepShadow); v.woodland = keepEnv; this.scene.custom = null; this.scene.pinned = false; this.scene.eye = null; this.scene.cullVP = null;
        this.restoreLook(); this.hold--;
        await this.reloadSubject();
      }
    });
  }
  /** Every scene × camera at one resolution and shadow setting. */
  async benchSuite(o: { width: number; height: number; shadow: number; frames: number; scenes?: string[] }, onEach?: (r: Record<string, unknown>) => void): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for (const scene of o.scenes ?? ['oak-b', 'pine', 'birch', 'stand12', 'stand50', 'stand200']) for (const camera of ['ground', 'aerial'] as const) {
      const r = await this.bench({ scene, camera, width: o.width, height: o.height, shadow: o.shadow, frames: o.frames }); out.push(r); onEach?.(r);
    }
    return out;
  }
  private async reloadSubject(): Promise<void> {
    if (this.state.kind === 'specimen') { this.scene.set([this.state.specimen], this.state.lod); }
    else if (this.state.compare === 'stand') { this.scene.set([], this.state.lod, true); }
    else { const set = COMPARISONS.find((c) => c.id === this.state.compare)!; this.scene.set(set.members, this.state.lod); }
    this.invalidate();
  }

  // ---------------------------------------------------------------- state changes
  private async ensure(ids: string[]): Promise<void> {
    const missing = ids.filter((id) => !this.store.get(id).built);
    if (!missing.length) return;
    this.onStatus(`Growing ${missing.map((id) => this.store.get(id).def.name).join(', ')}…`, true);
    await Promise.all(missing.map((id) => this.store.load(id)));
    this.onStatus('', false);
  }
  members(): string[] { return this.state.kind === 'specimen' ? [this.state.specimen] : this.state.compare === 'stand' ? [...new Set(STAND.map((t) => t.id))] : COMPARISONS.find((c) => c.id === this.state.compare)!.members; }

  async select(id: string, view: View = this.state.view): Promise<void> {
    this.state.kind = 'specimen'; this.state.specimen = id; this.state.focus = null;
    await this.ensure([id]);
    this.scene.set([id], this.state.lod);
    this.setView(view, false); this.onState();
  }
  async compare(setId: string): Promise<void> {
    const set = COMPARISONS.find((c) => c.id === setId); if (!set) throw new Error(`unknown comparison ${setId}`);
    this.state.kind = 'compare'; this.state.compare = setId; this.state.focus = null;
    await this.ensure(set.members);
    this.scene.set(set.members, this.state.lod);
    this.setView(CLOSE.includes(this.state.view) ? 'front' : this.state.view, false); this.onState();
  }
  /** The woodland stand (stress test): twelve trees, per-tree LOD by distance, on the woodland floor. */
  async stand(): Promise<void> { await this.standOf(12); }
  setEnv(woodland: boolean): void { this.viewer.woodland = woodland; this.invalidate(); this.onState(); }
  /** Stress test: the stand from a ground-level walk position and from an elevated overview; per view the image,
   *  measured overdraw, instances and triangles drawn, draw calls, LOD mix, GPU-resident bytes and frame time. */
  async standStress(w = 1200, h = 900): Promise<{ shots: Blob[]; labels: string[]; stats: Record<string, unknown>[] }> {
    await this.stand(); this.setEnv(true);
    const views: [string, V3, V3][] = [['ground-level walk (1.7 m)', [-14, 1.7, 46], [6, 9, 0]], ['elevated overview', [-70, 42, 70], [2, 4, -4]], ['aerial', [-20, 120, 30], [0, 0, -2]]];
    const shots: Blob[] = [], labels: string[] = [], stats: Record<string, unknown>[] = [];
    for (const [name, eye, target] of views) {
      this.scene.eye = eye;
      const d = [eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]], L = Math.hypot(d[0], d[1], d[2]);
      const orbit = { target, az: Math.atan2(d[0], d[2]), el: Math.asin(d[1] / L), dist: L };
      let od: Record<string, number> = {};
      const blob = await this.shoot('three', 'lit', { width: w, height: h, light: 'day', orbit, overdraw: (r) => { od = r; } });
      // what that frame drew
      this.scene.apply(0);
      const draws = this.viewer.draws;
      const inst = draws.reduce((a, x) => a + (x.foliage?.instances ?? 0), 0), ftri = draws.reduce((a, x) => a + (x.foliage?.triangles ?? 0), 0), btri = draws.reduce((a, x) => a + (x.kind === 0 ? x.mesh.triangles : 0), 0);
      const calls = draws.length + draws.reduce((a, x) => a + (x.foliage?.sets.length ?? 0), 0) + 1;
      const vp = viewProj(eye, target, FOV, w / h, 0.05, 3000);
      const t = await this.viewer.timeRender(w, h, vp, eye, 2);
      stats.push({ view: name, lodMix: [...this.scene.lodCounts], foliageInstances: inst, foliageTriangles: ftri, barkTriangles: btri, drawCalls: calls, overdraw: od, frame: t, foliageBytesResident: this.viewer.foliageBytes, geometryBytesResident: this.viewer.geometryBytes });
      shots.push(blob); labels.push(`Woodland stand · ${name} · LOD by distance ${this.scene.lodCounts.join('/')}`);
    }
    this.scene.eye = null; this.restoreLook(); this.scene.apply(this.state.lod); this.invalidate();
    return { shots, labels, stats };
  }
  focus(id: string | null): void { this.state.focus = id; this.setView(this.state.view, true); this.onState(); }
  setMode(m: Mode): void { this.state.mode = m; this.viewer.mode = m; this.invalidate(); this.onState(); }
  setLight(id: string): void {
    const L = LIGHTS.find((l) => l.id === id); if (!L) return;
    this.state.light = id; this.viewer.light = L; if (this.viewer.draws.length) this.scene.apply(this.state.lod); this.invalidate(); this.onState();
  }
  setLod(k: number): void { this.state.lod = k; if (this.viewer.draws.length) this.scene.apply(k); this.invalidate(); this.onState(); }
  setRep(r: FoliageRep): void { this.scene.rep = r; if (this.viewer.draws.length) this.scene.apply(this.state.lod); this.invalidate(); this.onState(); }
  setFoliage(on: boolean): void { this.state.foliage = on; this.scene.showFoliage = on; if (this.viewer.draws.length) this.scene.apply(this.state.lod); this.invalidate(); this.onState(); }
  setLive(on: boolean): void { this.state.live = on; this.perf.reset(); this.invalidate(); this.onState(); }

  /** The specimen close-ups and focus refer to: the focused one in a comparison, else the selected/first. */
  subject(): { id: string; offset: V3; box: Box } {
    const id = this.state.focus ?? (this.state.kind === 'specimen' ? this.state.specimen : this.members()[0]);
    const p = this.scene.placed.find((q) => q.id === id) ?? this.scene.placed[0];
    return p;
  }
  /** Orbit parameters for a view. `common`: full-tree views use the fixed capture frame (common scale). */
  orbitFor(view: View, aspect: number, common = false): { target: V3; az: number; el: number; dist: number } {
    const s = this.subject();
    const built = this.store.get(s.id).built!;
    if (view === 'backlit') {
      // the common full-tree frame, seen from the side opposite the low sun (the light comes through the crown)
      const f = this.orbitFor('front', aspect, true), sun = LIGHTS.find((l) => l.id === 'low')!.sun;
      return { ...f, az: Math.atan2(sun[0], sun[2]) + Math.PI, el: 0.06 };
    }
    const C = built.poi.crown;
    if (C && ['crown', 'macro', 'interior', 'up', 'elevated', 'aerial'].includes(view)) {
      const o = s.offset, at = (p: V3): V3 => [o[0] + p[0], p[1], o[2] + p[2]];
      const fromEye = (eye: V3, target: V3) => { const d = [eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]], L = Math.hypot(d[0], d[1], d[2]); return { target, az: Math.atan2(d[0], d[2]), el: Math.asin(d[1] / L), dist: L }; };
      const H = C.top - C.low;
      if (view === 'crown') return { target: at(C.leaf), az: C.az + 0.25, el: 0.12, dist: 1.6 };
      if (view === 'macro') return { target: at(C.leaf), az: C.az + 0.15, el: 0.18, dist: 0.42 };
      if (view === 'interior') return fromEye(at([C.center[0] + Math.sin(C.az) * C.radius * 0.25, C.low + H * 0.45, C.center[2] + Math.cos(C.az) * C.radius * 0.25]), at([C.center[0] + Math.sin(C.az + 2.2) * C.radius * 0.6, C.low + H * 0.75, C.center[2] + Math.cos(C.az + 2.2) * C.radius * 0.6]));
      if (view === 'up') return fromEye(at([C.center[0] + Math.sin(C.az + 0.8) * Math.min(C.radius * 0.45, 4), 1.6, C.center[2] + Math.cos(C.az + 0.8) * Math.min(C.radius * 0.45, 4)]), at([C.center[0], C.low + H * 0.7, C.center[2]]));
      const box = s.box, size = Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
      if (view === 'elevated') return { target: at([C.center[0], C.low + H * 0.4, C.center[2]]), az: 0.6, el: 0.42, dist: size * 1.35 };
      return { target: at([C.center[0], C.low + H * 0.5, C.center[2]]), az: 0.9, el: 1.2, dist: size * 1.5 };
    }
    if (view === 'broken' && built.poi.broken) {
      const b = built.poi.broken;
      return { target: [s.offset[0] + b.p[0], b.p[1], s.offset[2] + b.p[2]], az: b.az, el: b.el, dist: b.dist };
    }
    if (view === 'trunk' || view === 'junction' || view === 'broken') {
      const p = built.poi;
      if (view === 'trunk') return { target: [s.offset[0], p.trunkY, s.offset[2]], az: p.trunkAz, el: 0.08, dist: p.trunkDist };
      return { target: [s.offset[0] + p.junction[0], p.junction[1], s.offset[2] + p.junction[2]], az: p.junctionAz, el: p.junctionEl, dist: p.junctionDist };
    }
    const pv: Preset = (['front', 'side', 'rear', 'three', 'top'] as View[]).includes(view) ? view as Preset : 'three';
    let box: Box = this.state.kind === 'compare' && !this.state.focus ? this.scene.box : s.box;
    if (common && pv !== 'top' && !(this.state.kind === 'compare' && !this.state.focus)) {
      const cx = (s.box.min[0] + s.box.max[0]) / 2, cz = (s.box.min[2] + s.box.max[2]) / 2, F = PROTOCOL.commonFrame;
      box = { min: [cx - F.width / 2, 0, cz - F.width / 2], max: [cx + F.width / 2, F.height, cz + F.width / 2] };
      // the frame (F.width × F.height) is measured in the plane through the tree's centre, not at the box's face
      // the same distance for every specimen (common scale); framing() already allows for the frame's depth
      return CameraController.framing(box, pv, aspect, 1.0);
    }
    return CameraController.framing({ min: [box.min[0], Math.min(0, box.min[1]), box.min[2]], max: box.max }, pv, aspect);
  }
  setView(v: View, animate = true): void {
    this.state.view = v;
    this.cam.go(this.orbitFor(v, this.cam.aspect), animate);
    this.onState();
  }
  resetCamera(): void { this.cam.setFree(false); this.setView('three'); }

  /** Back to the lab's own mode and light after an offscreen render (from the state, not a saved copy: offscreen
   *  renders overlap, e.g. the library thumbnails, and a saved copy could be another render's temporary look). */
  private restoreLook(): void { this.viewer.mode = this.state.mode; this.viewer.light = LIGHTS.find((l) => l.id === this.state.light) ?? LIGHTS[0]; }

  // ---------------------------------------------------------------- capture
  /** Render one standardized shot of the current subject offscreen (fixed size, protocol lighting and LOD). */
  shoot(view: View, mode: Mode, opts: Parameters<Lab['shootNow']>[2] = {}): Promise<Blob> { return this.exclusive(() => this.shootNow(view, mode, opts)); }
  private async shootNow(view: View, mode: Mode, opts: { width?: number; height?: number; light?: string; lod?: number; common?: boolean; orbit?: { target: V3; az: number; el: number; dist: number }; overdraw?: (r: Record<string, number>) => void } = {}): Promise<Blob> {
    const w = opts.width ?? PROTOCOL.width, h = opts.height ?? PROTOCOL.height;
    const keep = { mode: this.viewer.mode, light: this.viewer.light, lod: this.state.lod };
    this.hold++;
    this.viewer.mode = mode;
    this.viewer.light = LIGHTS.find((l) => l.id === (opts.light ?? PROTOCOL.light)) ?? keep.light;
    const lod = opts.lod ?? PROTOCOL.lod;
    this.scene.apply(lod);
    const o = opts.orbit ?? this.orbitFor(view, w / h, opts.common ?? true);
    const eye: V3 = [o.target[0] + Math.sin(o.az) * Math.cos(o.el) * o.dist, o.target[1] + Math.sin(o.el) * o.dist, o.target[2] + Math.cos(o.az) * Math.cos(o.el) * o.dist];
    try {
      const vp = viewProj(eye, o.target, FOV, w / h, 0.05, 3000);
      if (opts.overdraw) opts.overdraw(await this.viewer.measureOverdraw(w, h, vp, eye));
      return await this.viewer.renderImage(w, h, vp, eye);
    } finally {
      this.restoreLook(); this.scene.apply(keep.lod); this.hold--; this.invalidate();
    }
  }
  /** Small clay portrait of one specimen for the library (its own draw list; the scene is restored after). */
  thumbnail(id: string, w = 360, h = 270): Promise<Blob> { return this.exclusive(() => this.thumbnailNow(id, w, h)); }
  private async thumbnailNow(id: string, w = 360, h = 270): Promise<Blob> {
    const b = this.store.get(id).built!; const mesh = this.store.gpu(this.viewer, id, 2);
    const keep = { mode: this.viewer.mode, light: this.viewer.light };
    this.hold++;
    this.viewer.mode = 'clay'; this.viewer.light = LIGHTS[0];
    const box: Box = { min: [b.bounds.min[0], 0, b.bounds.min[2]], max: b.bounds.max };
    this.viewer.fitShadow([box.min[0] - 2, -1, box.min[2] - 2], [box.max[0] + 2, box.max[1] + 1, box.max[2] + 2]);
    const o = CameraController.framing(box, 'three', w / h, 1.02);
    const eye: V3 = [o.target[0] + Math.sin(o.az) * Math.cos(o.el) * o.dist, o.target[1] + Math.sin(o.el) * o.dist, o.target[2] + Math.cos(o.az) * Math.cos(o.el) * o.dist];
    try { return await this.viewer.renderImage(w, h, viewProj(eye, o.target, FOV, w / h, 0.05, 3000), eye, [{ mesh, offset: [0, 0, 0], kind: 0 }]); }
    finally { this.restoreLook(); if (this.viewer.draws.length) this.scene.apply(this.state.lod); this.hold--; this.invalidate(); }
  }
  /** Screenshot of the viewport exactly as seen (current camera, mode, light), at the canvas size. */
  async screenshot(): Promise<Blob> {
    const { eye, target } = this.cam.view();
    return this.viewer.renderImage(this.canvas.width, this.canvas.height, viewProj(eye, target, FOV, this.canvas.width / this.canvas.height, 0.05, 3000), eye);
  }

  sheetInfo(id: string): { title: string; subtitle: string; lines: [string, string][]; footer: string } {
    const e = this.store.get(id), d = e.built!.diag, def = e.def;
    const L = e.built!.lods;
    return {
      title: `${def.name}  ·  ${def.latin}`,
      subtitle: `${def.summary}`,
      lines: [
        ['Status', def.status], ['Seed / preset', `${def.seed} · ${def.preset}`], ['Height', `${d.height.toFixed(1)} m`],
        ['Crown width', `${d.crownWidth.toFixed(1)} m (${d.crownX.toFixed(1)} × ${d.crownZ.toFixed(1)})`], ['DBH / base', `${d.dbh.toFixed(2)} m / ${d.baseDiameter.toFixed(2)} m`],
        ['Primary limbs', String(d.primaryLimbs)], ['Branches (stem / all)', `${d.stemBranches} / ${d.branches}`], ['Dead / broken', `${d.deadBranches} / ${d.brokenEnds}`],
        ['Hierarchy', d.hierarchy.join(' · ')], ['Triangles LOD0/1/2', L.map((l) => (l.tris / 1000).toFixed(0) + 'k').join(' / ')],
        ['Vertices LOD0', L[0].verts.toLocaleString()], ['Grow / mesh LOD0', `${d.growMs} ms / ${d.meshMs[0]} ms`],
        ...d.history.slice(0, 4).map((h, i) => [i ? '' : 'History', h] as [string, string]),
      ],
      footer: `Tree Lab · ${COMMIT} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${PROTOCOL.width}×${PROTOCOL.height}, ${LIGHTS.find((l) => l.id === PROTOCOL.light)!.label}, LOD ${PROTOCOL.lod}; full-tree views at common scale (${PROTOCOL.commonFrame.width} m frame), close-ups framed on the feature · ${this.viewer.adapterName}`,
    };
  }

  /** The standard review set for one specimen: individual shots + sheet. */
  async review(id: string, progress: (k: number, n: number) => void = () => {}): Promise<{ shots: { spec: ShotSpec; blob: Blob }[]; sheet: Blob }> {
    await this.select(id);
    const shots: { spec: ShotSpec; blob: Blob }[] = [];
    const fol = this.state.foliage; this.scene.showFoliage = false; // structural regression set: the leafless tree
    try { for (let k = 0; k < REVIEW_SET.length; k++) { progress(k, REVIEW_SET.length); const s = REVIEW_SET[k]; shots.push({ spec: s, blob: await this.shoot(s.view as ShotView as View, s.mode) }); } }
    finally { this.scene.showFoliage = fol; }
    progress(REVIEW_SET.length, REVIEW_SET.length);
    const sheet = await composeSheet(shots.map((s) => s.blob), shots.map((s) => s.spec.label), this.sheetInfo(id));
    return { shots, sheet };
  }
  /** The bark/material review set for one specimen (MATERIAL_SET), with texture and render-time statistics. */
  async materialReview(id: string, progress: (k: number, n: number) => void = () => {}): Promise<{ shots: { spec: ShotSpec; blob: Blob }[]; sheet: Blob; stats: Record<string, unknown> }> {
    await this.select(id);
    const shots: { spec: ShotSpec; blob: Blob }[] = [];
    const fol = this.state.foliage; this.scene.showFoliage = false; // bark regression set: the leafless tree
    try {
      for (let k = 0; k < MATERIAL_SET.length; k++) {
        progress(k, MATERIAL_SET.length); const s = MATERIAL_SET[k];
        shots.push({ spec: s, blob: await this.shoot(s.view as View, s.mode, { light: s.light, lod: s.lod }) });
      }
    } finally { this.scene.showFoliage = fol; }
    const stats = await this.renderStats(id);
    const info = this.sheetInfo(id);
    const T = this.viewer.tex, fmt = (x: number | null) => (x === null ? 'n/a' : x.toFixed(1) + ' ms');
    info.lines = [
      ...info.lines.slice(0, 5),
      ['Bark', ({ oak: 'oak plates (bark_willow_02) + young bark', pine: 'pine plates + orange flakes + shoots', birch: 'paper bark + black base + red twigs' } as Record<string, string>)[this.store.get(id).def.material]],
      ['Textures', T ? `${T.layers} layers ${T.size}², ${(T.bytes / 1048576).toFixed(1)} MiB GPU, ${(T.download / 1048576).toFixed(1)} MiB dl` : 'not loaded'],
      ['Triangles LOD0/1/2', this.store.get(id).built!.lods.map((l) => (l.tris / 1000).toFixed(0) + 'k').join(' / ')],
      ['Draw calls (tree)', '1 per LOD (one pipeline)'],
      ['Frame: clay / materials', `${fmt((stats.full as any).clay.wallMs)} / ${fmt((stats.full as any).lit.wallMs)}`],
      ['Trunk close: clay / mat.', `${fmt((stats.trunk as any).clay.wallMs)} / ${fmt((stats.trunk as any).lit.wallMs)}`],
      ['GPU pass (timestamps)', this.viewer.hasTs ? `${fmt((stats.full as any).lit.gpuMs)} full / ${fmt((stats.trunk as any).lit.gpuMs)} trunk` : 'not exposed by this adapter'],
      ['Adapter', this.viewer.adapterName],
    ];
    info.footer = `Tree Lab · ${COMMIT} · ${PROTOCOL.width}×${PROTOCOL.height} · lighting per shot · LOD 0 unless marked · full-tree views at common scale (${PROTOCOL.commonFrame.width} m frame); close-ups at matched cameras for clay and materials · frame times: ${this.viewer.adapterName}`;
    const sheet = await composeSheet(shots.map((s) => s.blob), shots.map((s) => s.spec.label), info);
    progress(MATERIAL_SET.length, MATERIAL_SET.length);
    return { shots, sheet, stats };
  }
  /** The foliage review set for one specimen (FOLIAGE_SET), with foliage statistics. */
  async foliageReview(id: string, progress: (k: number, n: number) => void = () => {}): Promise<{ shots: { spec: ShotSpec; blob: Blob }[]; sheet: Blob; stats: Record<string, unknown> }> {
    await this.select(id);
    const shots: { spec: ShotSpec; blob: Blob }[] = [];
    let overdraw: Record<string, number> = {};
    const keepF = this.state.foliage, keepW = this.viewer.woodland;
    try {
      for (let k = 0; k < FOLIAGE_SET.length; k++) {
        progress(k, FOLIAGE_SET.length); const s = FOLIAGE_SET[k];
        this.scene.showFoliage = s.foliage !== false; this.viewer.woodland = !!s.woodland;
        shots.push({ spec: s, blob: await this.shoot(s.view as View, s.mode, { light: s.light, lod: s.lod, overdraw: s.file === 'full-day' ? (r) => { overdraw = r; } : undefined }) });
      }
    } finally { this.scene.showFoliage = keepF; this.viewer.woodland = keepW; }
    const e = this.store.get(id), F = e.built!.foliage, st = F.stats, T = this.viewer.folTex;
    const stats = { foliage: st, lods: F.lods.map((l) => ({ instances: l.instances, triangles: l.triangles, bytes: l.sets.reduce((a, s) => a + s.data.byteLength, 0) })), overdrawFullTreeLOD0: overdraw, foliageTextures: T, barkTextures: this.viewer.tex, adapter: this.viewer.adapterName };
    const info = this.sheetInfo(id);
    info.lines = [
      ...info.lines.slice(0, 4),
      ['Shoots (shed in shade)', `${st.shoots.toLocaleString()} (${st.shed.toLocaleString()})`],
      [e.def.foliage.type === 'pine' ? 'Needle fascicles' : 'Leaves', `${st.leaves.toLocaleString()} · ${st.leafArea} m² one side`],
      ['Bearing wood', `${st.bearingLength} m`],
      ['Foliage LOD0/1/2 inst.', F.lods.map((l) => (l.instances / 1000).toFixed(1) + 'k').join(' / ')],
      ['Foliage LOD0/1/2 tris', F.lods.map((l) => (l.triangles / 1000).toFixed(0) + 'k').join(' / ')],
      ['Foliage generation', `${st.ms} ms`],
      ['Overdraw, full tree L0', overdraw.meanFoliage ? `${overdraw.meanFoliage.toFixed(2)} mean · p95 ${overdraw.p95Foliage}` : 'n/a'],
      ['Foliage textures', T ? `${T.layers} × ${T.size}², ${(T.bytes / 1048576).toFixed(1)} MiB GPU` : 'not loaded'],
      ['Draw calls (tree)', `1 bark + ${F.lods[0].sets.length} foliage (L0)`],
      ['Adapter', this.viewer.adapterName],
    ];
    info.footer = `Tree Lab · ${COMMIT} · ${PROTOCOL.width}×${PROTOCOL.height} · lighting per shot · LOD 0 unless marked · full-tree views at common scale · leaves: ambientCG CC0 scans · ${this.viewer.adapterName}`;
    const sheet = await composeSheet(shots.map((s) => s.blob), shots.map((s) => s.spec.label), info);
    progress(FOLIAGE_SET.length, FOLIAGE_SET.length);
    return { shots, sheet, stats };
  }

  /** Foliage study (proof of concept): one specimen's foliage in the three representations (opaque leaf
   *  geometry, shoot cards, hybrid) at close (a single shoot, 0.8 m), medium (a branch, 6 m) and distant (the full
   *  tree at the common frame) range, at matched cameras and daylight; triangles, instances and measured overdraw
   *  per cell. The hybrid draws what the LOD chain would: sprites close and at branch range, shoot cards far. */
  async foliageStudy(id: string, w = 800, h = 600, progress: (k: number, n: number) => void = () => {}): Promise<{ sheet: Blob; shots: { rep: string; range: string; blob: Blob; stats: Record<string, number> }[] }> {
    await this.select(id);
    const C = this.store.get(id).built!.poi.crown!, o = this.subject().offset;
    const leaf: V3 = [o[0] + C.leaf[0], C.leaf[1], o[2] + C.leaf[2]];
    const ranges: [string, ((a: number) => { target: V3; az: number; el: number; dist: number }) | null, number][] = [
      ['close 0.8 m', () => ({ target: leaf, az: C.az + 0.2, el: 0.15, dist: 0.8 }), 0],
      ['medium 6 m', () => ({ target: leaf, az: C.az + 0.2, el: 0.1, dist: 6 }), 0],
      ['distant (full tree)', null, 1],
    ];
    const shots: { rep: string; range: string; blob: Blob; stats: Record<string, number> }[] = [];
    const n = 9; let k = 0;
    for (const rep of ['geometry', 'cards', 'hybrid'] as FoliageRep[]) {
      this.scene.rep = rep;
      for (const [range, orbit, hybLod] of ranges) {
        progress(k++, n);
        const lod = rep === 'hybrid' ? hybLod : 0;
        let st: Record<string, number> = {};
        this.scene.apply(lod);
        const f = this.viewer.draws.find((d) => d.foliage)?.foliage;
        const blob = await this.shoot(orbit ? 'crown' : 'front', 'lit', { width: w, height: h, light: 'day', lod, orbit: orbit ? orbit(w / h) : undefined, overdraw: (r) => { st = r; } });
        shots.push({ rep, range, blob, stats: { ...st, triangles: f?.triangles ?? 0, instances: f?.instances ?? 0, lod } });
      }
    }
    this.scene.rep = 'hybrid'; this.scene.apply(this.state.lod); this.invalidate();
    const e = this.store.get(id);
    const pct = (x: number) => (x * 100).toFixed(1) + ' %';
    const info = {
      title: `Foliage study — ${e.def.name}`,
      subtitle: 'Rows: opaque leaf geometry (outline polygons) · shoot cards · hybrid (alpha-tested leaf sprites near, cards far). Columns: close · medium · distant. Daylight, matched cameras.',
      lines: shots.map((s) => [`${s.rep} · ${s.range.split(' ')[0]}`, `${(s.stats.triangles / 1000).toFixed(0)}k tri · OD ${s.stats.meanFoliage.toFixed(2)} p95 ${s.stats.p95Foliage} · ${pct(s.stats.foliageCoverage)}`] as [string, string]),
      footer: `Tree Lab · ${COMMIT} · ${w}×${h} · overdraw = foliage fragments passing the alpha test per covered pixel, no depth rejection (upper bound, GPU-independent) · ${this.viewer.adapterName}`,
    };
    const sheet = await composeSheet(shots.map((s) => s.blob), shots.map((s) => `${s.rep} · ${s.range}`), info, 600, 450);
    progress(n, n);
    return { sheet, shots };
  }

  /** Offscreen render timings for one specimen (clay vs materials, full tree and trunk close-up, 1200×900). */
  async renderStats(id: string, frames = 3): Promise<Record<string, unknown>> {
    await this.select(id);
    return this.exclusive(() => this.renderStatsNow(id, frames));
  }
  private async renderStatsNow(id: string, frames: number): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    const keep = { mode: this.viewer.mode, light: this.viewer.light };
    this.hold++;
    for (const view of ['three', 'trunk'] as View[]) {
      const r: Record<string, unknown> = {};
      for (const mode of ['clay', 'lit'] as Mode[]) {
        this.viewer.mode = mode; this.viewer.light = LIGHTS.find((l) => l.id === 'day')!; this.scene.apply(0);
        const w = PROTOCOL.width, h = PROTOCOL.height, o = this.orbitFor(view, w / h, true);
        const eye: V3 = [o.target[0] + Math.sin(o.az) * Math.cos(o.el) * o.dist, o.target[1] + Math.sin(o.el) * o.dist, o.target[2] + Math.cos(o.az) * Math.cos(o.el) * o.dist];
        r[mode] = await this.viewer.timeRender(w, h, viewProj(eye, o.target, FOV, w / h, 0.05, 3000), eye, frames);
      }
      out[view === 'three' ? 'full' : 'trunk'] = r;
    }
    this.restoreLook(); this.scene.apply(this.state.lod); this.hold--; this.invalidate();
    out.textures = this.viewer.tex; out.adapter = this.viewer.adapterName; out.timestampQueries = this.viewer.hasTs;
    out.geometryBytesLOD0 = (() => { const L = this.store.get(id).built!.lods[0]; return L.v.byteLength + L.i.byteLength; })();
    return out;
  }
  /** Comparison line-up (true scale): clay + silhouette rows. */
  async comparisonSheet(setId: string, w = 2400, h = 800): Promise<Blob> {
    await this.compare(setId);
    const set = COMPARISONS.find((c) => c.id === setId)!;
    const rows: Blob[] = [];
    rows.push(await this.shoot('front', 'lit', { width: w, height: h, common: false, light: 'day' }));
    const fol = this.state.foliage; this.scene.showFoliage = false;
    try { rows.push(await this.shoot('front', 'lit', { width: w, height: h, common: false, light: 'day' })); } finally { this.scene.showFoliage = fol; }
    rows.push(await this.shoot('front', 'silhouette', { width: w, height: h, common: false }));
    const names = set.members.map((id) => this.store.get(id).def.name).join('   ·   ');
    return composeRows(rows, [`Front · summer foliage, daylight — ${names}`, `Front · leafless, daylight — ${names}`, `Front · silhouette (foliage) — ${names}`], `${set.label} — true relative scale, common ground level`, `Tree Lab · ${COMMIT} · ${LIGHTS.find((l) => l.id === PROTOCOL.light)!.label} · LOD 0 · 5 m ground grid · 1.8 m figures · 10 m ranging pole`, w, h);
  }
  /** Everything as one ZIP: per-specimen shots + sheets + diagnostics, and the comparison sheets. */
  async exportAll(progress: (msg: string) => void = () => {}): Promise<Blob> {
    const files: { name: string; data: Blob | string }[] = [];
    const diag: Record<string, unknown> = {};
    for (const def of SPECIES) {
      const r = await this.review(def.id, (k, n) => progress(`${def.name}: shot ${Math.min(k + 1, n)}/${n}`));
      for (const s of r.shots) files.push({ name: `${def.id}/${def.id}-${s.spec.file}.png`, data: s.blob });
      files.push({ name: `sheets/${def.id}-review.png`, data: r.sheet });
      const m = await this.materialReview(def.id, (k, n) => progress(`${def.name}: material shot ${Math.min(k + 1, n)}/${n}`));
      for (const sh of m.shots) files.push({ name: `${def.id}/materials/${def.id}-${sh.spec.file}.png`, data: sh.blob });
      files.push({ name: `sheets/${def.id}-materials.png`, data: m.sheet });
      const fo = await this.foliageReview(def.id, (k, n) => progress(`${def.name}: foliage shot ${Math.min(k + 1, n)}/${n}`));
      for (const sh of fo.shots) files.push({ name: `${def.id}/foliage/${def.id}-${sh.spec.file}.png`, data: sh.blob });
      files.push({ name: `sheets/${def.id}-foliage.png`, data: fo.sheet });
      diag[def.id] = this.diagnostics(def.id);
    }
    for (const c of COMPARISONS) { progress(`Comparison: ${c.label}`); files.push({ name: `sheets/compare-${c.id}.png`, data: await this.comparisonSheet(c.id) }); }
    files.push({ name: 'diagnostics.json', data: JSON.stringify({ commit: COMMIT, adapter: this.viewer.adapterName, protocol: PROTOCOL, specimens: diag }, null, 2) });
    return zip(files);
  }
  diagnostics(id: string): Record<string, unknown> {
    const e = this.store.get(id); const b = e.built as BuiltSpecimen;
    const { info, ...d } = b.diag;
    return { name: e.def.name, status: e.def.status, seed: e.def.seed, preset: e.def.preset, params: e.def.params, ...d, lods: b.lods.map((l) => ({ triangles: l.tris, vertices: l.verts, bytes: l.v.byteLength + l.i.byteLength, meshMs: Math.round(l.ms) })), info };
  }
}
export { MODES, LIGHTS, COMPARISONS };
