// The Hogwarts world terrain model: a pure, deterministic height function h(x, z) and the material/biome fields,
// built in three layers as the brief asks:
//   1. macrostructure — regional base elevation and relief amplitude from authored anchors (data/world.json)
//   2. erosion-inspired detail — domain-warped, derivative-damped fbm and ridged noise scaled by that amplitude
//   3. authored features — lake basin with depth bowls and steep shores, the castle promontory, knolls, the hollow,
//      river valleys (with a waterfall step), the railway formation with a gradient-capped profile, flattened sites
// Coordinates: X east, Z north, origin SW; heights in metres above sea level. Only exactly specified IEEE operations
// are used on the evaluation path (see src/terrain/noise.js), so results are identical on every engine.

import { noise, fbm, erodedFbm, ridged, smoothstep, mix } from '../terrain/noise.js';
import { WORLD_DB, type WorldDB, type Landmark, type River } from './world-db.ts';
import { sampleSpline, arcLengths, PolylineIndex, PolygonMask, polygonArea, type P2, type Nearest } from './geometry.ts';

function smin(a: number, b: number, k: number): number { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
function smax(a: number, b: number, k: number): number { return -smin(-a, -b, k); }

interface RiverRT { def: River; pts: P2[]; bed: Float64Array; index: PolylineIndex; valleySlope: number; glenSlope: number; reach: number }
export type RailKind = 0 | 1 | 2; // 0 ground (cutting/embankment), 1 viaduct, 2 tunnel
export interface RailProfile { pts: P2[]; s: Float64Array; elev: Float64Array; ground: Float64Array; kind: Uint8Array; index: PolylineIndex }
interface Pad { lm: Landmark; target: number; r: number; blend: number; flatten: number }

/** Material weights (0..1) that drive terrain shading and, later, vegetation. */
export interface Materials { forest: number; forestDepth: number; lawn: number; path: number; paved: number; ballast: number; clearing: number }

export class WorldTerrain {
  readonly db: WorldDB;
  readonly water: number;
  private s: Record<string, number>;
  private anchors: Float64Array; private kr2: number;
  readonly shore: P2[]; private shoreIdx: PolylineIndex; private lakeMask: PolygonMask; private shoreSign: number;
  private bowls: WorldDB['lake']['depthBowls']; private steep: WorldDB['lake']['steepShores'];
  readonly rivers: RiverRT[] = [];
  readonly rail!: RailProfile;
  private pads: Pad[] = [];
  private valleys: { idx: PolylineIndex; elev: Float64Array; half: number; blend: number; relief: number }[] = [];
  private castle: Landmark;
  private knolls: Landmark[]; private hollows: Landmark[];
  private forestIdx: PolylineIndex; private forestMask: PolygonMask;
  private pathIdx: { idx: PolylineIndex; half: number; road: boolean }[] = [];
  private nn: Nearest = { dist: 0, seg: 0, t: 0, side: 0 };
  private stage = 99; // evaluation stage limit, used while building derived data

  constructor(db: WorldDB = WORLD_DB) {
    this.db = db;
    this.water = db.lake.surface;
    const sd = db.seed | 0;
    this.s = { warpX: sd ^ 0x1001, warpZ: sd ^ 0x2002, eroded: sd ^ 0x3003, ridge: sd ^ 0x4004, shore: sd ^ 0x5005, shoreType: sd ^ 0x6006, bed: sd ^ 0x7007, rock: sd ^ 0x8008, forest: sd ^ 0x9009 };
    const a = db.regions.anchors;
    this.anchors = new Float64Array(a.length * 4);
    a.forEach((v, i) => this.anchors.set(v, i * 4));
    this.kr2 = db.regions.kernelRadius * db.regions.kernelRadius;

    for (const v of db.regions.valleys || []) {
      // per control point elevations, interpolated along the sampled spline by arc length
      const pts = sampleSpline(v.points, 20, false), s = arcLengths(pts), cs = arcLengths(v.points);
      const elev = new Float64Array(pts.length);
      for (let i = 0; i < pts.length; i++) {
        const u = s[i] / s[s.length - 1] * cs[cs.length - 1];
        let k = 0; while (k < cs.length - 2 && cs[k + 1] < u) k++;
        const t = Math.min(1, Math.max(0, (u - cs[k]) / (cs[k + 1] - cs[k])));
        elev[i] = v.elevations[k] + (v.elevations[k + 1] - v.elevations[k]) * t;
      }
      this.valleys.push({ idx: new PolylineIndex(pts, false, v.halfWidth + v.blend, 256), elev, half: v.halfWidth, blend: v.blend, relief: v.relief });
    }
    // lake shoreline: smooth closed spline, counter-clockwise
    let shore = sampleSpline(db.lake.shoreline, 12, true);
    this.shoreSign = polygonArea(shore) > 0 ? 1 : -1;
    this.shore = shore;
    this.shoreIdx = new PolylineIndex(shore, true, 700, 128);
    const xs = shore.map((p) => p[0]), zs = shore.map((p) => p[1]);
    this.lakeMask = new PolygonMask(shore, Math.min(...xs) - 64, Math.min(...zs) - 64, Math.max(...xs) + 64, Math.max(...zs) + 64, 16);
    this.bowls = db.lake.depthBowls; this.steep = db.lake.steepShores;

    this.castle = db.landmarks.find((l) => l.site === 'promontory')!;
    this.knolls = db.landmarks.filter((l) => l.site === 'knoll');
    this.hollows = db.landmarks.filter((l) => l.site === 'hollow');

    const fo = db.forest.outline;
    this.forestIdx = new PolylineIndex(fo, true, 1600, 256);
    this.forestMask = new PolygonMask(fo, -6000, -6000, 14000, 12000, 32);
    for (const p of db.paths) {
      const pts = sampleSpline(p.points, 8, false);
      this.pathIdx.push({ idx: new PolylineIndex(pts, false, 24, 128), half: p.width / 2, road: p.width >= 4 });
    }

    // derived data, each built from the stages before it
    this.stage = 0; this.buildRivers();
    this.stage = 4; (this as { rail: RailProfile }).rail = this.buildRailway();
    this.stage = 5; this.buildPads();
    this.stage = 99;
  }

  // -------------------------------------------------------------------------------------------- layer 1 + 2
  /** Regional base elevation + relief from the anchors, with mountains rising outside the playable area. */
  baseAt(x: number, z: number): number {
    const A = this.anchors, kr2 = this.kr2;
    let sw = 0, se = 0, sa = 0;
    for (let i = 0; i < A.length; i += 4) {
      const dx = x - A[i], dz = z - A[i + 1], q = dx * dx + dz * dz + kr2, w = 1 / (q * q);
      sw += w; se += w * A[i + 2]; sa += w * A[i + 3];
    }
    let h0 = se / sw, amp = sa / sw;
    const p = this.db.playable, R = this.db.regions;
    const ox = Math.max(p.minX - x, 0, x - p.maxX), oz = Math.max(p.minZ - z, 0, z - p.maxZ), out = Math.sqrt(ox * ox + oz * oz);
    if (out > 0) { const t = smoothstep(0, R.outsideRiseDistance, out); h0 += R.outsideRise * t; amp += R.outsideRelief * t; }
    for (const v of this.valleys) {
      const n = v.idx.nearest(x, z, this.nn);
      if (n.seg < 0) continue;
      const e = v.elev[n.seg] + (v.elev[n.seg + 1] - v.elev[n.seg]) * n.t;
      const w = 1 - smoothstep(v.half, v.half + v.blend, n.dist);
      h0 = mix(h0, e, w); amp = mix(amp, amp * v.relief, w);
    }
    const s = this.s;
    const wx = x + 170 * fbm(x / 1100, z / 1100, s.warpX, 3), wz = z + 170 * fbm(x / 1100 + 7.1, z / 1100 - 3.3, s.warpZ, 3);
    const e = erodedFbm(wx / 1400, wz / 1400, s.eroded, 10, 1.6);
    const r = ridged(wx / 760, wz / 760, s.ridge, 7);
    return h0 + amp * (0.95 * e + 0.85 * (r - 0.36));
  }

  // -------------------------------------------------------------------------------------------- layer 3
  /** Signed distance to the lake shore (negative in the water), clamped to ±700 m away from the shore. */
  lakeDistance(x: number, z: number): number {
    const wx = x + 32 * fbm(x / 170, z / 170, this.s.shore, 3), wz = z + 32 * fbm(x / 170 + 4.4, z / 170 - 1.7, this.s.shore, 3);
    const n = this.shoreIdx.nearest(wx, wz, this.nn);
    if (n.seg < 0) return this.lakeMask.inside(wx, wz) ? -700 : 700;
    return n.side * this.shoreSign > 0 ? -n.dist : n.dist;
  }

  private lakeDepthAt(x: number, z: number): number {
    let d = this.db.lake.baseDepth;
    for (const b of this.bowls) {
      const dx = x - b.x, dz = z - b.z, t = 1 - Math.min(1, (dx * dx + dz * dz) / (b.radius * b.radius));
      d = Math.max(d, b.depth * t * t * (3 - 2 * t));
    }
    return d * (0.85 + 0.15 * noise(x / 260, z / 260, this.s.bed));
  }

  private shoreSlopeAt(x: number, z: number): number {
    let s = mix(0.07, 0.45, smoothstep(-0.35, 0.5, noise(x / 380, z / 380, this.s.shoreType)));
    for (const st of this.steep) {
      const d = Math.hypot(x - st.x, z - st.z);
      s = Math.max(s, st.slope * (1 - smoothstep(st.radius * 0.5, st.radius, d)));
    }
    return s;
  }

  private applyLake(h: number, x: number, z: number): number {
    const W = this.water, ld = this.lakeDistance(x, z);
    if (ld >= 650) return h;
    const slope = this.shoreSlopeAt(x, z);
    const far = Math.max(0, ld - 20);
    h = smin(h, W + slope * ld + 0.006 * far * far, 6); // shore cap: land meets the water, then rises
    const bed = W - this.lakeDepthAt(x, z);
    h = smax(h, bed, 6);
    if (ld > 0) h = smax(h, W + 0.6 + 0.012 * Math.min(ld, 400), 1.2); // no stray flooding outside the lake
    for (const is of this.db.lake.islands || []) {
      const t = Math.hypot(x - is.x, z - is.z) / is.radius;
      if (t < 2.2) h = smax(h, W + is.height * (1 - t * 0.75) + 2.5 * noise(x / 9, z / 9, this.s.rock + 5), 4);
    }
    return h;
  }

  private applyPromontory(h: number, x: number, z: number): number {
    const c = this.castle, dx = x - c.x, dz = z - c.z;
    // the plateau is elongated along the promontory axis and narrower across it
    const ax = 0.94, az = -0.34; // unit vector of the promontory axis (WNW–ESE); u runs along it, v across it
    const u = dx * ax + dz * az, v = -dx * az + dz * ax;
    const d = Math.sqrt((u * u) / 1.35 + (v * v) * 1.25);
    const core = c.radius;
    if (d > core + 320) return h;
    const top = c.elevation!;
    // east (towards the mainland grounds) the plateau blends gently; elsewhere it ends in lake-facing cliffs
    const east = d > 1e-6 ? smoothstep(-0.15, 0.65, dx / d) : 0;
    const width = mix(45 + 40 * smoothstep(-0.2, 0.4, noise(x / 120, z / 120, this.s.rock + 6)), 300, east);
    // the plateau edge wobbles so the cliff line is not a circle
    // a lobed, bitten cliff line: low-frequency lobes plus small notches
    const edge = core - 12 + 34 * fbm(x / 160, z / 160, this.s.rock, 2) + 12 * fbm(x / 45, z / 45, this.s.rock + 4, 2);
    const t = smoothstep(edge, edge + width, d);
    const shape = 1 - (1 - t) * (1 - t) * (1 - t); // steep just below the rim
    const drop = mix(top - (this.water - 8), top - 382, east);
    let prof = top - drop * shape;
    // rocky texture on the cliff band
    prof += (1 - east) * 7 * t * (1 - t) * 4 * (noise(x / 14, z / 14, this.s.rock) + 0.5 * noise(x / 5, z / 5, this.s.rock + 1));
    h = smax(h, prof, 5);
    // flat plateau top
    const w = 1 - smoothstep(edge - 25, edge, d);
    return mix(h, top + 0.6 * noise(x / 40, z / 40, this.s.rock + 2), w);
  }

  private applyKnollsHollows(h: number, x: number, z: number): number {
    for (const k of this.knolls) {
      const t = Math.hypot(x - k.x, z - k.z) / k.knollRadius!;
      if (t < 1) { const u = 1 - t * t; h += k.rise! * u * u; }
    }
    for (const o of this.hollows) {
      const t = Math.hypot(x - o.x, z - o.z) / o.radius;
      if (t < 1.6) {
        h -= o.depth! * (1 - smoothstep(0.4, 1.0, t)) * (0.85 + 0.3 * noise(x / 40, z / 40, this.s.rock + 3));
        const r = (t - 1.18) / 0.32; if (r > -1 && r < 1) { const u = 1 - r * r; h += 7 * u * u; }
      }
    }
    return h;
  }

  private applyRivers(h: number, x: number, z: number): number {
    for (const r of this.rivers) {
      const n = r.index.nearest(x, z, this.nn);
      if (n.seg < 0) continue;
      const bed = r.bed[n.seg] + (r.bed[n.seg + 1] - r.bed[n.seg]) * n.t;
      const d = n.dist, half = r.def.width * 0.5 + 3, top = bed + r.def.depth;
      const target = d < half ? bed + r.def.depth * smoothstep(r.def.width * 0.3, half, d) : Math.min(top + r.valleySlope * (d - half), top + 4 + r.glenSlope * (d - half));
      // fade the carve out well before the search radius so it never ends in a step
      const w = 1 - smoothstep(r.index.radius * 0.6, r.index.radius * 0.95, d);
      h = mix(h, smin(h, target, 4), w);
    }
    return h;
  }

  private applyRailway(h: number, x: number, z: number): number {
    const R = this.rail, n = R.index.nearest(x, z, this.nn);
    if (n.seg < 0) return h;
    if (R.kind[n.seg] !== 0 && R.kind[n.seg + 1] !== 0) return h; // viaduct span or tunnel: terrain untouched
    const rail = R.elev[n.seg] + (R.elev[n.seg + 1] - R.elev[n.seg]) * n.t - 0.5;
    const hw = this.db.railway.formationHalfWidth, bank = 3 + 1.5 * Math.abs(h - rail);
    const w = 1 - smoothstep(hw, hw + bank, n.dist);
    return mix(h, rail, w);
  }

  private applyPads(h: number, x: number, z: number): number {
    for (const p of this.pads) {
      const d = Math.hypot(x - p.lm.x, z - p.lm.z);
      if (d < p.r + p.blend) h = mix(h, p.target, p.flatten * (1 - smoothstep(p.r, p.r + p.blend, d)));
    }
    return h;
  }

  /** Terrain height (m above sea level). */
  heightAt(x: number, z: number): number {
    let h = this.baseAt(x, z);
    if (this.stage <= 0) return h;
    h = this.applyLake(h, x, z);
    h = this.applyPromontory(h, x, z);
    h = this.applyKnollsHollows(h, x, z);
    h = this.applyRivers(h, x, z);
    if (this.stage <= 4) return h;
    h = this.applyRailway(h, x, z);
    if (this.stage <= 5) return h;
    return this.applyPads(h, x, z);
  }

  // -------------------------------------------------------------------------------------------- derived data
  private buildRivers(): void {
    const byId = new Map<string, RiverRT>();
    for (const def of this.db.rivers) {
      const pts = sampleSpline(def.points, 10, false);
      const s = arcLengths(pts);
      const bed = new Float64Array(pts.length);
      const glenDepth = def.glenDepth || 0;
      for (let i = 0; i < pts.length; i++) bed[i] = this.baseAt(pts[i][0], pts[i][1]) - def.depth - 1 - glenDepth * 0.5;
      // smooth, then never flow uphill
      const sm = Float64Array.from(bed);
      for (let i = 0; i < pts.length; i++) { let a = 0, c = 0; for (let k = -15; k <= 15; k++) { const j = Math.min(pts.length - 1, Math.max(0, i + k)); a += bed[j]; c++; } sm[i] = a / c; }
      let fallIdx = -1;
      if (def.fallAt !== undefined) {
        const fp = def.points[def.fallAt]; let best = Infinity;
        pts.forEach((p, i) => { const d = Math.hypot(p[0] - fp[0], p[1] - fp[1]); if (d < best) { best = d; fallIdx = i; } });
      }
      for (let i = 1; i < pts.length; i++) {
        sm[i] = Math.min(sm[i], sm[i - 1] - 0.002 * (s[i] - s[i - 1]));
        if (i === fallIdx) sm[i] = Math.min(sm[i], sm[i - 1] - (def.fallHeight || 0));
      }
      // mouth: into the lake, or meet the river it joins at the same bed level
      const end = def.points[def.points.length - 1];
      let endBed = this.water - 3;
      for (const other of byId.values()) {
        const n = other.index.nearest(end[0], end[1], this.nn);
        if (n.seg >= 0 && n.dist < 40) endBed = other.bed[n.seg] + (other.bed[n.seg + 1] - other.bed[n.seg]) * n.t;
      }
      const L = s[s.length - 1];
      for (let i = 0; i < pts.length; i++) {
        const t = smoothstep(L - 350, L, s[i]);
        if (t > 0) sm[i] = Math.min(sm[i], mix(sm[i], endBed, t));
      }
      const rt: RiverRT = {
        def, pts, bed: sm, index: new PolylineIndex(pts, false, Math.max((def.glenWidth || 0) * 1.4, 260), 128),
        valleySlope: 0.55, glenSlope: def.glenWidth ? (2 * (def.glenDepth || 0)) / def.glenWidth : 0.55, reach: 0,
      };
      this.rivers.push(rt); byId.set(def.id, rt);
    }
  }

  private buildRailway(): RailProfile {
    const R = this.db.railway, pts = sampleSpline(R.points, 10, false), s = arcLengths(pts), n = pts.length;
    const ground = new Float64Array(n);
    for (let i = 0; i < n; i++) ground[i] = this.heightAt(pts[i][0], pts[i][1]);
    // starting profile: terrain smoothed over ±300 m
    let elev = new Float64Array(n);
    for (let i = 0; i < n; i++) { let a = 0, c = 0; for (let k = -30; k <= 30; k++) { const j = Math.min(n - 1, Math.max(0, i + k)); a += ground[j]; c++; } elev[i] = Math.max(a / c, this.water + 3); }
    // the station platform is level at its fixed elevation
    const st = R.station, pinned = new Uint8Array(n);
    let si = 0, best = Infinity;
    pts.forEach((p, i) => { const d = Math.hypot(p[0] - st.at[0], p[1] - st.at[1]); if (d < best) { best = d; si = i; } });
    for (let i = 0; i < n; i++) if (Math.abs(s[i] - s[si]) <= st.platformLength / 2) { elev[i] = st.elevation; pinned[i] = 1; }
    // gradient cap: alternate forward/backward clamping, keeping pinned samples fixed
    const g = R.maxGradient * 0.95;
    for (let pass = 0; pass < 8; pass++) {
      for (let i = 1; i < n; i++) if (!pinned[i]) { const ds = s[i] - s[i - 1]; elev[i] = Math.min(Math.max(elev[i], elev[i - 1] - g * ds), elev[i - 1] + g * ds); }
      for (let i = n - 2; i >= 0; i--) if (!pinned[i]) { const ds = s[i + 1] - s[i]; elev[i] = Math.min(Math.max(elev[i], elev[i + 1] - g * ds), elev[i + 1] + g * ds); }
    }
    const kind = new Uint8Array(n);
    // embankments up to 18 m, cuttings up to 30 m; beyond that a viaduct or a tunnel
    for (let i = 0; i < n; i++) kind[i] = elev[i] - ground[i] > 18 ? 1 : ground[i] - elev[i] > 30 ? 2 : 0;
    // remove one-sample flickers between kinds
    for (let i = 1; i < n - 1; i++) if (kind[i - 1] === kind[i + 1] && kind[i] !== kind[i - 1]) kind[i] = kind[i - 1];
    return { pts, s, elev, ground, kind, index: new PolylineIndex(pts, false, 90, 128) };
  }

  private buildPads(): void {
    for (const lm of this.db.landmarks) {
      if (!(lm.site === 'pad' || lm.site === 'shore' || lm.site === 'knoll' || lm.site === 'cliff-foot')) continue;
      const target = lm.elevation ?? this.heightAt(lm.x, lm.z);
      this.pads.push({ lm, target, r: lm.radius, blend: lm.blend ?? Math.max(20, lm.radius), flatten: lm.flatten ?? 1 });
    }
  }

  /** Railway top-of-rail elevation and kind at the nearest point of the line (for proxies and tests). */
  railAt(x: number, z: number): { elev: number; kind: RailKind; dist: number } | null {
    const n = this.rail.index.nearest(x, z, this.nn);
    if (n.seg < 0) return null;
    const R = this.rail;
    return { elev: R.elev[n.seg] + (R.elev[n.seg + 1] - R.elev[n.seg]) * n.t, kind: R.kind[n.seg] as RailKind, dist: n.dist };
  }

  /** Bed elevation and distance of the nearest river (Infinity when none within its reach). */
  riverAt(x: number, z: number): { dist: number; bed: number; id: string } {
    let best = { dist: Infinity, bed: 0, id: '' };
    for (const r of this.rivers) {
      const n = r.index.nearest(x, z, this.nn);
      if (n.seg >= 0 && n.dist < best.dist) best = { dist: n.dist, bed: r.bed[n.seg] + (r.bed[n.seg + 1] - r.bed[n.seg]) * n.t, id: r.def.id };
    }
    return best;
  }

  /** Distance inside the forest outline (negative outside), with a noisy edge. */
  forestDepth(x: number, z: number): number {
    const wx = x + 70 * fbm(x / 260, z / 260, this.s.forest, 3), wz = z + 70 * fbm(x / 260 + 3.3, z / 260 + 8.1, this.s.forest, 3);
    const n = this.forestIdx.nearest(wx, wz, this.nn);
    const inside = this.forestMask.inside(wx, wz);
    const d = n.seg < 0 ? 1600 : n.dist;
    return inside ? d : -d;
  }

  forestZone(depth: number): string | null {
    if (depth < 0) return null;
    for (const z of this.db.forest.zones) if (depth >= z.fromDepth && depth < z.toDepth) return z.id;
    return 'deep';
  }

  /** Material weights at a point; `slope` = 1 − normal.y (computed by the caller from neighbouring heights). */
  materialsAt(x: number, z: number, h: number, slope: number): Materials {
    const W = this.water;
    const fd = this.forestDepth(x, z);
    let forest = fd > 0 ? smoothstep(0, 60, fd) : 0;
    let clearing = 0;
    for (const hb of this.db.forest.habitats) {
      const d = Math.hypot(x - hb.x, z - hb.z);
      if (hb.kind === 'clearing') clearing = Math.max(clearing, 1 - smoothstep(hb.radius * 0.45, hb.radius, d));
      if (hb.kind === 'open-upland') clearing = Math.max(clearing, 0.65 * (1 - smoothstep(hb.radius * 0.5, hb.radius, d)) * smoothstep(0.1, 0.4, noise(x / 120, z / 120, this.s.forest + 7) + 0.3));
    }
    forest *= 1 - clearing;
    if (h < W + 1.2) forest = 0;
    forest *= 1 - smoothstep(0.55, 0.8, slope); // cliffs stay bare
    // managed grounds: around the castle, the pitch and village greens
    const c = this.castle;
    let lawn = (1 - smoothstep(330, 520, Math.hypot(x - (c.x + 260), z - (c.z + 30)))) * (1 - forest) * (1 - smoothstep(0.18, 0.32, slope)) * 0.85;
    for (const id of ['quidditch-pitch', 'hogsmeade']) {
      const l = this.db.landmarks.find((m) => m.id === id)!;
      lawn = Math.max(lawn, (1 - smoothstep(l.radius, l.radius + 60, Math.hypot(x - l.x, z - l.z))) * 0.8);
    }
    if (h < W + 1.0) lawn = 0;
    let path = 0;
    for (const p of this.pathIdx) {
      const n = p.idx.nearest(x, z, this.nn);
      if (n.seg >= 0) path = Math.max(path, 1 - smoothstep(p.half, p.half + 2.5, n.dist));
    }
    const ra = this.railAt(x, z);
    const ballast = ra && ra.kind === 0 ? 1 - smoothstep(3.2, 6, ra.dist) : 0;
    let paved = 1 - smoothstep(c.radius - 30, c.radius - 5, Math.hypot(x - c.x, z - c.z));
    const hg = this.db.landmarks.find((m) => m.id === 'hogsmeade')!;
    paved = Math.max(paved, 0.55 * (1 - smoothstep(hg.radius * 0.35, hg.radius * 0.6, Math.hypot(x - hg.x, z - hg.z))));
    return { forest, forestDepth: Math.max(fd, 0), lawn, path, paved, ballast, clearing };
  }
}
