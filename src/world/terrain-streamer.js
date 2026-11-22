// Terrain streaming: turns quadtree requests into generated chunks (worker pool), keeps a CPU cache of every
// generated chunk, assigns GPU pool slots, uploads within a per-frame budget and evicts least-recently-used slots.
//
// A node is "resident" once its data is in a GPU slot; only resident nodes may be drawn (the quadtree enforces it).
// The CPU cache outlives GPU residency, so evicted chunks come back without regeneration, and after a device loss
// everything is re-uploaded from it.

import { nodeKey, keyDepth, keyIx, keyIz } from '../terrain/quadtree.js';
import { WorldTerrain } from '../world/world-terrain.ts';
import { buildChunk } from '../terrain/chunk-mesher.js';
import { shadeOverview, sampleHeights, sampleMaterials } from '../terrain/overview.js';

export class TerrainStreamer {
  constructor({ seed, poolSlots, uploadsPerFrame, workerCount, workerUrl }) {
    this.workerUrl = workerUrl;
    this.seed = seed;
    this.poolSlots = poolSlots;
    this.uploadsPerFrame = uploadsPerFrame;
    this.cache = new Map(); // key → { buffer, f32, minY, maxY, slot, used }
    this.pending = new Map(); // key → worker index
    this.freeSlots = [];
    for (let i = poolSlots - 1; i >= 0; i--) this.freeSlots.push(i);
    this.slotOwner = new Int32Array(poolSlots).fill(-1);
    this.slotKey = new Float64Array(poolSlots);
    this.frame = 0;
    this.gpu = null; // TerrainRenderer
    this.stats = { generated: 0, genMsTotal: 0, uploadsThisFrame: 0, evictions: 0, pending: 0, backlog: 0, maxBacklog: 0, resident: 0, cached: 0, maxPending: 0, workers: 0 };
    this.cpuLimit = poolSlots * 3;
    this.workers = [];
    this.mainGen = new WorldTerrain();
    this._startWorkers(workerCount);
  }

  _startWorkers(n) {
    for (let i = 0; i < n; i++) {
      try {
        const w = new Worker(this.workerUrl, { type: 'module' });
        w.onmessage = (e) => this._onMessage(i, e.data);
        w.onerror = (e) => { console.error('terrain worker error', e.message || e); };
        this.workers.push({ w, inflight: 0 });
      } catch (err) {
        console.warn('Module workers unavailable, generating on the main thread', err);
        break;
      }
    }
    this.stats.workers = this.workers.length;
  }

  attachGpu(terrainRenderer) { this.gpu = terrainRenderer; }

  isResident(key) { const e = this.cache.get(key); return !!e && e.slot >= 0; }
  boundsOf(key) { return this.cache.get(key) || null; }
  chunkF32(key) { const e = this.cache.get(key); return e ? e.f32 : null; }
  slotOf(key) { const e = this.cache.get(key); return e ? e.slot : -1; }

  /** Generate the coarse levels synchronously so the very first frame already covers the whole world. */
  bootstrap(maxDepth = 2) {
    for (let d = 0; d <= maxDepth; d++) {
      const n = 2 ** d;
      for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
        const c = buildChunk(this.mainGen, d, ix, iz);
        this._store(nodeKey(d, ix, iz), c.buffer, c.minY, c.maxY, 0);
      }
    }
    for (const [k] of this.cache) this._upload(k, true);
  }

  _store(key, buffer, minY, maxY, ms) {
    this.cache.set(key, { buffer, f32: new Float32Array(buffer), minY, maxY, slot: -1, used: this.frame, pinned: keyDepth(key) <= 2 });
    this.stats.generated++; this.stats.genMsTotal += ms;
  }

  _onMessage(wi, m) {
    if (m.type === 'chunk') {
      this.workers[wi].inflight--;
      this.pending.delete(m.key);
      if (!this.cache.has(m.key)) this._store(m.key, m.buffer, m.minY, m.maxY, m.ms);
      this._pump(); // refill workers immediately: throughput must not depend on the frame rate
    } else if (this._overviewJob) this._overviewJob(m);
  }

  /**
   * Per frame, after quadtree selection: refresh LRU stamps, upload arrived chunks the tree wants, dispatch new jobs.
   * @param {import('../terrain/quadtree.js').TerrainQuadtree} tree
   */
  update(tree, frameMs = 16.7) {
    this.frame++;
    const f = this.frame;
    for (const l of tree.leaves) { const e = this.cache.get(l.key); if (e) e.used = f; }
    for (const k of tree.internal) { const e = this.cache.get(k); if (e) e.used = f; }

    // sort wanted nodes by priority
    const req = this._req || (this._req = []);
    req.length = 0;
    for (const [k, p] of tree.requests) req.push(k, p);
    const order = this._order || (this._order = []);
    order.length = 0;
    for (let i = 0; i < req.length; i += 2) order.push(i);
    order.sort((a, b) => req[a + 1] - req[b + 1]);

    let uploads = 0, backlog = 0;
    // upload budget scales with frame time so slow frames do not throttle streaming
    const budget = Math.round(this.uploadsPerFrame * Math.min(8, Math.max(1, frameMs / 16.7)));
    const queue = this._queue || (this._queue = []);
    queue.length = 0;
    for (const i of order) {
      const k = req[i], e = this.cache.get(k);
      if (req[i + 1] < 1000 && !(e && e.slot >= 0)) backlog++;
      if (e) {
        e.used = f;
        if (e.slot < 0 && uploads < budget && this._upload(k)) uploads++;
      } else if (!this.pending.has(k)) {
        if (this.workers.length) queue.push(k);
        else if (uploads < this.uploadsPerFrame) { // no workers: small main-thread budget
          const c = buildChunk(this.mainGen, keyDepth(k), keyIx(k), keyIz(k));
          this._store(k, c.buffer, c.minY, c.maxY, 0); this._upload(k); uploads++;
        }
      }
    }
    queue.reverse(); // highest priority last, for pop()
    this._pump();
    this.stats.backlog = backlog;
    this.stats.uploadsThisFrame = uploads;
    this._trimCpu();
    this.stats.pending = this.pending.size;
    this.stats.maxPending = Math.max(this.stats.maxPending, this.pending.size);
    this.stats.maxBacklog = Math.max(this.stats.maxBacklog, this.stats.backlog);
    this.stats.cached = this.cache.size;
    this.stats.resident = this.poolSlots - this.freeSlots.length;
  }

  /** Hand queued requests (highest priority first) to idle workers. */
  _pump() {
    const q = this._queue;
    if (!q) return;
    while (q.length) {
      const k = q[q.length - 1];
      if (this.cache.has(k) || this.pending.has(k)) { q.pop(); continue; }
      if (!this._dispatch(k)) break;
      q.pop();
    }
  }

  _dispatch(key) {
    let best = null;
    for (const w of this.workers) if (w.inflight < 3 && (!best || w.inflight < best.inflight)) best = w;
    if (!best) return false;
    best.inflight++;
    this.pending.set(key, 1);
    best.w.postMessage({ type: 'chunk', key, depth: keyDepth(key), ix: keyIx(key), iz: keyIz(key) });
    return true;
  }

  _upload(key, force = false) {
    const e = this.cache.get(key);
    if (!e || e.slot >= 0 || !this.gpu) return false;
    let slot = this.freeSlots.pop();
    if (slot === undefined) slot = this._evict();
    if (slot === undefined) return false;
    e.slot = slot; this.slotOwner[slot] = 1; this.slotKey[slot] = key;
    this.gpu.upload(slot, e.buffer);
    return true;
  }

  _evict() {
    let victim = -1, oldest = Infinity;
    for (let s = 0; s < this.poolSlots; s++) {
      const e = this.cache.get(this.slotKey[s]);
      if (!e || e.pinned || e.used >= this.frame) continue;
      if (e.used < oldest) { oldest = e.used; victim = s; }
    }
    if (victim < 0) return undefined;
    this.cache.get(this.slotKey[victim]).slot = -1;
    this.stats.evictions++;
    return victim;
  }

  _trimCpu() {
    if (this.cache.size <= this.cpuLimit) return;
    const list = [];
    for (const [k, e] of this.cache) if (e.slot < 0 && !e.pinned) list.push([e.used, k]);
    list.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < list.length && this.cache.size > this.cpuLimit * 0.9; i++) this.cache.delete(list[i][1]);
  }

  /** After a device loss: forget all slot assignments, re-upload the most recently used chunks into the new pool. */
  reattach(terrainRenderer) {
    this.gpu = terrainRenderer;
    this.freeSlots.length = 0;
    for (let i = this.poolSlots - 1; i >= 0; i--) this.freeSlots.push(i);
    const list = [...this.cache.entries()].sort((a, b) => (b[1].pinned - a[1].pinned) || (b[1].used - a[1].used));
    for (const [, e] of list) e.slot = -1;
    let n = 0;
    for (const [k] of list) { if (n >= this.poolSlots) break; if (this._upload(k)) n++; }
    return n;
  }

  /**
   * Bake the overview maps over grid g: heights and materials split across workers, shading on one worker.
   * Resolves with {grid, data (rgba16f), materials (rgba8)}.
   */
  bakeOverview(g, sun) {
    return new Promise((resolve) => {
      const id = Math.random();
      const n = g.nx * g.nz, heights = new Float32Array(n), mats = new Uint8Array(n * 4), paved = new Uint8Array(n);
      if (!this.workers.length) {
        heights.set(sampleHeights(this.mainGen, g));
        const m = sampleMaterials(this.mainGen, g, heights, 0, g.nz);
        resolve({ grid: g, data: shadeOverview(heights, g, sun, m.paved), materials: m.rgba });
        return;
      }
      const parts = this.workers.length, rows = (p) => [Math.floor(g.nz * p / parts), Math.floor(g.nz * (p + 1) / parts)];
      let doneH = 0, doneM = 0;
      this._overviewJob = (m) => {
        if (m.id !== id) return;
        if (m.type === 'heights') {
          heights.set(m.data, m.rowStart * g.nx);
          if (++doneH === parts) for (let p = 0; p < parts; p++) { const [r0, r1] = rows(p); this.workers[p].w.postMessage({ type: 'materials', id, grid: g, heights, rowStart: r0, rowEnd: r1 }); }
        } else if (m.type === 'materials') {
          mats.set(m.rgba, m.rowStart * g.nx * 4); paved.set(m.paved, m.rowStart * g.nx);
          if (++doneM === parts) this.workers[0].w.postMessage({ type: 'shade', id, heights, grid: g, sun, paved });
        } else if (m.type === 'shade') {
          this._overviewJob = null;
          resolve({ grid: g, data: m.data, materials: mats, heights });
        }
      };
      for (let p = 0; p < parts; p++) { const [r0, r1] = rows(p); this.workers[p].w.postMessage({ type: 'heights', id, grid: g, rowStart: r0, rowEnd: r1 }); }
    });
  }

  dispose() { for (const w of this.workers) w.w.terminate(); this.workers.length = 0; }
}
