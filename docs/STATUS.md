# Status of the first vertical slice (2026-11-21)

**Test environment:** 2-core Linux VM, **no GPU**. WebGPU ran on Chrome 153's **SwiftShader software
adapter (it runs on the CPU)**. All frame and GPU times below are software-rasterizer numbers. They show that the
pipeline works and that the benchmark records correctly. They say **nothing** about performance on a real GPU.
Hardware numbers still need a run on a desktop GPU (see `BENCHMARK.md`).

## Measured

### Automated tests: `npm test` → 33 / 33 pass (≈9 s)

| Suite | What it proves |
|---|---|
| determinism (5) | Same seed gives bit-identical heights regardless of evaluation order; seeds differ; golden hash `6beafc7e`; repeated chunk generation is bit-identical; the loch covers > 0.25 km² and is elongated (aspect > 1.8, not circular). |
| index-patterns (16) | Every one of the 16 stitching index buffers is CCW, has no degenerate triangles, covers exactly Q² area, is watertight (each interior edge shared by 2 triangles with consistent orientation), and uses 2-quad segments on stitched edges. |
| chunk-boundaries (3) | Same-level neighbours share bit-identical edge vertices (height, morph target, normals). Fine/coarse edges coincide. Morph targets reproduce the parent surface (< 1 mm). |
| quadtree (3) | Full and random partial residency: leaves tile the root exactly with no holes or overlaps, 2:1 balanced, edge masks consistent from both sides. Only resident nodes are drawn. |
| cracks-and-lod (2) | CPU simulation of the vertex shader over real chunks with morphing active: no T-junctions, all shared vertices bit-identical. Along a 1.3 km low flight (1,004 LOD splits), the worst geometric change at a switch is **0.05 m = 0.30 px at 1080p**. |
| float-precision (1) | Render-origin-relative vertex coordinates are exactly representable in f32 for every LOD level across a **64 km** world. |
| flight-collision (3) | Full-boost dives into cliffs and the loch keep the eye above clearance, with < 4 m vertical correction per frame. Acceleration is smooth. The benchmark route keeps ≥ 5 m terrain clearance at every metre. |

### Headless WebGPU runs (SwiftShader, `tools/headless.mjs`)

| Check | Result |
|---|---|
| 8 fixed viewpoints, High preset, 960×540, 4× MSAA | All render. **0 WebGPU validation errors.** Quadtree balanced in every view. 141k–468k triangles and 72–232 draw calls after frustum culling (`docs/screenshots-software.png`). |
| Crack check (sky drawn magenta, magenta pixels counted, 960×540) | **0 magenta pixels** in 6 downward views across LOD boundaries (518,400 px each). Positive control: a view with sky registers 213,180 magenta pixels, so the detector works. |
| Device loss (2 simulated losses via `device.destroy()`) | Recovered in place both times: 1,537 chunks re-uploaded from the CPU cache, rendering resumed, 0 errors after recovery. |
| No WebGPU (`navigator.gpu` removed) | The error panel "WebGPU is not available" is shown with guidance. No exception. |
| Startup | Coarse levels (21 chunks) generated synchronously in 61–106 ms, then the first frame. No loading screen. |
| Overview bake (1024², shadows + sky visibility) | 12.8–16.2 s on this machine (one worker sharing 2 cores with the software rasterizer). Shadows fade in when ready. |

### Benchmark route, software adapter, High, 960×540 (`docs/measurements/bench-high-swiftshader.json`)

90 s, 8.4 km at 94 m/s. **113 frames, 1.08 fps average. Frame time p50 850 ms, p95 1,567 ms, p99 1,717 ms.
GPU time (timestamp queries) p50 835 ms.** Triangles: average 188k, maximum 347k. Draw calls: average 95, maximum 173.
4,157 chunks generated (5.4 ms average in the worker, on contended cores). Missing LOD chunks: average 37, maximum 286.
0 WebGPU errors.

### CPU-side measurements (Node 22, same VM, `tools/cpu-profile.mjs`)

| | Low | Medium | High | Ultra |
|---|---|---|---|---|
| LOD selection per frame (avg / p95) | 0.33 / 0.50 ms | 0.60 / 0.92 ms | 0.75 / 1.26 ms | 1.27 / 1.67 ms |
| Leaves along the route, before culling (avg / max) | 253 / 400 | 354 / 544 | 525 / 793 | 923 / 1,258 |
| Triangles before culling (avg / max) | 0.52 M / 0.82 M | 0.72 M / 1.11 M | 1.07 M / 1.62 M | 1.89 M / 2.57 M |

Chunk generation: median 2.05 ms, p95 4.5 ms (1,369 height samples per chunk). Height function ≈ 1.8 µs per sample.

## Against the success criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Launch locally in a WebGPU desktop browser | **Works** with `npm start`. Verified in headless Chrome with a software adapter, **not yet on a real GPU or desktop browser.** |
| 2 | Smooth flight across the whole world, no loading screens | No loading screen: verified. Flight covers the full 2 km square with soft edge walls. **Smoothness is unmeasured on real hardware.** |
| 3 | No visible seams or obvious popping | Seams: none (CPU proof plus GPU crack check). Popping from distance-driven LOD switches: ≤ 0.3 px (measured). **Popping when streaming lags** (fast flight on a slow CPU) is not hidden: the coarse level is shown until children arrive, then they switch in. On this 2-core VM that lag occurred (up to 286 missing chunks at 94 m/s). |
| 4 | No major camera jitter or terrain clipping | Floating origin with exact coordinates (tested). Collision against the rendered surface plus a near-plane ring (tested headless in Node). **Not judged visually in interactive flight.** |
| 5 | Benchmark records FPS and frame-time percentiles | **Works**: avg/p50/p90/p95/p99/p99.9/max frame time, GPU time, hitches, load metrics, JSON export. |
| 6 | Can expand without rewriting the renderer | Generation is separate from the GPU. Exact coordinates hold to 64 km. Renderer, streamer and terrain recipe are independent modules (`ARCHITECTURE.md` §3.6). This is a design claim, not yet exercised. |

## Problems found and fixed during this slice

- **LOD popping up to 18 px**: a fixed morph start let a splitting node's far side morph towards its grandparent. Fixed with a morph start derived from the LOD factor.
- **Popping up to 20 m after balance collapses**: fixed by balancing with forced splits.
- **Streaming throughput tied to frame rate** (11× fewer chunks at low fps): workers are now refilled on completion and the upload budget scales with frame time.
- **Unbounded GPU queue** when GPU-bound: frames were submitted faster than the GPU could finish them. Now at most 2 frames are in flight.
- **45 m vertical step** in the terrain: a distance-gated shoreline term. Fixed, and a 1 m-neighbour scan was added to the workflow.
- **Creases** from arc-length-keyed valley widths: switched to position-based noise.
- **Cliff collision teleported the camera 7 m per frame**: steep rises now block or slide instead.

## Incomplete / needs improvement (in priority order)

1. **Real-GPU measurements**: run `?bench=1` on the target hardware for each preset. Nothing here says the frame budget is met.
2. **Streaming lag at high speed**: needs a faster generator (WGSL compute generation of the same recipe is the natural next step), frustum-aware request priority, and a short time-based cross-fade for lag-driven switches.
3. **Shadows**: only a baked 4 m/texel overview shadow for a static sun. Close-range terrain self-shadowing is soft and approximate, and nothing casts shadows beyond ±2 km. Cascaded shadow maps are needed before buildings arrive.
4. **Cliffs** still read as stepped bands in places (heightfield terracing). Overhangs are impossible in a heightfield and need a volumetric/stamp layer later.
5. **Look**: the material is procedural noise without textures. Near ground is soft/blurry at 1 m mesh resolution. There are no clouds. Water reflects only the sky plus a "hills" approximation (no SSR or planar reflection). There is no bloom.
6. **Fragment cost**: sky ambient is evaluated per fragment (two sky integrals). It should move to per-frame uniforms or a small LUT.
7. **Overview bake time** (13–16 s on this VM) delays shadows. Bake progressively or on the GPU.
8. Wasted triangles: children beyond their morph range are drawn at full resolution (CDLOD draws parent quadrants instead). Selection and the CPU cache allocate small objects each frame (no GC stutter measured, but not zero-allocation).
9. Not tested: Firefox and Safari WebGPU, high-DPI canvases above 2×, keyboard layouts other than QWERTY (keys are physical codes, so they work, but the labels assume QWERTY).
