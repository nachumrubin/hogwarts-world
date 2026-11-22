// 2D geometry helpers for the world model (x/z plane). Pure, deterministic, allocation-free on the query path.

export type P2 = [number, number];

/** Closed or open Catmull-Rom spline through control points, resampled at roughly `step` metres. */
export function sampleSpline(ctrl: P2[], step: number, closed: boolean): P2[] {
  const n = ctrl.length, out: P2[] = [];
  const at = (i: number): P2 => closed ? ctrl[((i % n) + n) % n] : ctrl[Math.max(0, Math.min(n - 1, i))];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const k = Math.max(1, Math.ceil(len / step));
    for (let j = 0; j < k; j++) {
      const u = j / k, u2 = u * u, u3 = u2 * u;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (3 * b - a - 3 * c + d) * u3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  if (!closed) out.push([ctrl[n - 1][0], ctrl[n - 1][1]]);
  return out;
}

/** Cumulative arc length of a polyline. */
export function arcLengths(pts: P2[]): Float64Array {
  const s = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) s[i] = s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

export function pointInPolygon(x: number, z: number, poly: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Result of a nearest-segment query. */
export interface Nearest { dist: number; seg: number; t: number; side: number }

/**
 * Segments of a polyline bucketed in a uniform grid, for fast "nearest segment within R" queries.
 * Each segment is registered in every cell its R-inflated bounding box touches.
 */
export class PolylineIndex {
  readonly ax: Float64Array; readonly az: Float64Array; readonly dx: Float64Array; readonly dz: Float64Array; readonly inv2: Float64Array;
  private cells: Map<number, number[]> = new Map();
  readonly count: number; readonly radius: number; readonly cell: number;
  constructor(pts: P2[], closed: boolean, radius: number, cell = 128) {
    this.radius = radius; this.cell = cell;
    const n = closed ? pts.length : pts.length - 1;
    this.count = n;
    this.ax = new Float64Array(n); this.az = new Float64Array(n); this.dx = new Float64Array(n); this.dz = new Float64Array(n); this.inv2 = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      this.ax[i] = a[0]; this.az[i] = a[1]; this.dx[i] = b[0] - a[0]; this.dz[i] = b[1] - a[1];
      const l2 = this.dx[i] * this.dx[i] + this.dz[i] * this.dz[i];
      this.inv2[i] = l2 > 0 ? 1 / l2 : 0;
      const x0 = Math.floor((Math.min(a[0], b[0]) - radius) / cell), x1 = Math.floor((Math.max(a[0], b[0]) + radius) / cell);
      const z0 = Math.floor((Math.min(a[1], b[1]) - radius) / cell), z1 = Math.floor((Math.max(a[1], b[1]) + radius) / cell);
      for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
        const k = cx * 100003 + cz;
        let list = this.cells.get(k);
        if (!list) { list = []; this.cells.set(k, list); }
        list.push(i);
      }
    }
  }

  /** Nearest segment within the index radius; dist = Infinity when none. `side` > 0 left of the segment direction. */
  nearest(x: number, z: number, out: Nearest): Nearest {
    out.dist = Infinity; out.seg = -1; out.t = 0; out.side = 0;
    const list = this.cells.get(Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell));
    if (!list) return out;
    let best = this.radius * this.radius;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      let t = ((x - this.ax[i]) * this.dx[i] + (z - this.az[i]) * this.dz[i]) * this.inv2[i];
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = this.ax[i] + this.dx[i] * t - x, pz = this.az[i] + this.dz[i] * t - z, d2 = px * px + pz * pz;
      if (d2 < best) { best = d2; out.seg = i; out.t = t; out.side = this.dx[i] * (z - this.az[i]) - this.dz[i] * (x - this.ax[i]); }
    }
    if (out.seg >= 0) out.dist = Math.sqrt(best);
    return out;
  }
}

/** Coarse inside/outside raster of a polygon, used where no edge is within an index radius. */
export class PolygonMask {
  private bits: Uint8Array; private nx: number; private nz: number;
  readonly x0: number; readonly z0: number; readonly cell: number;
  constructor(poly: P2[], x0: number, z0: number, x1: number, z1: number, cell: number) {
    this.x0 = x0; this.z0 = z0; this.cell = cell;
    this.nx = Math.ceil((x1 - x0) / cell); this.nz = Math.ceil((z1 - z0) / cell);
    this.bits = new Uint8Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) this.bits[j * this.nx + i] = pointInPolygon(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell, poly) ? 1 : 0;
  }
  inside(x: number, z: number): boolean {
    const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return false;
    return this.bits[j * this.nx + i] === 1;
  }
}

/** Signed polygon area (> 0 counter-clockwise in x/z with z up on the map). */
export function polygonArea(poly: P2[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1]);
  return a / 2;
}
