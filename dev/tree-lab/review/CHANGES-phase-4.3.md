# Tree Lab, Phase 4.3: LOD transition fidelity

Baseline: 8d541c3 (Phase 4.2).
- **Default chain:** chain B (LOD0 → LOD1 shoot cards → impostor) stays the default.
- **Four-level chain:** chain A (clump cards) stays selectable and is part of the benchmark. No work went into the clump cards.
- **Frozen:** skeletons, bark, crown architecture, the LOD0 foliage distribution and the specimen seeds are unchanged.
  - The one shared-data effect on LOD0 is described in §7.
- **Transitions:** hysteresis and the complementary cross-fade are kept.
  - A reversal mid-fade now continues from its current blend (§8).

All renders and timings come from SwiftShader (software). No hardware performance is claimed.

## 1. Method

* **Protocol measurements.** Definitions are identical to Phase 4.2:
  - Tools: `tools/evidence/lodcheck.js` and `tools/lod_metrics.py`.
  - Both sides of each switch are rendered at the switch size, 900 × 900, in `day` light.
  - Views: eye level (0.12 rad) and overhead (1.45 rad), azimuth 0.6.
  - "Before" is the Phase 4.2 run of 8d541c3. `tools/lod_compare.py` writes the table and the before/after sheets.
* **Angular set.** Elevations 0°, 45° and 90° at azimuths 0.6 and 2.7 rad, at both switches, for Oak B, Oak C, the
  pine and the birch. Same tools; results in `lod-angular.md`.
* **Shading diagnostics.** New: `viewer.diag`, `tools/evidence/diag.js`, `tools/diag_metrics.py`. The foliage shader writes one term
  at a time:

  | mode | term |
  |---|---|
  | 1 | unlit albedo |
  | 2 | world normal |
  | 3 | visible leaf side |
  | 4 | direct sun |
  | 5 | ambient |
  | 6 | transmission off |
  | 7 | self-shadowing off |
  | 8 | coverage |
  | 10 | card or blade facing |
  | 12 | top mip only (no mip filtering, no alpha boost) |
  | 13 | full linear |
  | 14 | ground shadow alone |
  | 15 | tone-mapped output |
  | 16 | top-mip coverage |

  - Wood and ground are drawn magenta and the background black. Each pixel's term is therefore recovered exactly from
    its foliage coverage (un-premultiplied), and the terms add up: LOD0 direct + ambient + transmission matches the full
    shading to within 8-bit precision.
  - A first attempt drew the sky behind the terms. That blended every partly covered pixel with the sky and made the
    terms non-additive, so its numbers were discarded. A half-scale attempt was also discarded: it samples one mip level
    coarser than the real switch, and filtering turned out to be decisive.
* **Diagnostic baseline.** Diagnostics for "before" come from a worktree of 8d541c3 with only the diagnostic modes added.

## 2. Pine luminance: root cause

Pine LOD0 → LOD1 at the switch size (700 px), seven elevations, azimuth 0.6, 8d541c3. Linear means over foliage pixels;
LOD1 relative to LOD0 (`review/lod/pine-diagnostics.md` has every term):

| elevation | coverage (pts) | protocol luminance | albedo | direct sun | ambient | full shading | self-shadow off | undersides seen (LOD0 / LOD1) | normal up-component |
|---|---|---|---|---|---|---|---|---|---|
| 0° | -7.2 | -19.0 % | -39.3 % | -48.4 % | -14.4 % | -20.5 % | -31.4 % | 0.48 / 0.70 | -0.14 / -0.29 |
| 15° | -9.2 | -23.4 % | -43.5 % | -35.7 % | -22.3 % | -24.7 % | -33.0 % | 0.46 / 0.49 | +0.01 / +0.05 |
| 30° | -9.1 | -28.2 % | -47.6 % | -31.0 % | -29.6 % | -28.9 % | -34.0 % | 0.46 / 0.28 | +0.15 / +0.36 |
| 45° | -10.3 | -33.9 % | -50.5 % | -32.6 % | -35.2 % | -33.5 % | -36.0 % | 0.45 / 0.13 | +0.29 / +0.57 |
| 60° | -10.9 | -39.7 % | -51.7 % | -37.2 % | -39.0 % | -38.1 % | -40.5 % | 0.45 / 0.07 | +0.42 / +0.63 |
| 75° | -12.1 | -41.4 % | -52.0 % | -38.7 % | -41.4 % | -39.4 % | -43.3 % | 0.46 / 0.06 | +0.52 / +0.64 |
| 90° | -11.8 | -38.5 % | -52.0 % | -33.8 % | -42.3 % | -36.5 % | -41.3 % | 0.46 / 0.06 | +0.55 / +0.63 |

The error does not come from lighting balance or shadows: with self-shadowing disabled LOD1 is just as dark. It comes
from four defects in how the spray-card atlas stored the 3D needles, and in how the renderer read that data back:

1. **Bake data: premultiplied colour stored as straight colour.** The card generator composited every leaf and needle
   "over" a black, empty texel and kept the result as straight colour. Every partly covered texel was darkened.
   - Needles are two to three texels wide, so 31% of pine card texels were partly covered, darkened by up to 38%.
   - The atlas mean was 13% below the needles it was made from.
   - Dilation then copied the darkened edge colours into the transparent texels that mips average.
   - Oak and birch leaves are broad: 2–3% of their texels were affected.
2. **Normal reconstruction: lost out-of-plane component.**
   - The atlas stored a card-space normal's x and y. The renderer rebuilt z as (2·side − 1)·√(1 − x² − y²), where
     "side" is the share of leaves whose upper side faces the card's front.
   - For needles the generator wrote a side share of 0.5, which gives z = 0: every pine card normal lay in the card
     plane.
   - Cards face the sky, so from above the needles were lit edge-on (direct sun −31 to −48%), and from below their
     normals pointed down.
3. **Bake data: side channel.** The side share was multiplied by coverage before saving and composited premultiplied.
   Its mips therefore averaged in zeros, and from above LOD1 showed almost no needle backs (6% against LOD0's 46%).
   It lost the paler underside colour as well (albedo −39 to −52%).
4. **Filtering: needle normals collapse.** This defect was hidden by defect 2 and appeared once z was rebuilt from the
   side.
   - With z implicit, filtering (mips, trilinear, anisotropic) shortened the averaged x and y, and the renderer rebuilt z
     to unit length. Every distant needle texel then faced the card's front.
   - In that intermediate state, LOD1's mean normal up-component from above was 0.87 against LOD0's 0.55, with direct
     sun +21% overhead and −37% at eye level.
   - Selection-based normal mips did not help, because the sampler averages again at sample time. Storing z and lighting
     with the mean normal did help (§3).

Coverage (−7 to −12 points) is a separate, smaller cause: the cards carry the generator's needles (§5), but at the
switch distance each LOD0 fascicle renders as an opaque blob of its 2 × 1 px quad.

## 3. Corrections

Physically motivated (shared by all species):

* **Card atlas: premultiplied compositing.**
  - Colour, normal, roughness and side are composited premultiplied from zero and divided by coverage once a card is
    complete (`tools/foliage_textures.py`).
  - The side channel is no longer masked before saving.
* **Card atlas: folded normals with z stored.**
  - Each texel's normal is folded to the card's front hemisphere. Its z is stored in the blue channel; roughness becomes
    each species' sprite mean (0.43 oak, 0.35 birch, 0.40 pine).
  - The side channel says whether the folded side is the blade's upper side.
  - Needle blades are treated exactly like leaves, as LOD0 does.
  - The stored normal is the blade's own normal, without the scan's normal map. LOD0 filters that detail away and
    renormalises.
* **Mean-normal lighting.**
  - Filtering now averages whole normals. The renderer uses the averaged vector's length ℓ: the share ℓ of the texel is
    lit along the mean normal, and the rest is lit as normals spread over the hemisphere facing the viewer (mean
    (1 + V·L)/4).
  - Transmission uses the mean-normal share only, because light through the spread share passes other needles of the
    same tuft first.
  - Card normal mips are plain averages, with no Toksvig renormalisation.
* **Untilted spray frame.** Each LOD1 card's tilt about its spray axis (±40° in the V pair) is stored per instance. The
  atlas leaves are shaded in the untilted frame, so they keep LOD0's attitude to the light whichever way their card
  leans. Before this, Oak B's tilted cards showed paler undersides at eye level (+11.8%) and caught less sun from above
  (−9.8%). LOD0's interior cards are flagged untilted and are unchanged.
* **Projected-area coverage correction.**
  - A card texel shows its leaf's area foreshortened twice: once onto the card when the atlas was drawn (|n·n₀|), and
    once by the card's angle to the view (|n_c·V|). LOD0 shows the same leaf at |n·V|.
  - Coverage is scaled by r = |n·V| / (|n·n₀| |n_c·V|), limited to 0.33–3, on LOD1 cards.
  - This restored Oak B's overhead coverage (−8.7 → −3.5 points) without changing card density.
  - It is not applied to the birch (see calibrations).
* **Shadow casting of pine cards.** Needles get a 2.5× alpha boost in the shadow pass. Fascicles had it; pine cards made
  of the same needles did not, and cast a fraction of LOD0's shadow (LOD1 lost 5% of its light to self-shadowing where
  LOD0 loses 18%).
* **Card shadow lookup offset.** The offset is half the card's width (the distance to its V partner) instead of a fixed
  0.35 m. Measured: this made little difference (< 2%).
* **Translucency of cards.** Set to the scans' measured mean, 0.75, instead of 0.72.

Calibrations that remain (documented, not hidden):

* **Pine card alpha boost:** 1.5 per mip level against the fascicles' 0.5, set by a measured sweep (0.5, 1.0, 1.5, 2.2).
  - At the switch distance every LOD0 fascicle renders as an opaque blob of its quad, far more than its needles cover.
  - The cards carry the same needles (leaf area matches the generator's, §5) but cannot blob the same way.
  - The shadow-pass boost of pine cards scales with this value.
* **Birch: no projected-area correction.** Birch curtains overlap so much that the correction, which assumes leaves do
  not hide each other, over-covered the birch from above (+8.2 points). Capping r at 1.5 for every species made the oaks
  and the birch worse (measured), so the correction is off for the birch layer only.
* **Impostor self-shadowing exponent:** 1.0, against LOD1. It was 0.6, measured against Phase 4.2's LOD1; LOD1's shading
  changed.

Tried and rejected (measured, no benefit):
- narrower V angles (±26°, ±20°) alone: they trade eye-level coverage for overhead coverage;
- card shadows sampled at the shadow texel's footprint mip: pine got brighter;
- mean-normal lighting with no spread term: too dark;
- a spread term for transmission too: too bright;
- capping r at 1.5.

## 4. Oak B and Oak C brightness (eye level, LOD0 → LOD1)

The breakdown at 7° shows what was left after the untilted-frame shading:
- **Shading:** the foliage shading itself agreed (full linear −0.1%, output over foliage pixels +0.7%).
- **Protocol metric:** it still read +5.3%. Its mask includes partly covered pixels blended with the bright sky; the
  real background decides those pixels, so the residual follows coverage.
- **Overhead:** the background is dark ground, and the residual darkness followed the coverage deficit there.

No per-specimen calibration is used. Results in §6.

## 5. Overhead crown coverage

* **Card orientation distribution.** Measured from the generator's own instances (`/home/claude/work/p43/gfun.ts`):
  oak leaves present 2.09× their eye-level projected area from above, the V-paired cards 1.34×. Cards have to contain
  their spray axis, while LOD0's leaves face the light whatever the shoot's direction.
* **Leaf area.** The cards carry the generator's leaves:
  - card leaf area ÷ LOD0 leaf area is 0.81–0.87 for the oaks and 0.64 for the pine. Those are the projection losses
    expected for leaves facing the card and for needles turned at random (2/π);
  - the birch is 1.57.

  So density was not the problem and was not increased.
* **Edge-on cards and mips.** The atlas sampler is already 8× anisotropic, and the coverage-preserving per-cell mips are
  unchanged.
* **Fix:** the projected-area correction (§3).

## 6. Results

The 20 protocol measurements. Cameras, light, resolution and metric definitions are identical to Phase 4.2. Sheets:
`review/lod/before-after-<specimen>.jpg`.

Coverage within ±5 points: 14 of 20; luminance within ±5 %: 8 of 20.

| specimen | boundary | view | coverage before → after (pts) | Δ coverage before → after | Δ luminance before → after | ΔE after | IoU after | triangles | instance bytes | overdraw | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Oak A | LOD0 → LOD1 (700 px) | eye | 59.4 → 57.0 ⇒ 59.4 → 56.0 | -2.4 → -3.5 | +1.1 % → +2.2 % | 0.8 | 0.69 | 2,123,801 → 230,630 | 4.20 → 0.53 MB | 1.83 → 1.51 | pass |
| Oak A | LOD0 → LOD1 (700 px) | over | 69.5 → 59.2 ⇒ 69.5 → 63.7 | -10.2 ✗ → -5.8 ✗ | -8.5 ✗ % → -6.6 ✗ % | 1.7 | 0.67 | 2,123,801 → 230,630 | 4.20 → 0.53 MB | 1.85 → 1.50 | fail |
| Oak A | LOD1 → impostor (140 px) | eye | 56.8 → 67.7 ⇒ 53.5 → 62.4 | +10.9 ✗ → +8.8 ✗ | -5.2 ✗ % → +1.9 % | 1.1 | 0.55 | 230,630 → 2 | 0.53 → 0.00 MB | 1.52 → 0.00 | fail |
| Oak A | LOD1 → impostor (140 px) | over | 51.6 → 63.6 ⇒ 56.8 → 65.7 | +11.9 ✗ → +8.9 ✗ | -4.3 % → -3.1 % | 1.0 | 0.66 | 230,630 → 2 | 0.53 → 0.00 MB | 1.50 → 0.00 | fail |
| Oak B | LOD0 → LOD1 (700 px) | eye | 68.5 → 67.7 ⇒ 68.5 → 65.9 | -0.8 → -2.6 | +8.5 ✗ % → +6.6 ✗ % | 1.6 | 0.74 | 2,315,340 → 291,734 | 4.57 → 0.72 MB | 2.06 → 1.73 | fail |
| Oak B | LOD0 → LOD1 (700 px) | over | 71.9 → 63.2 ⇒ 71.9 → 68.5 | -8.7 ✗ → -3.5 | -6.6 ✗ % → -5.6 ✗ % | 1.2 | 0.72 | 2,315,340 → 291,734 | 4.57 → 0.72 MB | 1.98 → 1.63 | fail |
| Oak B | LOD1 → impostor (140 px) | eye | 63.3 → 73.1 ⇒ 59.3 → 68.0 | +9.8 ✗ → +8.7 ✗ | -2.8 % → +6.5 ✗ % | 1.5 | 0.65 | 291,734 → 2 | 0.72 → 0.00 MB | 1.70 → 0.00 | fail |
| Oak B | LOD1 → impostor (140 px) | over | 58.9 → 66.3 ⇒ 64.6 → 68.5 | +7.4 ✗ → +3.9 | -2.2 % → -1.7 % | 0.6 | 0.71 | 291,734 → 2 | 0.72 → 0.00 MB | 1.61 → 0.00 | pass |
| Oak C | LOD0 → LOD1 (700 px) | eye | 50.9 → 48.5 ⇒ 50.9 → 47.7 | -2.4 → -3.2 | +7.1 ✗ % → +4.2 % | 1.8 | 0.71 | 1,266,368 → 134,908 | 2.56 → 0.32 MB | 2.05 → 1.64 | pass |
| Oak C | LOD0 → LOD1 (700 px) | over | 61.9 → 50.5 ⇒ 61.9 → 55.6 | -11.4 ✗ → -6.3 ✗ | -7.6 ✗ % → -7.6 ✗ % | 1.6 | 0.65 | 1,266,368 → 134,908 | 2.56 → 0.32 MB | 1.86 → 1.50 | fail |
| Oak C | LOD1 → impostor (140 px) | eye | 54.1 → 61.2 ⇒ 51.2 → 51.4 | +7.1 ✗ → +0.2 | +0.2 % → +9.1 ✗ % | 2.2 | 0.60 | 134,908 → 2 | 0.32 → 0.00 MB | 1.61 → 0.00 | fail |
| Oak C | LOD1 → impostor (140 px) | over | 57.8 → 65.1 ⇒ 63.1 → 61.3 | +7.4 ✗ → -1.8 | +1.2 % → +2.5 % | 0.6 | 0.57 | 134,908 → 2 | 0.32 → 0.00 MB | 1.47 → 0.00 | pass |
| Scots pine | LOD0 → LOD1 (700 px) | eye | 57.2 → 50.6 ⇒ 57.3 → 52.3 | -6.6 ✗ → -5.0 | -20.8 ✗ % → +5.1 ✗ % | 4.8 | 0.89 | 1,468,041 → 271,163 | 11.84 → 0.71 MB | 1.94 → 1.47 | fail |
| Scots pine | LOD0 → LOD1 (700 px) | over | 67.5 → 57.2 ⇒ 67.7 → 63.3 | -10.3 ✗ → -4.3 | -40.0 ✗ % → +7.0 ✗ % | 2.5 | 0.89 | 1,468,041 → 271,163 | 11.84 → 0.71 MB | 1.48 → 1.33 | fail |
| Scots pine | LOD1 → impostor (140 px) | eye | 37.4 → 38.9 ⇒ 37.4 → 33.2 | +1.5 → -4.2 | -2.2 % → +19.6 ✗ % | 4.5 | 0.63 | 271,163 → 2 | 0.71 → 0.00 MB | 1.44 → 0.00 | fail |
| Scots pine | LOD1 → impostor (140 px) | over | 58.3 → 52.6 ⇒ 58.4 → 41.6 | -5.7 ✗ → -16.9 ✗ | +0.8 % → +7.4 ✗ % | 2.4 | 0.42 | 271,163 → 2 | 0.71 → 0.00 MB | 1.32 → 0.00 | fail |
| Silver birch | LOD0 → LOD1 (700 px) | eye | 57.8 → 58.9 ⇒ 57.8 → 58.9 | +1.1 → +1.1 | -1.9 % → +4.5 % | 4.0 | 0.72 | 1,736,574 → 240,482 | 3.74 → 0.82 MB | 1.83 → 1.80 | pass |
| Silver birch | LOD0 → LOD1 (700 px) | over | 68.4 → 66.6 ⇒ 68.4 → 66.6 | -1.8 → -1.8 | +1.0 % → +15.7 ✗ % | 3.8 | 0.79 | 1,736,574 → 240,482 | 3.74 → 0.82 MB | 2.54 → 2.63 | fail |
| Silver birch | LOD1 → impostor (140 px) | eye | 69.1 → 74.0 ⇒ 69.1 → 69.8 | +4.9 → +0.7 | -0.9 % → +7.5 ✗ % | 1.9 | 0.77 | 240,482 → 2 | 0.82 → 0.00 MB | 1.80 → 0.00 | fail |
| Silver birch | LOD1 → impostor (140 px) | over | 73.7 → 81.9 ⇒ 73.7 → 76.5 | +8.2 ✗ → +2.8 | +4.7 % → +2.4 % | 1.3 | 0.82 | 240,482 → 2 | 0.82 → 0.00 MB | 2.57 → 0.00 | pass |

The birch impostor was rebaked once more after its LOD1 changed (the area-correction exception), and its two impostor
rows were re-measured.

* **Previously passing measurements that now fail** (the "no regressions" criterion is **not** met):
  - Oak B impostor at eye level: luminance −2.8 → +6.5%.
  - Oak C impostor at eye level: luminance +0.2 → +9.1%.
  - Pine impostor at eye level: luminance −2.2 → +19.6%.
  - Pine impostor overhead: luminance +0.8 → +7.4%.
  - Birch LOD0 → LOD1 overhead: luminance +1.0 → +15.7%.
  - Birch impostor at eye level: luminance −0.9 → +7.5%.
* **Fixed:** 8 coverage failures, and the luminance failures of Oak A at the impostor and Oak C LOD0 → LOD1 at eye level.
* **Improved but still failing:** pine LOD0 → LOD1 (−20.8 → +5.1%, −40.0 → +7.0%).

Angular set (worst cases per specimen and switch; every view is in `review/lod/lod-angular.md`):

Angular set: elevations 0°, 45° and 90° at azimuths 0.6 and 2.7 rad, for Oak B and the pine (time allowed two of the
five specimens; the other three have only the protocol views):

| specimen | boundary | views | worst Δ coverage (view) | worst Δ luminance (view) | views passing |
|---|---|---|---|---|---|
| Oak A | LOD0 → LOD1 (700 px) | 2 | -5.8 (over) | -6.6 % (over) | 1 of 2 |
| Oak A | LOD1 → impostor (140 px) | 2 | +8.9 (over) | -3.1 % (over) | 0 of 2 |
| Oak B | LOD0 → LOD1 (700 px) | 8 | -7.5 (e45@2.7) | +21.2 % (e0@2.7) | 0 of 8 |
| Oak B | LOD1 → impostor (140 px) | 8 | +10.8 (e0) | -13.9 % (e0@2.7) | 1 of 8 |
| Oak C | LOD0 → LOD1 (700 px) | 2 | -6.3 (over) | -7.6 % (over) | 1 of 2 |
| Oak C | LOD1 → impostor (140 px) | 2 | -1.8 (over) | +9.1 % (eye) | 1 of 2 |
| Scots pine | LOD0 → LOD1 (700 px) | 8 | -5.8 (e45@2.7) | +44.7 % (e0@2.7) | 0 of 8 |
| Scots pine | LOD1 → impostor (140 px) | 8 | -16.9 (over) | +19.6 % (eye) | 2 of 8 |
| Silver birch | LOD0 → LOD1 (700 px) | 2 | -1.8 (over) | +15.7 % (over) | 1 of 2 |
| Silver birch | LOD1 → impostor (140 px) | 2 | +2.8 (over) | +7.5 % (eye) | 1 of 2 |

The angular set finds directional failures the protocol views miss:
- **Backlit views** (azimuth 2.7, looking towards the sun): LOD1 is far too bright at low elevations (pine +44.7%,
  Oak B +21.2%), from card transmission (§11).
- **Straight overhead:** pine LOD1 is +14% at 90° against +7% at the protocol's 83°.

## 7. LOD0

LOD0's deep-interior sprays (shoots below a sky exposure of 0.22–0.3) are drawn as spray cards and share the card
atlas. They therefore carried the same defects and receive the same corrections. They are flagged untilted, so they get
neither the untilted-frame shading nor the area correction.

Measured LOD0 change at the protocol views: luminance +0.5 to +1.0%, coverage unchanged (0.0 points), ΔE ≤ 0.3. The
leaf and needle sprites, their sampling, mips and shadows are untouched.

## 8. Impostors

* **Dark internal contours: root cause and fix.**
  - The normal atlas's blue channel packed two things: wood or leaf (below or above 0.5) and occlusion.
  - Bilinear filtering between a twig texel and a leaf texel passed through 0.5, which decoded as "leaf, no sky", so
    black lines traced every twig and branch edge inside the clumps.
  - Simulated on the baked atlas: 10–11% of covered texels sat in that band. The simulation reproduced the lines
    (`review/lod/impostor-occlusion-sim.png`).
  - Fixed: b holds occlusion alone, and leaf or wood is decided by colour (leaves and needles g > r, bark and twigs
    g ≤ r). The encoding version is part of the atlas fingerprint.
  - Magnified check: `review/lod/impostor-contours.jpg`.
* **Excess coverage.**
  - The impostor sharpened its blended alpha to a hard 0.5 threshold. That rounded every half-covered texel up, and every
    frame-blend mismatch to the union. It now passes coverage straight to alpha-to-coverage (box-filtered mips keep the
    mean), sharpening only when magnified more than 2×.
  - Oak C now passes; Oak A and Oak B are still about +9 points at eye level (§10).
* **Kept:** the Phase 4.2 bake transparency (binary per sample), premultiplied resolve and division by coverage, and the
  normal filtering (an octahedral-fold simulation showed under 0.2% of normals affected, so it is not the contour
  source).
* **Shadows during cross-fades.** The impostor shadow pass drew every instance, so during an LOD1 ↔ impostor fade both
  representations cast and the shadow was their union. Only the side with more weight now casts. The shadow cache key
  follows the casting side of incoming and outgoing impostors (it missed incoming ones crossing halfway).

## 9. Transitions

`tools/evidence/transitions.js`: the 200-tree stand, stepped at 30 frames a second with the live LOD machinery
(projected size as on a 1080p screen, 12% hysteresis, 0.6 s cross-fades). After every step the expected shadow casters
(draws that cast, impostors on their casting side) are compared with the viewer's dirty flag.
- A stale frame (casters changed, map not flagged) would be a correctness bug.
- A redundant redraw is wasted work only.

| path | seconds | switches | boundaries crossed | max switches per tree | reversals within 1 s | max simultaneous fades | shadow caster changes | stale shadow frames | redundant redraws |
|---|---|---|---|---|---|---|---|---|---|
| aerial impostor crossing | 40 | 308 | 1↔3 | 2 | 0 | 44 | 196 | 0 | 1004 |
| ground approach and retreat | 60 | 368 | 1↔3, 0↔1 | 4 | 0 | 11 | 371 | 0 | 1429 |
| high forest traversal | 20 | 0 | — | 0 | 0 | 0 | 181 | 0 | 419 |
| low broom flight | 20 | 156 | 1↔3, 0↔1 | 2 | 0 | 24 | 231 | 0 | 369 |
| orbit | 24 | 182 | 1↔3, 0↔1 | 3 | 1 | 13 | 214 | 0 | 506 |
| rapid direction reversals | 12 | 0 | — | 0 | 0 | 0 | 180 | 0 | 180 |
| vertical ascent and descent | 80 | 319 | 1↔3, 0↔1 | 4 | 0 | 25 | 293 | 0 | 2107 |

* **Shadow cache:** no stale shadow map on any path.
  - Redundant redraws are frequent, because the viewer flags the map on any draw-list change.
  - Rendered checks during fades: the frame drawn with the cache and the frame drawn with a forced redraw were identical
    in all three checks. All three happened to need a redraw anyway, so the cached path itself was not exercised by
    these renders; the numeric check above covers it.
* **Aerial path through the impostor threshold:** a descent from 600 m to 60 m and back crosses LOD1 ↔ impostor
  (308 switches over 200 trees, at most 2 per tree, no reversals).
* **Reversals:** none within a second on any path except the orbit (one tree once). The "rapid direction reversals"
  path (±6 m every 0.4 s) never crossed a threshold, which shows the hysteresis band holds but tests little else.
  - Reversals mid-fade are covered by the unit tests (`tests/treelab-lod.test.ts`): they now continue from the current
    blend instead of restarting it, which popped.
* **Simultaneous transitions:** up to 44 trees cross-fading at once (aerial crossing).
* **Shadow continuity:** during an LOD1 ↔ impostor fade only one side casts, never both (fixed, §8).
* **Fade length:** the paths record the longest stretch a tree spent mid-fade as up to 16 s. Those are trees culled
  mid-fade, whose state pauses until they are back in view; visible trees finish in 0.6 s.
* **Culling and shadows:** frustum culling also removes culled trees from the shadow casters, so trees just outside the
  view cast no shadow into it. This is pre-existing and not fixed.


## 10. Hardware benchmark mode

`?bench=<scene>&cam=ground|aerial&res=WxH&shadow=N&frames=N&chain=B|A|both&motion=0|1`, or the Inspect panel.

* **Timings,** as median, p95 and p99:
  - CPU per frame: command recording and submission; LOD selection, culling and cross-fades when moving;
  - wall time per frame;
  - GPU pass times from timestamp queries: the shadow pass, the main pass, and in a second run the main pass split into
    bark and ground, foliage, and impostors and sky. The split passes store and reload attachments, so their sum exceeds
    the single pass.
* **Other records:**
  - draw calls and triangles;
  - pixel workloads: foliage fragments rasterized (alpha-rejected ones included), foliage coverage and overdraw, and
    impostor fragments and coverage, counted at half resolution without depth rejection;
  - allocated GPU memory, by category;
  - shadow-map redraws;
  - trees per LOD at the start and the end.
* **Moving camera:** walking at 1.4 m/s, or broom flight at 20 m/s at 80 m, 60 frames a second. The shadow map is
  redrawn only when its casters change.
* **LOD chains:** three-level (B) and four-level (A, clump cards) run with identical scenes and cameras, so they are
  directly comparable.
* **Procedure** on hardware:
  1. Open `…/dev/tree-lab/?bench=suite&res=1920x1080&shadow=2048&frames=300&chain=both` in Chrome.
  2. Repeat with `&motion=1`.
  3. Keep the two JSON downloads.
* **Software check:** SwiftShader run (`review/lod/bench-smoke-swiftshader.json`: Oak B, ground, 640 × 360, moving camera, both chains,
6 frames). It checks that every field is filled: timestamps, split passes, p50/p95/p99, pixel workloads, LOD counts
and the software warning. Its timings are those of a CPU rasterizer and say nothing about GPU performance.
* No hardware numbers yet.

## 11. Deficiencies

1. **The acceptance criteria are not met.**
   - Coverage passes in 14 of 20 measurements, luminance in 8 of 20. Six previously passing luminance measurements fail
     (§6).
   - The worst cases are in §6. The angular set is worse than the protocol views.
2. **Backlit card transmission (main open defect).** Looking towards the sun at low elevations, LOD1 is up to 45% (pine)
   and 21% (Oak B) too bright.
   - LOD0 tests each needle's or leaf's transmission against the shadow on its own sunlit side, and inside the crown that
     is mostly dark.
   - A card's transmission uses the card's own shadow lookup and a single mean-normal share.
   - Next step: a transmission shadow test equivalent to LOD0's, at the texel's depth inside its spray.
3. **Impostors brighter than the new LOD1** at eye level (pine +19.6%, Oak C +9.1%, Oak B +6.5%, birch +7.5%).
   - The bake stores each texel's unit visible normal, not the card's mean-normal length. The impostor therefore lights
     needle and leaf texels as if aligned.
   - The normal atlas's alpha duplicates the albedo's coverage and could carry that length; this needs a bake change and
     a rebake (about 1.5 h in SwiftShader).
4. **Oak A and Oak B impostor coverage** is about +9 points at eye level.
   - Likely cause (not verified): the atlas draws the tree at about 86 px, so the baked LOD1 receives the distance alpha
     boost of a smaller tree than the 140 px at which the impostor appears.
   - The fix is to bake with the switch size's mip level, plus a rebake.
5. **Pine impostor coverage overhead,** −16.9 points (it was −5.7). Unsharpened coverage keeps the mean, but sparse
   needles become partly covered pixels, which the protocol's silhouette (at least 65% covered) does not count.
   Sharpening half-way measured −7.2 (§3).
6. **Birch overhead** (LOD0 → LOD1 +15.7%) and **oak overhead** (Oak A −6.6%, Oak C −7.6%, coverage −5.8 / −6.3
   points) remain.
7. **Calibrations:** the pine card alpha boost (1.5), the birch exception to the area correction, and the impostor
   self-shadow exponent (1.0). §3 gives their measurements.
8. **Pre-existing, found here:**
   - Frustum culling removes culled trees from the shadow casters (shadows at the view's edge).
   - Shadow-map redraws are often redundant.
   - Fade state pauses while a tree is culled.
9. **Evidence gaps:**
   - The post-correction pine sweep over all seven elevations was not rerun; the angular set covers 0°, 45° and 90° at
     two azimuths.
   - Only Oak B and the pine have the angular set.
   - No videos, as the brief asked.
10. **No hardware measurements.** The benchmark mode is ready (§10); the numbers have to come from a run on real
    hardware.
