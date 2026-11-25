# Tree Lab: technical report (structural review gate)

Branch `world-v2-webgpu`. Starting checkpoint `9c024fe`. No foliage and no bark materials.

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
| Oak B, Ancient Guardian | new | 2206 | 19.1 m | 28.7 m (25.9 × 28.7) | 2.21 m | 5 | 2,467 | leader lost at 6.5 m in youth → spread; late dieback |
| Oak C, Forest Veteran | new | 3119 | 24.8 m | 16.3 m | 1.50 m | 5 | 531 | woodland light (canopy from 10 m, 7.5 m gap); storm at 17.7 m; whips died back |
| Scots pine | refined | 1714 | 20.4 m | 14.9 m | 1.19 m | 2 | 1,721 | 6 dominant limbs, 64 primaries self-pruned, leader died back |
| Silver birch | refined | 1903 | 21.1 m | 10.0 m | 0.59 m | 10 | 1,309 | 33 arching primaries, 5 low limbs lost |

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
| Oak A | 630k | 365k | 25.1 MB | 131k | 14k | 1.1 s | 1.5 s |
| Oak B | 868k | 502k | 34.5 MB | 179k | 19k | 1.9 s | 2.9 s |
| Oak C | 332k | 187k | 13.0 MB | 69k | 7.6k | 0.9 s | 1.7 s |
| Scots pine | 483k | 290k | 19.7 MB | 92k | 5.6k | 1.6 s | 0.9 s |
| Silver birch | 795k | 479k | 32.5 MB | 73k | 4.8k | 0.6 s | 1.1 s |

The grow and mesh times were measured in this headless session's Worker, on 2 CPU cores. In the single-specimen
view the viewer reports 5 draw calls for the main pass (sky, tree, ground, figure, ranging pole).

**Frame time and FPS:** the lab measures these live (frame cadence, CPU encode time and, where the browser exposes
timestamp queries, GPU pass time). The only numbers I have so far come from the SwiftShader software renderer. They
say nothing about GPU performance, so I haven't quoted them. Real figures need a run in Chrome on your machine with
"Live rendering" on.

LOD0 is the hero inspection mesh. Oak B and the birch at LOD0, at more than 0.8M triangles each, are too heavy for
the world. LOD1 (70–180k) is the realistic near-field budget.

## Outstanding structural defects

1. **Oak A:** a low limb bends sharply toward the viewer near the trunk. From the front it reads as a curl,
   although it isn't a reversal. The 23 remaining minor direction reversals are high in the crown (r < 0.16 m).
2. **Oak A, B and C bases:** a thin dark sliver where the blended root flare meets the ground in close-ups.
3. **Blended surfaces:** faint dotted creases where surface-net blocks meet. They are visible in the normals mode at
   the forks.
4. **Oak B:** dense, fairly uniform twig layer at the crown rim, so the dome reads as somewhat even. One long
   hanging branch on the right side.
5. **Oak C:** thin crown (531 branches) and a plain, smooth upper stem. Two small loops remain at 19–20 m.
6. **Pine:** dominant limbs are slender relative to the 1.19 m stem. Stubs still project almost horizontally from
   the upper bole.
7. **Birch:** primaries that pass in front of the stem show their rounded start inside the stem's silhouette from
   some angles.
8. **Comparison framing:** full-tree views use one 36 m frame, so the narrow trees occupy a small part of the image.
   Close-ups are framed per tree.
9. **Headless only:** page screenshots of the WebGPU canvas can show compositing artifacts under SwiftShader. Lab
   captures render offscreen and are not affected.

Interface screenshots: `review/lab-ui.png` (desktop) and `review/lab-mobile.png` (phone). The viewport in both is
the frame actually presented to the canvas, read back from the GPU, because headless page screenshots of
WebGPU canvases are unreliable.

Stopped here, before bark and foliage, for your structural review.
