# Tree Lab — Phase 4: summer foliage

Baseline: c78db29 (bark b4fe25e). The five specimens' skeletons, bark meshes and bark materials are unchanged:
skeleton fingerprints match, leafless LOD0 meshes are identical, and the leafless regression renders match the bark
phase (section 7). No wind, no seasons, no new species.

## 1. Sources and licences

All foliage textures are photoscans from ambientCG, CC0 1.0 (`textures/LICENSE.md`), fetched from a CC0 git mirror
because this environment cannot reach ambientcg.com directly. `tools/foliage_textures.py` rebuilds every layer
deterministically.

| layer | scan | treatment |
|---|---|---|
| oak | LeafSet016, lobed *Quercus* leaves | 6 leaves cut out by their opacity (2 insect-damaged, kept: they read naturally), 2 mirrored; recoloured to mid-summer green, keeping the scan's veins and blotches |
| birch | LeafSet014, doubly serrated and acuminate | base widened towards the silver birch's deltoid outline, recoloured |
| pine | PineNeedles001, two-needle fascicles | turned base-down; recoloured from dry brown to living glaucous blue-green; the 2 curled scans are left out |
| shoot and clump cards | composited from those sprites | LOD1 shoot cards (3 per species) and LOD2 clump cards, drawn the way the 3D generator arranges leaves |
| woodland floor | Poly Haven forest_leaves_02 | high-passed offline so that the tile does not show; desaturated in the shader |

Each layer is packed as albedo + opacity and normal + roughness + translucency. GPU memory is 6 × 1024² RGBA8 × 2 arrays
with full mips, **64 MiB**, from a **2.4 MiB** download. The woodland floor adds one 1024² layer to the bark arrays
(+10.7 MiB, so 53.4 MiB bark + ground).

## 2. Foliage from the growth structure (`src/framework/foliage.ts`)

Nothing is scattered through a crown volume. Each step builds on the skeleton the earlier phases grew:

1. **Bearing wood.** Live, unbroken segments thinner than a species limit (oak 2.5 cm, birch 0.7 cm, pine 3.5 cm),
   within reach of a live tip along the branch (oak 2.6 m, birch 2.5 m, pine 1.15 m: about the needles' 3–4 years).
   So dead limbs, Oak A's storm-broken limb and stag-headed top, and the pine's self-pruned stubs all stay bare.
2. **Shoots.** On that wood by phyllotaxis (golden-angle spiral), with a terminal shoot on every live tip. Oak
   shoots are branching **sprays**: a leader with 3–5 alternating laterals, drawn as real twiglets. The skeleton's
   metamers are 0.1–0.4 m, and real twig systems fill the space between them, as these do. Birch shoots are short
   and follow the skeleton's pendulous twigs. Pine fascicles sit on the skeleton's own last years of shoots.
3. **Light.** The shoots' leaf area goes into a 0.6 m voxel grid. Exposure is the sky light transmitted along a
   zenith ray and six rays at 40°. The side rays are weighted per specimen: open-grown trees take side light, and
   Oak C, grown in closed woodland, takes almost none. Shoots in deep shade are shed (Oak B 37,571 of 101,579; Oak C
   35,143 of 58,898), which opens the internal crown gaps. The rest carry leaves in proportion to their light. Shade
   leaves are larger and held flatter; sun leaves are smaller and steeper.
4. **Leaves by species.**
   * **Oak:** on a 2/5 spiral along each shoot, crowding towards the tip, blades turned to the light, with a midrib
     fold and a curl.
   * **Birch:** alternate along hanging shoots, hanging from their petioles.
   * **Pine:** fascicles spiralling round the shoot, pointing forwards 37–57°, thinning towards older wood.
   * **Pigmentation:** a per-shoot variation (lighter or darker, yellower or bluer) that is coherent in space.
5. **Individual crowns.**
   * **Oak A** (declining veteran): density 0.72 and more shade shedding, so a thinner crown with its dead limbs
     visible.
   * **Oak B** (parkland): dense and full to the edge.
   * **Oak C** (forest): foliage gathered in the upper crown.

The three silhouettes in `compare-oaks.png` stay distinct in leaf.

Generation is deterministic (seeded), runs in the worker with the rest of the build, and is cached in IndexedDB
with the specimen.

Per specimen (`tools/timing.ts`, Node, one thread; instance data is 64 B per instance):

| | leaves / fascicles | shoots (shed) | LOD0 inst. · tris | LOD1 cards · tris | LOD2 cards · tris | instance data L0 / L1 / L2 | foliage gen. |
|---|---|---|---|---|---|---|---|
| Oak A | 152,314 | 41,699 (19,180) | 194k · 1.55M | 41.7k · 167k | 2.3k · 9k | 12.4 / 2.7 / 0.15 MB | 0.58 s |
| Oak B | 209,367 | 64,008 (37,571) | 273k · 2.19M | 64.0k · 256k | 2.5k · 10k | 17.5 / 4.1 / 0.16 MB | 0.70 s |
| Oak C | 99,810 | 23,755 (35,143) | 124k · 0.99M | 23.8k · 95k | 1.3k · 5k | 7.9 / 1.5 / 0.09 MB | 0.38 s |
| Scots pine | 502,515 fascicles | 20,183 (508) | 503k · 1.01M | 40.4k · 161k | 0.8k · 3k | 32.2 / 2.6 / 0.05 MB | 0.70 s |
| Silver birch | 66,562 | 31,218 (137) | 98k · 0.78M | 31.2k · 125k | 1.4k · 5k | 6.3 / 2.0 / 0.09 MB | 0.27 s |

LOD0 instances include the twiglets (one per broadleaf shoot). Generation adds 0.3–0.7 s to each build of 2.5–8.3 s.

## 3. Proof of concept: three representations (`study-*.png`, `study-stats.json`)

Before committing to one approach, the same foliage was rendered three ways, each on a real branch of Oak B, the
pine and the birch. Each was shown at close range (one shoot, 0.8 m), medium range (a branch, 6 m) and distant range
(the full tree at the common frame), with matched cameras and daylight. For every cell I recorded the triangles,
the instances, and the **measured overdraw**: foliage fragments passing the alpha test per covered pixel, counted
on the GPU with no depth rejection. Overdraw is an upper bound and does not depend on the GPU.

* **Geometry:** opaque leaf polygons traced from each scan's outline, 31–67 triangles per leaf.
* **Cards:** one shoot card per shoot.
* **Hybrid:** alpha-tested bent leaf sprites of 8 triangles (needle fascicles 2) up close, shoot cards further out,
  clump cards far away.

| | close: tris · overdraw | medium: tris · overdraw | distant: tris · overdraw |
|---|---|---|---|
| Oak B · geometry | 8.10M · 3.12 | 8.10M · 2.55 | 8.10M · 2.67 |
| Oak B · cards | 256k · 3.59 | 256k · 2.62 | 256k · 2.35 |
| Oak B · **hybrid** | 2.19M · 3.09 | 2.19M · 2.49 | 256k · 2.35 |
| Pine · geometry | 7.41M · 2.04 | 7.41M · 2.19 | 7.41M · 2.80 |
| Pine · cards | 161k · 4.18 | 161k · 3.78 | 161k · 3.65 |
| Pine · **hybrid** | 1.01M · 1.74 | 1.01M · 1.76 | 161k · 3.65 |
| Birch · geometry | 3.89M · 1.57 | 3.89M · 1.57 | 3.89M · 1.73 |
| Birch · cards | 125k · 2.15 | 125k · 2.11 | 125k · 1.61 |
| Birch · **hybrid** | 782k · 1.55 | 782k · 1.50 | 125k · 1.61 |

Overdraw is the mean count of foliage fragments passing the alpha test per covered pixel (p95 values are in
`study-stats.json`). The triangle counts are the whole specimen's foliage at that representation.

Findings:
* **Geometry** costs 3.7–7.4× the hybrid's triangles for no visible gain up close. At distance its sub-pixel
  polygons drop out and the crown thins (Oak B's distant cell). For needles it fails outright: the fascicle
  outlines are ragged shapes.
* **Shoot cards** are the cheapest by far (125–256k triangles), and at medium and far range they give the fullest
  masses: the pine's clumpy tufts look best as cards. Up close they are flat and coarse, and their overdraw is the
  highest at every range (up to 4.0 for the oak and 3.7 for the pine), because a card's transparent margins still
  rasterize and each card holds overlapping leaves.
* **Hybrid** matches geometry up close, with the same or lower overdraw. Its distant cell is the cards' (LOD1).

**Chosen: the hybrid**, as the lab's LOD chain:
* **LOD0:** every leaf and fascicle with twiglets.
* **LOD1:** shoot cards.
* **LOD2:** clump cards.

The geometry representation stays selectable in the lab for comparison (Rendering → Foliage representation).

## 4. Rendering

* **Instancing:** one draw per foliage set (template mesh × instances, 64-byte instances). A tree is 1 bark draw +
  2 foliage draws at LOD0 (twiglets, leaves) or 1 at LOD1 and LOD2. There is one shared texture array for all
  species.
* **Alpha:** alpha-to-coverage on the 4× MSAA target, with mip-aware alpha. The opacity edge is kept one pixel wide,
  and coverage grows with the mip level (needles much faster than leaves), so leaves and 1 mm needles do not
  dissolve at distance. Mips are built on the GPU, normals with Toksvig roughness.
* **Shadows:** foliage casts alpha-tested shadows into the sun shadow map. Crown interiors also darken through each
  shoot's light exposure, used as occlusion.
* **Leaf faces:** the front faces use the scan's albedo and roughness. Undersides are paler and greyer, with higher
  roughness.
* **Translucency:** sun through the blade, coloured by the leaf and scaled by the translucency channel, so veins
  and midribs transmit less. Its shadow test is made on the leaf's sunlit side. Tested on the visible, dark side, as
  the first version did, every backlit leaf shadowed itself and the backlit crown stayed dark.
* **Venation:** from the scans' normal maps up close.
* **Bark and twiglets:** bark is unchanged. Twiglets are smooth young bark in species colours.
* **Clay and silhouette:** foliage is drawn in a neutral green-grey in clay mode and black in silhouette mode, so
  structural comparisons with foliage remain possible.
* **Woodland environment (optional):** the forest-floor scan, two scales (the second turned 37°) height-blended by
  a slow noise, with no survey grid. It sits beside the unchanged neutral plot, which stays the default for
  objective comparisons. The trees are lit and shaded identically in both.
* **Per-draw yaw:** new for the stand. Bark mapping stays in tree-local space, so turning a tree does not move its
  bark.
* **Offscreen renders are serialized:** library thumbnails rendering during a review shot had switched the shared
  viewer to clay mid-shot.

## 5. LOD and performance

| stand view (1200×900) | LOD mix (0/1/2) | foliage instances | foliage tris | bark tris | draw calls | overdraw mean · p95 |
|---|---|---|---|---|---|---|
| ground level, 1.7 m | 3 / 9 / 0 | 749k | 4.55M | 1.22M | 30 | 2.46 · 6 |
| elevated overview | 0 / 5 / 7 | 218k | 0.87M | 0.32M | 27 | 2.80 · 7 |
| aerial | 0 / 0 / 12 | 18k | 0.07M | 0.04M | 27 | 1.88 · 4 |

GPU-resident in the stand: 86–90 MB of foliage instance buffers and 86–91 MB of bark geometry, because every LOD
used so far stays uploaded, plus 64 MiB of foliage and 53 MiB of bark/ground textures.

* **Woodland stand stress test** (`stand-*.png`, `stand-stats.json`): twelve trees from the five specimens, with
  copies turned, on the woodland floor. LOD is chosen per tree by distance: < 35 m LOD0, < 110 m LOD1, beyond
  LOD2.
* **Scaling problems found early:**
  * **Instance memory.** The pine's 502k fascicles are 32 MB of instance data at LOD0, and Oak B's leaves are
    17.5 MB. All LODs of all specimens resident at once came to 83 MB of instance buffers in the stand. Next step:
    quantize instances (16-bit position offsets per shoot, 8-bit orientation) to about a quarter of the size, and
    upload LOD0 only for trees near the camera.
  * **Triangle count up close.** LOD0 Oak B is 2.19M foliage triangles plus 0.41M bark. That is fine for one hero
    tree on desktop hardware, but more than three LOD0 oaks in view needs the tighter LOD0 radius the stand
    already uses.
  * **Alpha overdraw.** Mean 1.4–2.4 per covered pixel for a full tree at LOD0, p95 3–6, and 3.2–4.0 for the stand
    views, with no depth rejection. A depth pre-pass for foliage, or front-to-back sorting of shoots, would cut the
    shaded fraction on hardware.
  * **Shadow cost.** The shadow pass draws every foliage instance again with an alpha test. In the stand that is
    about 1.9M foliage triangles per shadow update. The shadow map updates only when the scene changes; for the
    world, cascaded maps with LOD2 casters in the far cascades are the obvious step.
  * **Far LOD.** LOD2 clump cards read as dark, blocky masses at the review distances (the LOD2 cells of the
    sheets). They are acceptable only at the > 110 m range they are used for. Impostors (octahedral billboards
    baked from LOD0) are the planned far representation.
* **GPU frame time:** the lab measures it with timestamp queries where the browser exposes them (performance
  panel), and frame times are recorded in `stand-stats.json`. This session has only SwiftShader, a CPU
  rasterizer, so those numbers say nothing about GPU performance. I make no hardware performance claims. Real
  figures need a run on your machine: Materials mode, Live rendering on, the performance panel, and the Woodland
  stand button for the scalability case.

## 6. Evidence (`review/`)

* `<id>-foliage-sheet.png`: the foliage review set for each specimen.
  * Full tree foliated, and leafless at the same camera and light.
  * Woodland floor under overcast, and backlit (low sun behind the tree).
  * Leaf or needle macro, branch-to-foliage junction, crown interior, ground level looking up.
  * Elevated and aerial views.
  * LOD 0/1/2 at one camera.
  * A panel with foliage counts, LOD instances and triangles, generation time, measured overdraw and texture
    memory.
* `foliage/<id>-*.jpg`: the main foliage shots at full resolution (1200×900).
* `compare-*.png`: line-ups at true scale, with foliated, leafless and silhouette rows.
* `study-oak-b.png`, `study-pine.png`, `study-birch.png`, `study-stats.json`: the proof of concept.
* `stand-1..3.png`, `stand-stats.json`: the stress test.
* `foliage-stats.json`: per-specimen foliage statistics.
* `regression/`: leafless renders against the bark phase (section 7).
* The bark-phase sheets (`*-material-sheet.png`, `bark-before-after/`) and structural sheets are kept unchanged.

## 7. No regression in bark or branches

* **Geometry:** the skeleton fingerprints are unchanged (`fingerprints.txt`). The leafless bark LOD0/1/2 triangle
  counts equal the bark phase's exactly (`tools/timing.ts`): Oak A 363,789 / 91,018 / 5,825, and likewise for the
  other four.
* **Rendering:** the leafless renders of four bark-phase shots (Oak A trunk, Oak B main junction, pine trunk, birch
  trunk; 1200×900, daylight, LOD0) are **pixel-identical** to the same shots rendered at b4fe25e: 0 pixels differ,
  maximum difference 0 (`regression/`). The renderer changes (per-draw yaw, foliage bindings, the woodland ground
  path) leave bark output untouched.
* **Kept evidence:** the bark-phase material sheets and the structural sheets in `review/` are kept as they were.

## 8. Known deficiencies

1. **Crowns are less dense than real summer oaks.** Limbs show through more than they would in July, most of all
   at the review distances. Leaf area is about 150–750 m² per oak against several thousand m² in a real crown.
   Raising it is a slider (`leavesPerM`, `laterals`), but triangle and instance costs rise with it; the right
   balance needs your hardware numbers.
2. **LOD2 clump cards are blocky,** and the birch's LOD2 loses its pendulous character. They are acceptable only
   far away. Impostors are the planned replacement.
3. **The birch leaves are a reshaped hornbeam/elm-type scan,** not a silver birch scan. The outline is close
   (deltoid, doubly serrated, acuminate), but the venation density is not birch's.
4. **The pine fascicles come from scans of dry fallen needles, recoloured.** At close range the needles are a
   little thin and too straight. Scots pine needles twist.
5. **Twiglets are straight segments.** Close up, oak sprays show straight grey sticks between leaf clusters.
6. **Macro framing:** the birch's macro view frames whole shoots rather than single leaves (the view picks the
   densest sunlit spray).
7. **The woodland floor** reads as dry leaf litter. There is no ground vegetation (that would be foliage outside
   this brief).
8. **Instance memory is uncompressed** (section 5), and so is texture memory (64 + 53 MiB; BC7/ASTC would cut it
   about 4×).
9. **GPU frame times on real hardware are unmeasured** (section 5).
