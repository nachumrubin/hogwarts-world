// Lab controller: state (specimen or comparison, view, display mode, lighting, LOD), render loop (on demand, or
// continuous in live mode), camera presets, standardized shots and review-sheet export. UI-agnostic: ui.ts binds the
// DOM to it, and the headless capture script drives the same API through window.__lab.
import { Viewer, viewProj, LIGHTS, MODES, type Mode } from '../render/viewer.ts';
import { CameraController, FOV, type Box, type Preset, type V3 } from './camera.ts';
import { SpecimenStore, LabScene, COMPARISONS } from './scene.ts';
import { PerfMonitor } from './perf.ts';
import { REVIEW_SET, MATERIAL_SET, PROTOCOL, composeSheet, composeRows, zip, type ShotSpec, type ShotView } from './capture.ts';
import { SPECIES } from '../species/index.ts';
import type { BuiltSpecimen } from '../build.ts';

declare const __COMMIT__: string;
export const COMMIT = typeof __COMMIT__ === 'string' ? __COMMIT__ : 'dev';

export type View = Preset | 'trunk' | 'junction' | 'broken';
export interface LabState { kind: 'specimen' | 'compare'; specimen: string; compare: string; focus: string | null; mode: Mode; light: string; lod: number; live: boolean; view: View }

export class Lab {
  viewer = new Viewer();
  cam = new CameraController();
  perf = new PerfMonitor();
  store: SpecimenStore;
  scene!: LabScene;
  state: LabState = { kind: 'specimen', specimen: 'oak-a', compare: 'oaks', focus: null, mode: 'lit', light: 'day', lod: 0, live: true, view: 'three' };
  private dirty = true; private last = 0; private busy = false;
  /** > 0 while an offscreen render has the viewer's mode/light switched: no canvas frames then (they would flash it) */
  private hold = 0;
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
    this.scene = new LabScene(this.viewer, this.store);
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
      this.viewer.render(viewProj(eye, target, FOV, this.canvas.width / this.canvas.height, 0.05, 3000), eye);
      this.perf.frame(t, this.viewer.cpuMs, this.viewer.hasTs ? this.viewer.gpuMs : null, this.state.live);
      this.frames++; this.dirty = false; this.onFrame();
    }
    requestAnimationFrame((tt) => this.tick(tt));
  }

  // ---------------------------------------------------------------- state changes
  private async ensure(ids: string[]): Promise<void> {
    const missing = ids.filter((id) => !this.store.get(id).built);
    if (!missing.length) return;
    this.onStatus(`Growing ${missing.map((id) => this.store.get(id).def.name).join(', ')}…`, true);
    await Promise.all(missing.map((id) => this.store.load(id)));
    this.onStatus('', false);
  }
  members(): string[] { return this.state.kind === 'specimen' ? [this.state.specimen] : COMPARISONS.find((c) => c.id === this.state.compare)!.members; }

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
    this.setView(this.state.view === 'trunk' || this.state.view === 'junction' || this.state.view === 'broken' ? 'front' : this.state.view, false); this.onState();
  }
  focus(id: string | null): void { this.state.focus = id; this.setView(this.state.view, true); this.onState(); }
  setMode(m: Mode): void { this.state.mode = m; this.viewer.mode = m; this.invalidate(); this.onState(); }
  setLight(id: string): void {
    const L = LIGHTS.find((l) => l.id === id); if (!L) return;
    this.state.light = id; this.viewer.light = L; if (this.viewer.draws.length) this.scene.apply(this.state.lod); this.invalidate(); this.onState();
  }
  setLod(k: number): void { this.state.lod = k; if (this.viewer.draws.length) this.scene.apply(k); this.invalidate(); this.onState(); }
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
    if (view === 'broken' && built.poi.broken) {
      const b = built.poi.broken;
      return { target: [s.offset[0] + b.p[0], b.p[1], s.offset[2] + b.p[2]], az: b.az, el: b.el, dist: b.dist };
    }
    if (view === 'trunk' || view === 'junction' || view === 'broken') {
      const p = built.poi;
      if (view === 'trunk') return { target: [s.offset[0], p.trunkY, s.offset[2]], az: p.trunkAz, el: 0.08, dist: p.trunkDist };
      return { target: [s.offset[0] + p.junction[0], p.junction[1], s.offset[2] + p.junction[2]], az: p.junctionAz, el: p.junctionEl, dist: p.junctionDist };
    }
    let box: Box = this.state.kind === 'compare' && !this.state.focus ? this.scene.box : s.box;
    if (common && view !== 'top' && !(this.state.kind === 'compare' && !this.state.focus)) {
      const cx = (s.box.min[0] + s.box.max[0]) / 2, cz = (s.box.min[2] + s.box.max[2]) / 2, F = PROTOCOL.commonFrame;
      box = { min: [cx - F.width / 2, 0, cz - F.width / 2], max: [cx + F.width / 2, F.height, cz + F.width / 2] };
      // the frame (F.width × F.height) is measured in the plane through the tree's centre, not at the box's face
      // the same distance for every specimen (common scale); framing() already allows for the frame's depth
      return CameraController.framing(box, view, aspect, 1.0);
    }
    return CameraController.framing({ min: [box.min[0], Math.min(0, box.min[1]), box.min[2]], max: box.max }, view, aspect);
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
  async shoot(view: View, mode: Mode, opts: { width?: number; height?: number; light?: string; lod?: number; common?: boolean } = {}): Promise<Blob> {
    const w = opts.width ?? PROTOCOL.width, h = opts.height ?? PROTOCOL.height;
    const keep = { mode: this.viewer.mode, light: this.viewer.light, lod: this.state.lod };
    this.hold++;
    this.viewer.mode = mode;
    this.viewer.light = LIGHTS.find((l) => l.id === (opts.light ?? PROTOCOL.light)) ?? keep.light;
    const lod = opts.lod ?? PROTOCOL.lod;
    this.scene.apply(lod);
    const o = this.orbitFor(view, w / h, opts.common ?? true);
    const eye: V3 = [o.target[0] + Math.sin(o.az) * Math.cos(o.el) * o.dist, o.target[1] + Math.sin(o.el) * o.dist, o.target[2] + Math.cos(o.az) * Math.cos(o.el) * o.dist];
    try {
      return await this.viewer.renderImage(w, h, viewProj(eye, o.target, FOV, w / h, 0.05, 3000), eye);
    } finally {
      this.restoreLook(); this.scene.apply(keep.lod); this.hold--; this.invalidate();
    }
  }
  /** Small clay portrait of one specimen for the library (its own draw list; the scene is restored after). */
  async thumbnail(id: string, w = 360, h = 270): Promise<Blob> {
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
    for (let k = 0; k < REVIEW_SET.length; k++) { progress(k, REVIEW_SET.length); const s = REVIEW_SET[k]; shots.push({ spec: s, blob: await this.shoot(s.view as ShotView as View, s.mode) }); }
    progress(REVIEW_SET.length, REVIEW_SET.length);
    const sheet = await composeSheet(shots.map((s) => s.blob), shots.map((s) => s.spec.label), this.sheetInfo(id));
    return { shots, sheet };
  }
  /** The bark/material review set for one specimen (MATERIAL_SET), with texture and render-time statistics. */
  async materialReview(id: string, progress: (k: number, n: number) => void = () => {}): Promise<{ shots: { spec: ShotSpec; blob: Blob }[]; sheet: Blob; stats: Record<string, unknown> }> {
    await this.select(id);
    const shots: { spec: ShotSpec; blob: Blob }[] = [];
    for (let k = 0; k < MATERIAL_SET.length; k++) {
      progress(k, MATERIAL_SET.length); const s = MATERIAL_SET[k];
      shots.push({ spec: s, blob: await this.shoot(s.view as View, s.mode, { light: s.light, lod: s.lod }) });
    }
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
  /** Offscreen render timings for one specimen (clay vs materials, full tree and trunk close-up, 1200×900). */
  async renderStats(id: string, frames = 3): Promise<Record<string, unknown>> {
    await this.select(id);
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
    for (const m of ['clay', 'silhouette'] as Mode[]) rows.push(await this.shoot('front', m, { width: w, height: h, common: false }));
    const names = set.members.map((id) => this.store.get(id).def.name).join('   ·   ');
    return composeRows(rows, [`Front · materials, daylight — ${names}`, `Front · clay — ${names}`, `Front · silhouette — ${names}`], `${set.label} — true relative scale, common ground level`, `Tree Lab · ${COMMIT} · ${LIGHTS.find((l) => l.id === PROTOCOL.light)!.label} · LOD 0 · 5 m ground grid · 1.8 m figures · 10 m ranging pole`, w, h);
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
