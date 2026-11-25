# Tree Lab — Phase 3: bark and woody surfaces

Baseline: e4f3010 (structural finishing pass). The five specimens, their seeds and their growth are unchanged:
the skeleton fingerprints match e4f3010, and LOD0 positions, normals and indices are bit-identical except for
the extra rings in the fused-to-tube handover band (section 4). No foliage, no wind.

## 1. Bark sources

Synthetic bark was not good enough at close range, so all four texture layers come from Poly Haven photoscans
(CC0 1.0; `textures/LICENSE.md`). The sources were fetched from a CC0 git mirror, because this environment cannot
reach polyhaven.com or ambientcg.com directly. `tools/textures.py` packs each layer and recolours three of them
deterministically.

| layer | scan | used for | tile |
|---|---|---|---|
| `oak` | bark_willow_02 | pedunculate oak plates; birch base (recoloured in the shader) | 1.0 m, and 2.6 m on the ancient bole |
| `pinelow` | pine_bark | Scots pine lower-trunk plates | 1.5 m, and 2.55 m on the oldest trunk |
| `pineup` | japanese_zelkova_bark, recoloured orange | pine upper stem and limbs | 0.7 m, and 1.26 m on the stem |
| `birch` | sakura_bark, recoloured white | birch paper bark; normals for young bark of all species | 1.1 m |

The tile sizes are my estimates: polyhaven.com's real-world sizes were not reachable from here. I set them so that
the fissure spacing matches the species: oak ridges about 3 cm apart on limbs and 8–10 cm on the ancient bole;
pine plates 5–15 cm.

The birch layer keeps the cherry scan's relief and fine cracks. Its lenticels and cracks are darkened, and it gets
330 long, seeded synthetic lenticels and a few peeling strips with a cream-orange underlayer. The result is not
uniform black-and-white stripes: the marks vary in length, thickness and darkness.

Each layer is packed as two 1024² WebP images: RGB albedo with height in A, and normal XY + roughness + occlusion.
The download is 7.4 MiB for all four layers. On the GPU they are two `texture_2d_array` (rgba8unorm-srgb and
rgba8unorm) with full mip chains built at load, which comes to **42.7 MiB**. Albedo mips are averaged in linear
light. Normal mips are renormalized, with their spread folded into roughness (Toksvig) so that distant bark does
not turn glossy. Load time is about 0.3 s after download.

## 2. Mapping: no UVs, no seams, true scale

Each vertex carries a bark-mapping axis A (σ × the branch direction) and an origin C = c − v·A, where c is the
branch centre and v is a bark coordinate. v is continuous from the trunk into every branch: a branch starts at its
parent's v where it attaches. The shader projects the scans in metres onto the two planes that contain A, plus the
plane across A for broken faces and flat root tops. It blends the projections by the normal, and texture "up"
always runs along A.

* **No seams:** there are no UV charts. A tube leaving a blended fork continues the fused surface's frame: in the
  handover band both use the skeleton segment's axis and centre. A child tube starts with its parent's axis and
  turns to its own across the collar.
* **No stretching with taper:** the scale is in metres everywhere.
* **Pivoting about the branch centre:** a first version pivoted about the world origin. Wherever the axis turned,
  at collars and forks, the bark swung by |p| × the angle and was compressed into stripes, worst at Oak B's 7 m
  fork. Centring the origin on the branch, with v carried through the hierarchy, removed them. The pattern now
  flows around forks the way branch-bark ridges do.
* **Repetition:** every tile-length band along a branch takes a random offset. Neighbouring bands height-blend
  over the last fifth, so a tall bole shows no repeats. Large-scale colour variation (0.4–1 m) breaks up the rest.
* **Age-dependent plate size:** two fixed scales are height-blended over a radius band (oak 0.3–0.6 m radius).
  Plates widen on old stems without any continuous rescaling, which would stretch.

## 3. Material distribution (procedural, in the shader)

The inputs are branch radius (as a proxy for age), height, orientation, the hierarchy (stem, fused base, order),
the geometric bark relief, and the growth history recorded in the mesh flags: dead, broken, hollow and collar.
Transitions are height-blended: the new bark appears first in the old bark's fissures.

* **Pedunculate oak:** smooth olive-grey young bark with faint lenticels gives way to fissured plates from about
  6–28 cm diameter. Plates are greyer and deeper on old wood, with normal strength rising with radius, and they
  widen on the ancient bole. Green algae sit on the side away from the sun and lichen on upper faces of old
  limbs; both increase with age. Oak A's hollow is dark decayed heartwood.
* **Scots pine:** grey-brown young shoots, then thin orange flaking bark from about 2.5 cm (larger flakes on the
  stem), then thick, dark, fractured plates on the trunk and fused base. The plates reach up to an irregular
  boundary between about 2.7 and 7.7 m, and widen on the oldest trunk.
* **Silver birch:** red-brown twigs with pale lenticels give way to white paper bark with dark lenticels from
  about 2.5–10 cm diameter. Mid-size limbs are slightly greyer. There are dark marks at branch collars. On a mature stem a
  black, deeply fissured base, with white ridges, rises in irregular streaks to about 0.5–1.6 m.
* **Exposed wood** (all species): dead limbs are weathered fibrous wood, silver-grey for oak and warmer grey for
  pine, with drying checks and occasional bark remnants. Broken ends show splintered fibres on the splinters, and
  end grain on the break face: growth rings (oak about 260 per metre, pine 380) and heart rot around the pith.
  The pine's self-pruned stubs carry flake remnants.

The geometric bark relief that the mesher already displaces (LOD0, and 0.6× at LOD1) is unchanged. It now also
darkens the crevices (cavity occlusion), so the large furrows and the texture's fissures read as one relief.

## 4. Rendering

* **Shading:** Lambert diffuse plus GGX specular (F0 0.04), using the scan's roughness, so bark has a broad, dull
  sheen and the lower roughness of young birch and pine shows. Sky and ground bounce, the sun shadow map, the scan
  occlusion squared and the relief cavity occlusion. Per-light exposure, then ACES.
* **Geometric versus shading normal:** the sun term uses the geometric side, so normal maps cannot leak light onto
  faces turned away from it.
* **Ground:** a dull soil and litter tone, with the 5 m survey grid kept faint as a scale reference.
* **Clay and the other structural modes** are unchanged, so clay/material pairs at the same camera are directly
  comparable.
* **Fused-to-tube handover lip (structural defect from e4f3010):** with bark lit, the lip at the pine and birch
  handover became obvious. The tube's rings were about 0.6 m apart through the 1 m band in which the fused surface
  sinks across it, so the tube stayed undersized there and the two surfaces met at an angle. Tubes now have rings
  every 8 cm in that band and reach full radius within 12 cm instead of 25 cm. The lip is reduced to a faint
  ridge. This is the only change to LOD0 geometry: +1–12k triangles per tree (+0.6–2.9%).
* **Draw calls:** unchanged. One draw per tree per LOD and one pipeline; the species material is a per-draw
  uniform.
* **Shader cost:** 2 texture arrays and 1 sampler. A typical bark fragment does 4–8 fetches: two projections ×
  albedo and normal, doubled at band boundaries and in species transition zones. The worst case is about 24, in
  the oak's age-scale blend band at a projection seam.

## 5. Performance

**Mesh generation** (Node, one thread; before → after):

| | grow | mesh LOD0 | mesh LOD1 | total | LOD0 tris | LOD1 tris | LOD2 tris |
|---|---|---|---|---|---|---|---|
| Oak A | 1.1 → 1.2 s | 6.97 → 4.59 s (−34%) | 1.00 → 0.70 s | 9.1 → 6.6 s | 354,131 → 363,789 | 122,520 → 91,018 | 18,495 → 5,825 |
| Oak B | 1.4 → 1.2 s | 7.80 → 5.04 s (−35%) | 1.09 → 0.75 s | 10.4 → 7.1 s | 395,730 → 407,366 | 138,894 → 102,970 | 21,353 → 6,495 |
| Oak C | 0.8 → 0.9 s | 2.77 → 1.83 s (−34%) | 0.52 → 0.44 s | 4.1 → 3.3 s | 188,134 → 193,664 | 62,978 → 49,998 | 10,646 → 4,168 |
| Scots pine | 1.0 → 1.0 s | 3.38 → 2.53 s (−25%) | 0.40 → 0.33 s | 4.9 → 4.0 s | 216,985 → 219,981 | 68,449 → 48,479 | 7,845 → 2,879 |
| Silver birch | 0.4 → 0.4 s | 2.09 → 1.67 s (−20%) | 0.29 → 0.27 s | 2.8 → 2.3 s | 173,912 → 175,024 | 37,050 → 25,152 | 4,465 → 1,483 |

`tools/timing.ts`, same machine, both commits run back to back. The LOD0 triangle increase (+0.6–2.9%) is the handover-band rings (section 4).

* **Mesh generation:** 20–35% faster. Without the handover rings (section 4) the output is bit-identical to e4f3010; that was checked by hashing positions, normals and indices.
  * The root-flare look-ups now visit only the capsules in their 0.5 m ground column.
  * Look-ups are skipped where they cannot change the sign of the field: more than two cells inside, or further out
    than the flare could reach (depth × (1 + slope), since the field is about 1-Lipschitz). Only signs, and values
    next to a sign change, reach the mesh.
  * The noise function no longer allocates closures.
* **Remaining cost:** the blended surfaces' field evaluation (capsule smooth-min plus the species bark noise).
* **LOD2 triangle count** had risen 15–40% in e4f3010. LOD1 and LOD2 used LOD0's absolute ring tolerances (1.5 mm
  chord, 8% radius change), so tapering, gently curved branches kept a ring every few centimetres. Those
  tolerances now scale with the LOD's viewing distance: 5 mm / 15% at LOD1 and 2 cm / 35% at LOD2. LOD2 is now
  1.5–6.5k triangles, below 35d542d's 4.8–19k, and LOD1 is 25–103k. The material LOD shots (sheets, cells 11–12)
  show no visible loss at their distances.
* **Offline generation and caching:** generation is pure and deterministic (no DOM, seeded), so it can be done
  offline.
  * **Measured bake size:** all five specimens × three LODs are 85 MB raw, 34 MB gzip, 30 MB brotli. LOD0 alone is
    17.8 MB raw / 7.4 MB gzip for Oak A, and LOD1 + LOD2 for all five are 7 MB gzip.
  * **Implemented:** the lab now keeps every built specimen in IndexedDB, keyed by build commit. On any visit after
    the first to a deployed build, specimens load from the cache with no growth or meshing, only GPU upload.
    Entries from other commits are dropped, and uncommitted dev builds are not cached.
    Measured on a build of b4fe25e (headless Chrome, two cores): all five specimens were ready 25.9 s after
    the first visit started, and 3.4 s after the second, all from the cache.
  * **Recommended for the world:** bake LOD1/LOD2 at build time (small), and generate LOD0 on demand in a worker
    with the same persistent cache. Shipping baked LOD0 for every tree would cost more download than it saves on a
    fast connection.
* **Vertex format:** 64 bytes per vertex (was 48): the bark-mapping axis and origin replace the unused UVs and
  flex values. The wireframe's line index buffer is now built only when the wireframe mode is first used. It was
  previously built for every mesh, at twice the size of the triangle index buffer, so typical resident geometry
  is lower than before (Oak A LOD0 was 9.8 MB of vertices + 4.2 MB of indices + 8.5 MB of lines; it is now 13.1 +
  4.2 MB).
* **Texture memory:** 42.7 MiB, once for all trees (four 1024² layers, two arrays, full mips). BC7/ASTC compression
  where the adapter supports it would cut this about 4×. It is the next step if memory matters in the world.
* **GPU timing:** the lab measures the GPU pass time with timestamp queries where the adapter exposes them (lab
  panel, and the material sheet's panel). This session has only SwiftShader, the CPU rasterizer, which exposes
  none. The clay versus materials frame times in `render-stats.json` and on the sheets are SwiftShader wall-clock
  times. They show the relative cost of the material shader on a CPU rasterizer, not GPU performance, and I make
  no GPU performance claims. Real numbers need a run in Chrome on your machine: Materials mode, Live rendering on,
  then read the performance panel.

## 6. Evidence (`review/`)

* `<id>-material-sheet.png`: the material review set for each specimen. Full tree under daylight, overcast and
  low-angle sun. Trunk under daylight and low sun, with clay at the same camera and light. Main junction and
  clay. Broken limb or exposed wood under daylight and overcast. LOD1 and LOD2. The panel lists texture memory,
  download size, triangles, draw calls, render timings and adapter.
* `materials/<id>-{full-day,trunk-day,trunk-low,junction-day,broken-day}.jpg`: those material shots at full
  resolution (1200×900); the lab's ZIP export has every shot as PNG.
* `bark-before-after/<id>-bark-before-after.png`: e4f3010's materials placeholder against phase 3, at matched
  camera, daylight and LOD0, for the full tree, trunk and junction.
* `compare-*.png`: comparison line-ups, now with a materials row above the clay and silhouette rows.
* `<id>-review-sheet.png`: the structural (clay) review set, unchanged protocol, for regression against e4f3010.
* `render-stats.json`: per specimen, render timings (clay versus materials, full tree and trunk), texture
  statistics, adapter, and LOD0 geometry bytes. `diagnostics.json` and `fingerprints.txt` are regenerated.

## 7. Known deficiencies

1. **Tile sizes are estimated**, not taken from the scans' metadata (unreachable from here). They are tuned by eye
   against species fissure spacing.
2. **The birch base and pine flakes are recoloured scans of other species** (willow, zelkova), and the birch paper
   bark is a recoloured cherry scan with synthetic lenticels. They read correctly at review distances, but a
   botanist would spot the zelkova's flake shapes on the pine at very close range. Dedicated Scots pine and silver
   birch scans would beat them if a CC0 source becomes reachable.
3. **No parallax or displacement from the textures.** Silhouettes get their ruggedness from the existing
   geometric relief at LOD0 only. Parallax occlusion on the trunk close-ups is the next quality step.
4. **Oak dead wood** is convincing on the pine stubs and the birch's dead limbs. On Oak A's storm-broken limb it is
   in deep shadow under daylight; the overcast shot shows it better. Fresh-break colour (pale, warmer wood) is not
   distinguished from old weathered breaks.
5. **No bark wounds or callus rolls** other than the oak's hollow; that needs geometry.
6. **Birch collar marks** are a noise pattern on the branch's collar, not the true chevron above each branch on
   the stem.
7. **A faint ridge remains** at the pine and birch handover, and the flare-fade ring from e4f3010 is still faintly
   visible under grazing light.
8. **The ground is a placeholder tone**, deliberately, with no foliage this phase.
9. **Texture memory is uncompressed** (42.7 MiB); see section 5.
10. **GPU frame time is unmeasured on real hardware**; see section 5.
