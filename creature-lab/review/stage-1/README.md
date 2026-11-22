# Stage 1 · Equine structure

[Open the paired review gallery](https://nachumrubin.github.io/hogwarts-world/review/stage-1/) · [Baseline source at 5d290cb](https://github.com/nachumrubin/hogwarts-world/tree/5d290cb248c48713a007b962385bfdc3ed76cfef/creature-lab)

Review the **centaur in side clay** first. The flank, withers, waist and back now share one silhouette. The baseline shows the lower edge of the human torso crossing the equine chest. The **unicorn graze clip** tests the same join under a much larger bend. The **hippogriff front silhouette and folding clip** show the elbow and wrist changing the wing outline.

All 42 plates use the lab's studio lights and background, a 640 × 480 orthographic camera and LOD 0. Each pair uses identical scale, aim, exposure and one second of fixed-step posing. The hippogriff is extending its wings. The centaur and unicorn are idle. The close-up framing is specific to each species. The four-second clips sample 96 fixed steps at 24 fps.

## Model changes and remaining weaknesses

| Species | Structural change | What to judge next |
|---|---|---|
| Centaur | The barrel rises into the abdomen and ribcage as one skinned mesh. Cheekbones, sockets, nose and lips are modeled in the skull surface. Longer locks fall behind the jaw. | The deltoids and upper forelegs still show separate outlines in clay. The chest needs more clavicle definition and the long hair moves with the skull as a unit. |
| Unicorn | A weighted neck bends through the withers during grazing. A broader muzzle, mobile pinnae, layered mane and subtly fluted horn refine the profile. | The graze still lacks a staggered stance and full ground reach. The mane remains attached to the moving neck as a unit. |
| Hippogriff | The brisket runs into a feathered neck. A shoulder, elbow and wrist carry scapulars, secondaries, coverts and tapered primaries. Neck and wing feathers share buffers by layer and pivot. | Watch the forefeet in a walk and the overlap of folded primaries at the flank. The hind and forelegs still use different contact systems. |

The shared torso uses dorsal and ventral station coordinates so the withers, chest and neck can take different paths. Two bone influences distribute rotation along the neck or human trunk. The hoof solver and its pivots remain in use. The original owl wing builder stays on its existing path. No new runtime dependency was introduced.

## Performance

Single-specimen studio runs in Chromium 156.0.8078.79 using ANGLE/SwiftShader. The table gives **before → Stage 1** for high LOD. Each median covers 30 walking frames after 10 warm-up frames. The timer covers the update, draw and a synchronous pixel readback. Habitat geometry is excluded. The earlier survey included habitat geometry and used a different timing method.

| Species | Draw calls | Triangles | Median ms | p95 ms |
|---|---:|---:|---:|---:|
| Centaur | 45 → 47 | 26,072 → 35,764 | 82.55 → 69.8 | 97.4 → 83.3 |
| Unicorn | 37 → 36 | 19,352 → 22,676 | 37.4 → 51.4 | 69.7 → 69.7 |
| Hippogriff | 151 → 59 | 25,828 → 28,568 | 66.2 → 69.95 | 80 → 81.4 |

The hippogriff submits fewer draws, with a higher triangle count and a higher measured LOD 0 median. The centaur carries the largest increase in triangles, principally in the face, locks and continuous torso. At LOD 1 and 2 its median also increased. The timings come from one software-rendered run per revision. Mobile GPU cost and production-world performance remain unmeasured. [Full LOD measurements](measurements.json)

## Review plates and movement

### Centaur

| View | Before | Stage 1 |
|---|---|---|
| Front clay | [Before](centaur-baseline-front-neutral.png) | [Stage 1](centaur-lab-front-neutral.png) |
| Side clay | [Before](centaur-baseline-side-neutral.png) | [Stage 1](centaur-lab-side-neutral.png) |
| Rear clay | [Before](centaur-baseline-rear-neutral.png) | [Stage 1](centaur-lab-rear-neutral.png) |
| Three-Quarter clay | [Before](centaur-baseline-three-quarter-neutral.png) | [Stage 1](centaur-lab-three-quarter-neutral.png) |
| Detail clay | [Before](centaur-baseline-detail-neutral.png) | [Stage 1](centaur-lab-detail-neutral.png) |
| Front silhouette | [Before](centaur-baseline-front-silhouette.png) | [Stage 1](centaur-lab-front-silhouette.png) |
| Side silhouette | [Before](centaur-baseline-side-silhouette.png) | [Stage 1](centaur-lab-side-silhouette.png) |

[Movement clip](centaur.mp4)

### Unicorn

| View | Before | Stage 1 |
|---|---|---|
| Front clay | [Before](unicorn-baseline-front-neutral.png) | [Stage 1](unicorn-lab-front-neutral.png) |
| Side clay | [Before](unicorn-baseline-side-neutral.png) | [Stage 1](unicorn-lab-side-neutral.png) |
| Rear clay | [Before](unicorn-baseline-rear-neutral.png) | [Stage 1](unicorn-lab-rear-neutral.png) |
| Three-Quarter clay | [Before](unicorn-baseline-three-quarter-neutral.png) | [Stage 1](unicorn-lab-three-quarter-neutral.png) |
| Detail clay | [Before](unicorn-baseline-detail-neutral.png) | [Stage 1](unicorn-lab-detail-neutral.png) |
| Front silhouette | [Before](unicorn-baseline-front-silhouette.png) | [Stage 1](unicorn-lab-front-silhouette.png) |
| Side silhouette | [Before](unicorn-baseline-side-silhouette.png) | [Stage 1](unicorn-lab-side-silhouette.png) |

[Movement clip](unicorn.mp4)

### Hippogriff

| View | Before | Stage 1 |
|---|---|---|
| Front clay | [Before](hippogriff-baseline-front-neutral.png) | [Stage 1](hippogriff-lab-front-neutral.png) |
| Side clay | [Before](hippogriff-baseline-side-neutral.png) | [Stage 1](hippogriff-lab-side-neutral.png) |
| Rear clay | [Before](hippogriff-baseline-rear-neutral.png) | [Stage 1](hippogriff-lab-rear-neutral.png) |
| Three-Quarter clay | [Before](hippogriff-baseline-three-quarter-neutral.png) | [Stage 1](hippogriff-lab-three-quarter-neutral.png) |
| Detail clay | [Before](hippogriff-baseline-detail-neutral.png) | [Stage 1](hippogriff-lab-detail-neutral.png) |
| Front silhouette | [Before](hippogriff-baseline-front-silhouette.png) | [Stage 1](hippogriff-lab-front-silhouette.png) |
| Side silhouette | [Before](hippogriff-baseline-side-silhouette.png) | [Stage 1](hippogriff-lab-side-silhouette.png) |

[Movement clip](hippogriff.mp4)

Stage 1 is awaiting structural review. The next decision is whether the three junctions and the hippogriff wing fold are ready for approval or need another focused iteration.
