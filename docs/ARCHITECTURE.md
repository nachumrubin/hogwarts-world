# Highlands prototype — reference analysis and architecture plan

## 1. Reference repository: Abyssal Garden

- Source: https://github.com/Noniv/abyssal-garden (inspected at commit `a596354e`, 2026‑11‑14)
- License: **MIT**, © 2026 Maksymilian Dendura. Verified from the repository's `LICENSE` file. The
  full notice is kept in [`/NOTICE.md`](../NOTICE.md); every file here that adapts reference code says so in its header.

### What it is

A bounded (≈384 m × 384 m × 60 m) underwater scene in a single 96 kB HTML file. Seven source files
(`quality.js`, `math.js`, `shaders.js`, `world.js`, `main.js`, `audio.js`, `dev.js`, ≈3,200 lines) are
**concatenated into one async closure** that shares globals (`F`, `UB`, `LV`, `W`, `H` …) across files, then minified by esbuild.

Pipeline: a WGSL compute shader evaluates a voxel density field (512×80×512) once at load; the result is
read back to the CPU, meshed with naive surface nets into one static mesh, decorated with millions of
instanced props, and drawn with CPU cell culling (16×16 grid) and distance cut-offs. Rendering is HDR,
4× MSAA, reverse‑Z, a baked shadow map, light shafts, bloom and a tonemapping composite.

### Component verdicts

| Area | In Abyssal Garden | Verdict for Highlands |
|---|---|---|
| WebGPU init (`main.js` 19–34) | adapter/device request, timestamp feature, `uncapturederror` logging | **Reuse the pattern, rewrite as a module** (`src/gpu/gpu-context.js`). Add in-place device recovery instead of `location.reload()`. |
| Device loss | reloads the page one quality level lower | **Rewrite**: we keep CPU copies of all chunk data, so the renderer is rebuilt and re-uploaded without a reload. Keep the "drop a level after repeated loss" idea. |
| Unsupported browser | throws a message into the loading screen | **Reuse idea**, own UI panel. |
| Reverse‑Z infinite projection (`render()` 431–435, depth `greater`, clear 0) | yes | **Reuse** (adapted in `src/core/math.js`). Essential for 0.2 m near plane and 8 km view. |
| Camera‑relative precision | camera position written into the view matrix in f32; fine for 384 m | **Rewrite**: floating origin snapped to a power-of-two grid (see §3.4). |
| Procedural terrain (GPU density + readback + surface nets) | one static mesh, bounded, no LOD | **Discard** for terrain. Volumetric caves are not needed for a heightfield highland and the approach cannot stream. Surface nets may return later for overhangs/castle rock. |
| Noise (`math.js` `ihash`, `vnoise`, `fbm`; WGSL `h31`, `vn`, `fbm`) | value noise, JS and WGSL copies | **Rewrite** CPU noise (seeded, derivative value noise, no transcendental functions → cross-engine deterministic). **Reuse** the WGSL `h31` hash for shader-side detail noise. |
| Seeded RNG (`rnd`, mulberry32) | global mutable seed | **Rewrite** as pure functions of `(seed, coords)`; no global stream, so generation order cannot change results. |
| Procedural meshes (lathe, coral, ship, fish) | load-time builders | **Discard** for now (no props in this milestone). |
| Shaders (water fog, caustics, kelp, god rays) | underwater look | **Discard**. New sky/aerial-perspective model. Keep the HDR → tonemap structure and dithering. |
| Bloom / Karis-weighted downsample (`W_BLIT`) | good quality | **Defer** (not needed for the first slice; easy to port later). |
| Camera controls | WASD swim, two-stage low-pass mouse look, velocity smoothing `1-exp(-k dt)` | **Reuse** the frame-rate-independent smoothing; **rewrite** as a flight model with banking. |
| Collision (SDF bricks around the voxel grid) | volumetric | **Discard**; heightfield + rendered-surface query instead. |
| Adaptive quality (`frame()` 536–552) | GPU-timestamp-driven dynamic resolution, then draw distance | **Reuse the controller logic** (rewritten as `src/quality/dynamic-resolution.js`). |
| Quality presets (`quality.js`) | Low/Medium/High, crash detection via `localStorage` | **Reuse the idea**, explicit preset table. |
| Timestamp queries (`main.js` 373–388) | ring of 6 map buffers | **Reuse** (adapted). |
| Benchmark (`dev.js`, `FLY`, arc-length LUT) | Catmull-Rom path, constant speed, avg/p99/max | **Reuse** the arc-length spline approach; extend to p50/p90/p95/p99, hitch count, JSON export, automation hook. |
| Zero per-frame allocation discipline | preallocated `Float64Array F` | **Keep** as a rule for the frame loop (instance buffer, draw lists preallocated). |
| Build to single minified HTML | esbuild concat | **Discard**: native ES modules, no build step, readable source. |
| Audio, touch, menu | — | Out of scope. |

## 2. Goals of this milestone

2 km × 2 km flyable Highlands terrain (the generator also fills an 8 km × 8 km backdrop so the horizon is never empty),
streamed in LOD chunks, daylight + haze, free flight with collision, debug overlay, scripted benchmark, tests.

## 3. Architecture

```
index.html               page shell, overlay, error panel (no logic)
src/main.js              boot: capability check → App
src/app.js               owns subsystems, frame loop, device-loss recovery
src/config.js            world constants + quality presets
src/core/                math (f64 vectors, matrices), deterministic hash/RNG, spline
src/terrain/             CPU only, no GPU imports — usable from node tests and workers
  noise.js               seeded value noise with derivatives, fbm variants (IEEE-deterministic)
  generator.js           heightAt(x,z): glen, loch, cliffs, ridges; terrain "recipe"
  chunk-mesher.js        node → height/morph/normal arrays (+ min/max)
  index-patterns.js      16 crack-free stitching index buffers (shared by all chunks)
  quadtree.js            LOD selection, residency fallback, 2:1 balance, edge masks
  morph.js               CPU mirror of the shader's morph (tests, collision)
  terrain-worker.js      worker entry: generate chunks off the main thread
  overview.js            low-res height/shadow/sky-visibility map (worker)
src/world/
  terrain-streamer.js    worker pool, request priority, LRU residency, CPU chunk cache
  floating-origin.js     render-origin snapping
src/gpu/                 everything that touches WebGPU
  gpu-context.js         adapter/device, loss detection, timestamp queries
  renderer.js            frame graph: terrain+sky+water pass → post pass; targets; stats
  terrain-renderer.js    chunk pool (storage buffer slots), per-draw instance data, draws
  shaders/*.wgsl.js      terrain, sky, water, post, shared atmosphere functions
src/atmosphere/          sun + single-scattering parameters (shared CPU/GPU constants)
src/flight/              input, flight model (accel, bank, altitude), collision
src/quality/             presets, dynamic resolution controller
src/debug/               overlay, benchmark route + recorder
tests/                   node:test suites (no browser)
tools/                   static server, headless screenshot/crack-check/benchmark runner
```

### 3.1 Terrain data flow

`generator.heightAt(x,z)` (pure, f64) → `chunk-mesher` (worker) builds a 33×33 vertex chunk
(height, morph-target height, normal, morph-target normal; 16 B/vertex) → transferred to main thread →
kept in a CPU cache → copied into a slot of one large GPU storage buffer. The GPU never generates terrain,
and the generator never sees the GPU. This is what makes device-loss recovery and tests cheap.

### 3.2 LOD: quadtree + CDLOD-style morphing + stitched edges

- Root node covers 8192 m; depth 8 leaves are 32 m chunks with 1 m vertex spacing. Every chunk has the same 32×32-quad grid.
- A node splits when the camera is within `k · size` of its 3D bounding box (`k` = quality preset LOD factor).
- **Residency fallback**: a node is refined only when all four children are resident; otherwise the node itself is drawn. The
  root is generated synchronously at start, so there is never a hole and never a loading screen.
- **2:1 balance**: after selection, a leaf with a neighbour two or more levels coarser forces that neighbour to split
  (its children appear beyond their morph range, i.e. fully morphed, so nothing pops). Only if those children are not
  resident does the finer side collapse into its parent instead. Iterated to a fixed point. (The first implementation
  only collapsed; the LOD-continuity test showed that lifting a collapse later popped by up to 20 m.)
- **Crack-free edges** (two mechanisms):
  1. Edge facing a *coarser* neighbour: one of 16 precomputed index buffers collapses odd edge vertices onto even ones, so that edge
     uses exactly the coarse neighbour's vertices.
  2. Edge facing a *finer* neighbour: the vertex shader disables morphing on that edge (per-draw flag), so the shared vertices keep their exact heights.
  Same-level shared vertices get bit-identical inputs (positions are exact, see 3.4), so they compute identical outputs.
- **No popping**: each vertex stores the parent-level surface height at its position (exact piecewise-linear parent surface, because the
  triangle diagonal direction is uniform across levels). Vertices blend to it as they approach the distance where the parent takes over, so
  at the switch the child geometry is identical to the parent's. A test measures the residual (0.3 px worst case at 1080p).
- The morph start is derived from the LOD factor (`morphStartFor` in `config.js`): when a node splits, its far side must
  not yet be morphing towards *its* parent, otherwise the new children (which show the un-morphed parent shape) pop.
  A fixed 0.62 popped by up to 18 px; the derived value (0.72–0.92) fixed it.

### 3.3 Streaming

Requests are prioritised by need (missing children of a node that wants to split come first) then by projected size; a prefetch margin
(1.3× split range) requests children before they are needed. Workers = `min(4, hardwareConcurrency-1)`, refilled as soon as a job completes (an earlier version dispatched once
per frame, which tied streaming throughput to frame rate: 11× fewer chunks at low fps). Uploads are budgeted per frame,
scaled by frame time. The frame loop keeps at most two frames in flight on the GPU (backpressure).
Residency is LRU-evicted except nodes needed for drawing and their ancestors.

### 3.4 Floating-point-safe coordinates

- CPU world state (camera, routes) is f64.
- The GPU works relative to a **render origin** = camera position snapped to a 256 m grid. Chunk origins relative to it are small multiples of
  the chunk spacing (a power of two ≥ 1 m), and local vertex offsets are integer multiples of the same spacing, so every vertex position on the GPU
  is **exactly representable in f32** (needs ≤ 24 significant bits up to a ±16 million-spacing range). This removes jitter and guarantees bit-identical
  shared edge vertices. A test asserts exactness for every chunk across a 64 km world, not only 2 km.
- The view matrix carries only the small camera-to-origin offset (< 256 m), computed in f64 and rounded once.

### 3.5 Rendering

One HDR render pass (rgba16float, optional 4× MSAA, depth32float reverse‑Z): terrain chunks (vertex pulling from the storage pool, one
`drawIndexed` per visible chunk, `firstInstance` indexes per-draw data) → analytic sky where depth is still clear → flat water plane with
fresnel and depth tint. A post pass tonemaps (ACES fit), dithers and upscales to the canvas. Aerial perspective is analytic single scattering
(Rayleigh + Mie, exponential height falloff, closed-form optical depth) evaluated per fragment; terrain shadows and sky visibility come from a
precomputed low-res overview map. GPU timestamps measure GPU time when the adapter allows it.

### 3.6 Expansion path (why the renderer will not need a rewrite)

- More world = larger root (the exactness bound covers ±16 M × spacing) or a grid of roots streamed by the same streamer.
- Hand-authored features (castle plateau, Hogsmeade terrace, roads) become terms of the generator recipe or a later "stamp" layer applied in the mesher; the renderer never changes.
- New object types (trees, buildings) become new renderers in `src/gpu/` sharing the frame uniforms, the atmosphere WGSL module and the render pass.

## 4. Technical risks

| Risk | Impact | Mitigation in this slice |
|---|---|---|
| CPU generation throughput (JS fbm, 1,369 samples × ~10 octaves per chunk) during fast flight | holes avoided by fallback, but visible coarse terrain / late refinement | workers, prefetch margin, priority queue; measured in benchmark (pending queue length, generation ms). Later: WGSL compute generation with the same recipe. |
| Cross-engine determinism of float math | different worlds per browser | generator uses only + − × ÷, `sqrt`, `floor`, `Math.imul` (IEEE-exact); no `sin/exp/pow`. Golden-hash test. |
| T-junction cracks / depth pinholes | seams | stitching + morph lock + exact coordinates; tests on CPU mirror; GPU crack check (magenta clear colour, count pixels). |
| Popping when residency lags behind the camera | visible LOD switch | morph makes distance-driven switches invisible; lag-driven switches are not hidden in this slice (would need a time-based cross-fade). |
| No shadow maps; heightfield cannot overhang | flat look, no true overhanging cliffs | baked overview shadow + sky visibility; real cascades later. Overhangs need a volumetric layer later. |
| Heightfield collision vs. rendered (morphed/coarser) mesh | clipping into terrain | collision queries the *rendered* surface (CPU mirror of morph) as well as the analytic height, plus a near-plane-sized clearance sphere. |
| Software-only test environment (no GPU here) | cannot measure real GPU performance | only count metrics and functional checks are claimed; hardware numbers must come from the user running `?bench`. |
| Vertex-stage storage buffers unavailable (compatibility mode) | renderer fails on some devices | detected at start and reported; desktop core WebGPU supports them. |
