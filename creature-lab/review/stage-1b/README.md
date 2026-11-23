# Stage 1B structural review

[Open the paired gallery](https://nachumrubin.github.io/hogwarts-world/review/stage-1b/) · [Stage 1 review archive](../stage-1/) · [Reviewed source at 97096d3](https://github.com/nachumrubin/hogwarts-world/tree/97096d37f0ba4d66e95900cac4618f3f31805427/creature-lab)

| Specimen | What to inspect | Stage 1B clip |
|---|---|---|
| Centaur | The clavicles and sternum shape the chest above a narrower waist. The upper arms share boundary vertices with the deltoids and follow shoulder bones in the walk. The horse’s shoulder, carpus and fetlock follow one skinned leg surface. | [Walk · 4 s](centaur-walk.mp4) |
| Unicorn | The slimmer neck bends from the withers as the poll flexes. The chest shifts forward and down between staggered forelegs. Watch the muzzle during the grazing hold and the hoof soles as the animal rises. | [Graze · 7.5 s](unicorn-graze.mp4) |
| Hippogriff | The shoulder turns the wing aft along the flank. The elbow and wrist gather the feather fans, with the coverts layered over the longer flight feathers. The upper foreleg nests under the ruff and tapers toward the talon. | [Folded → extended → folded · 7 s](hippogriff-fold-unfold.mp4) |

## Matched plates

The gallery has eight before/after pairs per species. Each pair shares a 640 × 480 orthographic projection, camera offset, studio lights, exposure, high-detail geometry and fixed simulation steps. Three-quarter, side, front and detail plates use the resting pose. The action plates show a walking stride, a low graze and extended wings. The clips use 24 frames per simulated second and follow the root in translation.

## Geometry and motion checks

The centaur torso and arms formed a closed, consistently wound mesh at all three detail levels. The original weighted trunk continues through the human–equine junction.

On a level floor, a 240-frame unicorn test at 60 Hz measured less than 10⁻¹² m of movement in each hoof sole centre. The forehooves were staggered by 30.7 cm. During the last second of the graze, the lowest muzzle vertex varied between 2.35 and 5.55 mm above the floor. The revised clip also shows the transition back to standing.

The hippogriff intersection check covered 482 sampled poses per detail level. It used 121 evenly spaced wing openings and 361 simulation frames through unfolding, folding, flapping, flight and landing. Triangle checks found zero intersections among the 45 feathers of the right wing or between those feathers and the torso or neck collar. The wings are mirrored and stayed at least 36.2 cm from the midline. Contact between sampled poses was outside the test. The owl wing implementation is byte-identical to Stage 1.

## Performance

Both revisions ran in the same Chromium 156 session with ANGLE/SwiftShader, a single specimen walking in the studio, a 640 × 480 framebuffer and a tracking orthographic camera. Each detail level ran ten warm-up frames and thirty timed frames. The timer includes update, camera tracking, draw and a synchronous one-pixel readback. These are single-run software-renderer timings. Hardware GPU performance remains unmeasured.

| Specimen, LOD 0 | Draws before → after | Triangles before → after | Median ms before → after | p95 ms before → after |
|---|---:|---:|---:|---:|
| Centaur | 47 → 37 | 35,764 → 34,372 | 69.80 → 67.55 | 82.10 → 91.50 |
| Unicorn | 36 → 28 | 22,676 → 21,188 | 59.80 → 60.15 | 73.80 → 78.40 |
| Hippogriff | 59 → 59 | 28,568 → 30,248 | 78.85 → 83.20 | 92.50 → 93.70 |

[All detail levels, 540 raw timings, source hashes and renderer settings](measurements.json)

Stage 1B awaits structural review.
