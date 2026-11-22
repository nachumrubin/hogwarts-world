// Small f64 math helpers for the CPU side. Matrices are column-major Float32Array(16) as WGSL expects.
//
// Projection: reverse-Z with an infinite far plane (depth = near / w: 1 at the near plane, → 0 at infinity,
// compared with 'greater', cleared to 0). The approach is adapted from Abyssal Garden (MIT, © 2026 Maksymilian
// Dendura), main.js render(); see NOTICE.md.

export const DEG = Math.PI / 180;

/** Camera basis from yaw (clockwise from north, i.e. from −z towards +x), pitch (up positive) and roll (right-wing-down positive). */
export function cameraBasis(yaw, pitch, roll, out) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch), sy = Math.sin(yaw), cy = Math.cos(yaw);
  // forward
  const fx = sy * cp, fy = sp, fz = -cy * cp;
  // unrolled right (horizontal) and up
  let rx = cy, ry = 0, rz = sy;
  let ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
  // roll around forward
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const rx2 = rx * cr - ux * sr, ry2 = ry * cr - uy * sr, rz2 = rz * cr - uz * sr;
  const ux2 = ux * cr + rx * sr, uy2 = uy * cr + ry * sr, uz2 = uz * cr + rz * sr;
  out.fx = fx; out.fy = fy; out.fz = fz;
  out.rx = rx2; out.ry = ry2; out.rz = rz2;
  out.ux = ux2; out.uy = uy2; out.uz = uz2;
  return out;
}

/**
 * viewProj (column-major) for a camera at (cx, cy, cz) — already relative to the render origin — with basis b.
 * clip = (f/aspect · r·(p−c), f · u·(p−c), near, fwd·(p−c))
 */
export function viewProjection(b, cx, cy, cz, fovY, aspect, near, m) {
  const f = 1 / Math.tan(fovY / 2), sx = f / aspect;
  m[0] = b.rx * sx; m[4] = b.ry * sx; m[8] = b.rz * sx; m[12] = -(b.rx * cx + b.ry * cy + b.rz * cz) * sx;
  m[1] = b.ux * f; m[5] = b.uy * f; m[9] = b.uz * f; m[13] = -(b.ux * cx + b.uy * cy + b.uz * cz) * f;
  m[2] = 0; m[6] = 0; m[10] = 0; m[14] = near;
  m[3] = b.fx; m[7] = b.fy; m[11] = b.fz; m[15] = -(b.fx * cx + b.fy * cy + b.fz * cz);
  return m;
}

/** Frustum planes (a, b, c, d; inside when a·x + b·y + c·z + d ≥ 0) from a column-major viewProj. Near + 4 sides. */
export function frustumPlanes(m, out) {
  const row = (r) => [m[r], m[4 + r], m[8 + r], m[12 + r]];
  const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
  const planes = [
    r3.map((v, i) => v + r0[i]), r3.map((v, i) => v - r0[i]),
    r3.map((v, i) => v + r1[i]), r3.map((v, i) => v - r1[i]),
    r3.map((v, i) => v - r2[i]),
  ];
  for (let p = 0; p < 5; p++) for (let i = 0; i < 4; i++) out[p * 4 + i] = planes[p][i];
  return out;
}

/** AABB vs frustum (conservative). */
export function boxInFrustum(pl, x0, y0, z0, x1, y1, z1) {
  for (let p = 0; p < 20; p += 4) {
    const a = pl[p], b = pl[p + 1], c = pl[p + 2], d = pl[p + 3];
    if (a * (a > 0 ? x1 : x0) + b * (b > 0 ? y1 : y0) + c * (c > 0 ? z1 : z0) + d < 0) return false;
  }
  return true;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
/** Frame-rate independent exponential smoothing factor. */
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
export function wrapAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

/** Percentile of a sorted array (nearest-rank). */
export function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p / 100 * sorted.length) - 1));
  return sorted[i];
}
