# Hogwarts World — technical architecture

Status: Stage A complete; Stages B, C and E at first-milestone level (see `STATUS.md`). This document is the reference
for conventions, data formats and module boundaries. The Phase 1 terrain design (quadtree LOD, morphing, stitching,
streaming, floating origin) is unchanged and documented in `PHASE1_ARCHITECTURE.md`.

## 1. Stack decision

| Option | Verdict |
|---|---|
| Own WebGPU renderer (Phase 1) + WGSL | **Chosen.** It already has chunked terrain streaming with continuous LOD, crack-free edges, an f32-exact floating origin, GPU timing and device-loss recovery, all with tests. |
| Three.js (WebGPURenderer) | Not adopted. It would give a mature glTF loader, PBR and shadow maps sooner, but its scene graph and terrain do not fit quadtree chunk streaming, and mixing two renderers doubles the lighting and atmosphere work. Revisit if glTF import or PBR becomes the bottleneck (Stage D). |
| Babylon.js / game engine | Excluded by the brief's preference for direct WebGPU. |

Cost of the choice: glTF/GLB loading, PBR materials, shadow maps and post effects must be written here. They are planned
in Stage D; the prop renderer and shared WGSL atmosphere are the foundation.

**TypeScript:** new modules are TypeScript (`.ts`), written in Node's *erasable* syntax subset (`erasableSyntaxOnly`), so
Node 22.18+ runs them and the tests directly, and esbuild bundles them for the browser (`npm run build` → `dist/`).
`npm run typecheck` runs `tsc`. The Phase 1 JavaScript modules are migrated as they are changed; currently 26 JS and
11 TS source files.

## 2. World coordinate system

- Metres. **X = east, Y = up (elevation above sea level), Z = north. Origin = SW corner of the playable area.**
- Playable area: 0 ≤ X ≤ 8000, 0 ≤ Z ≤ 6000 (48 km²). Scenic terrain continues 4.2 km east/west and 5.2 km north/south
  (quadtree root 16,384 m, min corner (−4192, −5192), centred on (4000, 3000)).
- Yaw is measured clockwise from north (towards east); pitch up is positive; roll right-wing-down is positive.
- **Handedness.** X-east / Y-up / Z-north is a *left-handed* frame. Consequences, all handled in one place each:
  - camera basis `up = forward × right` (`src/core/math.js cameraBasis`); right = (cos yaw, 0, −sin yaw)
  - terrain triangles are clockwise seen from above → terrain pipeline `frontFace: 'cw'`
  - procedural meshes are wound counter-clockwise seen from outside → prop pipeline `frontFace: 'ccw'`
  - rotations about Y are clockwise from north: x′ = x cos a + z sin a, z′ = −x sin a + z cos a
  Data never changes convention; only the renderer adapts. Tests pin the basis (`tests/systems.test.ts`).
- **Precision.** All CPU world state is f64. The GPU works relative to a render origin snapped to 256 m; terrain vertex
  positions are exact in f32 (tested to 64 km); props and creatures are made origin-relative on the CPU each frame.

## 3. World data (`data/world.json`, schema `hogwarts-world/1`)

One machine-readable database read by the terrain model, the placeholders, the debug map, the creature host and the
tests (TypeScript types in `src/world/world-db.ts`, validation in `validateWorldDB`).

| Section | Contents |
|---|---|
| `playable`, `scenicMargin`, `seed` | extent and the generation seed |
| `landmarks[]` | the 21 approved anchors: id, name, x, z, target elevation or null, kind, `site` (how terrain treats it: `promontory`, `pad`, `knoll`, `shore`, `hollow`, `underwater`, …), radius and site parameters |
| `lake` | surface (300 m), shoreline control polygon, depth bowls (squid, merpeople, basins), steep-shore zones, islands |
| `regions` | macrostructure: elevation/relief anchors blended with a smooth kernel, scenic rise, valley corridors |
| `rivers[]` | polylines with width, depth, waterfall step, glen width/depth |
| `railway` | planning route, max gradient, min curve radius, station level, viaduct clearance |
| `paths[]` | named paths and roads |
| `forest` | outline (continues into the scenic margin), ecological zones by depth, habitats |
| `encounterZones[]` | creature zones: creature, centre, radius, medium, minimum depth |
| `viewpoints[]` | named camera positions used by screenshots and keys 1–0 |

Anchors are planning coordinates; `tests/world.test.ts` fails if any approved x/z changes.

## 4. Terrain and biome model (`src/world/world-terrain.ts`)

Pure, deterministic `heightAt(x, z)` (f64, IEEE-exact operations only), evaluated identically in workers, tests and the
main thread. Layers, in order:

1. **Macrostructure:** a regional base elevation and relief amplitude from authored anchors (inverse-distance kernel),
   pulled towards valley corridors (the railway valley), rising into mountains outside the playable area.
2. **Erosion-inspired detail:** domain-warped, derivative-damped fbm plus ridged noise, scaled by the regional amplitude.
3. **Authored features:** the lake (signed distance to a spline shoreline with noise; shore cap and slope; depth bowls;
   islands; a no-stray-water clamp), the castle promontory (elongated plateau, lobed cliff line, lake-facing cliffs,
   gentle mainland side), knolls (Owlery, Shrieking Shack), Aragog's hollow, river valleys (monotone beds, waterfall step,
   glen), the railway formation (profile computed from the terrain with a gradient cap; viaduct spans and tunnels leave
   the ground untouched), and flattened sites at their target elevations.

**Materials/biomes** (`materialsAt`): forest amount and depth (zones: familiar < 220 m, outer < 700 m, ancient < 1300 m,
deep), clearings and the open uplands, managed lawn, paths, paved stone, ballast. These are baked with terrain shadow
and sky visibility into the overview maps (8 m texels on High) used by terrain shading, props and the debug map.

## 5. Runtime modules

```
src/main.js                 boot, options, unsupported-browser message
src/app.js                  frame loop: input → movement (walk / broom / benchmark) → LOD → streaming → props → creatures → render → stats
src/config.js               world constants (extent, root, water level) and quality presets
src/world/                  world-db.ts, world-terrain.ts, geometry.ts, landmark-proxies.ts, terrain-streamer.js, floating-origin.js
src/terrain/                chunk mesher, quadtree, stitching, morph mirror, overview baking, worker
src/gpu/                    renderer (frame graph), terrain renderer, prop renderer (instanced), shaders
src/meshes/mesh-builder.ts  procedural mesh construction (adapted from Abyssal Garden's Mesh class)
src/flight/                 input, FlightModel (broom flight + walking, collision)
src/creatures/              contract (types.ts), CreatureHost, placeholder module
src/debug/                  overlay, world map + labels, benchmark, route, viewpoints
```

Frame graph: scene pass (HDR, optional 4× MSAA, reverse-Z) → terrain chunks → props → creature draw callbacks → sky →
lake water → post (ACES tonemap, dither, upscale).

## 6. Creature integration contract (`src/creatures/types.ts`)

`CreatureModule { initialize(ctx), update(dt, worldTime), setPosition(p), setLOD(level), getBounds(), dispose() }` as in
the brief. The context gives each module:

- **its encounter zone** (`EncounterZoneInfo`, world coordinates)
- **read-only world queries:** height, water level and depth, forest depth, viewer position
- **optional render hooks:** device, formats, MSAA count, the shared Frame uniform buffer, the shared WGSL (atmosphere and
  lighting), `toRender()` for the floating origin, and `addDrawCallback()` inside the scene pass

`CreatureHost` handles registration, initialisation with error containment, distance LOD (0 ≤ 150 m, 1 ≤ 600 m,
2 ≤ 2500 m, 3 dormant: no updates), bounds for collision and debugging, and disposal. Placeholder modules occupy every
encounter zone until real modules replace them (`src/creatures/placeholder-module.ts`).

## 7. Asset strategy

`nachumrubin/HP-world` (Unreal project) holds licensed models: a textured Hogwarts castle (CC BY 4.0), a Quidditch
pitch, a cliff scan, forest trees, rocks and reeds (mostly CC BY 4.0; one CC BY-NC-SA rock to exclude). They are Git LFS
objects and were not accessible from this session (see `STATUS.md`). Planned path once available: GLB → offline bake
(merge, decimate LODs, pack textures) → runtime GLB loader feeding the prop renderer, with attribution kept in
`NOTICE.md` and an in-game credits screen.

## 8. Risks

| Risk | Status / mitigation |
|---|---|
| Real-GPU performance unknown | Software-only measurements so far; benchmark procedure in `BENCHMARK.md`. |
| Generation throughput at broom speed | Event-driven worker refill; next step is GPU compute generation. |
| Placeholder architecture is not Hogwarts | Explicit greybox until the licensed castle GLB (or an authored kit) is integrated. |
| River water is a ribbon at a fixed level | Adequate at distance; a real water surface (flow, banks, refraction) is Stage D. |
| Overview maps are global and baked once | ≈ 1.3 M samples on High (13–20 s on 1 worker here); tile them for larger worlds. |
| Left-handed frame confuses integrations | Documented, tested, and exposed to creature modules only as world coordinates. |
