# Tree Lab

A standalone, browser-based lab for developing, inspecting, comparing and documenting the procedural trees of
the Hogwarts world. It is separate from the main world and from the forest POC. Nothing under `src/` or `dev/`
outside this folder is touched.

Structural phase only: clay, silhouette, wireframe, normals and hierarchy modes. "Materials" is a neutral
placeholder until the bark and foliage phase.

## Run it

```bash
npm install                       # once, at the repository root (esbuild, TypeScript)
node dev/tree-lab/build.mjs       # bundles dist/main.js + dist/worker.js
node tools/serve.mjs 8080         # zero-dependency static server
# open http://localhost:8080/dev/tree-lab/
```

Needs WebGPU: Chrome or Edge 113+, Safari 18+ with WebGPU on, or Firefox Nightly. `localhost` counts as a secure
context. Each tree is grown in a Web Worker. The first specimen appears in a few seconds, and the rest of the
collection keeps growing in the background, so switching between them is instant.

### URL options

| option | values |
|---|---|
| `specimen` | `oak-a` · `oak-b` · `oak-c` · `pine` · `birch` |
| `compare` | `all` · `oaks` · `a-b` · `b-c` · `pine-birch` |
| `view` | `front` · `side` · `rear` · `three` · `top` · `trunk` · `junction` |
| `mode` | `clay` · `silhouette` · `wire` · `normals` · `hierarchy` · `lit` (materials placeholder) |
| `light` | `studio` · `day` · `overcast` · `low` |
| `lod` | `0` · `1` · `2` |
| `live` | `0` renders on demand only (default is continuous frames, for real FPS) |
| `shadow` | shadow-map size, default 4096 |

### Controls

| | mouse / keyboard | touch |
|---|---|---|
| Orbit | drag | one finger |
| Pan | right or middle drag, shift-drag | two fingers |
| Zoom | wheel | pinch |
| Free-fly | `F`, then WASD to move, Q/E down/up, Shift fast, drag to look | Fly button, then drag to look and two fingers to move |
| Views | `1` front · `2` side · `3` rear · `4` ¾ · `5` top · `6` trunk · `7` junction · `R` reset | view bar |
| Modes | `C` clay · `S` silhouette · `W` wire · `N` normals · `H` hierarchy · `M` materials | mode strip |
| Screenshot | `P` | Screenshot button |

Presets frame the selected tree from its measured bounds, using the viewport's real aspect ratio.

In a comparison, the bar at the top of the viewport switches between the whole line-up and a single specimen,
inspected in place.

## Evidence capture

* **Screenshot:** the viewport exactly as seen.
* **Review sheet · this specimen:** the standard set (front, side and ¾ clay; front and side silhouettes; trunk and
  main-junction close-ups), plus a diagnostics panel.
* **Comparison sheet · three oaks:** a clay row and a silhouette row at true relative scale.
* **Export everything (ZIP):** every specimen's shots and sheet, all five comparison sheets, and `diagnostics.json`.

Protocol (`src/lab/capture.ts`): 1200×900, neutral studio light, LOD 0. Full-tree views use one common scale (a
36 m × 27 m frame at the tree, the same camera distance for every specimen); close-ups are framed on the feature.

Headless, with the same pipeline:

```bash
SOFTWARE=1 UI=1 MOBILE=1 node dev/tree-lab/capture.mjs out/treelab-review
DEBUG=oak-b:junction:normals,pine:trunk:clay node dev/tree-lab/capture.mjs out/dbg   # single shots
```

The checked-in sheets are in `review/`.

## Layout

```
src/framework/   growth and geometry framework, pure TS (no DOM): skeleton, pipe model, mechanics,
                 self-organizing growth (sotm), tube mesher, implicit fusion of junctions and roots
src/species/     species algorithms (oak.ts, pine.ts, birch.ts) and the specimen catalogue (index.ts):
                 configurations, presets, seeds, meshing regions
src/build.ts     grow → mesh 3 LODs → measure; what the world would call to get a tree
src/render/      WebGPU viewer (modes, lighting presets, shadow map, offscreen capture, timestamp queries)
src/lab/         lab.ts (controller), camera.ts, scene.ts (store, layouts, scale references), worker.ts,
                 perf.ts, capture.ts (protocol, sheets, ZIP), ui.ts (DOM binding)
tools/           Node dev tools: baseline.ts (geometry fingerprints), loops.ts, meas.ts, preview.ts (CPU preview)
```

Using a tree in the world: `import { buildSpecimen } from 'dev/tree-lab/src/build.ts'`, which returns the LOD
meshes (interleaved `Float32Array` with 12 floats per vertex, plus `Uint32Array` indices), bounds and
diagnostics. Generation is deterministic: same seed and configuration, same tree.
