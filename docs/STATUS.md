# Development report: first milestone (2026-11-22)

**Bottom line.** The entire 8 × 6 km world exists and is traversable by broom and on foot, with every landmark at its
approved coordinate, a coherent lake, the castle on a connected promontory, a graded railway with the South Viaduct,
and a distinct Forbidden Forest with Aragog's Hollow deep inside it. It can host external creature modules. It is a
**greybox world**: placeholder architecture, no vegetation, simple water. **No real-GPU performance has been
measured**, because this environment has no GPU; that is the main open acceptance item.

Environment for every measurement below: 2-core Linux VM, Chrome 153 headless, **SwiftShader software WebGPU**
(CPU). Frame times from it say nothing about GPU performance.

## Acceptance criteria (brief §16)

| Criterion | Status | Evidence |
|---|---|---|
| Entire 8 × 6 km world traversable | Met | Broom flight is bounded to the playable area with soft edges; the benchmark route covers 16.9 km across the world (station → lake → castle → forest → Aragog's Hollow → Hogsmeade → west lake). Walking works, but there is no swimming and steep slopes block (by design). |
| Landmarks at approved coordinates | Met | `tests/world.test.ts` pins all 21 anchors; the 5 reference elevations are within ±1.5 m (exact in practice: 338.0, 305.0, 306.0, 389.7, 375.0). |
| Hogwarts on the eastern promontory, not an island | Met | Flood fill over dry land connects the castle to the grounds; water lies W, NW and SW of it; the castle is 89.7 m above the lake. |
| Coherent lake shoreline | Met | 3.94 km², 9.5 km shoreline, solidity 0.83 (an ellipse scores 1), with a western arm through a strait, coves, a northern bay, a southern inlet and two islands. Squid Deepwater is 62 m deep, Merpeople Cove 44 m, maximum 68 m. |
| Hogsmeade and Forbidden Forest distinct | Met | Hogsmeade is more than 1.6 km outside the forest outline; distinct biome materials. |
| Aragog's Hollow deep in the forest | Met | "Deep" zone (≥ 1,300 m inside the outline); 4.22 km straight-line from the entrance; a depression more than 20 m deep with a rim. |
| Broom flight across the whole world | Met functionally | Tests plus the headless route. Feel and smoothness are not judged on real hardware. |
| No visible streaming gaps | Met (software) | Crack check: 0 magenta pixels in 4 downward views (230,400 px each); a positive control view registers 114,639. The hole-free cover is proven by tests. Coarse LOD lingers when generation lags (see below). |
| Stable world-space positioning | Met by design and test | Floating origin; f32-exact vertex coordinates tested to 64 km. Not judged interactively. |
| Performance measurements available | Instrumentation met; **numbers missing** | Overlay with FPS, frame/GPU time, triangles and draw calls; a benchmark with percentiles and JSON export. **Needs a real-GPU run.** |
| External creature modules | Met | `CreatureModule` contract, `CreatureHost` (lifecycle, LOD, dormancy, error containment), placeholder modules in all 5 encounter zones, tests. |

## Completed this session

- **Stage A:**
  - audit of `HP-world` (Unreal project; licensed assets found but blocked, see Blockers) and of the Phase 1 code
  - stack decision (own WebGPU renderer, TypeScript for new code, esbuild)
  - the coordinate convention and its handedness consequences (`ARCHITECTURE.md`)
  - the world database `data/world.json` with schema validation
- **Stage B:** world terrain model in three layers (macrostructure → eroded noise → authored features), with:
  - the lake and depth bowls, the promontory with lake-facing cliffs, knolls, the hollow
  - two rivers with a waterfall step, the railway valley
  - biome and material fields (forest zones, lawns, paths, paved, ballast) baked into overview maps
- **Stage C:**
  - greybox placeholders for all landmarks, generated from the database
  - the railway: an 8.24 km planning route validated at 1.90% maximum gradient and 1,673 m minimum radius, with a level station at 338 m
  - the South Viaduct span (98 m, 37 m high)
  - river water ribbons and a waterfall sheet
- **Stage E:**
  - walking mode (gravity, jump, step and slope limits, deep-water stop) and broom flight (Phase 1 model, now Z-north)
  - collision against the rendered terrain surface
  - the debug map (minimap, plus a large map with click-to-teleport) and world-space labels
- **Stage F (partial):**
  - 41 automated tests and a clean type check
  - headless viewpoint renders, crack check, device-loss recovery (2 losses, 1,664 chunks re-uploaded), unsupported-browser panel, software benchmark

## Measurements (software adapter)

| | Value |
|---|---|
| Tests | 41/41 pass (≈ 25 s); `tsc --noEmit` clean |
| WebGPU validation errors | 0 in all runs |
| Viewpoint renders (960×540, High, 4× MSAA) | 10/10; 294k–567k triangles, 177–282 draw calls after culling |
| Benchmark route (150 s, 16.9 km at 113 m/s) | 153 frames, 0.75 fps; frame time p50 1,283 / p95 1,967 / p99 2,283 ms; GPU time p50 884 ms; triangles avg 347k, max 470k; draws avg 184, max 257 |
| Streaming during the benchmark (1 worker, 2 shared cores) | 15,255 chunks generated (5.8 ms avg); missing LOD chunks avg 105, max 394 (coarser terrain shown meanwhile, never holes) |
| Startup | coarse levels in 61–106 ms; placeholders built in 16–25 ms; overview maps (1.3 M samples) 14.5–18.7 s |
| Height function | ≈ 2.5 µs per sample |

## Limitations and known issues

- **Architecture is greybox:**
  - the castle is massing (halls, towers, curtain walls) at the right place and scale, not Hogwarts
  - Hogsmeade is a row of identical gabled boxes, with the five named shops labelled only
- **No vegetation:** the forest exists as zones and a ground/canopy tint; there are no trees, undergrowth, grass or rocks (Stage D).
- **Water is basic:**
  - the lake reflects only the sky, plus an approximation for the surrounding hills
  - no underwater view or atmosphere, no shoreline foam
  - rivers are flat ribbons; the waterfall is a static sheet with animated noise
- **No real shadows:** a baked 8 m terrain shadow map for a static sun; placeholders cast no shadows; there is no weather or time of day.
- **Materials:** procedural colour fields only, not PBR; near ground is soft (the baked detail texture from the audit, E1, is not done yet).
- **Terrain artefacts:**
  - the plateau still reads as a raised table from some angles
  - embankment ends at the viaduct are abrupt
  - paths are texture only, not cut into the terrain
- **Streaming lag at broom speed** on slow CPUs: coarse terrain is visible until children arrive.
- **The debug map** labels overlap around the castle.
- **Late fix:** the Quidditch stand colours were fixed after the last screenshot (view 10 shows the old muddy tints).

## Blockers (need you)

1. **Real-GPU benchmark.** Your computer link was offline this session. Run `npm start`, open `localhost:8080/?bench=1`
   on your GPU (procedure in `BENCHMARK.md`) and send the JSON, or link the computer so I can run it.
2. **Licensed models from HP-world.** The castle (CC BY 4.0), pitch, cliff scan and forest models are Git LFS objects.
   Anonymous access gives only pointer stubs, and credentialed repository access was refused in this session. Attach
   the `.glb` files (at least `SourceAssets/Hogwarts/hogwarts_3d_baked.glb`) or grant access, and Stage D starts with
   castle integration.

## Next steps (proposed order)

1. Real-GPU baseline (blocker 1), then set preset budgets from it.
2. Castle GLB integration (blocker 2): loader, offline bake (LODs, merged materials), attribution and credits screen.
3. E1 baked triplanar detail texture (from the Abyssal Garden audit), then instanced rocks, then forest trees with
   impostors and grass, driven by the zone fields that already exist.
4. Water: lake reflections of terrain, underwater fog below 300 m, shoreline foam; proper river surfaces.
5. Per-tile static shadow maps; then weather and time of day.
6. Hogsmeade layout pass (streets, building variety); a real castle grounds layout (courtyards, bridges over carved ravines).
