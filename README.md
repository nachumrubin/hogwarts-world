# Hogwarts World

A browser-based, explorable Hogwarts open world: the castle on its promontory above the Great Lake, the Forbidden
Forest, Hogsmeade, the railway and the surrounding Highlands, built with **WebGPU, WGSL and TypeScript**. No engine and
no Three.js: procedural terrain streaming with continuous LOD, instanced procedural meshes, analytic atmosphere.

**Status: first milestone in progress.** The whole 8 × 6 km world exists and can be walked and flown. Landmarks
are greybox placeholders at their approved coordinates; vegetation, real architecture and detailed water are not built
yet. See [`docs/STATUS.md`](docs/STATUS.md) for what is measured, what is missing, and the blockers.

## Run

```bash
npm install          # esbuild, TypeScript (dev only)
npm start            # builds dist/ and serves http://localhost:8080
npm test             # 41 automated tests (Node ≥ 22.18 runs the TypeScript directly)
npm run typecheck
```

Open `http://localhost:8080/` in a desktop browser with WebGPU (current Chrome or Edge recommended).

## Controls

| | |
|---|---|
| Click / Esc | capture / release the mouse |
| W A S D | move |
| F | switch between walking and broom |
| Broom | E or Space up, Q or C down, Shift fast, Alt slow, mouse wheel cruise speed; strafing and turning bank |
| Walking | Space jump, Shift run |
| M | large debug map (click to teleport); V hides the map |
| N | landmark labels |
| 1 – 0 | viewpoints (from `data/world.json`) |
| B | benchmark route |
| H | stats overlay · L LOD / crack view · P quality preset · F9 simulate GPU device loss |

URL options: `?view=N`, `?walk=1`, `?labels=1`, `?bench=1&duration=180`, `?preset=low|medium|high|ultra`,
`?cam=x,agl,z,yawDeg,pitchDeg`, `?debug=lod|crack`, `?hud=0`, `?scale=0.75`.

## World

- Coordinates: metres, **X east, Y up (elevation), Z north, origin at the SW corner**; playable 0–8000 × 0–6000.
- `data/world.json`: the coordinate database. It holds the landmarks, lake, regions, rivers, railway, paths, forest
  zones, encounter zones and viewpoints.
- Architecture, conventions and the creature module contract: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Credits

Built on techniques adapted from [Abyssal Garden](https://github.com/Noniv/abyssal-garden) (MIT). See
[`NOTICE.md`](NOTICE.md). Non-commercial fan project; Harry Potter is a trademark of Warner Bros. Entertainment Inc.
