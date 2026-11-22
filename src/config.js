// World constants and quality presets. Everything that a later milestone may want to tune lives here.

// World convention (data/world.json, docs/WORLD_ARCHITECTURE.md): metres, X = east, Y = up (elevation above sea level),
// Z = north, origin = south-west corner of the playable area.
export const WORLD = Object.freeze({
  seed: 1337,
  /** Side of the quadtree root (m): playable 8 × 6 km plus ≈ 4–5 km of scenic terrain. chunkQuads · 2^maxDepth · 1 m. */
  rootSize: 16384,
  /** World position of the root's minimum corner: the root is centred on the playable area's centre (4000, 3000). */
  rootMinX: -4192,
  rootMinZ: -5192,
  /** Quads per chunk side. Every chunk at every LOD has this grid, so one set of index buffers serves all. */
  chunkQuads: 32,
  /** Depth of the finest chunks: rootSize / 2^maxDepth = 32 m chunks with 1 m vertex spacing. */
  maxDepth: 9,
  /** Playable area (m). Flight and walking are kept inside it. */
  playable: Object.freeze({ minX: 0, minZ: 0, maxX: 8000, maxZ: 6000 }),
  /** Great Lake surface (m above sea level). */
  waterLevel: 300,
  /** Flight ceiling (m above sea level). */
  ceiling: 2100,
  /** Region baked into the overview maps (shadows, sky visibility, materials): playable area + 1 km. */
  overview: Object.freeze({ minX: -1024, minZ: -1024, maxX: 9216, maxZ: 7168 }),
  /** Render-origin snap (m, power of two). Keeps GPU vertex coordinates exact; see docs/ARCHITECTURE.md §3.4. */
  originSnap: 256,
});

export const CHUNK_VERTS = WORLD.chunkQuads + 1; // 33
export const CHUNK_VERTEX_COUNT = CHUNK_VERTS * CHUNK_VERTS; // 1089
/** Bytes per chunk vertex in the GPU pool: height f32, morph-target height f32, normal 2×snorm16, morph normal 2×snorm16. */
export const VERTEX_BYTES = 16;
export const CHUNK_BYTES = CHUNK_VERTEX_COUNT * VERTEX_BYTES;

/**
 * Morph runs between morphStart·R and R, where R is the distance at which the parent takes over.
 * At the moment a node splits, the camera is at distance R from its box, so its farthest vertex is at most
 * R + (horizontal diagonal + vertical extent) away. For that vertex the node must not yet morph towards its own
 * parent (which starts at morphStart·2R), so morphStart ≥ (1 + (√2 + v)/lodFactor) / 2, with v the assumed vertical
 * extent of a node relative to its size. Smaller values pop (measured by tests/cracks-and-lod.test.js).
 */
export const NODE_VERTICAL_EXTENT = 0.45;
export function morphStartFor(lodFactor) {
  return Math.min(0.92, 0.5 * (1 + (Math.SQRT2 + NODE_VERTICAL_EXTENT) / lodFactor) + 0.01);
}
/** Children are requested before they are needed (multiplier on the split range). */
export const PREFETCH = 1.35;
/** Vertical padding (fraction of node size, min metres) of node bounds, covers finer samples exceeding coarse min/max. */
export const BOUNDS_PAD_FRACTION = 0.04;
export const BOUNDS_PAD_MIN = 2;

/**
 * Quality presets.
 *   lodFactor    split range = lodFactor · node size (higher = more detail further away)
 *   renderScale  maximum internal resolution scale (dynamic resolution moves below it)
 *   msaa         1 or 4
 *   poolSlots    GPU chunk slots (each CHUNK_BYTES)
 *   uploadsPerFrame  chunk uploads per frame
 *   overviewCell texel size (m) of the baked shadow / sky-visibility / material maps
 */
export const PRESETS = Object.freeze({
  low: { name: 'Low', lodFactor: 2.0, renderScale: 0.7, msaa: 1, poolSlots: 704, uploadsPerFrame: 6, overviewCell: 16, minScale: 0.5 },
  medium: { name: 'Medium', lodFactor: 2.5, renderScale: 0.85, msaa: 1, poolSlots: 960, uploadsPerFrame: 10, overviewCell: 12, minScale: 0.55 },
  high: { name: 'High', lodFactor: 3.2, renderScale: 1.0, msaa: 4, poolSlots: 1664, uploadsPerFrame: 14, overviewCell: 8, minScale: 0.6 },
  ultra: { name: 'Ultra', lodFactor: 4.5, renderScale: 1.0, msaa: 4, poolSlots: 2624, uploadsPerFrame: 20, overviewCell: 8, minScale: 0.7 },
});
export const DEFAULT_PRESET = 'high';

/** Sun and atmosphere. Direction points towards the sun (x east, y up, z north): mid-afternoon, from the south-west. */
export const SUN = Object.freeze({
  azimuthDeg: 218, // clockwise from north
  elevationDeg: 31,
  illuminance: 9.0, // linear scene units; exposure is set to match
});
