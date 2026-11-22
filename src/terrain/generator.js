// The terrain "recipe": a pure, deterministic height function h(x, z) in metres.
//
// Coordinate convention (used everywhere): y up, x east, z south (north is −z). The playable square is
// centred on the origin. Water level is y = WATER_LEVEL.
//
// Composition, in order:
//   1. domain-warped mountain field: derivative-damped ("eroded") fbm + ridged multifractal
//   2. a glacial U-shaped glen and a tributary glen carved into it (polyline distance)
//   3. cliff bands (terracing) and one fault scarp
//   4. an irregular loch: shoreline from warped distance to the glen axis, a bay up the tributary,
//      beaches and steep shores by a shore-type field, a rocky island, a deep basin
//
// Only exactly specified IEEE operations are used (see noise.js), so the world is identical on every engine.

import { noise, fbm, erodedFbm, ridged, smoothstep, mix } from './noise.js';

export const WATER_LEVEL = 0;

// Glen axis (x, z) in metres, west → east, and a tributary glen branching north.
const GLEN = [[-6000, 900], [-2600, 520], [-1500, 330], [-900, 230], [-450, 130], [0, 70], [450, 40], [900, -60], [1500, -160], [2600, -430], [6000, -700]];
const TRIB = [[300, 45], [420, -380], [560, -900], [700, -1600], [900, -2600], [1300, -6000]];
// Along-axis range of the loch on GLEN (arc length, m) and length of the bay up TRIB
const GLEN_LEAD = 3421.169391; // length of the first (off-map) glen segment
const LOCH_S0 = GLEN_LEAD + 1720, LOCH_S1 = GLEN_LEAD + 3330, BAY_LEN = 470;
const ISLAND = [-120, 95, 46]; // x, z, radius
// Crag zone on the north shore: one large, sharp cliff band (x, z, radius, step height)
const CRAG = [-380, -250, 420, 62];

function preparePolyline(pts) {
  const segs = [];
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, len = Math.sqrt(dx * dx + dz * dz);
    segs.push({ ax, az, dx, dz, len, inv2: 1 / (len * len), s0: s });
    s += len;
  }
  return { segs, length: s };
}

const glen = preparePolyline(GLEN), trib = preparePolyline(TRIB);

/** Distance from (x, z) to a prepared polyline and the arc length at the closest point. Writes [d, s] into out. */
function polyDist(pl, x, z, out) {
  let best = Infinity, bestS = 0;
  const segs = pl.segs;
  for (let i = 0; i < segs.length; i++) {
    const g = segs[i];
    let t = ((x - g.ax) * g.dx + (z - g.az) * g.dz) * g.inv2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = g.ax + g.dx * t - x, pz = g.az + g.dz * t - z;
    const d2 = px * px + pz * pz;
    if (d2 < best) { best = d2; bestS = g.s0 + g.len * t; }
  }
  out[0] = Math.sqrt(best); out[1] = bestS;
  return out;
}

// polynomial smooth min / max (k in metres)
function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
function smax(a, b, k) { return -smin(-a, -b, k); }

export class TerrainGenerator {
  constructor(seed) {
    this.seed = seed | 0;
    // independent sub-seeds per field so changing one field never reshuffles another
    const s = this.seed;
    this.sWarpX = s ^ 0x1001; this.sWarpZ = s ^ 0x2002; this.sEroded = s ^ 0x3003; this.sRidge = s ^ 0x4004;
    this.sWidth = s ^ 0x5005; this.sShore = s ^ 0x6006; this.sCliff = s ^ 0x7007; this.sShoreType = s ^ 0x8008;
    this.sBed = s ^ 0x9009; this.sFloor = s ^ 0xc00c; this.sScarp = s ^ 0xa00a; this.sIsland = s ^ 0xb00b;
    this._pd = new Float64Array(2);
    this.waterLevel = WATER_LEVEL;
  }

  /** Terrain height (m) at world position (x, z). Pure function of (seed, x, z). */
  heightAt(x, z) {
    const W = WATER_LEVEL, pd = this._pd;

    // 1. mountains -----------------------------------------------------------------------------
    const wx = x + 150 * fbm(x * 0.001, z * 0.001, this.sWarpX, 3);
    const wz = z + 150 * fbm(x * 0.001 + 7.1, z * 0.001 - 3.3, this.sWarpZ, 3);
    const e = erodedFbm(wx / 1300, wz / 1300, this.sEroded, 10, 1.6);
    const r = ridged(wx / 720, wz / 720, this.sRidge, 7);
    const edge = Math.max(Math.abs(x), Math.abs(z));
    let mtn = 330 + 520 * e + 360 * r + 260 * smoothstep(1200, 3200, edge);

    // 2. glens -----------------------------------------------------------------------------------
    // U-shaped cross-section: a flat-ish floor with low hummocks, walls that steepen upward and blend into
    // the mountain field at the shoulders (~700 m from the axis).
    // valley axes are measured in a gently warped space, so the walls meander instead of running straight
    const vx = x + 0.6 * (wx - x), vz = z + 0.6 * (wz - z);
    polyDist(glen, vx, vz, pd);
    const dG = pd[0], sG = pd[1];
    // widths vary with position, not arc length: arc length jumps across the medial axis of the polyline
    const widthG = 980 + 160 * noise(x / 620, z / 620, this.sWidth);
    const lochMid = (LOCH_S0 + LOCH_S1) * 0.5;
    const hummocks = 3.5 * fbm(x / 140, z / 140, this.sFloor, 4) + 7 * fbm(x / 420, z / 420, this.sFloor + 3, 2) + 3;
    const floorG = W + 6 + hummocks + 0.03 * Math.max(0, Math.abs(sG - lochMid) - 900);
    let sg = smoothstep(0.1, 1.0, dG / widthG);
    const profG = sg * sg * (1.6 - 0.6 * sg);
    const hG = floorG + (Math.max(mtn, floorG + 20) - floorG) * profG;

    polyDist(trib, vx, vz, pd);
    const dT = pd[0], sT = pd[1];
    const widthT = 720 + 110 * noise(x / 400 + 3.5, z / 400, this.sWidth);
    const floorT = W + 6 + hummocks + 0.07 * Math.max(0, sT - 420);
    let st = smoothstep(0.08, 1.0, dT / widthT);
    const profT = st * st * (1.6 - 0.6 * st);
    const hT = floorT + (Math.max(mtn, floorT + 20) - floorT) * profT;

    let h = smin(hG, hT, 50);

    // 3. cliffs ------------------------------------------------------------------------------------
    const cliffMask = smoothstep(0.28, 0.45, fbm(x / 520, z / 520, this.sCliff, 2)) * smoothstep(90, 180, h - W);
    if (cliffMask > 0) {
      const hn = h + 34 * noise(x / 210, z / 210, this.sCliff + 9) + 8 * noise(x / 45, z / 45, this.sCliff + 11);
      const step = 30 + 12 * noise(x / 300, z / 300, this.sCliff + 5), k = hn / step, fl = Math.floor(k), f = k - fl;
      const g = f < 0.72 ? f * (0.3 / 0.72) : 0.3 + (f - 0.72) * (0.7 / 0.28);
      h = mix(h, (fl + g) * step, cliffMask * 0.5);
    }
    {
      const dx = x - CRAG[0], dz = z - CRAG[1], d = Math.sqrt(dx * dx + dz * dz);
      if (d < CRAG[2]) {
        const m = smoothstep(CRAG[2], CRAG[2] * 0.45, d) * smoothstep(25, 70, h - W);
        const hn = h + 30 * noise(x / 140, z / 140, this.sScarp) + 7 * noise(x / 35, z / 35, this.sScarp + 1);
        const step = CRAG[3], k = hn / step, fl = Math.floor(k), f = k - fl;
        const g = f < 0.78 ? f * (0.3 / 0.78) : 0.3 + (f - 0.78) * (0.7 / 0.22);
        h = mix(h, (fl + g) * step, m * 0.85);
      }
    }

    // 4. loch --------------------------------------------------------------------------------------
    const shoreWarp = 38 * fbm(x / 190, z / 190, this.sShore, 3);
    const taper = smoothstep(LOCH_S0, LOCH_S0 + 380, sG) * smoothstep(LOCH_S1, LOCH_S1 - 380, sG);
    const halfW = (205 + 55 * noise(sG / 260, 9.5, this.sWidth)) * taper - 60 * (1 - taper);
    // distance past the loch / bay ends counts too, otherwise the shoreline field stays small along the glen axes
    const pastEnds = Math.max(0, LOCH_S0 - sG, sG - LOCH_S1);
    let ld = dG + shoreWarp - halfW + pastEnds;
    const bayHalf = 125 * smoothstep(BAY_LEN, BAY_LEN - 260, sT) - 40;
    ld = smin(ld, dT + shoreWarp * 0.8 - bayHalf + Math.max(0, sT - BAY_LEN), 30);

    {
      // no distance gate here: every term is continuous, and the shore cap rises quadratically away from the loch so
      // it stops affecting the land smoothly (a gate produced a vertical step at its boundary)
      const shoreType = smoothstep(-0.3, 0.45, noise(x / 420, z / 420, this.sShoreType));
      const beach = mix(0.035, 0.75, shoreType); // shore slope (m per m)
      const far = Math.max(0, ld - 30);
      h = smin(h, W + beach * ld + 0.012 * far * far, 6);
      // lake bed: deep glacial basin, shallower near the ends
      const bed = W - (14 + 40 * taper) * (0.75 + 0.25 * noise(x / 300, z / 300, this.sBed));
      h = smax(h, bed, 8);
      // keep land outside the loch above water (no stray puddles); the floor rises gently away from the shore
      if (ld > 0) h = smax(h, W + 0.4 + 0.012 * Math.min(ld, 400), 1.5);
    }
    // rocky island
    {
      const dx = x - ISLAND[0], dz = z - ISLAND[1], d = Math.sqrt(dx * dx + dz * dz);
      if (d < ISLAND[2] * 2.2) {
        const isl = W + 17 * (1 - d / ISLAND[2]) + 5 * noise(x / 14, z / 14, this.sIsland) + 2.5 * noise(x / 4, z / 4, this.sIsland + 1);
        h = smax(h, isl, 5);
      }
    }
    return h;
  }

  /** Signed distance-like value to the loch shoreline (negative inside). Used by tests and tooling only. */
  lochDistance(x, z) {
    const pd = this._pd;
    const wx = x + 150 * fbm(x * 0.001, z * 0.001, this.sWarpX, 3);
    const wz = z + 150 * fbm(x * 0.001 + 7.1, z * 0.001 - 3.3, this.sWarpZ, 3);
    const vx = x + 0.6 * (wx - x), vz = z + 0.6 * (wz - z);
    polyDist(glen, vx, vz, pd); const dG = pd[0], sG = pd[1];
    polyDist(trib, vx, vz, pd); const dT = pd[0], sT = pd[1];
    const widthG = 340 + 90 * noise(sG / 420, 0.5, this.sWidth);
    const shoreWarp = 38 * fbm(x / 190, z / 190, this.sShore, 3);
    const taper = smoothstep(LOCH_S0, LOCH_S0 + 380, sG) * smoothstep(LOCH_S1, LOCH_S1 - 380, sG);
    const halfW = (205 + 55 * noise(sG / 260, 9.5, this.sWidth)) * taper - 60 * (1 - taper);
    const bayHalf = 125 * smoothstep(BAY_LEN, BAY_LEN - 260, sT) - 40;
    const pastEnds = Math.max(0, LOCH_S0 - sG, sG - LOCH_S1);
    return smin(dG + shoreWarp - halfW + pastEnds, dT + shoreWarp * 0.8 - bayHalf + Math.max(0, sT - BAY_LEN), 30);
  }
}

/** Landmarks other modules (benchmark route, spawn) refer to. */
export const LANDMARKS = { glen: GLEN, tributary: TRIB, island: ISLAND, crag: CRAG };
