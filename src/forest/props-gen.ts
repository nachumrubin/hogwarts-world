// Forest-floor geometry: rocks (instanced archetypes), fallen logs with root plates, exposed roots and fallen
// branches. Logs and roots follow the terrain, so they are unique geometry built once in site-local coordinates.
//
// Rocks adapt Abyssal Garden's meshChunk (world.js): an icosphere displaced by fbm and cut by a few random planes,
// which gives the faceted, fractured look of real boulders; flattened underneath and sunk into the ground.

import { Builder, MAT, BARK, type MeshData, type V3 } from './tree-gen.ts';
import { rng, type Species } from './species.ts';
import type { Ecology, LogInst, TreeInst } from './ecology.ts';
import { SITE } from './site.ts';

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.sqrt(dot(a, a)) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// smooth 3D value noise (CPU, for mesh displacement only)
function h3(x: number, y: number, z: number, s: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x1b873593) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vn3(x: number, y: number, z: number, s: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => h3(ix + dx, iy + dy, iz + dz, s);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
function fbm3(x: number, y: number, z: number, s: number, o: number): number { let a = 0.5, t = 0, n = 0; for (let i = 0; i < o; i++) { t += a * vn3(x, y, z, s + i); n += a; x *= 2.03; y *= 2.03; z *= 2.03; a *= 0.5; } return t / n; }

/** Icosphere with subdivision `sub`, vertices mapped by fn (unit-sphere point → position). Flat-ish shading via shared vertices. */
function icosphere(sub: number, fn: (p: V3) => V3): { pos: V3[]; idx: number[] } {
  const t = (1 + Math.sqrt(5)) / 2;
  let pos: V3[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => norm(p as V3));
  let idx = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
  for (let s = 0; s < sub; s++) {
    const cache = new Map<string, number>(), next: number[] = [];
    const mid = (a: number, b: number) => { const k = a < b ? `${a},${b}` : `${b},${a}`; let m = cache.get(k); if (m === undefined) { m = pos.length; pos.push(norm(mul(add(pos[a], pos[b]), 0.5))); cache.set(k, m); } return m; };
    for (let i = 0; i < idx.length; i += 3) { const a = idx[i], b = idx[i + 1], c = idx[i + 2], ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca); }
    idx = next;
  }
  return { pos: pos.map(fn), idx };
}

export interface RockArchetype { lods: MeshData[] }
export function buildRockArchetypes(n = 8): RockArchetype[] {
  const out: RockArchetype[] = [];
  for (let a = 0; a < n; a++) {
    const r = rng(500 + a * 31);
    const planes: [V3, number][] = [];
    for (let i = 0; i < 5; i++) planes.push([norm([r() - 0.5, (r() - 0.5) * 0.8, r() - 0.5]), 0.7 + 0.25 * r()]);
    const squash = 0.55 + 0.35 * r(), stretch = 1 + 0.6 * r();
    const shape = (p: V3, det: boolean): V3 => {
      let rad = 1 + (fbm3(p[0] * 1.6 + a * 7, p[1] * 1.6, p[2] * 1.6, a, 3) - 0.5) * 0.9 + (det ? (fbm3(p[0] * 5 + a, p[1] * 5, p[2] * 5, a + 50, 2) - 0.5) * 0.18 : 0);
      let q: V3 = [p[0] * rad * stretch, p[1] * rad * squash, p[2] * rad];
      for (const [pn, d] of planes) { const dd = dot(q, pn) - d; if (dd > 0) q = sub(q, mul(pn, dd)); }
      if (q[1] < -0.35) q[1] = -0.35 + (q[1] + 0.35) * 0.2; // flat underside (sunk anyway)
      return q;
    };
    const lods: MeshData[] = [];
    for (const [sub, det] of [[3, true], [2, false], [1, false]] as [number, boolean][]) {
      const ico = icosphere(sub, (p) => shape(p, det));
      const B = new Builder();
      // normals from faces (averaged)
      const nrm: V3[] = ico.pos.map(() => [0, 0, 0]);
      for (let i = 0; i < ico.idx.length; i += 3) {
        const A = ico.pos[ico.idx[i]], Bp = ico.pos[ico.idx[i + 1]], C = ico.pos[ico.idx[i + 2]];
        const fn = cross(sub_(Bp, A), sub_(C, A));
        for (const k of [0, 1, 2]) { const v = nrm[ico.idx[i + k]]; v[0] += fn[0]; v[1] += fn[1]; v[2] += fn[2]; }
      }
      const base = ico.pos.map((p, i) => B.v(p, norm(nrm[i]), [1, 0, 0], p[0], p[2], 0, 0, 0, Math.min(1, 0.6 + 0.4 * (p[1] + 0.35)), MAT.rock, 0, 0));
      for (let i = 0; i < ico.idx.length; i += 3) B.tri(base[ico.idx[i]], base[ico.idx[i + 1]], base[ico.idx[i + 2]]);
      lods.push(B.build());
    }
    out.push({ lods });
  }
  return out;
}
const sub_ = sub;

// ---------------------------------------------------------------------------------------------- tubes on the ground
function tube(B: Builder, pts: V3[], rad: number[], sides: number, mat: number, bark: number, varr: number, aoBase: number): void {
  let N: V3 = [0, 1, 0];
  let prev: number[] | null = null;
  let vacc = 0;
  const repU = Math.max(1, Math.round(2 * Math.PI * rad[0] / 0.55));
  for (let i = 0; i < pts.length; i++) {
    const T = norm(i < pts.length - 1 ? sub(pts[i + 1], pts[i]) : sub(pts[i], pts[i - 1]));
    N = norm(sub(N, mul(T, dot(N, T))));
    if (Math.abs(dot(N, T)) > 0.99 || !isFinite(N[0])) N = norm(cross(T, [1, 0, 0]));
    const Bv = cross(T, N);
    if (i > 0) vacc += Math.sqrt(dot(sub(pts[i], pts[i - 1]), sub(pts[i], pts[i - 1])));
    const ring: number[] = [];
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2, d = add(mul(N, Math.cos(a)), mul(Bv, Math.sin(a)));
      // underside darker (contact with the ground)
      const ao = aoBase * (0.55 + 0.45 * Math.max(0, d[1] * 0.5 + 0.5));
      ring.push(B.v(add(pts[i], mul(d, rad[i])), d, T, (s / sides) * repU, vacc / 0.55, 0, 0, 0, ao, mat, bark, 0, varr));
    }
    if (prev) for (let s = 0; s < sides; s++) { B.tri(prev[s], ring[s + 1], prev[s + 1]); B.tri(prev[s], ring[s], ring[s + 1]); }
    prev = ring;
  }
}

const barkOf = (sp: Species) => (sp === 'pine' ? BARK.pineLower : sp === 'oak' ? BARK.oak : sp === 'birch' ? BARK.birch : BARK.smooth);

export interface StaticGeo { lods: MeshData[]; cells: { cx: number; cz: number } }

/**
 * Logs, root plates and exposed roots in site-local coordinates, bucketed into 32 m cells (one mesh per cell and
 * LOD) so they can be culled by cell. Returns per-cell meshes.
 */
export function buildGroundWood(eco: Ecology, hAt: (x: number, z: number) => number): { cells: Map<string, { cx: number; cz: number; lods: MeshData[] }>; triangles: number } {
  const CELL = 32;
  const builders = new Map<string, { cx: number; cz: number; b: Builder[] }>();
  const get = (x: number, z: number) => {
    const cx = Math.floor((x - SITE.x0) / CELL), cz = Math.floor((z - SITE.z0) / CELL), k = `${cx},${cz}`;
    let e = builders.get(k); if (!e) builders.set(k, (e = { cx, cz, b: [new Builder(), new Builder(), new Builder()] }));
    return e.b;
  };
  const L = (x: number, z: number, y: number): V3 => [x - SITE.x0, y, z - SITE.z0];
  // ---- logs
  for (const lg of eco.logs) log(lg, get((lg.x0 + lg.x1) / 2, (lg.z0 + lg.z1) / 2), hAt, L);
  // ---- exposed roots of mature trees
  for (const t of eco.trees) if ((t.age === 'mature' || t.age === 'veteran') && t.species !== 'holly' && t.species !== 'hazel') roots(t, get(t.x, t.z), hAt, L, eco);
  const cells = new Map<string, { cx: number; cz: number; lods: MeshData[] }>();
  let tris = 0;
  for (const [k, e] of builders) { const lods = e.b.map((b) => b.build()); tris += lods[0].triangles; cells.set(k, { cx: e.cx, cz: e.cz, lods }); }
  return { cells, triangles: tris };
}

function log(lg: LogInst, B: Builder[], hAt: (x: number, z: number) => number, L: (x: number, z: number, y: number) => V3): void {
  const r = rng(lg.seed);
  const dx = lg.x1 - lg.x0, dz = lg.z1 - lg.z0, len = Math.sqrt(dx * dx + dz * dz);
  const n = Math.max(3, Math.ceil(len / 0.6));
  const pts: V3[] = [], rad: number[] = [];
  const sag = (r() - 0.5) * 0.3, sink = lg.radius * (0.25 + 0.45 * lg.decay);
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = lg.x0 + dx * t, z = lg.z0 + dz * t;
    // rest on the highest ground under the log, sagging between supports as it rots
    const ground = Math.max(hAt(x, z), i > 0 && i < n ? (hAt(x + dz / len * lg.radius, z - dx / len * lg.radius) + hAt(x - dz / len * lg.radius, z + dx / len * lg.radius)) / 2 : -1e9);
    const rr = lg.radius * (1 - 0.35 * t) * (1 + 0.06 * Math.sin(t * 17 + lg.seed));
    pts.push(L(x + (r() - 0.5) * 0.04, z + (r() - 0.5) * 0.04, ground + rr - sink + sag * Math.sin(Math.PI * t) * lg.decay));
    rad.push(rr);
  }
  // smooth the profile so the log reads as rigid timber
  for (let k = 0; k < 2; k++) for (let i = 1; i < n; i++) pts[i][1] = Math.max(pts[i][1], (pts[i - 1][1] + pts[i + 1][1]) / 2 - lg.radius * 0.1);
  const decayed = lg.decay > 0.55;
  const mat = decayed ? MAT.deadwood : MAT.bark;
  const bark = decayed ? BARK.deadwood : barkOf(lg.species);
  for (let k = 0; k < 3; k++) {
    const step = k === 0 ? 1 : k === 1 ? 2 : 4;
    const sp: V3[] = [], sr: number[] = [];
    for (let i = 0; i <= n; i += step) { sp.push(pts[i]); sr.push(rad[i]); }
    if ((n % step) !== 0) { sp.push(pts[n]); sr.push(rad[n]); }
    tube(B[k], sp, sr, k === 0 ? 10 : k === 1 ? 6 : 4, mat, bark, lg.decay, 0.85);
    // end caps: jagged broken wood at the top end, saw-cut-like rotted face at the base
    for (const [end, dirSign] of [[0, -1], [sp.length - 1, 1]] as [number, number][]) {
      const p = sp[end], q = sp[end - dirSign] ?? sp[end + 1];
      const T = norm(mul(sub(p, q), 1));
      const c = B[k].v(add(p, mul(T, sr[end] * (dirSign > 0 ? 0.5 : 0.15))), T, T, 0.5, 0.5, 0, 0, 0, 0.7, MAT.cutWood, bark, 0, lg.decay);
      const sides = k === 0 ? 10 : k === 1 ? 6 : 4;
      const N0 = norm(cross(T, [0, 1, 0]));
      const Bv = cross(T, N0);
      const ring: number[] = [];
      for (let s = 0; s <= sides; s++) { const a = s / sides * Math.PI * 2, d = add(mul(N0, Math.cos(a)), mul(Bv, Math.sin(a))); ring.push(B[k].v(add(p, mul(d, sr[end] * 0.98)), T, T, 0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a), 0, 0, 0, 0.6, MAT.cutWood, bark, 0, lg.decay)); }
      for (let s = 0; s < sides; s++) if (dirSign > 0) B[k].tri(ring[s], ring[s + 1], c); else B[k].tri(ring[s + 1], ring[s], c);
    }
  }
  // root plate: a disc of soil and roots stood on edge at the base of windthrown trees
  if (lg.rootPlate) {
    const base = pts[0], T = norm(sub(pts[1], pts[0]));
    const Rp = 1.1 + lg.radius * 2.6 + r() * 0.5;
    const N0 = norm(cross(T, [0, 1, 0])), U: V3 = norm(cross(N0, T));
    const center = add(base, add(mul(T, -0.25), mul(U, Rp * 0.35)));
    for (let k = 0; k < 2; k++) {
      const Bk = B[k], seg = k === 0 ? 22 : 10;
      const rimF: number[] = [], rimB: number[] = [];
      const cF = Bk.v(add(center, mul(T, -0.35)), mul(T, -1), U, 0.5, 0.5, 0, 0, 0, 0.6, MAT.soil, 0, 0);
      const cB = Bk.v(add(center, mul(T, 0.2)), T, U, 0.5, 0.5, 0, 0, 0, 0.5, MAT.soil, 0, 0);
      for (let s = 0; s <= seg; s++) {
        const a = s / seg * Math.PI * 2, rr = Rp * (0.8 + 0.3 * Math.sin(a * 3 + lg.seed) + 0.12 * Math.sin(a * 7));
        const d = add(mul(N0, Math.cos(a)), mul(U, Math.sin(a)));
        let p = add(center, mul(d, rr));
        const g = hAt(p[0] + SITE.x0, p[2] + SITE.z0);
        if (p[1] < g - 0.3) p = [p[0], g - 0.3, p[2]];
        rimF.push(Bk.v(add(p, mul(T, -0.2)), norm(add(mul(T, -1), mul(d, 0.6))), U, 0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a), 0, 0, 0, 0.75, MAT.soil, 0, 0));
        rimB.push(Bk.v(add(p, mul(T, 0.15)), norm(add(T, mul(d, 0.6))), U, 0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a), 0, 0, 0, 0.6, MAT.soil, 0, 0));
      }
      for (let s = 0; s < seg; s++) {
        Bk.tri(rimF[s + 1], rimF[s], cF); Bk.tri(rimB[s], rimB[s + 1], cB);
        Bk.tri(rimF[s], rimF[s + 1], rimB[s + 1]); Bk.tri(rimF[s], rimB[s + 1], rimB[s]);
      }
      // broken roots sticking out of the plate
      if (k === 0) for (let i = 0; i < 9; i++) {
        const a = r() * Math.PI * 2, d = add(mul(N0, Math.cos(a)), mul(U, Math.sin(a)));
        const p0 = add(center, mul(d, Rp * (0.5 + 0.4 * r())));
        const p1 = add(p0, add(mul(d, 0.5 + 0.8 * r()), mul(T, -0.3 - 0.4 * r())));
        tube(Bk, [p0, add(mul(add(p0, p1), 0.5), [0, 0.05, 0]), p1], [0.06 + 0.05 * r(), 0.04, 0.012], 5, MAT.root, barkOf(lg.species), 0.3, 0.8);
      }
    }
  }
}

function roots(t: TreeInst, B: Builder[], hAt: (x: number, z: number) => number, L: (x: number, z: number, y: number) => V3, eco: Ecology): void {
  const r = rng(t.seed + 17);
  const trunkR = t.height * (t.species === 'oak' ? 0.021 : t.species === 'pine' ? 0.015 : 0.012) * (t.age === 'veteran' ? 2.1 : 1);
  // more exposure on slopes, outcrops and next to trails (erosion)
  const u = t.x - SITE.x0, v = t.z - SITE.z0;
  const slope = Math.abs(hAt(t.x + 2, t.z) - hAt(t.x - 2, t.z)) / 4 + Math.abs(hAt(t.x, t.z + 2) - hAt(t.x, t.z - 2)) / 4;
  const exposure = Math.min(1, 0.35 + slope * 1.2 + eco.site.outcrop(u, v) * 0.6 + (eco.site.trail(u, v).dist < 4 ? 0.4 : 0) + (t.age === 'veteran' ? 0.4 : 0));
  const n = Math.round((t.age === 'veteran' ? 8 : 4) + r() * 4 * exposure);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.6;
    const len = (t.age === 'veteran' ? 4.5 : 2.2) * (0.6 + 0.8 * r()) * (0.5 + exposure);
    const segs = 9, pts: V3[] = [], rad: number[] = [];
    let ax = Math.cos(a), az = Math.sin(a);
    for (let k = 0; k <= segs; k++) {
      const s = k / segs, d = trunkR * 0.7 + len * s;
      ax += (r() - 0.5) * 0.25; az += (r() - 0.5) * 0.25; const l = Math.hypot(ax, az); ax /= l; az /= l;
      const x = t.x + ax * d, z = t.z + az * d;
      const rr = trunkR * 0.42 * Math.pow(1 - s * 0.85, 1.4) * (0.7 + 0.4 * r());
      // emerges from the flare, humps over the ground, dives under it
      const hump = rr * (0.55 * exposure + 0.25) * Math.sin(Math.PI * Math.min(1, s * 1.15)) - rr * 0.6 * s * s;
      pts.push(L(x, z, hAt(x, z) + hump + rr * 0.1 - (k === 0 ? 0.1 : 0)));
      rad.push(rr);
    }
    tube(B[0], pts, rad, 6, MAT.root, barkOf(t.species), 0.25, 0.9);
    if (rad[0] > 0.08) tube(B[1], [pts[0], pts[3], pts[6], pts[9]], [rad[0], rad[3], rad[6], rad[9]], 4, MAT.root, barkOf(t.species), 0.25, 0.9);
  }
}

/** Fallen branches: small dead branch archetypes lying flat (instanced, scaled by Cover.size). */
export function buildFallenBranches(n = 6): MeshData[][] {
  const out: MeshData[][] = [];
  for (let a = 0; a < n; a++) {
    const r = rng(700 + a * 13);
    const lods = [new Builder(), new Builder()];
    const limb = (p: V3, dir: V3, length: number, rad0: number, depth: number) => {
      const pts: V3[] = [p], rad: number[] = [rad0];
      let d = dir, q = p;
      const segs = 4;
      for (let i = 1; i <= segs; i++) { d = norm(add(d, [(r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3])); q = add(q, mul(d, length / segs)); q[1] = rad0 * (1 - i / segs) * 0.6; pts.push(q); rad.push(rad0 * (1 - 0.8 * i / segs)); }
      tube(lods[0], pts, rad, depth === 0 ? 5 : 3, MAT.deadwood, BARK.deadwood, 0.6, 0.85);
      if (depth === 0) tube(lods[1], [pts[0], pts[2], pts[4]], [rad[0], rad[2], rad[4]], 3, MAT.deadwood, BARK.deadwood, 0.6, 0.85);
      if (depth < 2) for (let k = 0; k < 2 + Math.floor(r() * 2); k++) {
        const s = 1 + Math.floor(r() * (segs - 1));
        const side = r() < 0.5 ? -1 : 1;
        const cd = norm([d[0] * 0.6 - d[2] * side, 0, d[2] * 0.6 + d[0] * side]);
        limb(pts[s], cd, length * 0.4, rad[s] * 0.6, depth + 1);
      }
    };
    limb([-0.5, 0.03, 0], [1, 0, 0], 1, 0.035, 0);
    out.push(lods.map((b) => b.build()));
  }
  return out;
}
