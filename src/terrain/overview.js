// Low-resolution "overview" maps baked once per world on a worker: terrain shadow from the (static) sun, sky
// visibility (horizon-based ambient occlusion) and height (used for loch depth tinting). Output is RGBA16F.
// This is a stand-in for real-time shadow maps; see docs/ARCHITECTURE.md §4.

export function floatToHalf(v) {
  const f = new Float32Array(1), u = new Uint32Array(f.buffer);
  f[0] = v;
  const x = u[0], sign = (x >>> 16) & 0x8000;
  let e = ((x >>> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
  if (e <= 0) return sign; // flush tiny values to zero
  if (e >= 31) return sign | 0x7c00;
  let h = (e << 10) | (m >>> 13);
  if (m & 0x1000) h++; // round half up; a mantissa carry propagates into the exponent correctly
  return sign | Math.min(h, 0x7c00);
}

/** Heights of an res×res grid covering [−half, half]² (texel centres). */
export function sampleHeights(gen, res, half, rowStart = 0, rowEnd = res) {
  const step = (2 * half) / res, out = new Float32Array((rowEnd - rowStart) * res);
  for (let j = rowStart; j < rowEnd; j++) {
    const z = -half + (j + 0.5) * step;
    for (let i = 0; i < res; i++) out[(j - rowStart) * res + i] = gen.heightAt(-half + (i + 0.5) * step, z);
  }
  return out;
}

export function shadeOverview(H, res, half, sun) {
  const step = (2 * half) / res;
  const at = (x, z) => { // bilinear, in texel units, clamped
    x = Math.max(0, Math.min(res - 1.001, x)); z = Math.max(0, Math.min(res - 1.001, z));
    const i = x | 0, j = z | 0, u = x - i, w = z - j, k = j * res + i;
    return (H[k] * (1 - u) + H[k + 1] * u) * (1 - w) + (H[k + res] * (1 - u) + H[k + res + 1] * u) * w;
  };
  let maxH = -Infinity; for (const h of H) if (h > maxH) maxH = h;
  const sl = Math.hypot(sun[0], sun[2]), dx = sun[0] / sl, dz = sun[2] / sl, rise = sun[1] / sl; // m up per m along
  const out = new Uint16Array(res * res * 4);
  const dirs = [];
  for (let a = 0; a < 8; a++) dirs.push([Math.cos(a * Math.PI / 4), Math.sin(a * Math.PI / 4)]);
  const one = floatToHalf(1);
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const h0 = H[j * res + i];
    // soft shadow: smallest clearance angle along the sun ray
    let lit = 1, t = step;
    while (t < 6000) {
      const hr = h0 + 0.6 + t * rise;
      if (hr > maxH) break;
      const x = i + dx * t / step, z = j + dz * t / step;
      if (x < 0 || z < 0 || x > res - 1 || z > res - 1) break;
      const c = (hr - at(x, z)) / t;
      lit = Math.min(lit, 0.5 + c * 12);
      if (lit <= 0) { lit = 0; break; }
      t += step * (0.6 + t / 400);
    }
    // sky visibility: mean over 8 azimuths of (1 − sin(horizon elevation))
    let vis = 0;
    for (const [ex, ez] of dirs) {
      let tmax = 0;
      for (let d = step; d < 900; d *= 1.6) {
        const tn = (at(i + ex * d / step, j + ez * d / step) - h0) / d;
        if (tn > tmax) tmax = tn;
      }
      vis += 1 - tmax / Math.sqrt(1 + tmax * tmax);
    }
    const o = (j * res + i) * 4;
    out[o] = floatToHalf(Math.max(0, Math.min(1, lit)));
    out[o + 1] = floatToHalf(vis / 8);
    out[o + 2] = floatToHalf(h0);
    out[o + 3] = one;
  }
  return out;
}
