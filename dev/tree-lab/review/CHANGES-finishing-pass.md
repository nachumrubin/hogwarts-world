# Structural finishing pass: technical change report

Baseline `35d542d` → this commit. No foliage, no bark textures, no wind, no new species.

All evidence uses the same capture protocol before and after: lab capture pipeline, 1200×900, neutral studio
light, LOD 0, one 36 m common frame for full-tree views, the same camera presets. The files:
* `before-after/<specimen>-before-after.png`: before and after rows (front, side and ¾ clay, front silhouette,
  trunk and junction close-ups).
* `before-35d542d/`: the previous sheets, diagnostics, fingerprints and mesh audit.
* `<specimen>-review-sheet.png`, `compare-*.png`, `diagnostics.json`, `fingerprints.txt`, `mesh-audit.txt`:
  current state.

## 1. Specimen corrections

| | height | crown (x × z) | DBH | primary limbs | branches | change |
|---|---|---|---|---|---|---|
| Oak A, Survivor | 18.9 → 18.9 m | 23.5 × 32.8 (unchanged) | 2.11 m | 5 | 1,803 | growth unchanged; meshing-level fixes only |
| Oak B, Ancient Guardian | 19.1 → 19.4 m | 25.9 × 28.7 → 24.8 × 26.9 | 2.21 m | 5 → 6 | 2,467 → 2,024 | outward/oblique secondaries, lobed crown boundary |
| Oak C, Forest Veteran | 24.8 → 24.6 m | 15.1 × 16.3 → 17.4 × 18.4 | 1.50 m | 5 → 6 | 531 → 853 | curved trunk, richer upper crown, lower limbs not straight |
| Scots pine | 20.4 → 21.6 m | 13.9 × 14.9 → 13.4 × 11.3 | 1.19 m | 2 → 3 | 1,721 → 1,729 | no tiers, irregular whorls, individual limb courses, new broken ends |
| Silver birch | 21.1 → 21.0 m | 10.0 × 9.7 → 9.0 × 10.4 | 0.59 m | 10 → 8 | 1,309 → 1,093 | primaries individually varied; no regular umbrella spiral |

**Oak A.** Its skeleton fingerprint is unchanged (`818b09d7df02`, `tools/baseline.ts`): same seed, growth, node
positions, history and silhouette. It changes only through the shared meshing fixes in section 2: root flare
without undercut, junction handover, bark frame and tessellation.

**Oak B.** These are new growth-model terms in `OakConfig`; Oak A doesn't use them.
* `outward`: secondary and finer shoots are pulled away from the stem axis, so they grow out and obliquely.
* `twigUp`: the twig up-turn is reduced from 0.10 to 0.03.
* `crownLobes`: the hydraulic height limit varies over the crown with low-frequency noise (±2.6 m, 7 m wavelength).
  The crown boundary is now uneven instead of a flat ceiling.
* `wander`: a deterministic position-noise pull on limbs.
* Stronger structural fairing, so the wander doesn't create hooks.

The broad parkland form is kept: 19.4 m tall, crown 24.8 × 26.9 m. It is about 1.8 m narrower on the long axis
than before, because the shoots no longer fill the flat outer shell.

**Oak C.**
* `stemSway`: a low-frequency lateral pull on the leader, from two incommensurate waves with a 9 m wavelength,
  faded out near the height limit. The trunk now curves gently instead of standing as a straight pole, and its
  top doesn't hook over.
* Upper ramification: weaker apical control on limbs (λ 0.50 → 0.44), longer bud life (2 → 3 periods), less
  shedding (0.045 → 0.038). Branches went from 531 to 853, mostly in the upper crown.
* `lowDroop` and `wander`: shaded lower limbs sag, then turn up, and meander, so they are no longer straight
  whips.
* Stem fairing starts just above the bole (9.5 m).

The clear bole (about 9 m) and the forest-grown proportions are kept.

**Scots pine.** Each shoot gets a persistent habit: an elevation bias and a turning rate that fades with shoot age.
The habit comes from a hash of the shoot's first node, so the growth RNG stream is undisturbed. Further changes:
* Wider whorl elevation spread.
* Irregular whorl spacing (leader increment ×0.62–1.38).
* Occasional shoots between whorls.

Together these remove the tiered, coat-hanger layering. The flat, uneven umbrella crown, long self-pruned stem and
deadwood are kept. Crown 13.4 × 11.3 m; 73 dead primaries shed or snapped.

**Silver birch.** Each primary gets its own character from a second RNG stream, so the main stream (which
primaries exist, the twig curtains) is unchanged:
* Departure angle about 20–65° from vertical.
* Arch strength ×0.45–1.6.
* A sideways bend and wander.
* An ascending tip on about 35% of primaries.
* Length ×0.7–1.3.
* Clustered vertical spacing with gaps, and a looser spiral.

The slender stem and the pendulous twigs are kept. There are 28 primaries (33 before), and crown density is not
increased.

## 2. Shared structural fixes (framework)

* **Root flare without undercuts** (`fusion.ts`, `FusionOpts.flare`). Below a species-specific band above ground
  (oak 1.2 m, pine 0.8 m, birch 0.5 m), each point of the blended surface also takes the shape found up to
  0.8 m / 0.5 m / 0.35 m higher, expanded by a slope. The copies are combined with a near-hard minimum, so the
  surface doesn't inflate. Before, the flare bulged into a lip with a downward-facing underside, and the ground cut
  through beneath it: the dark jagged line at every oak base. The stem now widens continuously into the ground. Oaks
  use 10 lifted steps, because 6 left a faint line.
* **Same-branch blending** (`fusion.ts`). Segments of one branch, up to four joints apart, now join with a light
  blend (0.12 r) instead of the full junction blend (0.55 r). The full blend had inflated straight stems by about
  15% in rings, making them fatter than the tubes continuing them; a plain minimum left a crease at every joint.
* **Tube handover** (`mesher.ts`, `fusion.ts`).
  * The blended surface relaxes to the bare branch and sinks 20% inside it, in step with the relaxation.
  * The tube starts 1.0 m before the exit point, measured along the branch, which is the full relaxation band.
    It ramps from 0.9 r to 1.0 r over its first 0.25 m, and starts with a ring interpolated exactly at the cut.
  * Before: oblique limbs carried two near-coincident surfaces over a metre or more, which z-fought in bands. A
    thick stem's first ring could fall past the end of the base, leaving a gap.
* **Bark frame** (`math.ts`, `barkSample`).
  * Bark used the world angle around the origin. On off-centre limbs that hardly varies, so the pattern turned
    into rings. On blended surfaces it used the nearest segment's axis, which switches at every joint and drew
    lines there.
  * Now tubes use their own continuous parallel-transported ring angle and arc length. Main stems and blended
    surfaces share the world angle and height, so the pattern is continuous across the handover.
  * The pattern is periodic in angle, so there is no seam at the wrap.
  * Along-branch detail finer than a tube's ring spacing (oak plates, pine flakes, birch lenticels) is left to the
    bark material instead of aliasing into rings.
  * Oak limb relief is about half the bole's.
* **Broken branch ends** (`mesher.ts`, `brokenCap`). The snap is now on an oblique plane: a few long splinters on
  the tension side, a short shredded compression side, narrowing fibres, and a low broken face. Normals come from
  the faces. Before, the cap was a symmetric crown of spikes. Pine stubs also vary in length, droop and taper.
* **Branch collars.** The emergence swell peaks just inside the parent (×1.22 r, not ×1.45) and fades over about
  5 r. This was already in `35d542d` and is unchanged.
* **Shadow bias** (`viewer.ts`, rendering only). The normal offset and depth bias are slope-scaled at grazing
  light angles. This removes shadow acne bands on edge-lit limbs. The geometry is unchanged.

## 3. Performance audit

`tools/meshaudit.ts` splits each mesh into blended junction and root surfaces and swept tubes by radius class.
The full output is in `mesh-audit.txt` (now) and `before-35d542d/mesh-audit.txt`.

**Findings (35d542d):**
* **Fine twig geometry is the main cost.** Below 3 cm there's no bark relief, yet tubes got a ring every 3.5 cm
  whether the branch bent or not: about 1,000 triangles per metre on oak twigs. Branches under 3 cm were 56% of
  Oak B's LOD0 and 94% of the birch's (2,050 m of pendulous twigs).
* **Radial tessellation** (sides = 2πr / 4.5 cm, 5–72) is proportionate, so it is unchanged.
* **Junction meshes.**
  * Blended surfaces were 23–25% of each oak.
  * 18–28k triangles per oak lay entirely underground and could never be seen.
  * The enlarged Oak B and Oak C regions blended plain limb and trunk at about 5× the cost per metre of a tube with
    the same bark relief.
* **Redundant vertices and triangles:** the underground faces, plus their vertices.

**Changes:**
* **Curvature-adaptive rings on branches under 3 cm** (LOD0; 6 cm at LOD1, 20 cm at LOD2). The spline is sampled
  every 2 cm. A ring is kept only where the dense spline would leave the straight run between kept rings by more
  than 0.12 r (minimum 1.5 mm), where the radius changes by more than 8% (this traces collar flares), or at
  live/dead changes and broken ends. Thicker branches keep the radius-based spacing their bark relief needs. This
  is not decimation: the dense spline is the reference, and the tolerance is relative to the branch radius.
* **Underground faces of blended surfaces** (more than 10 cm below the ground the roots were grown on) are not
  emitted, and unused vertices are compacted out.
* **Tighter blend regions:** Oak B's top lowered from 9.5 m to 7.5 m. Oak C's grid coarsened from 4.5 cm to 6 cm.
  Pine and birch regions raised (to 2.8 m and 2.2 m) so that the handover sits above the flare.

**Effect on visible structure:** with identical skeletons (the tessellation change alone), matched review shots
differed in 0.15–0.6% of pixels, all anti-aliasing on twig edges. Close-ups were indistinguishable.

| LOD0 | triangles before → after | vertices before → after | geometry before → after |
|---|---|---|---|
| Oak A | 629,734 → 354,111 (−44%) | 364,627 → 204,550 | 25.1 → 14.1 MB |
| Oak B | 867,537 → 395,880 (−54%) | 502,142 → 229,468 | 34.5 → 15.8 MB |
| Oak C | 332,449 → 188,094 (−43%) | 187,330 → 109,287 | 13.0 → 7.5 MB |
| Scots pine | 482,525 → 216,985 (−55%) | 290,291 → 133,161 | 19.7 → 9.0 MB |
| Silver birch | 795,176 → 173,912 (−78%) | 479,256 → 106,191 | 32.5 → 7.2 MB |

LOD1 is now 37–139k triangles and LOD2 4–21k. Geometry memory is the vertex and index buffers. Figures are from
the browser's `diagnostics.json`. Node's `fingerprints.txt` differs by a few dozen triangles on the oaks, probably
because Chrome's and Node's V8 builds evaluate floating-point maths slightly differently. Generation is
deterministic within a runtime.

**Generation time** (headless Chrome Worker on 2 CPU cores shared with the software GPU): mesh LOD0 went from
0.7–3.9 s to 2.8–10.4 s (Node, without the GPU competing for the CPU: 2.7–8.3 s). The
increase is the root-flare look-ups (about 3 s of Oak A's blended surface) and the dense 2 cm reference sampling.
It runs in the generation worker, off the UI thread. This is the main thing to optimise next, for example
per-block flare capsule lists, or limiting the look-ups to near the surface.

**Frame time:** still only software-rendered here, so no GPU performance claims. The lower triangle counts help
directly wherever the meshes are drawn.

## 4. Remaining structural defects

1. **Pine and birch stems:** a faint horizontal ring where the root-flare band fades out (pine about 0.8 m, birch
   about 0.5 m). A soft line where the tube takes over from the blended base.
2. **Oak forks:** a narrow crossing band where a limb's tube takes over at the region boundary (visible on Oak C's
   main limb), and faint dotted creases where the nearest capsule switches inside blended crotches.
3. **Oak A:** the low limb that bends toward the viewer in the front view (preserved architecture). 23 minor
   direction reversals, all high in the crown.
4. **Oak B:** about 1.8 m narrower on its long axis than before. 34 minor reversals on thin shoots (r < 0.15 m).
5. **Birch:** the leader runs on above the uppermost primaries for a few metres.
6. **Studio light:** the neutral studio preset casts crisp twig shadows across limbs. That reads as striping in clay
   close-ups; the overcast and low-sun presets show the surfaces without it. The preset is unchanged, so before and
   after stay comparable.
7. **Generation time** has gone up (section 3).
