# Forest POC: Abyssal Garden techniques studied, adopted, adapted and rejected

Reference: [Noniv/abyssal-garden](https://github.com/Noniv/abyssal-garden), commit `a596354`, MIT licence, © 2026 Maksymilian Dendura.
Studied files: `source/src/shaders.js` (782 lines), `source/src/main.js` (643), `source/src/world.js` (557), `source/src/math.js` (214), `source/src/quality.js` (14).

Only techniques that are implemented in this branch are listed as adopted. Each entry names the Abyssal Garden (AG) source, what we built, and where.

## Adopted

| # | AG mechanism (source) | What it does in AG | How it is adapted here | Where |
|---|---|---|---|---|
| 1 | Runtime-baked tileable detail texture (`shaders.js` `W_DETAIL`, `tn`/`tf`/`tw`, `H()`) | One 1024² texture baked once at startup by a fragment shader from periodic value and Worley noise: slope (rg), height (b), mottling (a). No downloaded textures. | Thirteen layers in one 2D array: soil, moss, wet earth, rock (AG's `H()` almost verbatim), turf, broadleaf litter (stacked Worley-placed leaf shapes), needle litter, five barks (oak, pine upper, pine lower, birch, smooth) and deadwood. Height is baked first, slopes by finite differences in a second pass, then a mip chain. | `src/forest/shaders/bake.wgsl.ts`, `src/forest/textures.ts` |
| 2 | Triplanar, multi-scale detail sampling (`shaders.js` `W_SOLID` `tri()`; four scales A/B/C/F, distance fade) | Rock surfaces sample the detail texture on three planes, at several scales, and perturb the normal from the stored slopes. | Ground: planar XZ mapping at two scales (the second rotated) blended by low-frequency noise, so no tiling is visible at walking height or from the air; rocks: object-space triplanar so the pattern sticks to the rock; bark: cylindrical UVs from the tube sweep. Normal from slopes as in AG; detail faded with distance against shimmer. | `forest-common.wgsl.ts` `forestGround()`, `vegetation.wgsl.ts` `fsSolid` |
| 3 | Layered material blending by masks (`W_SOLID` rock branch: beds, encrustation, algae on up-facing surfaces) | Colour layers chosen from masks and surface orientation. | Height-based blending of the seven ground layers by ecology weights (moss, mud, rock, grass, litter type, trail); moss on up-facing and north-facing bark, on the lower stem and on rock tops, more where the canopy keeps it damp. | `forestGround()`, `fsSolid` |
| 4 | Displaced, plane-cut icosphere rocks (`world.js` `meshChunk`) | Faceted boulders: icosphere + fbm displacement + a few random cutting planes. | Eight rock archetypes at three LODs, flattened underneath, sunk 25–45 % into the ground, clustered on outcrops with power-law sizes. | `src/forest/props-gen.ts` |
| 5 | Recursive branching tubes (`world.js` `meshCoral`, `Mesh.tube`) | Branch = short polyline with per-segment perturbation; children fork with smaller radius and length; a tube is swept along each. | Same skeleton-then-sweep structure, driven by species growth rules (whorls and self-pruning for Scots pine, forking limbs for oak, pendulous twigs for birch, coppice stools for hazel), parallel-transport frames, root flare and bark ridges, three LODs from one skeleton. | `src/forest/tree-gen.ts` |
| 6 | Vertex-generated ribbons (`shaders.js` `W_LEAF` `vs`; `ROWS` override per LOD) | Kelp and grass blades with no vertex buffer: rows from `vertex_index`, exact constant-curvature bend, widened at distance, shrunk out at the far end. | Ferns (bracken, buckler fern, hard fern), grass tussocks and rushes, blaeberry tufts. Fern pinnae are cut analytically in the fragment shader. Thin blades are widened to a pixel and carry their true coverage into alpha-to-coverage, so they do not shimmer. Two row-count LODs per kind. | `src/forest/shaders/cover.wgsl.ts` |
| 7 | Cell-sorted instancing with merged runs (`main.js` `drawCells`) | Instances sorted by grid cell; per frame each cell is tested against the frustum and a distance band, and contiguous visible cells become one instanced draw. | Ground cover sorted into 16 m cells; frustum + distance per cell; contiguous runs merged; near/far bands select the row-count LOD. Trees use per-instance culling (≈1,700 instances is cheap on the CPU). | `forest-renderer.ts` `update()` |
| 8 | Position-phased sway (`W_LEAF` `sway()`) | Displacement phased by position, amplitude ∝ height^1.25, two summed frequencies. | Hierarchical wind: stem bending ∝ height², branch flex weights from the generator, leaf flutter along card normals; frequencies rise towards the twigs; a travelling gust field keeps it spatially coherent but never synchronised; per-instance stiffness. Ground cover uses AG's sway almost as is, with stiffness per kind. | `vegetation.wgsl.ts` `deform()`, `cover.wgsl.ts` |
| 9 | Sun shadow map with PCF (`main.js` shadow pass baked once; `shaders.js` `shadow9`) | One orthographic sun shadow map rendered once at load (the scene is static), 3×3 PCF with a comparison sampler. | 4096² map over the planted area, rendered from the real geometry (trees at LOD1 with alpha-tested leaves, rocks, logs, ground cover, the site terrain) and re-rendered only when the lighting preset changes, as in AG. 3×3 PCF on a per-pixel rotated grid; normal-offset bias. | `forest-renderer.ts` `recordShadow()`, `forestCommon` `shadowAt()` |
| 10 | Occupancy volume for ambient and sky visibility (`main.js` `tVol`, `shaders.js` `vol()`, `amb()`) | A low-resolution 3D texture of the scene gives ambient occlusion and how much sky a point sees. | Crowns are splatted into a 2 m leaf-density volume; transmittance towards five sky directions is integrated with prefix sums. Shaders read sky visibility (r) and local leaf density (g): under the canopy it is darker and greener, inside crowns leaves are occluded. The same volume drives plant placement (light availability). | `ecology.ts` (volume), `canopyAt()` |
| 11 | Light shafts (`shaders.js` `W_RAYS` + `W_RBLUR`) | Half-resolution raymarch of the view ray through the shadow map, interleaved-gradient-noise jitter, depth-aware 3×3 blur. | Same structure; single scattering in the forest mist with a Henyey–Greenstein phase function; composited additively into the HDR image. Off in the overcast preset. | `impostor-shafts.wgsl.ts`, `recordShafts()` |
| 12 | Analytic height-fog integral (`shaders.js` `fogIn()`), limited range | Exponential height fog integrated in closed form along the ray; skylight limited to 150 m. | Forest mist on top of the world's physical atmosphere, limited to 160 m, so it gives depth inside the stand without fogging the landscape. | `forestMist()` |
| 13 | Quality scaling (`quality.js`) | One level variable sets shadow size, MSAA, ray count, thinning. | `?tex=` (detail texture size), `?flod=` (LOD distance scale), `?shafts=0`, plus the existing presets. | `main.js`, `forest-renderer.ts` |

## Additions not from Abyssal Garden

- Ecological placement (Matérn cluster process, species suitability from moisture, soil, topographic position and light; crown competition; lean and crown shift towards light), `src/forest/ecology.ts`.
- LOD3 impostors baked at runtime from 8 azimuths and above, with dithered view blending, `impostor-shafts.wgsl.ts`. AG has no far field of this kind.
- Dithered LOD cross-fades for all tree LODs.
- Eye adaptation, metered from the HDR image, partial for dark interiors.
- Overcast lighting preset applied to the whole sky model (`common.wgsl.js`, `params.z`; zero leaves the default world unchanged).

## Rejected, and why

| AG technique | Reason |
|---|---|
| Signed-distance terrain with surface nets (`W_DENS`, `math.js` `surfaceNets`) | Our terrain is a streamed heightfield quadtree over 8 × 6 km; a voxel terrain would mean replacing working systems. The forest floor needs relief at the metre scale, which a heightfield overlay provides. |
| Caustics, underwater extinction model, bubbles, fish and manta animation | Underwater-specific. |
| Static, baked-at-load scene as the only mode | The forest must scale to the full world and stream; geometry here is instanced and LOD-selected per frame. |
| Bloom chain (`W_BLIT` down/up) | The brief asks not to use bloom as a substitute for lighting; HDR + tonemapping + shafts were enough. |
| Fixed, single shadow map for the whole world | Fine for a 200 m test area (and used here); the full forest needs cascades (see the report). |

## Expected benefits (to be confirmed by the A/B/C measurements)

- Visual: texture detail on every surface with no texture downloads; ground that follows the ecology; trees with distinct silhouettes; real cast shadows and shafts; ambient that darkens and greens under the canopy.
- Performance: vertex-generated ground cover needs no vertex memory; cell runs keep draw counts low; impostors bound the far-field cost; baked-once shadows cost nothing per frame.

## Licence and attribution

Abyssal Garden is MIT-licensed. Adapted code fragments (the hash `h31`/`h33`, periodic noise `tn`/`tf`/`tw`, the rock detail function `H()`, the ribbon-strip vertex logic, the shaft raymarch and its depth-aware blur, the fog integral) are credited in the source headers and in `NOTICE.md`, which reproduces the MIT notice. No assets (images, models, audio) were taken from Abyssal Garden. No third-party art assets are used by the forest: every texture and mesh is generated at runtime.
