# Tree Lab: technical report (structural review gate)

Branch `world-v2-webgpu`. Starting checkpoint `9c024fe`; structural finishing pass on top of `35d542d` (see
`review/CHANGES-finishing-pass.md` for what changed, why, and the before/after evidence). No foliage and no bark
materials.

Public build: https://nachumrubin.github.io/hogwarts-world/dev/tree-lab/ (deployed with the Creature Lab;
see "Public build" in README.md).

## What was taken from the Creature Lab, and what was not

I read the Creature Lab source (`creature-lab` branch: `index.html`, `app.js`, `lab.js`, `inspection.js`,
`evidence.js`, `habitats.js`) and adapted these ideas:

* **Specimen library** with thumbnails, a data panel and a status badge.
* **Live viewport** with a caption, mode strip, view bar, reset and free camera.
* **Inspector:** environment, rendering (LOD, inspection material, wire, normals), capture.
* **Live telemetry strip:** FPS, frame time, triangles, draw calls.
* **Evidence capture:** screenshot, multi-view plates, review sheets.

What I didn't take:

* **Three.js / WebGL 2.** The Creature Lab runs on these. The Tree Lab stays on the project's own WebGPU renderer,
  extended for the lab with modes, lighting presets, offscreen capture, frame read-back and GPU timestamp queries.
  No new renderer or dependency was needed, so there was no architecture trade-off to raise.
* **Animation transport and video recording.** Trees have no motion in this phase, and you asked for static
  evidence.
* **Habitat scenery.** Comparisons need a neutral, identical environment, so the lab has a common ground plane
  with a 5 m grid, a 1.8 m figure beside each tree, and a 10 m ranging pole.

## Architecture

| concern | module |
|---|---|
| Tree generation | `src/framework/*`, `src/species/{oak,pine,birch}.ts` (pure TS, no DOM) |
| Configurations and presets | `src/species/oak.ts` (`OakConfig`: `OAK_A`, `OAK_B`, `OAK_C`), `src/species/index.ts` (catalogue: seed, preset, parameters, status, meshing region) |
| Geometry adapter | `src/build.ts` (grow → mesh 3 LODs → measure); `src/lab/worker.ts` runs it off the main thread |
| Rendering | `src/render/viewer.ts` (WebGPU) |
| Camera | `src/lab/camera.ts` (orbit, pan, zoom, fly, touch, eased presets, box framing) |
| Scene and comparison layouts | `src/lab/scene.ts` (specimen store, true-scale line-up, ground, scale references) |
| Performance monitoring | `src/lab/perf.ts` (frame cadence, CPU encode, GPU pass time via timestamp queries) |
| Screenshot capture | `src/lab/capture.ts` (protocol, review-sheet composition, ZIP writer); `capture.mjs` (headless) |
| Lab interface | `src/lab/ui.ts`, `index.html`, `style.css` (desktop three-column layout; phone layout with tabs) |

There is one tree-generation system, used by the lab, the Node tools and (later) the world.

## Specimens

| | status | seed | height | crown | DBH | primary limbs* | branches | history |
|---|---|---|---|---|---|---|---|---|
| Oak A, Survivor | preserved | 1603 | 18.9 m | 32.8 m | 2.11 m | 5 | 1,803 | storm-lost limb (5.5 m), stag-headed top |
| Oak B, Ancient Guardian | refined | 2206 | 19.4 m | 26.9 m (24.8 × 26.9) | 2.21 m | 6 | 2,024 | leader lost at 6.5 m in youth → spread; late dieback |
| Oak C, Forest Veteran | refined | 3119 | 24.6 m | 18.4 m | 1.50 m | 6 | 853 | woodland light (canopy from 10 m, 7.5 m gap); storm at 13.4 m; whips died back |
| Scots pine | refined | 1714 | 21.6 m | 13.4 m | 1.19 m | 3 | 1,729 | 6 dominant limbs, 73 primaries self-pruned, leader died back |
| Silver birch | refined | 1903 | 21.0 m | 10.4 m | 0.59 m | 8 | 1,093 | 28 arching primaries, 5 low limbs lost |

\* A primary limb is a limb leaving the stem with a base radius of at least 20% of the trunk radius at 1.3 m,
plus the stem's own continuation once it has divided. By this measure the pine's dominant limbs are slender
relative to its girth.

**Oak A.** The growth is bit-identical to `9c024fe`: same seed, configuration, 4,807 nodes and event history,
checked with `tools/baseline.ts`. Two defect fixes were applied after growth:
* **Structural fairing of woody limbs.** Short loops and hooks are relaxed while the branching points stay in
  place. The direction reversals that `tools/loops.ts` finds dropped from 61 to 23, and none remain below 9.8 m.
* **Buttress roots.** They now leave the trunk at the surface and dive within their first third, so the ground no
  longer cuts them into thin flaps.

**Oak B and Oak C.** These use the same growth simulation with independent configurations: a different seed,
environment and history, not a mirror or stretch of Oak A.
* **Oak B** is open parkland. Its young leader was lost, so it spread rather than climbing. Its limbs are more
  strongly flattened and it turns more slowly.
* **Oak C** grew in closed woodland. The sides are shaded below a 10 m canopy, light comes through a limited gap,
  and apical control is strong, which gives it a tall clear stem and a high narrow crown.

**Pine.** The crown and growth are unchanged. The lower stubs are now snapped at varied lengths, from flush knots
to long spikes, with varied droop and shrinkage. Lower dead branches are shed more often.

**Birch.** The architecture is unchanged. The branch collar now peaks inside the stem and fades over about five
branch radii, so there is no ball joint where a branch leaves the stem.

**All species.**
* Tube triangles were wound inward. The shader's back-face test therefore flipped their normals, which caused the
  bright band where the blended base meets the trunk. They are now wound outward like the blended surface, and the
  transition shades continuously.
* Tube shading normals now include the bark relief.
* Oak B's and Oak C's blended regions now enclose their main forks.

## Performance

These are counts measured from the actual meshes, from `diagnostics.json`:

| | LOD0 triangles | LOD0 vertices | LOD0 memory | LOD1 tris | LOD2 tris | grow | mesh LOD0 |
|---|---|---|---|---|---|---|---|
| Oak A | 354k | 205k | 14.1 MB | 122k | 18.5k | 1.2 s | 6.1 s |
| Oak B | 396k | 229k | 15.8 MB | 139k | 21.4k | 2.0 s | 10.4 s |
| Oak C | 188k | 109k | 7.5 MB | 63k | 10.6k | 1.7 s | 4.2 s |
| Scots pine | 217k | 133k | 9.0 MB | 68k | 7.8k | 2.1 s | 4.9 s |
| Silver birch | 174k | 106k | 7.2 MB | 37k | 4.5k | 0.5 s | 2.8 s |

The grow and mesh times were measured in this headless session's Worker, on 2 CPU cores. In the single-specimen
view the viewer reports 5 draw calls for the main pass (sky, tree, ground, figure, ranging pole).

**Frame time and FPS:** the lab measures these live (frame cadence, CPU encode time and, where the browser exposes
timestamp queries, GPU pass time). The only numbers I have so far come from the SwiftShader software renderer. They
say nothing about GPU performance, so I haven't quoted them. Real figures need a run in Chrome on your machine with
"Live rendering" on.

LOD0 fell by 43–78% in the finishing pass: curvature-adaptive rings on thin branches, underground blended faces
culled, tighter blend regions. The audit and method are in `review/CHANGES-finishing-pass.md`. Meshing got slower,
mainly from the root-flare look-ups; it runs in the worker and is the next thing to optimise.

## Outstanding structural defects

Current list: section 4 of `review/CHANGES-finishing-pass.md`. Faint rings where the flare band fades on the pine
and birch stems, narrow handover bands at oak forks, Oak A's preserved low-limb curl, Oak B slightly narrower,
the birch leader running on above the top primaries, crisp twig shadows under the studio light, and slower
generation.

Interface screenshots: `review/lab-ui.png` (desktop) and `review/lab-mobile.png` (phone). The viewport in both is
the frame actually presented to the canvas, read back from the GPU, because headless page screenshots of
WebGPU canvases are unreliable.

Stopped here, before bark and foliage, for your structural review.
