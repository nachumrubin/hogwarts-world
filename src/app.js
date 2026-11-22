// Owns the subsystems and runs the frame loop:
//   input/flight (or benchmark route) → quadtree selection → streaming → floating origin → draw list → render → stats
// Also handles device loss (in-place rebuild from CPU data) and debug keys.

import { WORLD, PRESETS, SUN } from './config.js';
import { cameraBasis, viewProjection, frustumPlanes, boxInFrustum, DEG } from './core/math.js';
import { GpuContext } from './gpu/gpu-context.js';
import { Renderer } from './gpu/renderer.js';
import { TerrainQuadtree } from './terrain/quadtree.js';
import { renderedHeightAt } from './terrain/morph.js';
import { nodeSize, nodeSpacing } from './terrain/chunk-mesher.js';
import { TerrainStreamer } from './world/terrain-streamer.js';
import { FloatingOrigin } from './world/floating-origin.js';
import { Input } from './flight/input.js';
import { FlightModel } from './flight/flight-model.js';
import { DynamicResolution } from './quality/dynamic-resolution.js';
import { Overlay } from './debug/overlay.js';
import { buildRoute } from './debug/route.js';
import { Benchmark, formatResult } from './debug/benchmark.js';
import { VIEWS } from './debug/views.js';
import { gridOf } from './terrain/overview.js';
import { buildLandmarkProxies } from './world/landmark-proxies.ts';
import { WorldMap, Labels } from './debug/world-map.ts';
import { CreatureHost, zoneInfo } from './creatures/host.ts';
import { PlaceholderCreature } from './creatures/placeholder-module.ts';
import { COMMON_WGSL } from './gpu/shaders/common.wgsl.js';
import { buildEcology } from './forest/ecology.ts';
import { ForestRenderer } from './forest/forest-renderer.ts';
import { FOREST_VIEWS, FOREST_ROUTE, toWorldView } from './forest/views.ts';
import { LIGHT_PRESETS } from './forest/presets.ts';

const FOV_Y = 60 * DEG, NEAR = 0.2, EXPOSURE = 0.82;
const DEBUG_MODES = ['normal', 'lod', 'crack'];

export class App {
  constructor({ canvas, overlayEl, statusEl, resultEl, mapEl, labelsEl, options }) {
    this.mapEl = mapEl; this.labelsEl = labelsEl;
    this.canvas = canvas; this.statusEl = statusEl; this.resultEl = resultEl;
    this.opt = options;
    this.presetKey = options.preset;
    this.preset = PRESETS[this.presetKey];
    this.overlay = new Overlay(overlayEl);
    if (!options.hud) this.overlay.toggle();
    this.debugMode = Math.max(0, DEBUG_MODES.indexOf(options.debug));
    this.time = 0; this.last = 0; this.frameIndex = 0; this.paused = false;
    this.losses = 0; this.lossLog = [];
    this.basis = {}; this.planes = new Float32Array(20);
    this.dyn = new DynamicResolution({ maxScale: options.scale || this.preset.renderScale, minScale: this.preset.minScale });
    this.dyn.enabled = options.dynres && !options.scale;
    this.overviewFade = 0; this.overviewRequested = false;
    this.culled = 0; this.drawn = 0; this.inflight = 0; this.skipped = 0;
  }

  async start() {
    this.gpu = new GpuContext(this.canvas);
    await this.gpu.init();
    this.gpu.onLost = (info) => this.recover(info);
    this.renderer = new Renderer(this.gpu, this.preset);
    this.renderer.build();
    const workers = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    // Forest POC: ?forest=A (baseline terrain, no forest), B (basic forest), C (full forest)
    const fm = this.opt.forest;
    this.forestMode = fm;
    this.lightKey = LIGHT_PRESETS[this.opt.light] ? this.opt.light : 'day';
    this.streamer = new TerrainStreamer({ seed: this.opt.seed, poolSlots: this.preset.poolSlots, uploadsPerFrame: this.preset.uploadsPerFrame, workerCount: workers, workerUrl: new URL('./terrain-worker.js', import.meta.url), terrainOptions: { forestPoc: fm === 'C' } });
    this.streamer.attachGpu(this.renderer.terrain);
    const t0 = performance.now();
    this.streamer.bootstrap(2);
    this.bootstrapMs = performance.now() - t0;
    this.gen = this.streamer.mainGen;
    this.tree = new TerrainQuadtree({
      lodFactor: this.preset.lodFactor,
      isResident: (k) => this.streamer.isResident(k),
      boundsOf: (k) => this.streamer.boundsOf(k),
    });
    this.origin = new FloatingOrigin(WORLD.originSnap);
    // Stage C placeholders, railway, viaduct, river water
    const t1 = performance.now();
    if (fm === 'B' || fm === 'C') {
      const tf = performance.now();
      this.eco = buildEcology(this.gen, { basic: fm === 'B' });
      this.forest = new ForestRenderer(this.eco, fm, this.lightKey, { sampleCount: this.preset.msaa, lodScale: this.opt.forestLod || 1, detailSize: this.opt.tex || 1024, shafts: fm === 'C' && this.opt.shafts !== false });
      this.renderer.depthSampleable = fm === 'C';
      if (this.opt.freeze) this.forest.meterEvery = 1;
      this._attachForest();
      this.forestMs = performance.now() - tf;
      console.log('forest POC', JSON.stringify({ ms: Math.round(this.forestMs), build: this.forest.stats.buildMs, eco: this.eco.stats }));
    }
    this.proxies = buildLandmarkProxies(this.gen);
    this.renderer.props.setMeshes(this.proxies.meshes);
    this.renderer.props.setInstances(this.proxies.instances);
    this.proxyMs = performance.now() - t1;
    this.map = new WorldMap(this.mapEl, this.gen);
    this.map.onTeleport = (x, z) => { this.bench = null; this.flight.setMode('broom'); this.flight.place(x, Math.max(this.gen.heightAt(x, z), WORLD.waterLevel) + 60, z, this.flight.yaw, -0.2); };
    this.labels = new Labels(this.labelsEl, this.proxies.labels);
    if (this.opt.labels) this.labels.toggle();
    // creature modules (placeholders until the creature project delivers real ones)
    const self = this;
    const worldQ = {
      heightAt: (x, z) => this.gen.heightAt(x, z), waterLevel: WORLD.waterLevel,
      waterDepthAt: (x, z) => Math.max(0, WORLD.waterLevel - this.gen.heightAt(x, z)),
      forestDepthAt: (x, z) => this.gen.forestDepth(x, z),
      viewerPosition: () => ({ x: self.flight.x, y: self.flight.y, z: self.flight.z }),
    };
    const hooks = {
      get device() { return self.gpu.device; }, colorFormat: 'rgba16float', depthFormat: 'depth32float', sampleCount: this.preset.msaa,
      get frameBuffer() { return self.renderer.frameBuffer; }, commonWGSL: COMMON_WGSL,
      toRender: (p) => ({ x: p.x - this.origin.x, y: p.y, z: p.z - this.origin.z }),
      addDrawCallback: (cb) => { this.renderer.drawCallbacks.push(cb); return () => { const i = this.renderer.drawCallbacks.indexOf(cb); if (i >= 0) this.renderer.drawCallbacks.splice(i, 1); }; },
    };
    this.creatures = new CreatureHost(worldQ, hooks);
    for (const z of this.gen.db.encounterZones) this.creatures.add(z.id, new PlaceholderCreature(z.creature === 'giant-squid' ? 12 : 4), zoneInfo(z, worldQ));
    this.input = new Input(this.canvas);
    this.flight = new FlightModel();
    this.route = buildRoute(this.gen);
    this.bench = null;
    const c = this.opt.cam;
    if (fm) this.route = buildRoute(this.gen, { points: FOREST_ROUTE, step: 0.5, maxSlope: 0.9, smoothWindow: 12 });
    const fv = fm ? toWorldView(FOREST_VIEWS[Math.min(this.opt.view, FOREST_VIEWS.length - 1)]) : null;
    const v = c && c.length === 5 ? { x: c[0], agl: c[1], z: c[2], yaw: c[3], pitch: c[4] } : fv || VIEWS[this.opt.view] || VIEWS[0];
    this.applyView(v);
    if (this.opt.walk || (fm && v.agl < 3 && !this.opt.freeze)) this.flight.setMode('walk');
    if (this.opt.bench) this.startBenchmark(true);
    const sunAz = SUN.azimuthDeg * DEG, sunEl = SUN.elevationDeg * DEG;
    this.sun = [Math.sin(sunAz) * Math.cos(sunEl), Math.sin(sunEl), Math.cos(sunAz) * Math.cos(sunEl)]; // X east, Z north
    if (fm) this.sun = LIGHT_PRESETS[this.lightKey].sun.slice();
    this._resizeCanvas();
    addEventListener('resize', () => this._resizeCanvas());
    window.__app = this;
    requestAnimationFrame((t) => { this.last = t; requestAnimationFrame((tt) => this.frame(tt)); });
  }

  _attachForest() {
    const fr = this.forest, r = this.renderer;
    fr.build(this.gpu.device, r);
    r.terrain.setForest(fr.terrainHook);
    if (!this._forestHooked) {
      this._forestHooked = true;
      r.preSceneCallbacks.push((enc) => fr.recordShadow(enc));
      r.drawCallbacks.push((pass) => fr.record(pass));
      r.postSceneCallbacks.push((enc, rr) => fr.recordShafts(enc, rr));
      r.postSceneCallbacks.push((enc, rr) => fr.recordMeter(enc, rr));
      r.extraStats = fr.stats;
    }
  }

  applyView(v) {
    const g = Math.max(this.gen.heightAt(v.x, v.z), WORLD.waterLevel);
    this.flight.place(v.x, g + v.agl, v.z, v.yaw * DEG, v.pitch * DEG);
  }

  startBenchmark(auto = false) {
    this.bench = new Benchmark(this.route, { duration: this.opt.duration });
    this.bench.auto = auto;
    this.bench.start();
    this.resultEl.hidden = true;
    this._benchScale = this.dyn.enabled;
    this.dyn.enabled = false; // fixed workload while measuring
  }

  _resizeCanvas() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(this.canvas.clientWidth * dpr)), h = Math.max(2, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  groundAt(x, z) {
    const a = this.gen.heightAt(x, z);
    const f = this.flight;
    const r = renderedHeightAt(this.tree, (k) => this.streamer.chunkF32(k), x, z, f.x, f.y, f.z);
    return r > a ? r : a;
  }

  _keys() {
    for (const code of this.input.consumePressed()) {
      if (code === 'F3' || code === 'KeyH') this.overlay.toggle();
      else if (code === 'KeyF') { this.bench = null; this.flight.setMode(this.flight.mode === 'walk' ? 'broom' : 'walk'); }
      else if (code === 'KeyM') this.map.toggleSize();
      else if (code === 'KeyN') this.labels.toggle();
      else if (code === 'KeyV') this.map.toggle();
      else if (code === 'F4' || code === 'KeyL') this.debugMode = (this.debugMode + 1) % DEBUG_MODES.length;
      else if (code === 'KeyB') { if (this.bench && this.bench.active) { this.bench = null; this.dyn.enabled = this._benchScale; } else this.startBenchmark(); }
      else if (code === 'F9') this.gpu.simulateLoss();
      else if (code === 'KeyP') { const keys = Object.keys(PRESETS); const next = keys[(keys.indexOf(this.presetKey) + 1) % keys.length]; const u = new URL(location.href); u.searchParams.set('preset', next); try { localStorage.setItem('highlands.preset', next); } catch {} location.href = u.href; }
      else if (/^Digit[0-9]$/.test(code)) {
        const n = +code.slice(5);
        const v = this.forestMode ? (FOREST_VIEWS[n - 1] ? toWorldView(FOREST_VIEWS[n - 1]) : null) : VIEWS[n === 0 ? 9 : n - 1];
        if (v) { this.bench = null; this.applyView(v); if (this.forestMode && v.agl < 3) this.flight.setMode('walk'); }
      }
      else if (code === 'KeyO' && this.forest) { this.lightKey = this.lightKey === 'day' ? 'overcast' : 'day'; this.forest.setPreset(this.lightKey); this.sun = LIGHT_PRESETS[this.lightKey].sun.slice(); }
      else if (code === 'KeyJ' && this.forest) { this.forest.windOn = !this.forest.windOn; }
    }
  }

  frame(t) {
    requestAnimationFrame((tt) => this.frame(tt));
    if (this.paused) { this.last = t; return; }
    // backpressure: never queue more than two frames on the GPU (keeps latency bounded when GPU-bound)
    if (this.inflight >= 2) { this.skipped++; return; }
    const frameMs = t - this.last; this.last = t;
    const dt = Math.min(frameMs / 1000, 0.1);
    this.time += dt; this.frameIndex++;
    if (this.opt.time !== null && this.opt.time !== undefined) this.time = this.opt.time;
    this._keys();
    const f = this.flight;

    // --- camera
    let roll;
    if (this.bench && this.bench.active) {
      const p = this.bench.step(Math.min(frameMs / 1000, 1)); // route runs on wall time
      f.x = p.x; f.y = p.y; f.z = p.z; f.yaw = p.yaw; f.pitch = p.pitch; roll = p.roll;
      f.groundHeight = this.gen.heightAt(p.x, p.z); f.agl = p.y - f.groundHeight;
      this.input.consumeMouse([0, 0]);
    } else if (this.opt.freeze) {
      roll = 0; this.input.consumeMouse([0, 0]);
    } else {
      f.update(dt, this.input, (x, z) => this.groundAt(x, z));
      roll = f.roll;
    }

    // --- LOD + streaming
    this.tree.select(f.x, f.y, f.z);
    this.streamer.update(this.tree, frameMs);
    if (!this.overviewRequested && (this.streamer.stats.backlog === 0 || this.time > 3)) this._bakeOverview();
    if (this.renderer.overviewData && this.overviewFade < 1) this.overviewFade = Math.min(1, this.overviewFade + dt / 1.2);
    // fixed-camera captures: stream without rendering until the terrain is complete, then render (saves many slow
    // software-rendered frames in headless runs)
    if (this.opt.freeze && !this._settled) {
      if (this.streamer.stats.backlog === 0 && this.streamer.pending.size === 0 && this.renderer.overviewData && this.frameIndex > 2) { this._settled = true; this.overviewFade = 1; this.settledFrames = 0; }
      else return;
    }
    if (this._settled) this.settledFrames++;

    // --- camera matrices, relative to the floating origin
    const o = this.origin; o.update(f.x, f.z);
    const cx = f.x - o.x, cy = f.y, cz = f.z - o.z;
    const r = this.renderer;
    r.resize(this.canvas.width, this.canvas.height, this.dyn.scale);
    const b = cameraBasis(f.yaw, f.pitch, roll, this.basis);
    const F = r.frame;
    viewProjection(b, cx, cy, cz, FOV_Y, r.width / r.height, NEAR, F);
    frustumPlanes(F, this.planes);
    const tanY = Math.tan(FOV_Y / 2);
    F[16] = cx; F[17] = cy; F[18] = cz; F[19] = this.time;
    F[20] = o.x; F[21] = 0; F[22] = o.z; F[23] = WORLD.waterLevel;
    F[24] = this.sun[0]; F[25] = this.sun[1]; F[26] = this.sun[2]; F[27] = SUN.illuminance;
    F[28] = b.rx; F[29] = b.ry; F[30] = b.rz; F[31] = tanY * r.width / r.height;
    F[32] = b.ux; F[33] = b.uy; F[34] = b.uz; F[35] = tanY;
    F[36] = b.fx; F[37] = b.fy; F[38] = b.fz; F[39] = NEAR;
    F[44] = this.tree.morphStart; F[45] = this.debugMode; F[46] = 0; F[47] = this.overviewFade;
    { const g = r.overviewData ? r.overviewData.grid : { x0: -1e6, z0: -1e6, cell: 1, nx: 1, nz: 1 }; F[56] = g.x0; F[57] = g.z0; F[58] = 1 / (g.cell * g.nx); F[59] = 1 / (g.cell * g.nz); }
    F[48] = 2.6; F[49] = EXPOSURE; F[50] = 0.78; F[51] = 0.8;
    let exposure = EXPOSURE;
    if (this.forestMode) {
      const lp = LIGHT_PRESETS[this.lightKey];
      F[46] = lp.overcast; F[48] = lp.haze; F[27] = lp.illuminance;
      // eye adaptation (forest modes): smoothed towards the metered target, ~1 s time constant
      this.adapt = this.adapt || 1;
      if (this.forest || this.forestMode === 'A') { const tgt = this.forest ? this.forest.autoExposure : 1; this.adapt += (tgt - this.adapt) * Math.min(1, (this.opt.freeze ? 1 : dt * 1.5)); }
      exposure = EXPOSURE * lp.exposure * this.adapt;
    }
    F[52] = f.x; F[53] = f.y; F[54] = f.z; F[55] = f.agl;

    // --- draw list (frustum culled)
    const tr = r.terrain;
    tr.beginDraws();
    let culled = 0;
    for (const l of this.tree.leaves) {
      const e = this.streamer.boundsOf(l.key);
      const slot = e ? e.slot : -1;
      if (slot < 0) continue; // cannot happen for a consistent tree; defensive
      const size = nodeSize(l.depth), x0 = WORLD.rootMinX + l.ix * size - o.x, z0 = WORLD.rootMinZ + l.iz * size - o.z;
      if (!boxInFrustum(this.planes, x0, e.minY - 2, z0, x0 + size, e.maxY + 2, z0 + size)) { culled++; continue; }
      tr.addDraw(x0, z0, nodeSpacing(l.depth), slot, this.tree.morphRange(l.depth), l.finer, l.depth, l.coarser);
    }
    this.culled = culled;
    r.props.update(o.x, o.z, this.planes, f.x, f.y, f.z, 9000);
    if (this.forest) this.forest.update(this.time, { x: f.x, y: f.y, z: f.z }, o, this.planes);
    this.creatures.update(dt);
    const stats = r.render(this.time, exposure);
    this.inflight++;
    const dev = this.gpu.device;
    dev.queue.onSubmittedWorkDone().then(() => { if (this.gpu.device === dev) this.inflight--; }, () => {});

    // --- stats
    const gpuMs = this.gpu.gpuMs;
    this.overlay.pushFrame(frameMs);
    if (this.bench) {
      if (this.bench.active) this.bench.record(frameMs, gpuMs, stats, this.streamer.stats.backlog);
      else if (this.bench.done && !this.bench.reported) this._finishBenchmark();
    } else if (this.dyn.update(frameMs, gpuMs)) { /* resize happens next frame */ }
    this.overlay.update(frameMs, () => this._overlayText(stats, frameMs, gpuMs));
    this.labels.update(F, o.x, o.z, this.canvas.clientWidth, this.canvas.clientHeight, f.x, f.z);
    if (this.frameIndex % 2 === 0) this.map.draw({ x: f.x, z: f.z, y: f.y, yaw: f.yaw, agl: f.agl, mode: this.bench && this.bench.active ? 'benchmark' : f.mode });
  }

  _bakeOverview() {
    this.overviewRequested = true;
    const t0 = performance.now();
    this.streamer.bakeOverview(gridOf(WORLD.overview, this.preset.overviewCell), this.sun).then((ov) => {
      this.overviewMs = performance.now() - t0;
      if (this.renderer.device) this.renderer.setOverview(ov); else this.renderer.overviewData = ov;
      this.map.setOverview(ov);
    });
  }

  _finishBenchmark() {
    this.bench.reported = true;
    this.dyn.enabled = this._benchScale;
    const g = this.gpu.adapterInfo;
    const res = this.bench.result({
      preset: this.preset.name, presetKey: this.presetKey, lodFactor: this.preset.lodFactor, msaa: this.preset.msaa,
      resolution: `${this.renderer.width}x${this.renderer.height}`, renderScale: this.dyn.scale,
      canvas: `${this.canvas.width}x${this.canvas.height}`,
      adapter: [g.vendor, g.architecture, g.description].filter(Boolean).join(' / ') || 'unknown',
      timestampQuery: this.gpu.hasTimestamps, userAgent: navigator.userAgent, seed: this.opt.seed,
      chunks: { generated: this.streamer.stats.generated, avgGenMs: +(this.streamer.stats.genMsTotal / Math.max(1, this.streamer.stats.generated)).toFixed(2), maxPending: this.streamer.stats.maxPending, maxBacklog: this.streamer.stats.maxBacklog, evictions: this.streamer.stats.evictions, workers: this.streamer.stats.workers },
      webgpuErrors: this.gpu.errors.length, deviceLosses: this.losses,
    });
    window.__benchResult = res;
    console.log('HIGHLANDS_BENCHMARK ' + JSON.stringify(res));
    this.resultEl.hidden = false;
    this.resultEl.querySelector('pre').textContent = formatResult(res);
    const a = this.resultEl.querySelector('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' }));
    a.download = `highlands-bench-${this.presetKey}-${Date.now()}.json`;
  }

  _overlayText(s, frameMs, gpuMs) {
    const w = this.overlay.windowStats(), f = this.flight, st = this.streamer.stats, r = this.renderer, o = this.origin;
    const head = ((f.yaw / DEG) % 360 + 360) % 360;
    return [
      `FPS ${(1000 / Math.max(w.avg, 0.001)).toFixed(1)}   frame ${frameMs.toFixed(2)} ms  (avg ${w.avg.toFixed(2)}, p95 ${w.p95.toFixed(2)}, max ${w.max.toFixed(1)} over ${this.overlay._n} frames)`,
      `GPU ${this.gpu.hasTimestamps ? gpuMs.toFixed(2) + ' ms' : 'n/a (no timestamp-query)'}`,
      `triangles ${s.triangles.toLocaleString()}   draw calls ${s.drawCalls} (terrain ${s.terrainDraws}, culled ${this.culled}; props ${s.propDraws}, ${r.props.stats.visible}/${r.props.stats.total} instances)`,
      `chunks drawn ${s.terrainDraws}  leaves ${this.tree.leaves.length}  resident ${st.resident}/${this.preset.poolSlots}  cached ${st.cached}  pending ${st.pending}  backlog ${st.backlog}  generated ${st.generated} (avg ${(st.genMsTotal / Math.max(1, st.generated)).toFixed(1)} ms, ${st.workers} workers)`,
      `${f.mode === 'walk' ? 'WALKING' : 'BROOM'}  x ${f.x.toFixed(1)} E  y ${f.y.toFixed(1)}  z ${f.z.toFixed(1)} N (m)   AGL ${f.agl.toFixed(1)} m   speed ${Math.hypot(f.vx, f.vy, f.vz).toFixed(1)} m/s   hdg ${head.toFixed(0)}°  pitch ${(f.pitch / DEG).toFixed(0)}°  bank ${(f.roll / DEG).toFixed(0)}°`,
      `render ${r.width}×${r.height} (scale ${this.dyn.scale.toFixed(2)}${this.dyn.enabled ? ', dynamic' : ''})  ${this.preset.name}  MSAA ${this.preset.msaa}×  LOD factor ${this.preset.lodFactor}  morph ${this.tree.morphStart.toFixed(2)}  origin (${o.x}, ${o.z})`,
      ...(this.forest ? [`forest ${this.forestMode} (${LIGHT_PRESETS[this.lightKey].name}${this.forest.windOn ? '' : ', wind off'})  draws ${this.forest.stats.draws}  tris ${this.forest.stats.triangles.toLocaleString()}  trees LOD0/1/2/imp ${this.forest.stats.lod.join('/')}  cover ${this.forest.stats.cover} in ${this.forest.stats.coverDraws} draws  est. GPU memory ${(this.forest.stats.gpuBytes / 1048576).toFixed(0)} MB`] : this.forestMode ? ['forest A (baseline: no forest)'] : []),
      `debug view: ${DEBUG_MODES[this.debugMode]}   ${this.bench && this.bench.active ? `BENCHMARK ${this.bench.t.toFixed(1)}/${this.bench.duration} s` : ''}${this.losses ? `   device losses recovered: ${this.losses}` : ''}${this.gpu.errors.length ? `   WebGPU errors: ${this.gpu.errors.length}` : ''}`,
    ].join('\n');
  }

  async recover(info) {
    this.paused = true;
    const now = performance.now();
    this.lossLog = this.lossLog.filter((t) => now - t < 60000); this.lossLog.push(now);
    this.statusEl.hidden = false;
    this.statusEl.textContent = `GPU device lost (${info.reason || 'unknown'}${info.simulated ? ', simulated' : ''}). Recovering…`;
    if (this.lossLog.length > 3) { this.statusEl.textContent = 'The GPU device was lost repeatedly. Try a lower preset (P) or reload the page.'; return; }
    try {
      this.renderer.destroy();
      await this.gpu.init();
      this.renderer.build();
      if (this.forest) this._attachForest();
      this.inflight = 0;
      const n = this.streamer.reattach(this.renderer.terrain);
      this.losses++;
      this.statusEl.hidden = true;
      console.log(`Recovered from device loss: re-uploaded ${n} chunks from the CPU cache`);
      this.paused = false;
    } catch (e) {
      this.statusEl.textContent = `Could not recover the GPU device: ${e.message}. Reload the page.`;
    }
  }
}
