// Creature integration contract (brief §13). A separate project implements the Giant Squid, Aragog and others as
// modules that implement CreatureModule; the world engine hosts them through CreatureHost.
//
// Shared conventions (all binding for modules):
//   coordinates  metres; X east, Y up (elevation above sea level), Z north; origin = SW corner of the playable area.
//                Positions passed to and from modules are WORLD coordinates (f64). Modules never see the floating
//                render origin except through RenderHooks.toRender(), which converts for GPU use.
//   time         deltaTime in seconds (clamped to ≤ 0.1 by the host); worldTime = seconds since world start.
//   LOD          0 = full detail (≤ 150 m), 1 = reduced (≤ 600 m), 2 = silhouette/impostor (≤ 2500 m), 3 = dormant
//                (not rendered; update may be skipped). The host chooses the level from camera distance and zone.
//   lighting     modules render into the scene's HDR pass with reverse-Z depth ('greater', cleared to 0) and must
//                apply the shared aerial perspective (WGSL `aerial()` from RenderHooks.commonWGSL) and sun/sky terms.
//   collision    bounds are axis-aligned boxes in world space; the world queries them for player collision.
//   lifecycle    initialize() once (may load assets), update() per frame while active, dispose() releases GPU objects.

export interface Vec3 { x: number; y: number; z: number }

export interface BoundingVolume { min: Vec3; max: Vec3 }

export type Medium = 'water' | 'land' | 'air';

export interface EncounterZoneInfo { id: string; creature: string; center: Vec3; radius: number; medium: Medium; minDepth?: number }

/** Read-only world queries available to modules. */
export interface WorldQueries {
  /** Terrain height (m) at world x/z. */
  heightAt(x: number, z: number): number;
  /** Great Lake surface elevation (m). */
  readonly waterLevel: number;
  /** Water depth at x/z (0 on land). */
  waterDepthAt(x: number, z: number): number;
  /** Forest depth (m inside the Forbidden Forest outline, negative outside). */
  forestDepthAt(x: number, z: number): number;
  /** The camera/player position in world coordinates. */
  viewerPosition(): Vec3;
}

/** GPU access for modules that render. Optional: a module may be logic-only. */
export interface RenderHooks {
  readonly device: GPUDevice;
  readonly colorFormat: GPUTextureFormat;
  readonly depthFormat: GPUTextureFormat;
  readonly sampleCount: number;
  /** Uniform buffer with the shared Frame struct (see src/gpu/shaders/common.wgsl.js). */
  readonly frameBuffer: GPUBuffer;
  /** WGSL source of the shared Frame struct, atmosphere and lighting helpers. */
  readonly commonWGSL: string;
  /** Converts a world position to render-origin-relative coordinates for vertex data or instance uniforms. */
  toRender(p: Vec3): Vec3;
  /** Register a draw callback recorded inside the scene pass (after terrain and props). Returns an unregister function. */
  addDrawCallback(cb: (pass: GPURenderPassEncoder) => void): () => void;
}

export interface CreatureContext {
  readonly id: string;
  readonly zone: EncounterZoneInfo;
  readonly world: WorldQueries;
  readonly render: RenderHooks | null;
  log(message: string): void;
}

export interface CreatureModule {
  initialize(context: CreatureContext): Promise<void>;
  update(deltaTime: number, worldTime: number): void;
  setPosition(position: Vec3): void;
  setLOD(level: number): void;
  getBounds(): BoundingVolume;
  dispose(): void;
}

export const LOD_DISTANCES = Object.freeze([150, 600, 2500]);
