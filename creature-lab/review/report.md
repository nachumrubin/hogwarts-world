# Phase B technical review

The seven specimens share one Three.js lab. The [comparison gallery](README.md) contains four neutral-material plates per specimen. In the lab, **Rendering → Inspection material** switches between habitat, neutral clay, and silhouette. **Capture four views** saves a fresh reference pose to Captures and preserves the live specimen’s pose and camera. Select silhouette first for black outlines. **Export full survey** includes the four comparison PNGs for each species, habitat views, motion clips when the browser supports recording, and timing data.

## Anatomy and motion at the review gate

| Specimen | Weakest anatomical feature | Weakest animation feature |
|---|---|---|
| Giant Squid | In front and rear views, overlapping arms obscure the outline of the shorter arm crown. | The resting arm waves stay rhythmic. Individual arms show limited variation in when they settle. |
| Aragog | Dense setae soften the leg joints in clay, particularly where the far legs overlap the near legs. | During turns the feet replant discretely. A planted foot can lag behind the rotating body before its next step. |
| Centaur | The waist meets the withers in a narrow band. The chest and shoulders read more clearly in profile than head-on. | The four-beat walk places the hooves, but the pelvis and upper torso transmit little of the weight shift. |
| Unicorn | The mane is strongest on one side. The shoulder-to-neck join becomes conspicuous at the lowest grazing angle. | Grazing comes primarily from the neck base. The stance changes too little as the muzzle goes down. |
| Barn Owl | The heart-shaped facial disc reads from the front. From three-quarter view the rim and eyes protrude, and the folded primary feathers fan away from the flank. | The flight cycle bends at the shoulder and wrist. The outer primaries still reverse together at the ends of the stroke. |
| Hippogriff | The feathered neck and talons establish the eagle forequarters. The rounded wing roots still look distinct from the shoulder muscles. | The forefeet have less convincing ground contact than the hoofed hind pair. Takeoff blends to a tucked pose with little hindquarter push. |
| Merperson | The gill covers are legible in profile but read as separate lobes head-on. The arms still have a strongly humanoid shoulder outline. | The tail wave drives the silhouette more strongly than the upper spine. The hands scull in a repeating cycle through a turn. |

## Measured baselines

One moving specimen, LOD 0, day habitat, three-quarter camera, 640 × 480 framebuffer. Each entry uses 10 warm-up frames and the median of 30 subsequent frames in headless Chromium 156 on ANGLE/SwiftShader. Triangle and draw counts include the habitat. Geometry memory is the lab’s estimate of buffers reachable from the scene. These software-rendered frame times are specific to the review machine.

| Specimen | Behavior | Triangles | Draw calls | Geometry MiB | Frame ms | CPU ms | GPU ms |
|---|---|---:|---:|---:|---:|---:|---:|
| Centaur | Walk | 420,516 | 67 | 1.69 | 383.4 | 1.6 | 416.3 |
| Unicorn | Walk | 413,796 | 60 | 1.51 | 366.6 | 1.1 | 352.1 |
| Barn Owl | Fly | 411,238 | 131 | 1.51 | 333.3 | 1.1 | 336.2 |
| Hippogriff | Walk | 420,272 | 173 | 1.68 | 366.6 | 1.5 | 361.4 |
| Merperson | Swim | 353,358 | 55 | 1.38 | 333.4 | 1.3 | 316.6 |

[Machine-readable baselines, including frame-time p95 and animation cost](baselines.json)

## Implementation and verification

The new modules under `creature-lab/species/` build indexed surfaces and articulated hierarchies in metres. The equine rig shares barrel sections, hoof geometry and sagittal leg solving. The avian rig shares shoulder and wrist pivots, cambered feather vanes and talons. The merperson deforms one continuous torso and tail surface, with the same traveling wave applied to both fin lobes. LOD swaps geometry on the existing hierarchy and retains behavior time and joint transforms. A future WebGPU adapter can reuse the section data, vertex buffers, joint transforms and gait equations. The current host remains the Three.js lab.

Giant Squid and Aragog loaded after each species checkpoint. All new behavior states were exercised and checked for finite, stable joint transforms across LOD 0 → 1 → 2 → 0. The gallery uses the same capture function exposed in the inspector. The modular entry point is `creature-lab/index.html`. The bundled `creature-lab/standalone.html` opens directly in a WebGL 2 browser. Rebuild it with `node tools/build-creature-lab.mjs` after installing the repository dependencies.
