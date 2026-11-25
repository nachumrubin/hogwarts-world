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
/** 3D value noise in [-1, 1], quintic. (Written without closures: it is the hot loop of meshing.) */
export function noise3(x: number, y: number, z: number, s = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10), w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const c000 = h3(ix, iy, iz, s), c100 = h3(ix + 1, iy, iz, s), c010 = h3(ix, iy + 1, iz, s), c110 = h3(ix + 1, iy + 1, iz, s);
  const c001 = h3(ix, iy, iz + 1, s), c101 = h3(ix + 1, iy, iz + 1, s), c011 = h3(ix, iy + 1, iz + 1, s), c111 = h3(ix + 1, iy + 1, iz + 1, s);
  const a0 = c000 + (c100 - c000) * u, a1 = c010 + (c110 - c010) * u, b0 = c001 + (c101 - c001) * u, b1 = c011 + (c111 - c011) * u;
  const a = a0 + (a1 - a0) * v, b = b0 + (b1 - b0) * v;
  return a + (b - a) * w;
}
export function fbm3(x: number, y: number, z: number, s: number, oct: number): number {
  let a = 0.5, t = 0, n = 0;
  for (let i = 0; i < oct; i++) { t += a * noise3(x, y, z, s + i * 31); n += a; x = x * 2.03 + 1.7; y = y * 2.03 - 3.1; z = z * 2.03 + 0.7; a *= 0.5; }
  return t / n;
}
/** Ground height of the lab plot (gentle undulation so roots have something to follow). */
export function groundAt(x: number, z: number): number { return 0.18 * fbm3(x * 0.12, 0, z * 0.12, 77, 3) + 0.05 * noise3(x * 0.6, 0, z * 0.6, 78); }
/** Bark coordinates for a surface point: `f(angle, along)`. Swept tubes pass their own continuous coordinates
 *  (`at`: the parallel-transported ring angle and the arc length along the branch), so a limb's pattern runs
 *  seamlessly along it; the blended bole and forks use the angle around the vertical stem axis and the height,
 *  one continuous pattern shared by everything they join. */
export function barkSample(p: V3, axis: V3, f: (a: number, along: number, tube: boolean) => number, at?: [number, number]): number {
  let a: number, along: number;
  if (at) { a = at[0]; along = at[1]; } else {
    // (height, not the nearest segment's axis: that switches at every joint and drew a ring there)
    a = Math.atan2(p[2], p[0]); along = p[1];
  }
  // periodic in the angle: the last quarter turn fades into the pattern before 0, so there is no seam at the wrap
  const T = Math.PI * 2; a = ((a % T) + T) % T;
  const w = smooth(T * 0.75, T, a);
  const tube = !!at; // tubes sample along the branch only every ~r: fine along-branch detail would alias into rings
  return w <= 0 ? f(a, along, tube) : f(a, along, tube) * (1 - w) + f(a - T, along, tube) * w;
}
