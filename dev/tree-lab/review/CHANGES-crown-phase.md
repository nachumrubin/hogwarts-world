# Tree Lab — Phase 4.1: crown realism and foliage scalability

Baseline: 72e8685 (Phase 4, foliage). Skeletons, bark meshes and bark materials are unchanged (section 9). No wind,
no seasons, no new species. The photographic leaf and needle scans are the same; every crown change is in the
generator (`src/framework/foliage.ts`), the card atlases built from those scans, and the shading.

Evidence lives in `review/crown/`. Phase 4 images were rendered by the 72e8685 build itself (a worktree), with the
same cameras, lights and lab code paths, so every pair is matched.

## 1. Crown structure: recursive sprays, not more leaves

Phase 4 put one shoot (with a few laterals for oak) at each point of bearing wood, so the leaves sat close to the
skeleton and the crown read as foliage stuck onto branches. 4.1 grows a small **twig system** at every point:

* **Leader → laterals → sub-laterals** (`spray` in the species spec). Oak: 3–5 laterals at 30–60° with 1–3
  sub-laterals each; birch: 2–4 lateral spurs, sub-spurs in the fullest crowns; pine: 0–2 side shoots per tuft.
  Laterals alternate across the light plane or spiral round the leader by a per-species `volume` (0 = flat spray,
  1 = all round), so sprays have depth without being spheres.
* **Reach:** sprays lean out of the crown (oak 0.6 m, Oak B 0.45 → more), so the crown edge is made of foliage
  instead of the skeleton's tips, and neighbouring sprays overlap.
* **Leaves per metre of shoot** instead of per shoot (oak 18/m, birch 24/m): leaf numbers follow twig length, and
  the light model still thins shaded shoots and sheds the darkest (internal openings stay, structural limbs stay
  visible).
* **Fullness** (0…1) scales spray spacing, sub-shoots and reach: the density experiments' control (section 3).
* **Interior spray cards:** a spray whose leader is in deep shade (exposure below 0.22–0.3) is drawn as one crossed
  spray card even at LOD0. It is seen only through the outer leaves, and gives the interior volume at ~1/40 of the
  cost of its leaves (Oak B: 3,432 cards instead of ~70k leaves).

Oak B has the same number of leaves as in Phase 4 (207,821 vs 209,367) but a fuller crown: the change is where the
leaves are, not how many.

### Species corrections

* **Oak A:** fullness 0.8, density 0.88 (was 0.72), slightly less shade shedding: moderately fuller; the dead top
  and the storm-broken limb stay bare (bearing wood is live, unbroken wood only).
* **Oak B:** density 1.15, more reach: the fullest oak, irregular interconnected masses; major limbs visible
  through the openings.
* **Oak C:** density 1.1, less shedding, light from above only: a fuller upper crown on the tall clear trunk.
* **Pine:** each shoot turns up towards its tip; fascicles spiral and splay wider towards the tip (rounded tufts,
  not flat brushes), needles curved, slightly longer; side shoots give the tufts 3D volume; pigment lighter
  glaucous blue-green (section 5). The silhouette and whorl structure are the skeleton's and unchanged.
* **Birch:** lateral spurs along the pendulous long shoots, spreading sideways (droop applies weakly to the spurs),
  wider and airier sprays; the trunk and the arching primaries are the skeleton's and unchanged. The repeated arches
  came from long unbranched hanging strings of leaves; with spurs they read as sprays.

Per specimen, Phase 4 → 4.1 (`tools/timing.ts`; instance bytes are what the GPU holds: 64 B → 20 B per instance):

| | leaves / fascicles | leaf area m² | LOD0 instances | LOD0 triangles | LOD0 instance MB | LOD1 instances (MB) | LOD2 instances |
|---|---|---|---|---|---|---|---|
| Oak A | 152,314 → 193,996 | 518 → 673 | 194,013 → 220,418 | 1.55M → 1.76M | 11.8 → 4.2 | 41,699 (2.55) → 27,932 (0.53) | 2,339 → 8,156 |
| Oak B | 209,367 → 207,821 | 748 → 733 | 273,375 → 239,765 | 2.19M → 1.90M | 16.7 → 4.6 | 64,008 (3.91) → 37,748 (0.72) | 2,522 → 9,088 |
| Oak C | 99,810 → 119,374 | 306 → 387 | 123,565 → 134,210 | 0.99M → 1.07M | 7.5 → 2.6 | 23,755 (1.45) → 16,982 (0.32) | 1,339 → 4,196 |
| Scots pine | 502,515 → 619,464 | 128 → 169 | 502,515 → 620,986 | 1.01M → 1.25M | 30.7 → 11.8 | 40,366 (2.46) → 37,114 (0.71) | 785 → 1,452 |
| Silver birch | 66,562 → 146,369 | 80 → 198 | 97,780 → 196,108 | 0.78M → 1.56M | 6.0 → 3.7 | 31,218 (1.91) → 43,066 (0.82) | 1,360 → 3,096 |

LOD0 triangles grew for the pine (+24 %) and the birch (×2, it was far too sparse), fell for Oak B (−13 %), and grew
13 % for Oak A and 8 % for Oak C. Instance memory fell by 61–72 % for every specimen. LOD1 is one crossed spray card per
spray instead of one card per shoot: 33–41 % fewer instances for the oaks, 79–82 % less memory.

## 2. Lighting (§5)

Phase 4 close-ups measured 0.19–0.21 sRGB on the foliage, the pine 0.13, the view up into Oak B 0.126 (typical
photographs of sunlit summer crowns: 0.25–0.4). Causes and fixes, each physically motivated:

1. **Leaf reflectance was about half the measured value.** Summer leaves reflect ~0.10–0.12 (linear) in the green
   (front face); the recolour targets were 0.05–0.07. New targets: oak (0.058, 0.102, 0.024), birch lighter and
   yellower (0.070, 0.118, 0.028), pine glaucous (0.046, 0.082, 0.066). This is a calibration of the albedo, not a
   compensation for lighting: the scans' variation is kept.
2. **No light scattered inside the crown.** Leaves pass on roughly half the light they intercept, so interior
   leaves receive sky light scattered between leaves. Added as sky × (1 − exposure) × 0.3 plus a small sun share.
3. **No sky transmitted through the blades.** A thin leaf transmits the sky above it to its underside (the
   dominant light looking up into a crown). Added with the leaf's translucency map.
4. **AO floor:** 0.4 → 0.55 for leaves (the crown occlusion is already in the exposure term).
5. **Cards:** a card stands for a spray's worth of leaves at all angles, so it is lit by the leaf-angle average
   (about half the leaves face the sun whichever way the card faces), and its shadow is tested a spray's depth
   (0.35 m) towards the sun so the crossed partner card does not shadow it. Lit by its own plane, LOD1 was 25–35 %
   darker than the leaves it replaces; closer, but not matched: at the 700 px switch LOD1 still covers 11–38 % more pixels and is 14–28 % darker than LOD0
   (mean sRGB of foliage pixels: Oak B 0.28 → 0.24, pine 0.38 → 0.27, birch 0.35 → 0.27). LOD1 → LOD2 now match
   within 2 % in luminance. This is the largest remaining LOD defect (section 8).
6. **Self-shadow bias:** unchanged for leaves (normal offset and slope bias were already right; the dark crowns were
   reflectance and missing interior light, not acne).

Before → after (mean sRGB of foliage pixels, matched cameras): 
| shot | Oak A | Oak B | Oak C | Scots pine | Silver birch |
|---|---|---|---|---|---|
| full-day | 0.29 → 0.33 | 0.28 → 0.31 | 0.28 → 0.33 | 0.33 → 0.39 | 0.37 → 0.35 |
| elevated | 0.31 → 0.35 | 0.28 → 0.31 | 0.30 → 0.36 | 0.31 → 0.39 | 0.34 → 0.34 |
| up | 0.17 → 0.24 | 0.14 → 0.20 | 0.19 → 0.27 | 0.15 → 0.22 | 0.21 → 0.25 |
| interior | 0.16 → 0.25 | 0.14 → 0.23 | 0.13 → 0.22 | 0.16 → 0.21 | 0.13 → 0.20 |
| macro | 0.15 → 0.20 | 0.16 → 0.19 | 0.13 → 0.23 | 0.14 → 0.19 | 0.21 → 0.23 |

The views into and under the crowns gained most (+25–70 %); the full-tree daylight views +10–20 %. The birch
full views are slightly darker (0.37 → 0.35) because the crown is now denser and self-shadows; its interior is +57 %.

## 3. Density experiments (§3)

Three levels per specimen: the **Phase 4 baseline** (rendered by the 72e8685 build), **moderate** (this generator at
fullness × 0.55) and **full** (fullness as defined: the chosen level). Four views from explicit orbits computed from
the woody-skeleton bounds (identical in both builds): ground level (camera 1.6 m above the ground, looking up at the
whole tree), eye level with the crown, elevated (24°) and directly above (86°). Daylight, LOD0, neutral studio plot.
Sheets: `crown/density-<specimen>.jpg`; numbers: `crown/density-coverage.json`.

**Crown fill** is the opaque share of the crown envelope in a silhouette render (the envelope is the silhouette closed
with a disk of 3.5 % of the image and hole-filled; the trunk is included). 1 − fill is the projected gap fraction.

| specimen | level | LOD0 instances | LOD0 triangles | instance MB | crown fill ground / eye / elevated / above | overdraw mean (eye) |
|---|---|---|---|---|---|---|
| oak-a | phase4 | 194,013 | 1,552,104 | 11.8 | 0.57 / 0.54 / 0.52 / 0.59 | 2.09 |
| oak-a | moderate | 197,805 | 1,579,208 | 3.8 | 0.65 / 0.61 / 0.59 / 0.65 | 1.80 |
| oak-a | full | 220,418 | 1,758,928 | 4.2 | 0.66 / 0.62 / 0.60 / 0.67 | 1.96 |
| oak-b | phase4 | 273,375 | 2,187,000 | 16.7 | 0.61 / 0.61 / 0.64 / 0.66 | 2.38 |
| oak-b | moderate | 227,937 | 1,809,800 | 4.3 | 0.68 / 0.68 / 0.70 / 0.71 | 2.12 |
| oak-b | full | 239,765 | 1,904,392 | 4.6 | 0.67 / 0.67 / 0.70 / 0.71 | 2.18 |
| oak-c | phase4 | 123,565 | 988,520 | 7.5 | 0.47 / 0.50 / 0.52 / 0.59 | 2.34 |
| oak-c | moderate | 122,562 | 979,456 | 2.3 | 0.52 / 0.54 / 0.55 / 0.66 | 1.93 |
| oak-c | full | 134,210 | 1,072,432 | 2.6 | 0.53 / 0.56 / 0.56 / 0.67 | 2.04 |
| pine | phase4 | 502,515 | 1,005,030 | 30.7 | 0.61 / 0.58 / 0.62 / 0.62 | 1.62 |
| pine | moderate | 533,654 | 1,069,476 | 10.2 | 0.64 / 0.61 / 0.59 / 0.67 | 1.72 |
| pine | full | 620,986 | 1,245,016 | 11.8 | 0.65 / 0.61 / 0.59 / 0.68 | 1.84 |
| birch | phase4 | 97,780 | 782,240 | 6.0 | 0.47 / 0.45 / 0.42 / 0.45 | 1.42 |
| birch | moderate | 175,650 | 1,398,128 | 3.4 | 0.65 / 0.62 / 0.60 / 0.70 | 1.76 |
| birch | full | 196,108 | 1,559,112 | 3.7 | 0.66 / 0.64 / 0.62 / 0.73 | 1.85 |

Findings:

* 4.1 is fuller than Phase 4: the oaks +4…+9 points in every view, the birch +19…+28 points; the pine +3…+6
  from the ground, eye level and above, but −3 from the elevated view (its tufts are rounder and leave more sky between whorls). Phase 4's
  birch (fill 0.42–0.47) was the clearest failure, and is now in line with the oaks.
* Moderate → full adds little (0–3 points) for 5–16 % more triangles: most of the gain comes from the spray
  structure, not from density. The fullness control saturates because fuller sprays also widen the envelope.
* Overdraw (mean foliage fragments per covered pixel, eye level) fell for the oaks (Oak B 2.38 → 2.18) despite the
  fuller look: interior spray cards replace many overlapping shaded leaves. It rose for the pine and birch (1.62 →
  1.84, 1.42 → 1.85), which simply have more foliage.
* Instance memory is 61–72 % lower at every level (packed instances).
* Reference: summer crowns of open-grown broadleaves are commonly described with crown porosity of roughly 0.15–0.4,
  i.e. fill 0.6–0.85 (this range is from general forestry literature, not checked against photographs here; the
  image search shows photographs to you but not to me). The full level puts the oaks and birch at 0.53–0.73,
  inside or just below that range; Oak C's flanks (0.53–0.56 from the side) are open by design (forest-grown).

**Selected: full**, per specimen as defined (Oak A at 0.8: a declining veteran). Moderate would save 5–16 %
triangles for an almost invisible change and is a reasonable setting for a lower quality tier.

## 4. Rendering efficiency (§4)

Measured on the GPU (fragment counts and memory are exact on any adapter; no timings are quoted, see section 6).
"Do not assume that reducing triangle counts reduces GPU frame time": the cost measured here is rasterized fragments,
including the ones the alpha test then throws away, which is what alpha-tested foliage pays for.

**Evaluated and adopted**

* **Packed instances (20 B instead of 64 B):** positions unorm16 in a fixed tree-local frame (x/z ±40 m, y −5…75 m:
  1.2 mm steps), length unorm16 (0–2 m), orientation snorm8 quaternion, width log2-coded unorm8 (0.5 mm–0.5 m,
  2.8 % steps), fold, curl, sprite cell, exposure, colour variation unorm8. Decoded in the vertex shader. LOD0
  instance memory: Oak B 15.3 → 4.8 MB, pine 39.7 → 12.4 MB, birch 12.6 → 3.9 MB (−69 %). No visible change
  (quantization is below a pixel at any LOD0 distance).
* **Shared GPU buffers:** one vertex buffer per specimen-LOD; sets address it by 256-byte-aligned offsets (2–3
  buffers → 1, fewer allocations and bindings; no measurable effect expected on its own).
* **Multi-leaf atlases (spray cards):** each card is a whole spray at true scale (oak 1.0 m, birch 0.6 m, pine
  0.32 m; leader, laterals and leaves drawn as the generator grows them), so leaf size no longer jumps at the LOD1
  switch, and one crossed card replaces a spray of 3–9 shoot cards (LOD1 instances −33…−41 % for the oaks).
* **Tighter card boundaries:** each card kind (spray, clump) draws a convex hull of its opaque texels, simplified to
  8 vertices and grown until nothing is clipped (6 triangles instead of 4). The hulls cover 22–65 % of the quad.

| specimen · LOD | quads: fragments per foliage pixel · useful share | hull-fitted | fragments saved |
|---|---|---|---|
| oak-b · LOD0 | 9.6 · 23 % | 5.9 · 37 % | 38 % |
| oak-b · LOD1 | 23.4 · 12 % | 9.9 · 29 % | 58 % |
| oak-b · LOD2 | 13.7 · 17 % | 4.1 · 56 % | 70 % |
| pine · LOD0 | 40.4 · 4 % | 39.9 · 5 % | 1 % |
| pine · LOD1 | 12.6 · 19 % | 8.2 · 30 % | 35 % |
| pine · LOD2 | 10.0 · 25 % | 4.2 · 59 % | 59 % |
| birch · LOD0 | 10.3 · 18 % | 6.6 · 28 % | 35 % |
| birch · LOD1 | 42.2 · 5 % | 15.8 · 14 % | 63 % |
| birch · LOD2 | 14.5 · 14 % | 5.1 · 40 % | 66 % |

  LOD0 includes the interior spray cards; the pine's LOD0 is needles only (no cards), so unchanged. Hull-fitted
  cards remove 35–70 % of the fragments at LOD1 and LOD2. Remaining overdraw is real leaf overlap.
* **Alpha coverage preservation:** for each mip level of each layer, the scale that keeps the fraction of texels
  above the alpha-test threshold equal to level 0's (Castaño's method; `alpha_scales` in
  `tools/foliage_textures.py`), applied to a copy of the mip chain at load. Measured crown fill (silhouette opaque
  share of the crown envelope) with the tree 700 / 160 / 60 px tall, LOD0 forced:

| specimen | none | Phase 4 heuristic | coverage-preserving | **chosen** (preserving + small boost) |
|---|---|---|---|---|
| oak-b | 0.62 / 0.38 / 0.33 | 0.74 / 0.67 / 0.64 | 0.63 / 0.46 / 0.59 | 0.73 / 0.67 / 0.67 |
| pine | 0.42 / 0.27 / 0.33 | 0.56 / 0.37 / 0.33 | 0.42 / 0.27 / 0.34 | 0.57 / 0.37 / 0.33 |
| birch | 0.24 / 0.20 / 0.24 | 0.58 / 0.57 / 0.55 | 0.29 / 0.36 / 0.24 | 0.57 / 0.59 / 0.60 |

  Coverage preservation alone does not hold the fill (oak 0.63 → 0.46 at 160 px): A2C's soft edge at minification
  still loses thin leaves. Phase 4's heuristic held it by brute force (alpha × (1 + 0.22 × mip level)). Chosen:
  preserved mips plus a smaller boost (0.15; needles 0.5), the most distance-stable for oak and birch (±5–7 %). The
  pine still thins at distance with every setting; at those sizes it is drawn as LOD2 or impostor, not LOD0.
* **Projected-size LOD selection:** each tree's LOD from its projected height (LOD0 ≥ 700 px, LOD1 ≥ 240, LOD2 ≥ 110,
  impostor below), with frustum culling; replaces Phase 4's fixed 35 / 110 m distances. It follows resolution and
  tree size (a 30 m oak and an 18 m birch at the same distance get different LODs). 12-tree stand, same ground camera
  as Phase 4: 3.24M + 0.72M triangles (foliage + bark) instead of 4.55M + 1.22M.
* **Near-camera-only LOD0 residency:** a specimen's LOD0 bark and foliage buffers are released when no tree has used
  them for 4 s (live view) or are not needed for the current view (benchmark), and are uploaded again on demand.
  Benchmark: 80 MB released for the Oak B ground view, 91 MB for the 200-tree aerial view.
* **Species impostors** (section 5): one quad per distant tree, one draw for all of them.

## 5. Distant representation (§6)

**LOD2** was crossed clump cards (two uprights and a cap). Seen from the side, an upright card turned edge-on is a thin
vertical sliver, and the crowns turned into streaks. Each clump is now a **tent** of three cards 120° apart, leaning
out from the clump's axis (40°; the birch 15°, so its clumps stay hanging curtains), turned at random, with a cap card.
LOD1 → LOD2 now match within 2 % in luminance and 5–19 % in covered pixels at the 240 px switch
(`lod-transitions-*.jpg`).

**Impostor proof of concept** (`src/render/impostor.ts`; for all five specimens, the PoC sheets show Oak B, the pine and
the birch):

* **Frames:** 9 × 9 views over the upper hemisphere in a hemi-octahedral layout on grid vertices, so the horizon
  (walking) and the zenith (broom flight overhead) are both exact frames; 112 px per frame, 1008² atlas per species;
  orthographic, fitted to the bounding sphere of what is baked (LOD1 bark and spray cards).
* **Contents (unlit):** albedo with coverage (4× MSAA alpha-to-coverage resolve); tree-local normal
  (octahedral-coded) with crown occlusion, coded so bark (0–0.5) and leaves (0.5–1) are told apart (only leaves
  transmit light).
* **Run time:** one camera-facing quad per tree, one instanced draw for all impostors. The three frames around the
  view direction are blended by barycentric weights, and each frame is sampled where the view ray through the pixel
  meets that frame's projection plane, so the image changes with direction the way the tree does and never turns
  with the camera (`impostor-sweep-*.jpg`: 6° steps). The quad stands half a radius in front of the crown centre so
  steep views do not cut it into the ground. Lit at run time (sun with the crown's baked exposure as self-shadowing,
  sky, translucency), receives tree shadows, casts shadows (frames towards the sun, same shader).
* **Pre-baked atlases:** baking takes milliseconds on a GPU but 5–11 minutes per specimen on SwiftShader, so the
  lab's own baker (`tools/evidence/bake-impostors.js`) wrote the five atlases to `textures/impostor.*.webp`
  (lossless, 5.8 MB in total, loaded only when impostors are needed). They load (0.1–0.2 s) only when their
  fingerprint (the generated foliage and skeleton plus the foliage-texture hashes) matches the running build;
  otherwise the lab bakes again. GPU memory: 51.7 MiB for the five atlases with mips.

Measured at the 110 px LOD2 → impostor switch (`lod-transitions-*.jpg`): the impostor covers about the same pixels
and is 5 % (oak) to 13 % (birch) brighter and yellower. Up close (`impostor-*.jpg`, the tree at 3× its intended
size) the frames are soft and the birch's hanging strands break into clusters; at the size it is used (≤ 110 px tall)
that is below the frame resolution.

## 6. Hardware benchmark (§7)

In the Inspect panel ("Hardware benchmark") and by URL (`?bench=stand200&cam=aerial&res=1920x1080&shadow=2048&frames=120`,
or `bench=suite` for every scene × both cameras; the result is also in `window.__benchResult`).

* **Scenes:** Oak B, the pine, the birch alone; stands of 12, 50 and 200 trees (50 and 200 are generated
  deterministically: Poisson-disc spacing, oaks 45 %, birch 30 %, pine 25 %, every tree turned).
* **Cameras:** ground level (1.7 m, walking) and aerial (80 m, broom flight).
* **Settings:** resolution (720p to 4K), shadow map off / 1024² / 2048² / 4096², frames.
* **Per run:** adapter name, software flag, timestamp support; frame time median / p95 / mean (submit → GPU done,
  one frame at a time, with the shadow pass every frame); GPU pass time median / p95 from timestamp queries; draw
  calls; triangles; foliage instances; the LOD distribution (LOD0 / 1 / 2 / impostor / culled); resident memory
  (geometry, foliage instances, textures, impostor atlases, shadow map, render targets) and the LOD0 bytes released
  by residency. Downloaded as JSON.

Headless check (SwiftShader, 1280 × 720, shadow 2048², 3 frames; `crown/bench-headless-swiftshader.json`). These are
CPU-rasterizer timings and say nothing about GPU performance. They only show that the benchmark runs and what it
records. Real numbers need your run in Chrome or Edge on your hardware:

| scene · camera | draw calls | triangles | LOD 0/1/2/imp/culled | resident memory |
|---|---|---|---|---|
| oak-b · ground | 5 | 0.32M | 0/1/0/0/0 | 238 MB |
| stand200 · ground | 285 | 16.02M | 3/27/108/26/36 | 322 MB |
| stand200 · aerial | 130 | 2.12M | 0/0/63/137/0 | 254 MB |

Stands as rendered for the evidence (1200 × 800, projected-size LOD, no culling; `crown/stands/`):

| stand · camera | LOD 0/1/2/impostor | foliage triangles | bark triangles | overdraw (mean) |
|---|---|---|---|---|
| 12 · ground | 1/9/2/0 | 3.24M | 0.72M | 3.05 |
| 12 · aerial | 0/0/12/0 | 0.31M | 0.04M | 2.23 |
| 50 · ground | 6/32/12/0 | 15.35M | 3.15M | 4.47 |
| 50 · aerial | 0/0/1/49 | 0.03M | 0.00M | 3.16 |
| 200 · aerial | 0/2/86/112 | 2.20M | 0.37M | 3.50 |
| 200 · ground | see the benchmark row (3/27/108/26, 36 culled) | | | |

(The 200-tree ground statistics recorded with the image were taken after the live view had re-assigned LOD from
its own camera; the image is right and the benchmark row has the right numbers. Scripts now pin the stand camera.)

The 12-tree stand from the same ground camera as Phase 4: 3.24M foliage + 0.72M bark triangles (Phase 4, by distance:
4.55M + 1.22M). The 50-tree ground view is the heaviest scene (15.3M foliage triangles: 32 trees at LOD1): the
projected-size thresholds are a starting point to tune on hardware.

## 7. Evidence (§8)

All in `review/crown/` (Phase 4 images rendered by the 72e8685 build, matched cameras and lights, neutral studio
unless a woodland view):

* `compare-<specimen>.jpg`: overview per specimen (full tree, elevated, aerial, under the crown, interior,
  close-up, backlit), Phase 4 left, 4.1 right; `compare/<specimen>-<shot>.jpg`: every shot of the 13-shot foliage
  set as a pair (true-scale full tree, leafless, elevated, aerial, up, interior, macro, junction, backlit, woodland
  overcast, LOD0/1/2).
* `../compare-all.png`, `../compare-oaks.png`: the line-ups at true scale (summer silhouettes), 4.1.
* `density-<specimen>.jpg`, `density-table.md`, `density-coverage.json`: section 3.
* `alpha-coverage.jpg` / `.json`, `efficiency.json`: section 4.
* `impostor-<oak-b|pine|birch>.jpg` (eye, elevated, steep, overhead), `impostor-sweep-*.jpg`,
  `lod-transitions-*.jpg`, `impostor-stats.json`: section 5.
* `stands/`: 12, 50 and 200 trees from the ground and from 80 m, `stand-stats.json`; `bench-headless-swiftshader.json`.
* `foliage-luminance.json`: section 2's before/after luminance.
* `bark-regression/`: section 9.
* Per-specimen foliage sheets and shots (`../<specimen>-foliage-sheet.png`, `../foliage/`) are replaced by 4.1's.

## 8. Deficiencies

* **LOD0 → LOD1** at the 700 px switch: LOD1 is 14–28 % darker and covers 11–38 % more pixels. A visible step
  when walking towards a tree; the card lighting needs a per-species calibration against LOD0, or a dithered
  cross-fade.
* **Impostors** are 5–13 % brighter and yellower than LOD2 at the switch (birch most); the birch impostor up close
  loses its strands. Both are within a few pixels at the switch size, but noticeable on a large screen.
* **The 50-tree ground view** reaches 15M foliage triangles with the current thresholds; untested on hardware.
* **Pine from below** is dark blue-green and dense; the tufts read well from the side and above.
* **Oak A** is only moderately fuller, by intent (a declining veteran); if a healthy summer veteran is wanted, its
  fullness can go from 0.8 to 1.
* **GPU timings:** none. The benchmark is in place; no hardware numbers exist yet.
* **Reference photographs:** I could search for species photographs, but the search shows them to you, not to me,
  so I could not compare them pixel for pixel. Crown fill was compared with published gap-fraction ranges instead
  (section 3).

## 9. Bark regression

Leafless LOD0 close-ups (Oak A trunk, Oak B junction, pine trunk, birch trunk; 1200 × 900, daylight) rendered by the
Phase 4 build (72e8685) and by this build: **pixel-identical** (maximum difference 0 on all four). Skeletons and bark
meshes are generated by unchanged code; the bark shader's only change is the impostor bake output, which the lit
mode never takes. Files: `review/crown/bark-regression/`.
