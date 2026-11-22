// Small deterministic math kit for the tree lab: vectors as tuples, a seeded PRNG, 3D value noise.
export type V3 = [number, number, number];
export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const madd = (a: V3, b: V3, s: number): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.sqrt(dot(a, a));
export const dist = (a: V3, b: V3) => len(sub(a, b));
export const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function perp(d: V3): V3 { return norm(Math.abs(d[1]) < 0.9 ? cross(d, [0, 1, 0]) : cross(d, [1, 0, 0])); }
/** Rodrigues rotation of v about unit axis k by angle a. */
export function rotate(v: V3, k: V3, a: number): V3 {
  const c = Math.cos(a), s = Math.sin(a), kv = cross(k, v), kd = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}
/** Seeded PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  const f = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return Object.assign(f, {
    range: (lo: number, hi: number) => lo + (hi - lo) * f(),
    sphere: (): V3 => { for (;;) { const p: V3 = [f() * 2 - 1, f() * 2 - 1, f() * 2 - 1]; const l = dot(p, p); if (l > 1e-4 && l <= 1) return norm(p); } },
    normal: () => { const u = Math.max(1e-9, f()), w = f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185 * w); },
  });
}
export type Rng = ReturnType<typeof rng>;

function h3(x: number, y: number, z: number, s: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x1b873593) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 2147483648 - 1;
}
/** 3D value noise in [-1, 1], quintic. */
export function noise3(x: number, y: number, z: number, s = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const q = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const u = q(fx), v = q(fy), w = q(fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => h3(ix + dx, iy + dy, iz + dz, s);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
export function fbm3(x: number, y: number, z: number, s: number, oct: number): number {
  let a = 0.5, t = 0, n = 0;
  for (let i = 0; i < oct; i++) { t += a * noise3(x, y, z, s + i * 31); n += a; x = x * 2.03 + 1.7; y = y * 2.03 - 3.1; z = z * 2.03 + 0.7; a *= 0.5; }
  return t / n;
}
/** Ground height of the lab plot (gentle undulation so roots have something to follow). */
export function groundAt(x: number, z: number): number { return 0.18 * fbm3(x * 0.12, 0, z * 0.12, 77, 3) + 0.05 * noise3(x * 0.6, 0, z * 0.6, 78); }
