// Procedural mesh construction for props, placeholders and structures.
// The approach — a small builder with primitive emitters, per-vertex material ids packed next to the normal, and one
// shared vertex/index buffer for every mesh — is adapted from Abyssal Garden's `Mesh` class (math.js, MIT © 2026
// Maksymilian Dendura; see NOTICE.md). Primitives here are new (boxes, frusta, roofs, ribbons, rings).
//
// Local mesh space uses the world convention: X east, Y up, Z north. Vertex format (16 bytes):
//   f32x3 position, snorm8x3 normal, u8 material id.

export const MAT = Object.freeze({
  STONE: 0, SLATE: 1, TIMBER: 2, GLASS: 3, FOLIAGE: 4, RIVER: 5, FALLS: 6, GOLD: 7, FABRIC: 8, PLASTER: 9,
  SHINGLE: 10, STEEL: 11, SLEEPER: 12, STANDING_STONE: 13, WEB: 14, DARK_STONE: 15, LAWN: 16,
});

export interface BuiltMesh { name: string; vertices: ArrayBuffer; indices: Uint32Array; vertexCount: number; radius: number; minY: number; maxY: number }

type V3 = [number, number, number];

export class MeshBuilder {
  private p: number[] = []; private n: number[] = []; private m: number[] = []; private idx: number[] = [];
  readonly name: string;
  constructor(name: string) { this.name = name; }

  private vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, mat: number): number {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.m.push(mat);
    return this.p.length / 3 - 1;
  }

  /** Flat-shaded quad a→b→c→d, counter-clockwise as seen from outside (the normal then points outward). */
  quad(a: V3, b: V3, c: V3, d: V3, mat: number): void {
    const n = normal(a, b, c);
    const i = this.vert(...a, ...n, mat), j = this.vert(...b, ...n, mat), k = this.vert(...c, ...n, mat), l = this.vert(...d, ...n, mat);
    this.idx.push(i, j, k, i, k, l);
  }
  tri(a: V3, b: V3, c: V3, mat: number): void {
    const n = normal(a, b, c);
    const i = this.vert(...a, ...n, mat), j = this.vert(...b, ...n, mat), k = this.vert(...c, ...n, mat);
    this.idx.push(i, j, k);
  }

  /** Axis-aligned box rotated by `rot` (radians, clockwise from north = towards east) around its centre's vertical axis. */
  box(cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, mat: number, rot = 0, roofMat = mat): this {
    const P = rect(cx, cz, sx, sz, rot), y1 = y0 + sy;
    const b = P.map(([x, z]) => [x, y0, z] as V3), t = P.map(([x, z]) => [x, y1, z] as V3);
    for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; this.quad(b[k], b[k2], t[k2], t[k], mat); }
    this.quad(t[0], t[1], t[2], t[3], roofMat);
    return this;
  }

  /** Vertical frustum/cylinder (r1 = top radius; 0 makes a cone). */
  frustum(cx: number, y0: number, cz: number, r0: number, r1: number, h: number, seg: number, mat: number, capMat = mat, cap = true): this {
    const ring = (r: number, y: number) => Array.from({ length: seg }, (_, k) => { const a = (k / seg) * Math.PI * 2; return [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r] as V3; });
    const A = ring(r0, y0), B = ring(r1, y0 + h);
    for (let k = 0; k < seg; k++) {
      const k2 = (k + 1) % seg;
      if (r1 > 1e-6) this.quad(A[k2], A[k], B[k], B[k2], mat); else this.tri(A[k2], A[k], [cx, y0 + h, cz], mat);
    }
    if (cap && r1 > 1e-6) for (let k = 1; k < seg - 1; k++) this.tri(B[0], B[k + 1], B[k], capMat);
    return this;
  }

  /** Gable roof over a rectangle: ridge along the rectangle's local x axis (rotate by `rot`). */
  gable(cx: number, y0: number, cz: number, sx: number, sz: number, rise: number, mat: number, rot = 0, overhang = 0.4, gableMat = mat): this {
    const P = rect(cx, cz, sx + overhang * 2, sz + overhang * 2, rot);
    const r0 = mid(P[0], P[3]), r1 = mid(P[1], P[2]);
    const e = P.map(([x, z]) => [x, y0, z] as V3), R0: V3 = [r0[0], y0 + rise, r0[1]], R1: V3 = [r1[0], y0 + rise, r1[1]];
    this.quad(e[0], e[1], R1, R0, mat);
    this.quad(e[2], e[3], R0, R1, mat);
    this.tri(e[1], e[2], R1, gableMat);
    this.tri(e[3], e[0], R0, gableMat);
    return this;
  }

  /** Four-sided pyramid roof. */
  pyramid(cx: number, y0: number, cz: number, sx: number, sz: number, rise: number, mat: number, rot = 0): this {
    const P = rect(cx, cz, sx, sz, rot), top: V3 = [cx, y0 + rise, cz];
    for (let k = 0; k < 4; k++) this.tri([P[k][0], y0, P[k][1]], [P[(k + 1) % 4][0], y0, P[(k + 1) % 4][1]], top, mat);
    return this;
  }

  /** A flat strip along a polyline at given heights (river water, rails, decks). Faces up. */
  ribbon(pts: [number, number][], heights: number[], width: number, mat: number, offset = 0): this {
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
      const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = dz / l, nz = -dx / l; // right-hand side
      const w = width / 2;
      const a1: V3 = [ax + nx * (offset - w), heights[k], az + nz * (offset - w)], a2: V3 = [ax + nx * (offset + w), heights[k], az + nz * (offset + w)];
      const b1: V3 = [bx + nx * (offset - w), heights[k + 1], bz + nz * (offset - w)], b2: V3 = [bx + nx * (offset + w), heights[k + 1], bz + nz * (offset + w)];
      this.quadUp(a1, a2, b2, b1, mat);
    }
    return this;
  }

  /** Quad whose normal is forced to face +y (for ribbons regardless of point order). */
  private quadUp(a: V3, b: V3, c: V3, d: V3, mat: number): void {
    let n = normal(a, b, c);
    if (n[1] < 0) { [b, d] = [d, b]; n = normal(a, b, c); }
    const i = this.vert(...a, ...n, mat), j = this.vert(...b, ...n, mat), k = this.vert(...c, ...n, mat), l = this.vert(...d, ...n, mat);
    this.idx.push(i, j, k, i, k, l);
  }

  /** Vertical sheet between two points (a waterfall face), from y0 to y1. */
  sheet(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, mat: number): this {
    this.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], mat);
    this.quad([ax, y1, az], [bx, y1, bz], [bx, y0, bz], [ax, y0, az], mat);
    return this;
  }

  /** Low-poly blob (for canopies): a squashed icosahedron-like octahedron subdivided once. */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, mat: number, seed = 0): this {
    const top: V3 = [cx, cy + ry, cz], bot: V3 = [cx, cy - ry * 0.6, cz];
    const ring: V3[] = [];
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2 + seed, j = 0.85 + 0.3 * frac(Math.sin(seed * 12.9 + k * 78.2) * 43758.5); ring.push([cx + Math.sin(a) * rx * j, cy + ry * 0.1 * (k % 2), cz + Math.cos(a) * rz * j]); }
    for (let k = 0; k < 8; k++) { const k2 = (k + 1) % 8; this.tri(ring[k2], ring[k], top, mat); this.tri(ring[k], ring[k2], bot, mat); }
    return this;
  }

  build(): BuiltMesh {
    const n = this.p.length / 3;
    const vb = new ArrayBuffer(n * 16), f = new Float32Array(vb), s8 = new Int8Array(vb);
    let r = 0, minY = Infinity, maxY = -Infinity;
    for (let k = 0; k < n; k++) {
      const x = this.p[k * 3], y = this.p[k * 3 + 1], z = this.p[k * 3 + 2];
      f[k * 4] = x; f[k * 4 + 1] = y; f[k * 4 + 2] = z;
      s8[k * 16 + 12] = Math.round(this.n[k * 3] * 127); s8[k * 16 + 13] = Math.round(this.n[k * 3 + 1] * 127); s8[k * 16 + 14] = Math.round(this.n[k * 3 + 2] * 127);
      s8[k * 16 + 15] = this.m[k]; // material id as an integer in the normal's w (read back with round(w·127))
      r = Math.max(r, Math.hypot(x, y, z)); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { name: this.name, vertices: vb, indices: new Uint32Array(this.idx), vertexCount: n, radius: r, minY, maxY };
  }
}

const frac = (v: number) => v - Math.floor(v);
function rect(cx: number, cz: number, sx: number, sz: number, rot: number): [number, number][] {
  const c = Math.cos(rot), s = Math.sin(rot), hx = sx / 2, hz = sz / 2;
  // local x axis = (cos, -sin) [east rotated clockwise], local z axis = (sin, cos) [north rotated clockwise]
  const pt = (lx: number, lz: number): [number, number] => [cx + lx * c + lz * s, cz - lx * s + lz * c];
  return [pt(-hx, -hz), pt(hx, -hz), pt(hx, hz), pt(-hx, hz)];
}
function mid(a: [number, number], b: [number, number]): [number, number] { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
/** Face normal for a→b→c. A loop that is counter-clockwise seen from outside gives an outward normal in our left-handed
 * frame (X east, Y up, Z north) with this cross-product order, (c−a)×(b−a). Checked by tests/meshes.test.ts. */
function normal(a: V3, b: V3, c: V3): V3 {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = vy * uz - vz * uy, ny = vz * ux - vx * uz, nz = vx * uy - vy * ux;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  return [nx, ny, nz];
}
