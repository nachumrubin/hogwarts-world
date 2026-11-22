# Third-party notices

## Abyssal Garden

This project adapts techniques and small portions of code from **Abyssal Garden**
(https://github.com/Noniv/abyssal-garden, inspected at commit `a596354e`), used under the MIT License:

| Here | Adapted from (Abyssal Garden `source/src/`) |
|---|---|
| `src/core/math.js` — reverse-Z infinite projection layout | `main.js` `render()` |
| `src/gpu/gpu-context.js` — timestamp-query readback ring, uncaptured-error logging | `main.js` (timing section) |
| `src/gpu/shaders/common.wgsl.js` — `h31` hash | `shaders.js` `W_NOISE` |
| `src/flight/flight-model.js` — two-stage low-pass mouse look | `main.js` `frame()` |
| `src/quality/dynamic-resolution.js` — dynamic resolution controller logic | `main.js` `frame()` |
| `src/debug/route.js` — arc-length-parameterised Catmull-Rom camera path | `main.js` (`FLY`, `flyLUT`), `dev.js` |
| `src/meshes/mesh-builder.ts` — mesh builder with per-vertex material ids in a 16-byte vertex, one shared buffer | `math.js` (`Mesh`) |
| `src/forest/shaders/bake.wgsl.ts` — periodic value/Worley noise (`tn`, `tf`, `tw`, `h33`), rock detail height `H()`, slope-in-texture layout | `shaders.js` `W_NOISE`, `W_DETAIL` |
| `src/forest/shaders/forest-common.wgsl.ts` — multi-scale detail sampling with slope normals, 3×3 PCF, volume sky visibility, height-fog integral | `shaders.js` `W_SOLID` (`tri`), `S_B` (`shadow9`, `vol`, `amb`), `S_G` (`fogIn`) |
| `src/forest/shaders/cover.wgsl.ts` — vertex-generated ribbon strips (rows from `vertex_index`, exact arc bend, distance widening/shrinking), `sway()` | `shaders.js` `W_LEAF` |
| `src/forest/shaders/vegetation.wgsl.ts` — wind sway phasing | `shaders.js` `W_LEAF` `sway()` |
| `src/forest/shaders/impostor-shafts.wgsl.ts` — half-resolution shaft raymarch with IGN jitter, depth-aware 3×3 blur | `shaders.js` `W_RAYS`, `W_RBLUR` |
| `src/forest/props-gen.ts` — icosphere rocks with fbm displacement and plane cuts | `world.js` `meshChunk`, `math.js` `icosphere` |
| `src/forest/tree-gen.ts` — recursive branch polylines swept into tubes | `world.js` `meshCoral`, `math.js` `Mesh.tube` |
| `src/forest/forest-renderer.ts` — cell-sorted instance runs (`drawCells`), shadow map rendered once and reused | `main.js` `drawCells()`, shadow bake |

Everything else (terrain generation, quadtree LOD, streaming, collision, atmosphere, renderer structure, forest ecology and tree growth rules, impostors) is new. See `docs/forest-poc-techniques.md` for the forest audit.

```
MIT License

Copyright (c) 2026 Maksymilian Dendura

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Assets not included

No third-party models are included in this repository yet. The HP-world repository's models (Hogwarts castle,
Quidditch pitch, cliff scan, forest models; CC BY 4.0 unless noted in its `docs/CREDITS.md`) are planned for Stage D and
will be credited here and on an in-game credits screen when integrated. "Rock Table" (CC BY-NC-SA 4.0) and the
Sketchfab-licensed "grass" model will not be used.

Harry Potter and related names are trademarks of Warner Bros. Entertainment Inc. This is a non-commercial fan project;
no assets are extracted from films or games.
