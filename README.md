# Highlands prototype

First technical slice of a browser-based, explorable Scottish Highlands world (the eventual setting for Hogwarts,
the Great Lake, the Forbidden Forest and Hogsmeade). It tests whether a procedural WebGPU + WGSL approach, inspired by
[Abyssal Garden](https://github.com/Noniv/abyssal-garden), can scale to a large, flyable outdoor terrain.

No engine, no Three.js, no build step: native ES modules, WebGPU and WGSL.

## Run it

```bash
npm start            # serves http://localhost:8080 (Node ≥ 20, no dependencies)
npm test             # 33 automated tests (determinism, chunk seams, LOD, precision, collision)
```

Open `http://localhost:8080/` in a desktop browser with WebGPU (current Chrome or Edge recommended).
WebGPU needs a secure context, so use `localhost`, not `file://`.

### Controls

| | |
|---|---|
| Click | capture the mouse (Esc releases) |
| W A S D | fly forward / strafe (strafing and turning bank the camera) |
| E or Space / Q or C | climb / descend |
| Shift / Alt | fast (×4.5) / slow (×0.25); mouse wheel scales cruise speed |
| Arrow keys | look without a mouse |
| 1 – 8 | fixed viewpoints |
| B | start/stop the benchmark route |
| H or F3 | debug overlay |
| L or F4 | debug view: normal → LOD levels (darker = morphing) → crack check (holes show magenta) |
| P | next quality preset (reloads) |
| F9 | simulate a GPU device loss (tests recovery) |

### URL options

`?preset=low|medium|high|ultra` · `?bench=1&duration=90` · `?view=1..8` · `?cam=x,agl,z,yawDeg,pitchDeg` ·
`?seed=N` · `?debug=lod|crack` · `?hud=0` · `?dynres=0` · `?scale=0.75` (fixed render scale)

## What is in this slice

- 2 km × 2 km playable area (an 8 km × 8 km backdrop around it so the horizon is never empty), deterministic from a seed
- glacial glen with a tributary glen, an irregular 1.4 km loch with a bay, beaches and steep shores, a rocky island,
  cliff bands and a crag zone, eroded ridges
- quadtree terrain LOD (9 levels, 1 m to 256 m vertex spacing), CDLOD-style vertex morphing, stitched edges, streamed
  from worker threads with an LRU-managed GPU chunk pool; no loading screen
- floating origin with exact f32 vertex coordinates (tested to 64 km)
- analytic daylight: Rayleigh + Mie single scattering with height falloff for sky and aerial perspective, baked terrain
  shadows and sky visibility, a flat loch surface with fresnel and depth tint
- free flight with smooth acceleration, banking, altitude control and terrain collision against the *rendered* surface
- debug overlay, scripted benchmark route with percentile report, quality presets, dynamic resolution,
  in-place recovery from GPU device loss, graceful message on browsers without WebGPU

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the reference analysis, design and risks,
[`docs/STATUS.md`](docs/STATUS.md) for measured results and known gaps, and
[`docs/BENCHMARK.md`](docs/BENCHMARK.md) for running the benchmark on your hardware.

## Layout

```
src/terrain/   CPU-only generation: noise, height recipe, chunk mesher, stitching, quadtree, morph mirror, worker
src/world/     streaming (workers, residency, LRU), floating origin
src/gpu/       WebGPU context, renderer, terrain renderer, WGSL shaders
src/flight/    input, flight model + collision
src/quality/   dynamic resolution        src/debug/  overlay, benchmark, route, viewpoints
tests/         node:test suites          tools/      static server, headless runner (screenshots, crack check, benchmark, device loss)
```

## License

MIT. Contains code adapted from Abyssal Garden (MIT, © 2026 Maksymilian Dendura); see [`NOTICE.md`](NOTICE.md).
