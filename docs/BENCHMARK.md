# Running the benchmark on real hardware

The numbers in `docs/STATUS.md` come from a **software** WebGPU adapter (SwiftShader, CPU) and say nothing about
GPU performance. Real numbers need a run on your machine:

1. `npm start` and open `http://localhost:8080/?bench=1` in Chrome/Edge (desktop, plugged in, other tabs closed).
   Optional: `&preset=low|medium|high|ultra`, `&duration=90` (seconds), `&seed=1337`.
   The window size is the render size; full screen (F11) is recommended. Dynamic resolution is frozen during the run.
2. The route (≈8.4 km at ≈94 m/s over 90 s: low over the loch, up the glen, over the crag, high panorama) starts
   immediately. A result panel appears at the end with **Download JSON**; the same JSON is printed to the console
   (`HIGHLANDS_BENCHMARK {...}`) and available as `window.__benchResult`.
3. Report: `fps.avg`, `frameTimeMs.p50/p95/p99/max`, `gpuTimeMs` (needs `timestamp-query`; in Chrome you may need
   `chrome://flags/#enable-webgpu-developer-features` for full-precision timestamps), `hitches`, `missingChunks.max`.

Interpretation notes
- Frame time is the rAF interval: it is capped by the display refresh rate (e.g. 6.9 ms at 144 Hz). GPU time shows
  the actual headroom.
- The first second is excluded as warm-up. Chunks keep streaming during the run; `missingChunks` (wanted LOD chunks not yet on the GPU) shows whether
  generation kept up. A high maximum means coarser LOD was visible for a moment (never holes).
- Automated: `CHROME_PATH=... node tools/headless.mjs bench out/` runs the same route headless (add `SOFTWARE=1`
  to force SwiftShader). Headless Chrome on a machine with a GPU uses the GPU.
