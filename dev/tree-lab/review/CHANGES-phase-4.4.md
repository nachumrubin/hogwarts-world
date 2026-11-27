# Tree Lab, Phase 4.4: directional lighting and impostor fidelity

Starting commit: **24de3b8** (Phase 4.3, `world-v2-webgpu`).

Preserved:
- the skeletons, seeds, bark, crown architecture and LOD0 foliage distribution;
- the corrected atlas compositing, explicit normal z, untilted spray shading and impostor contour fix;
- hysteresis, the complementary cross-fade and the mid-fade reversal handling;
- chain B as the default, with chain A in the benchmark;
- the hardware benchmark interface, unchanged.

All measurements here are SwiftShader (software rendering) and none of them is GPU performance. No hardware results
exist yet.

**Decision for review: LOD0 changes at distance.** Two of the corrections below fix filtering defects in LOD0's own leaf
and needle atlas. Close up LOD0 is unchanged: every texel with coverage is byte-identical in normal and roughness, and
translucency differs only on single boundary texels (0.002%). At distance LOD0 now keeps its leaves' real translucency
and colour; §4 measures the change. I judged this a correction, not a regression, because it makes LOD0's appearance
independent of mip filtering. It does move the ground truth, so it is flagged for your review.

## 1. Method

Every correction followed the same steps:
1. Establish the baseline.
2. Change one mechanism, using a runtime switch (viewer `ex` / `ey` uniforms) or one atlas change.
3. Measure the affected terms.
4. Check the cases that already passed.
5. Keep only demonstrated improvements.

Tools:
- `tools/evidence/exp.js`: isolated renders of one LOD under several viewer settings.
- `tools/evidence/diag.js` with new modes:

  | mode | term |
  |---|---|
  | 17 | sun transmission alone |
  | 18 | transmission shadow factor |
  | 19 | direct shadow factor |
  | 20 | mean-normal length |
  | 21 | transmission geometry term |

- `tools/evidence/bakesize.js` and `tools/coverage_single.py`: the impostor bake-size hypothesis.
- `tools/evidence/reversal.js`: the mid-fade reversal test.

The protocol definitions (`tools/lod_metrics.py`) are unchanged. Integrated fractional coverage (Σ per-pixel coverage
over the finer side's envelope) is reported beside the threshold coverage as a diagnostic only.

## 2. Priority 1: backlit transmission

**Root cause (verified before correcting).**

Pine, LOD0 → LOD1 at the switch size, elevation 0°, backlit azimuth 2.7 rad (`diag.js`, 24de3b8 code):

| term | LOD0 | LOD1 |
|---|---|---|
| full shading (linear) | 0.0165 | 0.0278 (+69%) |
| sun transmission | 0.0010 | 0.0100 (10×) |
| transmission shadow factor | 0.71 | 0.77 |
| direct shadow factor | 0.69 | 0.77 |
| transmission geometry term (back) | 0.35 | 0.35 |
| direct | 0.0047 | 0.0051 |
| self-shadowing off | 0.0187 | 0.0318 (+70%) |

- **Shadows and geometry are not the cause.** Shadow factors and the back term agree, and the gap stays with shadows
  off.
- **The transmitted colour is.** It is albedo × translucency. LOD0 reads translucency per texel from the sprite atlas,
  and the atlas generator zeroed it in transparent texels. At the switch distance the sprites are sampled at deep mips,
  where translucency averaged down to about coverage × 0.75:

  | species | translucency at deep mips | cards |
  |---|---|---|
  | oak | 0.29 | 0.75 |
  | birch | 0.23 | 0.75 |
  | pine | 0.04 | 0.75 |

  So LOD0's leaves lost their translucency with distance: about 3× for oak and 19× for pine. That matches the measured
  directional failures (pine +44.7%, Oak B +21.2%) and their ordering.
- **The hypothesis in the brief, tested:** sampling the card's transmission shadow at the represented foliage depth (0.1
  of the card width, the card's plane, instead of the direct light's lookup half a card towards the sun) changed backlit
  pine by −1.4 points and Oak B by −1.7. Not kept: no demonstrated improvement.

**Correction.**
- The sprite atlas keeps translucency in transparent texels (computed from their dilated colour, like the colour).
- The sprite normal textures are Phase 4.3's decoded normal and roughness with the new translucency alpha, stored
  lossless (`tools/sprite_translucency.py`), so covered texels are byte-identical.

Result against the corrected LOD0, LOD1 unchanged:
- backlit pine +44.7% → −12.7%;
- backlit Oak B +21.2% → −1.6%.

## 3. Lighting model re-selected against the corrected LOD0

The 4.3 card lighting (mean-normal share plus a spread share for direct light) was chosen against a LOD0 with two
compensating defects: lost translucency (darker) and fringe-coloured mips (brighter, §4). Against the corrected LOD0,
three models were measured at eye level, overhead and backlit for the pine, Oak B, the birch and Oak C. The LOD0
references include the §4 colour mips.

LOD1 against the corrected LOD0, luminance difference (coverage is the same in all three models: pine −5.0 / −4.3 /
−4.1, Oak B −2.6 / −3.5 / −2.3, birch +1.1 / −1.8 / +1.3, Oak C −3.2 / −6.3 / −4.3 points):

| specimen, view | mixture (direct + transmission spread) | direct spread only | plain mean normal (kept) |
|---|---|---|---|
| pine, eye | +12.4 % | +9.5 % | −8.9 % |
| pine, overhead | +20.7 % | +18.8 % | −2.0 % |
| pine, backlit 0° | +18.4 % | +7.4 % | −0.4 % |
| Oak B, eye | +6.4 % | +5.7 % | +0.1 % |
| Oak B, overhead | +2.0 % | +1.4 % | −3.3 % |
| Oak B, backlit 0° | +9.7 % | +6.5 % | +4.1 % |
| birch, eye | +1.0 % | +0.5 % | −4.0 % |
| birch, overhead | +12.9 % | +12.5 % | +8.0 % |
| birch, backlit 0° | +9.7 % | +7.2 % | +4.7 % |
| Oak C, eye | +3.9 % | +3.0 % | −3.5 % |
| Oak C, overhead | +0.9 % | +0.4 % | −5.4 % |
| Oak C, backlit 0° | +5.8 % | +2.3 % | −0.5 % |
| within ±5 % | 4 of 12 | 5 of 12 | 9 of 12 |

Kept: the plain mean-normal model (Lambert of the averaged normal, exact for the lit part of a texel), 9 of 12 within
±5%. The mixture terms stay available as switches (`viewer.ey`). The impostor uses the same model (§5).

## 4. Priority 4: overhead defects, and LOD0's colour mips

**Root cause (Oak C overhead, `diag.js`).**
- LOD1 albedo was 16.9% below LOD0's; direct −10.9%, ambient −20%.
- The sprite atlas fills transparent texels with the dilated colour of the nearest leaf pixels, which in the scans are
  the lighter fringe (oak 0.110 against 0.081 inside the leaves; pine 0.100 against 0.071).
- The mips averaged colour without weighting by coverage, so at distance LOD0's leaves drifted towards the fringe
  colour, up to +36% at the deepest levels for the oak.
- The card atlas's fill is closer to its leaves' colour (0.086 against 0.081).

**Correction.** Foliage albedo mips are coverage-weighted (premultiplied average divided by coverage). Mip 0 is
unchanged, so close-up LOD0 is unchanged. It applies to the cards too.

**LOD0 change at the switch distance**, both §2 and §4, against Phase 4.3 LOD0 (same camera; coverage unchanged, 0.0
points, everywhere):

| specimen | eye (0.12 rad) | overhead (1.45 rad) | backlit 0°, azimuth 2.7 |
|---|---|---|---|
| Scots pine | −8.2 % | −15.6 % | +29.3 % |
| Oak B | −0.4 % | −8.1 % | +12.4 % |
| Oak A | −1.6 % | −8.4 % | — |
| Oak C | +0.1 % | −9.2 % | — |
| Silver birch | +2.2 % | +0.9 % | — |

Translucency kept with distance brightens backlit and side-lit leaves. Coverage-weighted colour removes the fringe
brightening, which darkens most from above, where the leaves are seen at the deepest mips. (For translucency alone,
before the colour mips: pine backlit +65.8%, eye +20.0%, overhead +13.7%; Oak B backlit +23.1%, eye +9.4%.)

**Remaining overhead defects** (after both corrections and the §3 model):
- Oak A overhead now passes luminance (−6.6% → −3.9%); Oak C overhead is −5.4% (was −7.6%), just outside.
- Both keep about −6 points of overhead coverage: the projected-area correction is in place, and the residual is in the
  angular matrix.
- Birch overhead luminance is +8.2% (was +15.7%).

Overlap: birch curtains overlap strongly, and the area correction is off for the birch (Phase 4.3, measured). No
density was changed.

## 5. Priority 2: impostor lighting

**Loss of mean-normal length.**
- The bake stored each texel's unit visible normal.
- Cards are lit by their mean normal's length × cosine, so needle and leaf texels with spread normals were lit as if
  aligned. That is why impostors were brighter than LOD1 at eye level (Phase 4.3: pine +19.6%, Oak C +9.1%, Oak B
  +6.5%, birch +7.5%).

**The proposed redundant alpha channel, evaluated and used.**
- Both atlases stored coverage in alpha, and the bake used alpha-to-coverage with a binary alpha.
- The bake now uses a foliage pipeline without alpha-to-coverage that discards below half coverage, which gives the same
  per-sample coverage. The normal pass's alpha then carries coverage × the mean-normal length, from MSAA resolve and
  box mips alike.
- The impostor divides both atlases by the albedo's coverage and lights with length × cosine, like the cards.
- Encoding version 3 is part of the atlas fingerprint. The contour correction (occlusion alone in b, wood or leaf by
  colour) is unchanged.

**Validated on single specimens before the complete rebake** (Phase 4.3 LOD1 and LOD0 at the time):
- pine impostor: eye +19.6% → +14.7%, overhead +7.4% → +3.0%;
- Oak B: eye +6.5% → +3.9%, overhead −1.7% → −4.2%.

Final results in §7.

## 6. Priority 3: impostor coverage

**Hypothesis verified.** The bake draws the tree at its bounding sphere × 1.04 across a 112-texel frame, so Oak A is
52 px tall in the atlas against 140 px at the switch. LOD1 rendered at that bake size shows the same excess as the
impostor (`bakesize.js`; LOD1 against LOD1, its own envelope):

| specimen, view | LOD1 at 140 px: threshold / fractional | LOD1 at the bake size: threshold / fractional | impostor excess (Phase 4.3, threshold) |
|---|---|---|---|
| Oak A, eye (52 px in the bake) | 53.5 / 56.4 | 64.2 / 66.2 (+10.7) | +8.8 |
| Oak A, overhead | 56.8 / 59.0 | 65.9 / 67.8 (+9.1) | +8.9 |
| Oak B, eye | 59.3 / 61.5 | 66.4 / 69.1 (+7.1) | +8.7 |
| Oak B, overhead | 64.6 / 66.4 | 72.8 / 73.6 (+8.2) | +3.9 |
| pine, eye | 37.4 / 39.5 | 37.4 / 40.3 (±0) | −4.2 |
| pine, overhead | 58.4 / 62.0 | 61.4 / 65.8 (+3.0) | −16.9 |

**Correction tried: bake at the switch size's mip level**, Oak B (bias = log₂ of the switch size over the bake size):

| bake | Δ coverage eye / over (pts) | Δ luminance eye / over |
|---|---|---|
| no bias | +8.7 / +3.9 | +3.9% / −4.2% |
| alpha-boost level biased | +7.7 / +3.5 | +4.2% / −4.4% |
| alpha-boost level and texture sampling biased | −0.3 / −3.6 | +8.0% / −7.4% |

- Full biasing fixes the coverage, which confirms the cause, but it moves luminance out of bounds, so by the protocol
  (both within bounds) it passes fewer views.
- It stays available (`?impBias=2`), off by default.
- The structural fix is a larger bake frame, so the tree is drawn at its switch size. At 9 × 9 frames that means about
  2.7× the atlas width and 7× the memory; not done.

**Pine overhead.** Threshold coverage −16.9 points, integrated fractional coverage −7.1 points (Phase 4.3 impostor).
- About 60% of the failure is threshold sensitivity: unsharpened coverage keeps the mean, but sparse needles become
  partly covered pixels that the silhouette's 65% threshold does not count.
- The rest is a real deficit.
- No species-specific sharpening was introduced: the measured half-sharpening (Phase 4.3) traded pine for the birch and
  Oak C.

## 7. Results

The 20 protocol measurements, with cameras, light, exposure, resolution and metric definitions identical to Phase 4.2
and 4.3. Plates: `review/lod/before-after-<specimen>.jpg` (4.2 · 4.3 · 4.4, both sides of each switch). Raw:
`review/lod/lod-metrics.json`.

Coverage within ±5 points: 14 of 20; luminance within ±5 %: 13 of 20.

| specimen | boundary | view | Δ coverage 4.2 → 4.3 → now (pts) | Δ luminance 4.2 → 4.3 → now | fractional Δ coverage now (diagnostic) | ΔE now | IoU now | triangles | instance bytes | verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Oak A | LOD0 → LOD1 (700 px) | eye | -2.4 → -3.5 → -3.5 | +1.1 % → +2.2 % → -2.3 % | -3.8 | 0.9 | 0.69 | 2,123,801 → 230,630 | 4.20 → 0.53 MB | pass |
| Oak A | LOD0 → LOD1 (700 px) | over | -10.2 ✗ → -5.8 ✗ → -5.8 ✗ | -8.5 ✗ % → -6.6 ✗ % → -3.9 % | -6.0 | 1.9 | 0.67 | 2,123,801 → 230,630 | 4.20 → 0.53 MB | fail |
| Oak A | LOD1 → impostor (140 px) | eye | +10.9 ✗ → +8.8 ✗ → +8.8 ✗ | -5.2 ✗ % → +1.9 % → -1.0 % | +5.3 | 0.7 | 0.55 | 230,630 → 2 | 0.53 → 0.00 MB | fail |
| Oak A | LOD1 → impostor (140 px) | over | +11.9 ✗ → +8.9 ✗ → +8.9 ✗ | -4.3 % → -3.1 % → -6.3 ✗ % | +8.3 | 1.4 | 0.66 | 230,630 → 2 | 0.53 → 0.00 MB | fail |
| Oak B | LOD0 → LOD1 (700 px) | eye | -0.8 → -2.6 → -2.6 | +8.5 ✗ % → +6.6 ✗ % → +0.9 % | -2.5 | 0.4 | 0.74 | 2,315,340 → 291,734 | 4.57 → 0.72 MB | pass |
| Oak B | LOD0 → LOD1 (700 px) | over | -8.7 ✗ → -3.5 → -3.5 | -6.6 ✗ % → -5.6 ✗ % → -3.0 % | -3.5 | 1.3 | 0.72 | 2,315,340 → 291,734 | 4.57 → 0.72 MB | pass |
| Oak B | LOD1 → impostor (140 px) | eye | +9.8 ✗ → +8.7 ✗ → +8.7 ✗ | -2.8 % → +6.5 ✗ % → +4.6 % | +6.0 | 1.0 | 0.65 | 291,734 → 2 | 0.72 → 0.00 MB | fail |
| Oak B | LOD1 → impostor (140 px) | over | +7.4 ✗ → +3.9 → +3.9 | -2.2 % → -1.7 % → -4.2 % | +3.8 | 1.0 | 0.71 | 291,734 → 2 | 0.72 → 0.00 MB | pass |
| Oak C | LOD0 → LOD1 (700 px) | eye | -2.4 → -3.2 → -3.2 | +7.1 ✗ % → +4.2 % → -3.4 % | -3.7 | 0.9 | 0.71 | 1,266,368 → 134,908 | 2.56 → 0.32 MB | pass |
| Oak C | LOD0 → LOD1 (700 px) | over | -11.4 ✗ → -6.3 ✗ → -6.3 ✗ | -7.6 ✗ % → -7.6 ✗ % → -5.4 ✗ % | -7.3 | 1.9 | 0.65 | 1,266,368 → 134,908 | 2.56 → 0.32 MB | fail |
| Oak C | LOD1 → impostor (140 px) | eye | +7.1 ✗ → +0.2 → +0.1 | +0.2 % → +9.1 ✗ % → +7.8 ✗ % | +1.8 | 1.9 | 0.60 | 134,908 → 2 | 0.32 → 0.00 MB | fail |
| Oak C | LOD1 → impostor (140 px) | over | +7.4 ✗ → -1.8 → -1.7 | +1.2 % → +2.5 % → +1.1 % | +1.4 | 0.3 | 0.57 | 134,908 → 2 | 0.32 → 0.00 MB | pass |
| Scots pine | LOD0 → LOD1 (700 px) | eye | -6.6 ✗ → -5.0 → -5.0 | -20.8 ✗ % → +5.1 ✗ % → -8.2 ✗ % | -5.1 | 1.9 | 0.89 | 1,468,041 → 271,163 | 11.84 → 0.71 MB | fail |
| Scots pine | LOD0 → LOD1 (700 px) | over | -10.3 ✗ → -4.3 → -4.3 | -40.0 ✗ % → +7.0 ✗ % → -1.7 % | -4.8 | 1.1 | 0.89 | 1,468,041 → 271,163 | 11.84 → 0.71 MB | pass |
| Scots pine | LOD1 → impostor (140 px) | eye | +1.5 → -4.2 → -4.2 | -2.2 % → +19.6 ✗ % → +17.4 ✗ % | -2.7 | 3.9 | 0.63 | 271,163 → 2 | 0.71 → 0.00 MB | fail |
| Scots pine | LOD1 → impostor (140 px) | over | -5.7 ✗ → -16.9 ✗ → -16.9 ✗ | +0.8 % → +7.4 ✗ % → +3.5 % | -7.1 | 1.5 | 0.42 | 271,163 → 2 | 0.71 → 0.00 MB | fail |
| Silver birch | LOD0 → LOD1 (700 px) | eye | +1.1 → +1.1 → +1.1 | -1.9 % → +4.5 % → -3.6 % | +0.4 | 2.2 | 0.72 | 1,736,574 → 240,482 | 3.74 → 0.82 MB | pass |
| Silver birch | LOD0 → LOD1 (700 px) | over | -1.8 → -1.8 → -1.8 | +1.0 % → +15.7 ✗ % → +8.2 ✗ % | -2.1 | 1.8 | 0.79 | 1,736,574 → 240,482 | 3.74 → 0.82 MB | fail |
| Silver birch | LOD1 → impostor (140 px) | eye | +4.9 → +0.7 → +0.9 | -0.9 % → +7.5 ✗ % → +6.7 ✗ % | +0.5 | 1.6 | 0.77 | 240,482 → 2 | 0.82 → 0.00 MB | fail |
| Silver birch | LOD1 → impostor (140 px) | over | +8.2 ✗ → +2.8 → +2.8 | +4.7 % → +2.4 % → +0.5 % | +5.2 | 1.1 | 0.82 | 240,482 → 2 | 0.82 → 0.00 MB | pass |

Summary, Phase 4.2 → 4.3 → 4.4:

| | 4.2 | 4.3 | 4.4 |
|---|---|---|---|
| coverage within ±5 points | 7 of 20 | 14 of 20 | 14 of 20 |
| luminance within ±5% | 12 of 20 | 8 of 20 | 13 of 20 |

* **Passing in 4.3 and failing now:** one measurement, the Oak A impostor overhead (luminance −3.1% → −6.3%). The
  "no previously passing case becomes failing" target is **not** met.
* **Passing in 4.2 and still failing:**
  - impostor luminance at eye level: pine +17.4%, Oak C +7.8%, birch +6.7%;
  - Oak A impostor overhead: −6.3%;
  - birch LOD0 → LOD1 overhead: +8.2%.

## 8. Angular acceptance matrix

All five specimens, both switches, elevations 0, 15, 30, 45, 60, 75 and 90°, azimuths 2.7 rad (backlit) and −0.44 rad
(opposite): 140 boundary measurements, plus the 20 protocol views. Matched cameras, light, exposure and projected size.

Worst cases per specimen and switch (16 views each: the 2 protocol views, 7 elevations × 2 azimuths; every view and
the fractional diagnostic in `review/lod/lod-angular.md`, raw `lod-angular.json`):

| specimen | boundary | views | worst Δ coverage (view) | worst Δ luminance (view) | views passing |
|---|---|---|---|---|---|
| Oak A | LOD0 → LOD1 (700 px) | 16 | -9.2 (e45@2.7) | +4.8 % (e15@2.7) | 4 of 16 |
| Oak A | LOD1 → impostor (140 px) | 16 | +15.8 (e15@-0.4) | -18.7 % (e0@2.7) | 0 of 16 |
| Oak B | LOD0 → LOD1 (700 px) | 16 | -7.5 (e45@2.7) | +8.0 % (e15@2.7) | 9 of 16 |
| Oak B | LOD1 → impostor (140 px) | 16 | +13.4 (e15@2.7) | -14.0 % (e0@2.7) | 1 of 16 |
| Oak C | LOD0 → LOD1 (700 px) | 16 | -9.0 (e45@-0.4) | -6.4 % (e60@-0.4) | 5 of 16 |
| Oak C | LOD1 → impostor (140 px) | 16 | +5.2 (e90@2.7) | +7.8 % (eye) | 13 of 16 |
| Scots pine | LOD0 → LOD1 (700 px) | 16 | -5.8 (e45@2.7) | -8.2 % (eye) | 10 of 16 |
| Scots pine | LOD1 → impostor (140 px) | 16 | -16.9 (over) | +17.4 % (eye) | 4 of 16 |
| Silver birch | LOD0 → LOD1 (700 px) | 16 | -2.3 (e60@-0.4) | +14.0 % (e60@2.7) | 5 of 16 |
| Silver birch | LOD1 → impostor (140 px) | 16 | +5.4 (e60@-0.4) | +6.7 % (eye) | 10 of 16 |

| | LOD0 → LOD1 | LOD1 → impostor | all |
|---|---|---|---|
| angular views passing (coverage and luminance) | 27 of 70 | 25 of 70 | 52 of 140 |

coverage within ±5 points: 71 of 140; luminance within ±5%: 90 of 140.

* **Backlit failures that started this phase:** resolved at LOD0 → LOD1 (pine backlit 0° −0.4%, Oak B +4.1%). The worst
  LOD0 → LOD1 luminance error is now the birch at 60° backlit (+14.0%).
* **Impostors under backlight:** Oak A −18.7%, Oak B −14.0% at 0°.

## 9. Transitions

* **Deterministic mid-fade reversal** (`tools/evidence/reversal.js`, `review/lod/reversal/`):
  - Setup: one tree, 60 frames a second, LOD chosen as on a 1080p screen.
  - Path: the camera recedes until the fade starts, keeps going for 0.1 s, then returns fast enough to cross back over the
    hysteresis band before the fade ends (60 m/s at LOD0 ↔ LOD1, 150 m/s at LOD1 ↔ impostor).
  - Both reversed mid-fade, at 0.52 s and 0.75 s.
  - Visible weights summed to 1 exactly and changed by at most one frame's step (0.0278 = dt / fade) through the
    reversal, so the blend was continuous.
  - The shadow caster was the side with more weight on every frame: no wrong caster, and no stale shadow map.
* **Unit tests** (`tests/treelab-lod.test.ts`) still cover reversal arithmetic, the third-LOD case, hysteresis and caster
  complementarity.
* **Existing transition paths** (200-tree stand, `review/lod/transitions/`): unchanged, with zero stale shadow frames on
  all seven paths. The orbit has one reversal within a second (one tree).
* **Tracked, not expanded** (as the brief asked):
  - off-frustum shadow casters;
  - redundant shadow-map redraws;
  - paused fades for culled trees.

## 10. Deficiencies and the remaining architectural limitations

The targets are **not** met:
- protocol: coverage 14 of 20, luminance 13 of 20, both 9 of 20;
- angular: 52 of 140;
- one measurement that passed in 4.3 fails (Oak A impostor overhead luminance).

Remaining limitations, each with what was measured:

1. **Impostor bake resolution (architectural).**
   - The atlas draws each tree at 52–90 px (its bounding sphere across a 112-texel frame), against 140 px at the switch.
   - Verified: LOD1 itself shows the impostors' extra coverage at that size (+7 to +11 points).
   - Baking at the switch size's mip level fixes the coverage but moves luminance out of bounds.
   - A frame large enough to draw the tree at its switch size costs about 7× the atlas memory.
   - It also leaves backlit impostor luminance (Oak A −18.7%, Oak B −14.0% at 0°) and +13 to +16 points of oak impostor
     coverage at low elevations.
2. **Sparse pine impostor (architectural, alpha-to-coverage).**
   - Unsharpened coverage keeps the mean, but the pine impostor looks semi-transparent and washed out at its switch (see
     the plates).
   - Its luminance difference (+17.4% eye) includes sky seen through partly covered pixels.
   - Its threshold coverage fails (−17 points overhead, about 60% of it threshold sensitivity; integrated −7).
   - A silhouette-preserving representation of sparse needles (sharpened alpha with coverage-preserving thresholds per
     frame, or more frames) is the next step. No species-specific sharpening was added without evidence.
3. **Card V geometry at mid elevations.** LOD1 coverage is −7.5 to −9.2 points at 45° for the oaks (backlit and opposite
   alike). The projected-area correction is per texel and cannot fill the gap between the two cards of a V seen
   obliquely.
4. **Birch overhead and backlit:** +8.2% overhead, +14.0% at 60° backlit, LOD0 → LOD1. The area correction is off for the
   birch (curtain overlap, Phase 4.3), and no further mechanism was demonstrated.
5. **LOD0 changed at distance.** Two corrections of LOD0's own atlas filtering (§2, §4) change LOD0 at its switch distance
   by −16% to +29%; it is unchanged close up. This needs your decision: it can be reverted (sprite atlas and
   `viewer.folPremultMips`), but then the backlit and overhead errors return, and the LOD1 model would have to copy a
   filtering defect.
6. **Tracked, not expanded:**
   - off-frustum shadow casters;
   - redundant shadow-map redraws;
   - paused fades for culled trees.
7. **Hardware:** none. The benchmark interface is unchanged, with SwiftShader results flagged as software.
