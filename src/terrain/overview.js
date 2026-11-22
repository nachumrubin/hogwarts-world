// Low-resolution "overview" maps baked once per world on workers, over the rectangle WORLD.overview:
//   overview  (RGBA16F): r terrain shadow from the static sun, g sky visibility, b height, a paved/ballast amount
//   materials (RGBA8):   r forest amount, g forest depth (0..1 = 0..1600 m), b managed lawn, a path
// They stand in for real-time shadows and drive terrain shading and the debug map; see docs/WORLD_ARCHITECTURE.md.

export function floatToHalf(v) {
  const f = new Float32Array(1), u = new Uint32Array(f.buffer);
  f[0] = v;
  const x = u[0], sign = (x >>> 16) & 0x8000;
  const e = ((x >>> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
  if (e <= 0) return sign; // flush tiny values to zero
  if (e >= 31) return sign | 0x7c00;
  let h = (e << 10) | (m >>> 13);
  if (m & 0x1000) h++; // round half up; a mantissa carry propagates into the exponent correctly
  return sign | Math.min(h, 0x7c00);
}

/** Grid description: x0/z0 = world position of texel (0,0)'s corner; cell = texel size (m). */
export function gridOf(rect, cell) {
  return { x0: rect.minX, z0: rect.minZ, cell, nx: Math.round((rect.maxX - rect.minX) / cell), nz: Math.round((rect.maxZ - rect.minZ) / cell) };
}

/** Heights at texel centres for rows [rowStart, rowEnd). Row j = z (north increasing). */
export function sampleHeights(gen, g, rowStart = 0, rowEnd = g.nz) {
  const out = new Float32Array((rowEnd - rowStart) * g.nx);
  for (let j = rowStart; j < rowEnd; j++) {
    const z = g.z0 + (j + 0.5) * g.cell;
    for (let i = 0; i < g.nx; i++) out[(j - rowStart) * g.nx + i] = gen.heightAt(g.x0 + (i + 0.5) * g.cell, z);
  }
  return out;
}

/** Material weights for rows [rowStart, rowEnd); needs heights of rows rowStart-1 .. rowEnd (for slope), given as H. */
export function sampleMaterials(gen, g, H, rowStart, rowEnd) {
  const out = new Uint8Array((rowEnd - rowStart) * g.nx * 4), paved = new Uint8Array((rowEnd - rowStart) * g.nx);
  const at = (i, j) => H[Math.max(0, Math.min(g.nz - 1, j)) * g.nx + Math.max(0, Math.min(g.nx - 1, i))];
  for (let j = rowStart; j < rowEnd; j++) {
    const z = g.z0 + (j + 0.5) * g.cell;
    for (let i = 0; i < g.nx; i++) {
      const x = g.x0 + (i + 0.5) * g.cell, h = at(i, j);
      const dx = (at(i + 1, j) - at(i - 1, j)) / (2 * g.cell), dz = (at(i, j + 1) - at(i, j - 1)) / (2 * g.cell);
      const slope = 1 - 1 / Math.sqrt(1 + dx * dx + dz * dz);
      const m = gen.materialsAt(x, z, h, slope);
      const o = ((j - rowStart) * g.nx + i);
      out[o * 4] = Math.round(m.forest * 255); out[o * 4 + 1] = Math.round(Math.min(1, m.forestDepth / 1600) * 255);
      out[o * 4 + 2] = Math.round(m.lawn * 255); out[o * 4 + 3] = Math.round(m.path * 255);
      paved[o] = Math.round(Math.max(m.paved, m.ballast) * 255);
    }
  }
  return { rgba: out, paved };
}

export function shadeOverview(H, g, sun, paved) {
  const { nx, nz, cell } = g;
  const at = (x, z) => { // bilinear, in texel units, clamped
    x = Math.max(0, Math.min(nx - 1.001, x)); z = Math.max(0, Math.min(nz - 1.001, z));
    const i = x | 0, j = z | 0, u = x - i, w = z - j, k = j * nx + i;
    return (H[k] * (1 - u) + H[k + 1] * u) * (1 - w) + (H[k + nx] * (1 - u) + H[k + nx + 1] * u) * w;
  };
  let maxH = -Infinity; for (const h of H) if (h > maxH) maxH = h;
  const sl = Math.hypot(sun[0], sun[2]), dx = sun[0] / sl, dz = sun[2] / sl, rise = sun[1] / sl; // m up per m along
  const out = new Uint16Array(nx * nz * 4);
  const dirs = [];
  for (let a = 0; a < 8; a++) dirs.push([Math.cos(a * Math.PI / 4), Math.sin(a * Math.PI / 4)]);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const h0 = H[j * nx + i];
    // soft shadow: smallest clearance angle along the sun ray
    let lit = 1, t = cell;
    while (t < 8000) {
      const hr = h0 + 0.6 + t * rise;
      if (hr > maxH) break;
      const x = i + dx * t / cell, z = j + dz * t / cell;
      if (x < 0 || z < 0 || x > nx - 1 || z > nz - 1) break;
      const c = (hr - at(x, z)) / t;
      lit = Math.min(lit, 0.5 + c * 12);
      if (lit <= 0) { lit = 0; break; }
      t += cell * (0.6 + t / 400);
    }
    // sky visibility: mean over 8 azimuths of (1 − sin(horizon elevation))
    let vis = 0;
    for (const [ex, ez] of dirs) {
      let tmax = 0;
      for (let d = cell; d < 1200; d *= 1.6) {
        const tn = (at(i + ex * d / cell, j + ez * d / cell) - h0) / d;
        if (tn > tmax) tmax = tn;
      }
      vis += 1 - tmax / Math.sqrt(1 + tmax * tmax);
    }
    const o = (j * nx + i) * 4;
    out[o] = floatToHalf(Math.max(0, Math.min(1, lit)));
    out[o + 1] = floatToHalf(vis / 8);
    out[o + 2] = floatToHalf(h0);
    out[o + 3] = floatToHalf(paved ? paved[j * nx + i] / 255 : 0);
  }
  return out;
}
