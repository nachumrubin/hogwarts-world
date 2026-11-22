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

Everything else (terrain generation, quadtree LOD, streaming, collision, atmosphere, renderer structure) is new.

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
