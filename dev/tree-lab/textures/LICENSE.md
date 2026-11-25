# Bark texture sources

All four layers are derived from Poly Haven texture scans, released under CC0 1.0 (public domain dedication).
Attribution is not required; it is given here as a courtesy. `tools/textures.py --fetch` downloads the 1k source
maps (diffuse, OpenGL normal, roughness, displacement, AO) from a CC0 git mirror (github.com/zuujis-cc0) and
rebuilds the layers deterministically.

| layer | source | changes |
|---|---|---|
| `oak` | https://polyhaven.com/a/bark_willow_02 | slightly browner and darker; packed |
| `pinelow` | https://polyhaven.com/a/pine_bark | desaturated towards grey-brown, darker plates |
| `pineup` | https://polyhaven.com/a/japanese_zelkova_bark | recoloured to orange-copper flakes |
| `birch` | https://polyhaven.com/a/sakura_bark | recoloured to white paper bark; dark lenticels and cracks from the scan's own features, plus seeded synthetic lenticels and peeling strips |

## Woodland floor (review environment)

| layer | source | changes |
|---|---|---|
| `ground` (bark array, layer 4) | https://polyhaven.com/a/forest_leaves_02 (CC0 1.0) | packed; desaturated and darkened in the shader |

## Foliage

All foliage layers derive from ambientCG photoscanned leaf atlases, released under CC0 1.0 (public domain
dedication; attribution not required, given as a courtesy). `tools/foliage_textures.py --fetch` downloads the 2k
sources (Color, Opacity, NormalGL, Roughness) from a CC0 git mirror of ambientCG (github.com/zuujis-cc0/ambientcg-atlases)
and rebuilds every layer deterministically.

| layer | source | changes |
|---|---|---|
| `foliage.oak` | https://ambientcg.com/view?id=LeafSet016 (lobed *Quercus* leaves) | sprites cut out, 2 mirrored copies, recoloured to mid-summer green |
| `foliage.birch` | https://ambientcg.com/view?id=LeafSet014 (doubly serrated, acuminate) | blade base widened towards the silver birch's deltoid outline, recoloured |
| `foliage.pine` | https://ambientcg.com/view?id=PineNeedles001 (two-needle fascicles) | turned base-down; recoloured from dry brown to living glaucous blue-green; 2 curled scans left out |
| `foliage.card-*` | composited from the three sprite layers above | LOD1 shoot cards and LOD2 clump cards (tools/foliage_textures.py) |

Leaf outlines for the "geometry" representation (foliage.json) are traced from the same opacity masks.
