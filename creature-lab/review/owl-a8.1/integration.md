# Barn owl A8.1 integration readiness

The owl is ready for isolated scene evaluation. Population size and distance thresholds for a shipping world still need measurements on the target GPU. This patch changes the Creature Lab specimen only.

## Creation and ownership

Import the owl directly from the lab ES module tree. The catalog also exposes the same constructor as `catalog.owl.model`. Use one Three.js module instance for the scene and specimen. Positions and distances are in metres.

```js
import {Vector3} from './creature-lab/vendor/three.module.js';
import {Owl} from './creature-lab/species/owl.js';

const owl = new Owl();
owl.setPosition(new Vector3(0, 0, 0));
scene.add(owl.root);
owl.setLOD(0);

const gaze = {stimulus: new Vector3(0.28, 0.34, 0.46)};
function animate(deltaSeconds, elapsedSeconds) {
  owl.update(deltaSeconds, elapsedSeconds, 'Look', gaze);
}
// When removing this specimen
function removeOwl() { owl.dispose(); }
```

**Runtime and assets.** Serve the ES modules over HTTP or bundle them. Rendering uses the vendored Three.js r170 WebGL2 renderer, its shader chunks, and vendored fflate for synchronous atlas inflation. The main world uses WebGPU/WGSL. This Three.js material relies on WebGL shader hooks and would require a renderer bridge or material port for that pipeline. The model imports its owl modules plus shared `form.js` and `avian.js`. The four compressed RGBA atlases travel in `owl-finish-atlas.js`. Body is 512 × 384, head 1024 × 512, wings 512 × 512 and small surfaces 256 × 256. RGB stores sRGB pigment and alpha stores linear height. Mipmapped storage totals about 5.33 MiB before driver overhead. No external model or texture downloads are required. Python, NumPy and the A7 guide commit are bake-time inputs only.

**Seeds and replay.** The constructor takes no seed. Every instance uses the same fixed specimen, baked with seed 720931, and a deterministic behavior clock. Replay the same action and target sequence at the same simulation ticks for identical motion. `resetMotion()` returns to the perched start. The optional `OwlTimeline.seek(frame)` in `owl-inspection.js` recreates the lab's scripted 0–1220 sequence and supports rewinding. Independent appearance seeds would require an API change.

**State interface.** Call `update(dt, elapsed, action, context)` continuously with a finite nonnegative delta in seconds. Simulation consumes accumulated delta in 1/60-second ticks. The elapsed argument exists for the shared lab signature. The supported action strings are `Perch`, `Look`, `Unfold`, `Fold`, `Takeoff`, `Fly`, `Glide`, `Bank` and `Land`. Hold the desired action across frames. Flight requests from the perch pass through takeoff and perched requests from flight pass through landing. Contact completes before a new launch. `owl.motion.pose.state` exposes the active state for inspection. Look accepts a world-space XYZ point in `context.stimulus`, falling back to `context.playerPosition`. Supply a stable target in the same coordinate frame as the origin. A large accumulated delta runs catch-up ticks synchronously.

**Perch target.** Call `setPosition(Vector3)` to place the roost origin before starting the sequence. Use an identity-transformed scene parent. The calibrated perch runs along X for 0.44 m, with its axis at local Y −0.006 m, Z +0.011 m and midpoint diameter 0.036 m. The branch belongs to the host. Both feet and the circular flight route are tied to this origin. The controller returns to the same perch. Arbitrary approach destinations, rotating or moving perches, and runtime surface fitting have no public interface. Use `inspectOwlContact(owl)` for the two world-space pad positions and per-side signed minimum clearances in mm.

**LOD and allocation.** Call `setLOD(0 | 1 | 2)` with an integer. The constructor builds LOD0 synchronously. Other levels build on first selection and remain cached per instance, so first use costs more than switching back. The application chooses the LOD. The lab's optional automatic policy uses camera distance relative to fitted specimen size and hysteresis. LOD0/1/2 draw 54,396 / 28,728 / 10,158 triangles in 14 calls each with full visibility. LOD2 retains A8's simple pigment program, skipped micro relief and transmission, and all flight morphs.

**Multiple instances and disposal.** Construct an Owl for each actor. Each owns its scene nodes, generated geometry, LOD caches, skeleton, materials and animation clock. The four reference-counted textures are shared within the module instance. Owls receiving identical inputs in lockstep synchronize. Independent state schedules or pre-rolls provide behavioral offsets. Draw calls and geometry memory scale per owl. Dispose each owl once after its last update. Disposal detaches its root and frees its generated geometries, skeleton resources and materials. The final owner releases the shared textures. The host retains ownership of the renderer, scene, lighting and perch.

## Hardware benchmark

Open the packaged benchmark in a WebGL2 browser with hardware acceleration. In the source checkout serve the repository root and open `creature-lab/review/owl-a8.1/benchmark.html`. Select a LOD and run the full sequence. Download the JSON before starting another run. Repeat for each LOD and target device.

The harness builds 1, 5, 10, 25 and 50 independent flight controllers and fits every owl into a 1280 × 720 viewport. This represents progressively smaller on-screen birds as the flock grows. Each count gets 24 warm-up frames and 90 measured frames. The export records the adapter, browser, draw calls, triangles, update time and raw synchronized frame times, plus median and p95. Frame time includes simulation, camera placement, draw submission and completion through pixel readback. It excludes the wait for the next animation frame and is a wall-clock metric. The harness rejects software and unrecognized adapter strings, hidden-tab interruptions and lost contexts. A system that masks the adapter requires a browser configuration that exposes it. GPU-only timestamp queries, production lighting, world occlusion, and crowd instancing are outside this measurement.

## Release evidence

All five inherited animation tests passed. The comparison against A8 commit `f27f32f` found exactly equal position, index and morph arrays at each LOD. It also found equal world matrices, morph weights, foot pad positions and perch clearances at 13 sampled poses per LOD. The continuous-sequence test separately checks anchored contact and the A6 clearance limits. The full repository test command passed all 13 test files.

The historical A7 to A8 LOD0 regression was 122.2 to 151.8 ms on SwiftShader. In the new matched experiment, three-run medians were 132.3 ms for A7, 145.8 ms for A8 and 152.9 ms for A8.1. A8 with transmission disabled measured 143.3 ms, with relief disabled 147.5 ms, and with edge discard disabled 162.2 ms. The ranges overlap. These measurements show no repeatable recovery of the historical regression. Removing discard simplifies the shader and changed less than 0.3% of visible owl pixels by more than 8/255 in each test view. Transmission affected 77.85% of underside pixels by that threshold and remains necessary for the pale backlit appearance. Relief stays available on close plumage. The facial correction is baked into pigment and adds no runtime lookup or texture memory. The A8 LOD2 material configuration remains in place.

The comparison gallery includes the full timings, feature-removal image measurements and matched renders. Hardware frame times remain unmeasured. The isolated benchmark drew all five population sizes in a low-resolution software smoke check. Its hardware mode correctly refused that adapter.

## Baseline freeze

The final dedicated Barn Owl baseline is commit `9af5a07f44a0dcfb8027cb24273b0a227970d09d`, preserved on `barn-owl-a8.1`. The Creature Lab integration carries that commit and publishes the original comparison ZIP alongside the report.

The unresolved hero LOD0 frame-time regression and population budgets remain open pending hardware GPU validation. [Engineering issue #2](https://github.com/nachumrubin/hogwarts-world/issues/2)
