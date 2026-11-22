// Seeded 2D value noise with analytic derivatives, and the fractal sums built from it.
//
// Determinism: only IEEE-754 operations whose results are exactly specified (+ - * /, Math.floor,
// Math.sqrt, Math.imul, integer bit operations) are used, so every conforming JavaScript engine on every
// platform produces bit-identical results. Math.sin/exp/pow are deliberately avoided: their precision is
// implementation-defined.
//
// The derivative-damped ("eroded") fbm follows the well-known technique popularised by Inigo Quilez.

/** Integer lattice hash → float in [-1, 1). Pure function of (ix, iz, seed). */
export function hash2(ix, iz, seed) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 2147483648 - 1;
}

/**
 * Value noise with derivatives. Writes [value, d/dx, d/dz] into out (no allocation). Value in [-1, 1].
 * Quintic interpolation gives C2 continuity, so normals derived from it are smooth.
 */
export function noised(x, z, seed, out) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const du = 30 * fx * fx * (fx * (fx - 2) + 1);
  const dw = 30 * fz * fz * (fz * (fz - 2) + 1);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  const k1 = b - a, k2 = c - a, k3 = a - b - c + d;
  out[0] = a + k1 * u + k2 * w + k3 * u * w;
  out[1] = du * (k1 + k3 * w);
  out[2] = dw * (k2 + k3 * u);
  return out;
}

/** Value noise without derivatives (cheaper). */
export function noise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
}

// octave rotation (a 36.87° rotation scaled by 2.0; exact decimal constants) to hide lattice alignment
const R0 = 1.6, R1 = 1.2;

/** Plain fbm, value in roughly [-1, 1]. */
export function fbm(x, z, seed, octaves) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x, z, seed + i * 1013);
    norm += amp;
    const nx = R0 * x - R1 * z, nz = R1 * x + R0 * z;
    x = nx + 5.3; z = nz - 2.7;
    amp *= 0.5;
  }
  return sum / norm;
}

const _nd = new Float64Array(3);

/**
 * Derivative-damped fbm: octaves are attenuated where the accumulated slope is steep, which produces
 * eroded-looking ridges and smooth valley floors. Returns roughly [-1, 1].
 * Lower octaves are rotated in the same way as fbm(); derivatives are rotated back accordingly.
 */
export function erodedFbm(x, z, seed, octaves, damping) {
  let sum = 0, amp = 0.5, norm = 0, dx = 0, dz = 0;
  // m = cumulative transform from world to octave space; derivative wrt world = M^T * d_octave
  let m00 = 1, m01 = 0, m10 = 0, m11 = 1;
  for (let i = 0; i < octaves; i++) {
    noised(x, z, seed + i * 1013, _nd);
    // derivative in base coordinates
    const gx = m00 * _nd[1] + m10 * _nd[2], gz = m01 * _nd[1] + m11 * _nd[2];
    dx += gx * amp; dz += gz * amp;
    sum += amp * _nd[0] / (1 + damping * (dx * dx + dz * dz));
    norm += amp;
    const nx = R0 * x - R1 * z, nz = R1 * x + R0 * z;
    x = nx + 5.3; z = nz - 2.7;
    const a00 = R0 * m00 - R1 * m10, a01 = R0 * m01 - R1 * m11, a10 = R1 * m00 + R0 * m10, a11 = R1 * m01 + R0 * m11;
    m00 = a00; m01 = a01; m10 = a10; m11 = a11;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Ridged multifractal, value in [0, 1]. Sharp crests, each octave weighted by the previous one. */
export function ridged(x, z, seed, octaves) {
  let sum = 0, amp = 0.5, norm = 0, weight = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noise(x, z, seed + i * 7919));
    n *= n;
    n *= weight;
    weight = n * 1.6; if (weight > 1) weight = 1;
    sum += n * amp; norm += amp;
    const nx = R0 * x - R1 * z, nz = R1 * x + R0 * z;
    x = nx + 1.9; z = nz + 4.1;
    amp *= 0.5;
  }
  return sum / norm;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const mix = (a, b, t) => a + (b - a) * t;
export function smoothstep(e0, e1, v) {
  let t = (v - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}
