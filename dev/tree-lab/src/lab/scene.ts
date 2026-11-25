// Lab scene: specimen store (generation in a worker, GPU upload per LOD on demand), layouts (one specimen or a
// comparison line-up at true scale on a common ground level), ground with a 5 m grid, 1.8 m figure and 10 m ranging
// pole as scale references.
import { MeshOut } from '../framework/mesher.ts';
import { groundAt } from '../framework/math.ts';
import { SPECIES, type SpeciesDef } from '../species/index.ts';
import type { BuiltSpecimen } from '../build.ts';
import { cacheGet, cachePut } from './meshcache.ts';
import { type Viewer, type GpuMesh, type Draw, KIND, MAT } from '../render/viewer.ts';
import type { Box, V3 } from './camera.ts';

export interface Comparison { id: string; label: string; members: string[] }
export const COMPARISONS: Comparison[] = [
  { id: 'all', label: 'All five specimens', members: ['oak-a', 'oak-b', 'oak-c', 'pine', 'birch'] },
  { id: 'oaks', label: 'The three oaks', members: ['oak-a', 'oak-b', 'oak-c'] },
  { id: 'a-b', label: 'Oak A vs Oak B', members: ['oak-a', 'oak-b'] },
  { id: 'b-c', label: 'Oak B vs Oak C', members: ['oak-b', 'oak-c'] },
  { id: 'pine-birch', label: 'Pine vs birch', members: ['pine', 'birch'] },
];

export interface Entry { def: SpeciesDef; built?: BuiltSpecimen; gpu: (GpuMesh | null)[]; pending?: Promise<BuiltSpecimen>; error?: string; fromCache?: boolean }
export interface Placed { id: string; offset: V3; box: Box }

/** Spawns generation workers (at most `parallel` at once) and caches results. */
export class SpecimenStore {
  entries = new Map<string, Entry>();
  private queue: (() => void)[] = []; private running = 0; private job = 0;
  onBuilt: (id: string) => void = () => {};
  private workerUrl: string | URL; private parallel: number;
  private commit: string;
  constructor(workerUrl: string | URL, parallel = 2, commit = 'dev') {
    this.workerUrl = workerUrl; this.parallel = parallel; this.commit = commit;
    for (const def of SPECIES) this.entries.set(def.id, { def, gpu: [null, null, null] }); }
  get(id: string): Entry { const e = this.entries.get(id); if (!e) throw new Error(`unknown specimen ${id}`); return e; }
  load(id: string): Promise<BuiltSpecimen> {
    const e = this.get(id);
    if (e.built) return Promise.resolve(e.built);
    if (e.pending) return e.pending;
    e.pending = new Promise<BuiltSpecimen>((resolve, reject) => {
      const run = () => {
        this.running++;
        // a specimen built earlier by this same build (commit) comes from the persistent cache
        cacheGet(this.commit, id).then((hit) => {
          if (hit) { this.running--; this.next(); e.built = hit; e.fromCache = true; resolve(hit); this.onBuilt(id); return; }
          this.running--; spawn();
        });
      };
      const spawn = () => {
        this.running++;
        const w = new Worker(this.workerUrl, { type: 'module' });
        const job = ++this.job;
        w.onmessage = (m) => {
          w.terminate(); this.running--; this.next();
          if (m.data.job !== job) return;
          if (m.data.ok) { e.built = m.data.built; resolve(e.built!); this.onBuilt(id); cachePut(this.commit, id, m.data.built).catch(() => {}); } else { e.error = m.data.error; reject(new Error(m.data.error)); }
        };
        w.onerror = (err) => { w.terminate(); this.running--; this.next(); e.error = err.message; reject(new Error(err.message || 'worker failed')); };
        w.postMessage({ id, job });
      };
      if (this.running < this.parallel) run(); else this.queue.push(run);
    });
    return e.pending;
  }
  private next(): void { const f = this.queue.shift(); if (f) f(); }
  gpu(viewer: Viewer, id: string, lod: number): GpuMesh {
    const e = this.get(id);
    if (!e.built) throw new Error(`${id} not built`);
    if (!e.gpu[lod]) { const L = e.built.lods[lod]; e.gpu[lod] = viewer.upload(L.v, L.i); }
    return e.gpu[lod]!;
  }
}

/** Ground: flat common level, with each specimen's own micro-relief (that its roots follow) near its trunk. */
export function groundMesh(box: Box, trees: Placed[]): { v: Float32Array; i: Uint32Array } {
  const o = new MeshOut(), s = 0.5;
  const x0 = Math.floor(box.min[0]), z0 = Math.floor(box.min[2]);
  const nx = Math.ceil((box.max[0] - x0) / s), nz = Math.ceil((box.max[2] - z0) / s);
  const h = (x: number, z: number) => {
    let y = 0, wsum = 0;
    for (const t of trees) {
      const dx = x - t.offset[0], dz = z - t.offset[2], d = Math.hypot(dx, dz);
      const w = 1 - Math.min(1, Math.max(0, (d - 7) / 6)); if (w <= 0) continue;
      const ww = w * w * (3 - 2 * w); y += groundAt(dx, dz) * ww; wsum = Math.max(wsum, ww);
    }
    return y;
  };
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + i * s, z = z0 + j * s, e = 0.25;
    const y = h(x, z), nxv = h(x - e, z) - h(x + e, z), nzv = h(x, z - e) - h(x, z + e), l = Math.hypot(nxv, 2 * e, nzv);
    o.vert([x, y, z], [nxv / l, (2 * e) / l, nzv / l], 0, 0, 0, 0);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i; o.tri(a, a + nx + 1, a + 1); o.tri(a + 1, a + nx + 1, a + nx + 2); }
  return { v: new Float32Array(o.v), i: new Uint32Array(o.i) };
}

function capsule(o: MeshOut, a: V3, b: V3, r: number, S = 14, RN = 10): void {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]);
  const ax = [d[0] / L, d[1] / L, d[2] / L];
  const p = Math.abs(ax[1]) < 0.9 ? [ax[2], 0, -ax[0]] : [1, 0, 0]; const pl = Math.hypot(p[0], p[1], p[2]); const N = [p[0] / pl, p[1] / pl, p[2] / pl];
  const B = [ax[1] * N[2] - ax[2] * N[1], ax[2] * N[0] - ax[0] * N[2], ax[0] * N[1] - ax[1] * N[0]];
  const rings: number[][] = [];
  for (let k = 0; k <= RN; k++) {
    const th = (k / RN) * Math.PI, along = -Math.cos(th) * r, rr = Math.sin(th) * r, t = k <= RN / 2 ? 0 : 1;
    const c = [a[0] + d[0] * t + ax[0] * along, a[1] + d[1] * t + ax[1] * along, a[2] + d[2] * t + ax[2] * along];
    const ring: number[] = [];
    for (let s = 0; s <= S; s++) {
      const ph = (s / S) * Math.PI * 2, cs = Math.cos(ph), sn = Math.sin(ph);
      const dir: V3 = [(N[0] * cs + B[0] * sn) * Math.sin(th) - ax[0] * Math.cos(th), (N[1] * cs + B[1] * sn) * Math.sin(th) - ax[1] * Math.cos(th), (N[2] * cs + B[2] * sn) * Math.sin(th) - ax[2] * Math.cos(th)];
      ring.push(o.vert([c[0] + (N[0] * cs + B[0] * sn) * rr, c[1] + (N[1] * cs + B[1] * sn) * rr, c[2] + (N[2] * cs + B[2] * sn) * rr], dir, 0, 0, 0, 0));
    }
    rings.push(ring);
  }
  for (let k = 0; k < RN; k++) for (let s = 0; s < S; s++) { o.tri(rings[k][s], rings[k + 1][s], rings[k][s + 1]); o.tri(rings[k][s + 1], rings[k + 1][s], rings[k + 1][s + 1]); }
}

/** A 1.8 m standing figure at the origin (scale reference). */
export function figureMesh(): { v: Float32Array; i: Uint32Array } {
  const o = new MeshOut();
  capsule(o, [-0.1, 0.08, 0], [-0.1, 0.85, 0], 0.075); capsule(o, [0.1, 0.08, 0], [0.1, 0.85, 0], 0.075);
  capsule(o, [0, 0.95, 0], [0, 1.42, 0], 0.17); capsule(o, [-0.24, 1.42, 0], [-0.28, 0.85, 0.05], 0.05); capsule(o, [0.24, 1.42, 0], [0.28, 0.85, 0.05], 0.05);
  capsule(o, [0, 1.62, 0], [0, 1.68, 0], 0.11);
  return { v: new Float32Array(o.v), i: new Uint32Array(o.i) };
}
/** A 10 m ranging pole (red/white 1 m bands, black every 5 m: drawn by the shader from world height). */
export function poleMesh(): { v: Float32Array; i: Uint32Array } {
  const o = new MeshOut(); capsule(o, [0, 0, 0], [0, 10, 0], 0.05, 10, 4);
  return { v: new Float32Array(o.v), i: new Uint32Array(o.i) };
}

/** Lay specimens out left to right, crowns not overlapping, at true scale; centred on the origin. */
export function layout(store: SpecimenStore, ids: string[], gap = 6): Placed[] {
  const out: Placed[] = []; let cursor = 0;
  for (const id of ids) {
    const b = store.get(id).built!.bounds;
    const x = cursor - b.min[0];
    out.push({ id, offset: [x, 0, 0], box: { min: [b.min[0] + x, b.min[1], b.min[2]], max: [b.max[0] + x, b.max[1], b.max[2]] } });
    cursor = x + b.max[0] + gap;
  }
  const shift = (out[0].box.min[0] + out[out.length - 1].box.max[0]) / 2;
  for (const p of out) { p.offset[0] -= shift; p.box.min[0] -= shift; p.box.max[0] -= shift; }
  return out;
}

export function unionBox(boxes: Box[]): Box {
  const min: V3 = [1e9, 1e9, 1e9], max: V3 = [-1e9, -1e9, -1e9];
  for (const b of boxes) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], b.min[k]); max[k] = Math.max(max[k], b.max[k]); }
  return { min, max };
}

/** GPU scene for a set of placed specimens: trees, ground, a figure beside each tree and one ranging pole. */
export class LabScene {
  placed: Placed[] = [];
  box: Box = { min: [-10, 0, -10], max: [10, 20, 10] };
  private ground: GpuMesh | null = null; private figure: GpuMesh | null = null; private pole: GpuMesh | null = null;
  private viewer: Viewer; private store: SpecimenStore;
  constructor(viewer: Viewer, store: SpecimenStore) { this.viewer = viewer; this.store = store; }
  set(ids: string[], lod: number): void {
    this.placed = layout(this.store, ids);
    this.box = unionBox(this.placed.map((p) => p.box));
    const pad = 12;
    const gbox: Box = { min: [this.box.min[0] - pad, 0, this.box.min[2] - pad], max: [this.box.max[0] + pad, 0, this.box.max[2] + pad] };
    if (this.ground) this.viewer.destroy(this.ground);
    const g = groundMesh(gbox, this.placed); this.ground = this.viewer.upload(g.v, g.i);
    if (!this.figure) { const f = figureMesh(); this.figure = this.viewer.upload(f.v, f.i); }
    if (!this.pole) { const p = poleMesh(); this.pole = this.viewer.upload(p.v, p.i); }
    this.apply(lod);
  }
  apply(lod: number): void {
    const draws: Draw[] = [{ mesh: this.ground!, offset: [0, 0, 0], kind: KIND.ground }];
    for (const p of this.placed) {
      draws.push({ mesh: this.store.gpu(this.viewer, p.id, lod), offset: p.offset, kind: KIND.tree, mat: MAT[this.store.get(p.id).def.material] });
      const def = this.store.get(p.id).def, fz = def.figure ?? [def.crownR * 0.25 + 3, 2.5];
      const fx = p.offset[0] + fz[0], fzz = p.offset[2] + fz[1];
      draws.push({ mesh: this.figure!, offset: [fx, groundAt(fz[0], fz[1]), fzz], kind: KIND.figure });
    }
    const first = this.placed[0], fdef = this.store.get(first.id).def, ff = fdef.figure ?? [4, 2.5];
    draws.push({ mesh: this.pole!, offset: [first.offset[0] + ff[0] + 1.2, -0.05, first.offset[2] + ff[1] + 0.4], kind: KIND.pole });
    this.viewer.setDraws(draws);
    this.viewer.fitShadow([this.box.min[0] - 6, -1, this.box.min[2] - 6], [this.box.max[0] + 6, this.box.max[1] + 1, this.box.max[2] + 6]);
  }
}
