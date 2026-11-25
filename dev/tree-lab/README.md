# Tree Lab

A standalone, browser-based lab for developing, inspecting, comparing and documenting the procedural trees of
the Hogwarts world. It is separate from the main world and from the forest POC. Nothing under `src/` or `dev/`
outside this folder is touched.

Phase 4 (foliage): every specimen carries species-specific summer foliage grown from its own branch hierarchy:
lobed oak leaves, paired Scots pine needles, small serrated birch leaves on pendulous shoots (see "Foliage" below).
Phase 3's photoscanned bark is unchanged. The **Materials** mode is the default; clay, silhouette, wireframe,
normals and hierarchy are unchanged. An optional **woodland floor** environment sits beside the neutral plot. No
wind and no seasons yet.

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
| `view` | `front` · `side` · `rear` · `three` · `top` · `trunk` · `junction` · `broken` (exposed wood) · `crown` · `macro` · `interior` · `up` · `elevated` · `aerial` · `backlit` |
| `mode` | `lit` (materials, default) · `clay` · `silhouette` · `wire` · `normals` · `hierarchy` |
| `foliage` | `0` the leafless tree (default: summer foliage) |
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
| Views | `1` front · `2` side · `3` rear · `4` ¾ · `5` top · `6` trunk · `7` junction · `8` broken · `R` reset | view bar |
| Modes | `C` clay · `S` silhouette · `W` wire · `N` normals · `H` hierarchy · `M` materials | mode strip |
| Screenshot | `P` | Screenshot button |

Presets frame the selected tree from its measured bounds, using the viewport's real aspect ratio.

In a comparison, the bar at the top of the viewport switches between the whole line-up and a single specimen,
inspected in place.

## Evidence capture

* **Screenshot:** the viewport exactly as seen.
* **Foliage review (in the ZIP and the capture script):** full tree foliated and leafless at one camera, woodland
  floor under overcast, backlit, leaf/needle macro, branch-to-foliage junction, crown interior, ground level
  looking up, elevated and aerial views, LOD 0/1/2 at one camera; foliage statistics and measured overdraw.
* **Foliage study · this specimen:** the proof of concept: opaque leaf geometry vs shoot cards vs the hybrid, at
  close, medium and distant range, with triangles and measured overdraw per cell.
* **Woodland stand:** twelve trees on the woodland floor, LOD by distance; the stress test (capture `STAND=1`).
* **Material sheet · this specimen:** (bark, leafless) full tree under daylight, overcast and low-angle sun; trunk, main junction
  and broken-limb close-ups, each with clay at the same camera and light (trunk also under low sun); LOD 1 and
  LOD 2 at the common full-tree frame; texture memory and render timings (clay vs materials) in the panel.
* **Structural sheet · this specimen:** the standard set (front, side and ¾ clay; front and side silhouettes; trunk and
  main-junction close-ups), plus a diagnostics panel.
* **Comparison sheet · three oaks:** a materials row (daylight), a clay row and a silhouette row at true relative scale.
* **Export everything (ZIP):** every specimen's structural and material shots and sheets, all five comparison
  sheets, and `diagnostics.json`.

Protocol (`src/lab/capture.ts`): 1200×900, neutral studio light, LOD 0. Full-tree views use one common scale (a
36 m × 27 m frame at the tree, the same camera distance for every specimen); close-ups are framed on the feature.

Headless, with the same pipeline:

```bash
SOFTWARE=1 UI=1 MOBILE=1 node dev/tree-lab/capture.mjs out/treelab-review   # STRUCT=0 / MATERIALS=0 skip a set
DEBUG=oak-b:junction:lit,pine:trunk:clay DLIGHT=day node dev/tree-lab/capture.mjs out/dbg   # single shots
```

The checked-in sheets are in `review/`.

## Public build (GitHub Pages)

Published at **https://nachumrubin.github.io/hogwarts-world/dev/tree-lab/**, next to the Creature Lab at the site
root (`/hogwarts-world/`).

GitHub Pages serves one artifact per deployment, and each deployment replaces the whole site. So both labs are built
by a single workflow, `.github/workflows/deploy-pages.yml` on the `creature-lab` branch:
* Creature Lab is built from its own branch and goes at the root.
* Tree Lab is built from `world-v2-webgpu` with `node dev/tree-lab/build.mjs --pages <dir>` and goes under
  `dev/tree-lab/`.

A push to `creature-lab` redeploys both. A push touching `dev/tree-lab/` on `world-v2-webgpu` runs
`.github/workflows/request-pages-deploy.yml`, which dispatches that same deploy for the pushed commit. It then checks the live site: the new commit in
`version.json`, every asset returning 200, and Creature Lab intact. These checks block a failed update. It also runs
`tools/pages-smoke.mjs` (headless Chrome with WebGPU) against the public page, but only as an advisory step:
GitHub's hosted runners lose the software WebGPU device. Run the same script locally against the live URL, or
against a locally staged copy, to check WebGPU. Neither
lab can overwrite the other, and no branches are merged.

The staged site uses only relative URLs, so it works under any base path. Assets get content-hashed names
(Pages caches for 10 minutes), and `version.json` records the deployed commit.

## Layout

```
textures/        bark layers and the woodland floor (WebP, tools/textures.py, CC0 Poly Haven scans, manifest.json);
                 foliage sprite and card layers (foliage.*, foliage.json, tools/foliage_textures.py, CC0 ambientCG)
src/framework/   growth and geometry framework, pure TS (no DOM): skeleton, pipe model, mechanics, foliage,
                 self-organizing growth (sotm), tube mesher, implicit fusion of junctions and roots
src/species/     species algorithms (oak.ts, pine.ts, birch.ts) and the specimen catalogue (index.ts):
                 configurations, presets, seeds, meshing regions
src/build.ts     grow → mesh 3 LODs → measure; what the world would call to get a tree
src/render/      WebGPU viewer (bark materials, PBR shading, texture arrays and mips, modes, lighting presets,
                 shadow map, offscreen capture, timestamp queries)
src/lab/         lab.ts (controller), camera.ts, scene.ts (store, layouts, scale references), worker.ts,
                 perf.ts, capture.ts (protocol, sheets, ZIP), ui.ts (DOM binding)
tools/           Node dev tools: baseline.ts (geometry fingerprints), timing.ts (generation time and counts),
                 meshaudit.ts, loops.ts, meas.ts, preview.ts (CPU preview); textures.py (bark texture build)
```

Using a tree in the world: `import { buildSpecimen } from 'dev/tree-lab/src/build.ts'`, which returns the LOD
meshes (interleaved `Float32Array` with 16 floats per vertex: position, normal, order, flags, radius, bark relief,
bark-mapping axis and origin; plus `Uint32Array` indices), bounds and diagnostics. Generation is deterministic:
same seed and configuration, same tree. The lab keeps built specimens in IndexedDB per build commit, so only the
first visit to a deployed build pays the generation time.

## Foliage

* **Sources:** ambientCG CC0 photoscanned leaf atlases: LeafSet016 (lobed *Quercus* leaves), LeafSet014 (doubly
  serrated, reshaped towards the silver birch's deltoid outline), PineNeedles001 (two-needle fascicles,
  recoloured from dry brown to living blue-green). `tools/foliage_textures.py --fetch` rebuilds every layer:
  sprites, LOD1 shoot cards and LOD2 clump cards composited from the same sprites, and leaf outlines.
* **Growth** (`src/framework/foliage.ts`, deterministic, in the worker, cached with the specimen): shoots grow from
  live, unbroken thin wood within reach of a live tip (dead limbs, storm breaks and stubs stay bare); broadleaves
  get branching sprays of drawn twiglets; a voxel light model (zenith and side light, per-specimen) sheds shaded
  shoots (crown gaps) and sets leaf numbers, size and attitude (sun vs shade leaves). Oak A carries the thinner
  crown of a declining veteran, Oak B a dense open-grown crown, Oak C (forest-grown) foliage gathered at the top.
* **Rendering:** one instanced draw per foliage set (template mesh × instances: bent leaf, needle fascicle, card,
  twig), alpha-to-coverage with mip-aware alpha, alpha-tested shadows, separate leaf undersides, translucency
  with its own shadow test, per-shoot pigmentation variation.
* **LOD:** 0 every leaf / fascicle and twiglet; 1 one shoot card per shoot; 2 crossed clump cards per cluster. The
  stand picks LOD by distance (< 35 m, < 110 m, beyond). Impostors for the far distance are the next step.

## Bark materials

* **Textures:** four 1024² layers from Poly Haven photoscans (CC0): `bark_willow_02` (oak; also the birch base,
  recoloured in the shader), `pine_bark` (Scots pine lower trunk), `japanese_zelkova_bark` recoloured to the
  orange flaking upper pine stem, and `sakura_bark` recoloured to silver birch paper bark, with seeded synthetic
  lenticels and peeling strips. `tools/textures.py --fetch` rebuilds them from the CC0 mirror. Packed as albedo +
  height and normal + roughness + occlusion; mip chains are built on the GPU at load (albedo in linear light,
  normal spread folded into roughness).
* **Mapping:** projected in true metres onto planes that contain the local branch axis, at a per-vertex origin
  that follows the branch centre line with a bark coordinate continuous from the trunk into every branch. No UVs,
  so no seams; the scale never stretches with taper; fissures follow each branch; the pattern turns smoothly
  through collars and blended forks. Repeats along a branch are broken up by per-band random offsets with height-
  blended transitions.
* **Distribution:** in the shader, from branch radius (age), height, orientation, the hierarchy and the growth
  history in the mesh flags (dead, broken, hollow, collar). Oak: smooth olive-grey young bark → fissured plates,
  widening on the ancient bole; algae on the shaded side, lichen on upper faces. Pine: grey-brown shoots → orange
  flakes → thick dark plates on the lower trunk up to an irregular 4–7 m boundary. Birch: red-brown twigs →
  white paper bark with dark lenticels → black fissured base rising in streaks. Dead limbs: weathered fibrous wood
  with checks and bark remnants; broken ends: splintered wood and end grain with rings and heart rot; the oak's
  hollow: dark decayed wood.
* **Shading:** Lambert + GGX (F0 0.04) with the texture roughness, sky and ground bounce, sun shadow map, texture
  occlusion and the geometric bark relief as cavity occlusion; per-light exposure; ACES.
