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
- Oak A and Oak C overhead luminance pass. Their overhead coverage remains about −6 points: the projected-area
  correction is in place, and the residual is in the angular matrix.
- Birch overhead luminance is +8.0% (was +15.7%).

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

PROTOCOL_TABLE

## 8. Angular acceptance matrix

All five specimens, both switches, elevations 0, 15, 30, 45, 60, 75 and 90°, azimuths 2.7 rad (backlit) and −0.44 rad
(opposite): 140 boundary measurements, plus the 20 protocol views. Matched cameras, light, exposure and projected size.

ANGULAR_TABLE

## 9. Transitions

REVERSAL_TEXT

## 10. Deficiencies and the remaining architectural limitations

DEFICIENCIES
