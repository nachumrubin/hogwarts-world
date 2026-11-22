// Forest ecology: where everything grows, and why.
//
// Spatially correlated placement in three passes, each reading the fields the previous one produced:
//   1. site fields from the terrain: slope, topographic position (TPI), moisture, soil depth, rock exposure
//   2. trees: veterans first (authored positions), then a Matérn cluster process thinned by species suitability,
//      stand density and crown competition; lean and crown shift computed from neighbours and open sky
//   3. canopy → light: crowns splatted into a 3D leaf-density volume (also used for sky visibility in the shaders,
//      the Abyssal Garden "vol" technique), ground light from that volume; then the ground layer reads light and
//      moisture: ferns, grass, moss, litter type, mud, rocks, deadwood
//
// Runs once on the main thread (≈ 0.5–1 s). Uses a seeded PRNG, so the stand is identical on every load.

import { SITE, ForestSite, VETERANS, CLEARINGS, OUTCROPS } from './site.ts';
import { FOREST_SUN_DAY } from './presets.ts';
import { SPECIES_INFO, rng, type Species, type AgeClass } from './species.ts';
import { fbm, noise, smoothstep } from '../terrain/noise.js';

export interface HeightSource { heightAt(x: number, z: number): number }

export interface TreeInst {
  species: Species; age: AgeClass; arch: number; unique: boolean; note?: string;
  x: number; y: number; z: number; yaw: number; scale: number; height: number; crownR: number;
  /** lean of the stem (unit-less shear at the top: horizontal metres per metre of height) */
  leanX: number; leanZ: number;
  /** crown shift towards light (m at the top) */
  shiftX: number; shiftZ: number;
  /** stem curvature amplitude (m) */
  bend: number;
  seed: number; health: number; ring: boolean;
}
export interface RockInst { x: number; y: number; z: number; size: number; yaw: number; tiltX: number; tiltZ: number; arch: number; moss: number; seed: number }
export interface LogInst { x0: number; z0: number; x1: number; z1: number; radius: number; decay: number; rootPlate: boolean; species: Species; seed: number }
export interface Cover { x: number; y: number; z: number; yaw: number; size: number; kind: number; seed: number; light: number }

export interface Grid { x0: number; z0: number; cell: number; nx: number; nz: number }
export interface Ecology {
  site: ForestSite;
  hGrid: Grid; heights: Float32Array;
  trees: TreeInst[]; rocks: RockInst[]; logs: LogInst[];
  branches: Cover[]; ferns: Cover[]; grass: Cover[]; berries: Cover[];
  /** ground material maps over the test area + margin: A = moss, mud, rock, grass; B = broadleaf litter, needles, trail, light */
  mGrid: Grid; matA: Uint8Array; matB: Uint8Array;
  /** canopy volume: r = sky visibility, g = local leaf density (AO); absolute heights */
  vol: { x0: number; z0: number; y0: number; cell: number; cellY: number; nx: number; ny: number; nz: number; data: Uint8Array };
  stats: Record<string, number>;
}

const sat = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function buildEcology(terrain: HeightSource, opts: { basic?: boolean } = {}): Ecology {
  const t0 = performance.now();
  const site = new ForestSite();
  const R = SITE.ring, S = SITE.size;
  // ---------------------------------------------------------------- 1. height grid and site fields (1 m)
  const hGrid: Grid = { x0: SITE.x0 - R - 4, z0: SITE.z0 - R - 4, cell: 1, nx: S + 2 * R + 9, nz: S + 2 * R + 9 };
  const heights = new Float32Array(hGrid.nx * hGrid.nz);
  for (let j = 0; j < hGrid.nz; j++) for (let i = 0; i < hGrid.nx; i++) heights[j * hGrid.nx + i] = terrain.heightAt(hGrid.x0 + i, hGrid.z0 + j);
  const hAt = (x: number, z: number) => {
    const fx = Math.min(Math.max(x - hGrid.x0, 0), hGrid.nx - 1.001), fz = Math.min(Math.max(z - hGrid.z0, 0), hGrid.nz - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), a = fx - i, b = fz - j, n = hGrid.nx, k = j * n + i;
    // match the terrain mesh triangulation closely enough: bilinear inside the 1 m quad
    return (heights[k] * (1 - a) + heights[k + 1] * a) * (1 - b) + (heights[k + n] * (1 - a) + heights[k + n + 1] * a) * b;
  };
  // topographic position: height minus a 12 m box blur (three passes ≈ Gaussian)
  const blur = boxBlur(heights, hGrid.nx, hGrid.nz, 6, 3);
  const tpiAt = (x: number, z: number) => {
    const i = Math.round(x - hGrid.x0), j = Math.round(z - hGrid.z0);
    if (i < 0 || j < 0 || i >= hGrid.nx || j >= hGrid.nz) return 0;
    return heights[j * hGrid.nx + i] - blur[j * hGrid.nx + i];
  };
  const slopeAt = (x: number, z: number) => { const gx = (hAt(x + 1, z) - hAt(x - 1, z)) / 2, gz = (hAt(x, z + 1) - hAt(x, z - 1)) / 2; return Math.sqrt(gx * gx + gz * gz); };
  const sd = SITE.seed;
  const fields = (x: number, z: number) => {
    const u = x - SITE.x0, v = z - SITE.z0;
    const tpi = tpiAt(x, z), slope = slopeAt(x, z), hol = site.hollow(u, v), oc = site.outcrop(u, v);
    const moisture = sat(0.45 - tpi * 0.45 + hol * 0.75 + 0.22 * fbm(u * 0.03, v * 0.03, sd + 101, 3) - slope * 0.4);
    const soil = sat(0.75 - oc * 1.4 - slope * 1.2 + 0.2 * fbm(u * 0.05, v * 0.05, sd + 102, 2));
    // stand structure: the south-west is an open birch fringe, the north-east the old dense stand
    const fringe = smoothstep(95, 10, (u + v) * 0.5 + 18 * fbm(u * 0.02, v * 0.02, sd + 103, 2));
    const stand = sat(0.62 + 0.38 * fbm(u * 0.028, v * 0.028, sd + 104, 3) - 0.45 * fringe);
    const cl = site.clearing(u, v), tr = site.trail(u, v);
    return { u, v, tpi, slope, hol, oc, moisture, soil, fringe, stand, clear: cl.k, clearKind: cl.kind, trail: tr.k, trailDist: tr.dist };
  };

  // ---------------------------------------------------------------- 2. trees
  const r = rng(sd + 1);
  const trees: TreeInst[] = [];
  const hash = new SpatialHash(8);
  const canPlace = (x: number, z: number, crown: number, trunkMin: number) => {
    let ok = true;
    hash.query(x, z, 14, (t: TreeInst) => {
      const d = Math.sqrt((t.x - x) ** 2 + (t.z - z) ** 2);
      // crowns may interlock but not sit on top of each other; trunks need room
      if (d < Math.max(trunkMin, (t.crownR + crown) * (t.age === 'veteran' ? 0.6 : 0.36))) ok = false;
    });
    return ok;
  };
  const add = (t: TreeInst) => { trees.push(t); hash.add(t.x, t.z, t); };

  // veterans (authored)
  VETERANS.forEach((vt, i) => {
    const x = SITE.x0 + vt.u, z = SITE.z0 + vt.v, info = SPECIES_INFO[vt.species];
    const height = vt.species === 'oak' ? 19 + 3 * r() : 21 + 3 * r();
    add({ species: vt.species, age: 'veteran', arch: i, unique: true, note: vt.note, x, y: hAt(x, z), z, yaw: r() * Math.PI * 2, scale: 1, height,
      crownR: height * (vt.species === 'oak' ? 0.62 : 0.42), leanX: 0, leanZ: 0, shiftX: 0, shiftZ: 0, bend: 0.4, seed: 9000 + i, health: 0.75, ring: false });
    void info;
  });

  // species choice from site conditions
  const pickSpecies = (f: ReturnType<typeof fields>, x: number): Species => {
    const w: Record<Species, number> = {
      pine: 0.9 * (1 - f.moisture * 0.6) * (0.6 + f.tpi * 0.3 + f.oc * 1.2) * (1 - f.fringe * 0.7),
      oak: 1.0 * f.soil * (0.4 + f.moisture * 0.8) * (1 - f.fringe * 0.6) * (1 - f.oc),
      birch: 0.16 + 1.5 * f.fringe + 0.6 * f.clear,
      rowan: 0, holly: 0, hazel: 0,
    };
    let sum = 0; for (const k in w) sum += w[k as Species];
    let p = r() * sum;
    for (const k in w) { p -= w[k as Species]; if (p <= 0) return k as Species; }
    void x; return 'birch';
  };
  const ageOf = (sp: Species, f: ReturnType<typeof fields>): AgeClass => {
    const q = r();
    if (sp === 'pine' && q < 0.035) return 'snag';
    if (sp === 'birch' && q < 0.03) return 'snag';
    const youth = 0.18 + 0.35 * f.clear + 0.25 * f.fringe;
    return q < youth ? 'young' : 'mature';
  };
  const treeAt = (x: number, z: number, sp: Species, age: AgeClass, ring: boolean): TreeInst | null => {
    const info = SPECIES_INFO[sp];
    const [h0, h1] = info.height;
    let height = h0 + (h1 - h0) * r();
    if (age === 'young') height *= 0.45 + 0.25 * r();
    if (age === 'sapling') height *= 0.12 + 0.12 * r();
    if (age === 'snag') height *= 0.55 + 0.3 * r();
    const crownR = height * info.crownFrac * (age === 'young' ? 0.75 : 1) * (0.85 + 0.3 * r());
    if (!canPlace(x, z, crownR, age === 'mature' ? 2.2 : 1.2)) return null;
    const nArch = info.archetypes[age] || 1;
    return { species: sp, age, arch: Math.floor(r() * nArch), unique: false, x, y: hAt(x, z), z, yaw: r() * Math.PI * 2, scale: 1, height, crownR,
      leanX: 0, leanZ: 0, shiftX: 0, shiftZ: 0, bend: (0.15 + 0.6 * r()) * (sp === 'birch' ? 1.8 : sp === 'oak' ? 1.2 : 1), seed: Math.floor(r() * 1e9), health: 0.65 + 0.35 * r(), ring };
  };

  const x0 = SITE.x0 - R, z0 = SITE.z0 - R, ext = S + 2 * R;
  if (opts.basic) {
    // basic forest (comparison mode B): independent uniform random placement, one archetype per species
    for (let n = 0; n < 2600; n++) {
      const x = x0 + r() * ext, z = z0 + r() * ext, f = fields(x, z);
      const sp: Species = r() < 0.45 ? 'pine' : r() < 0.6 ? 'oak' : 'birch';
      const t = treeAt(x, z, sp, 'mature', !site.inside(f.u, f.v));
      if (t) { t.arch = 0; t.bend = 0; add(t); }
    }
  } else {
    // Matérn cluster process: parents, then offspring around them; acceptance by suitability
    const parents = Math.round(ext * ext / (9.5 * 9.5));
    for (let p = 0; p < parents; p++) {
      const px = x0 + r() * ext, pz = z0 + r() * ext;
      const fp = fields(px, pz);
      const sp = pickSpecies(fp, px);
      const kids = 2 + Math.floor(r() * (sp === 'birch' ? 9 : sp === 'pine' ? 7 : 4));
      const spread = sp === 'oak' ? 9 : sp === 'pine' ? 7 : 5;
      for (let k = 0; k < kids; k++) {
        const a = r() * Math.PI * 2, d = spread * Math.sqrt(-2 * Math.log(1 - r() * 0.95)) * 0.7;
        const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
        if (x < x0 || z < z0 || x > x0 + ext || z > z0 + ext) continue;
        const f = fields(x, z);
        const accept = f.stand * (1 - f.clear) * (1 - 0.95 * f.trail) * (1 - smoothstep(0.55, 0.9, f.slope)) * (0.35 + 0.65 * Math.max(f.soil, sp === 'pine' ? 0.6 : 0));
        if (r() > accept * 1.15 + 0.12 * f.fringe) continue;
        if (f.trailDist < 1.6) continue;
        const sp2 = r() < 0.8 ? sp : pickSpecies(f, x);
        const t = treeAt(x, z, sp2, ageOf(sp2, f), !site.inside(f.u, f.v));
        if (t) add(t);
      }
    }
    // gap and clearing-edge regeneration: birch, rowan and pine saplings where the light reaches the ground
    for (let n = 0; n < 900; n++) {
      const c = CLEARINGS[Math.floor(r() * CLEARINGS.length)];
      const a = r() * Math.PI * 2, d = (0.6 + 0.8 * r()) * Math.max(c.ru, c.rv);
      const x = SITE.x0 + c.u + Math.cos(a) * d, z = SITE.z0 + c.v + Math.sin(a) * d;
      const f = fields(x, z);
      if (f.trailDist < 1.5 || r() > 0.25) continue;
      const sp: Species = r() < 0.45 ? 'birch' : r() < 0.5 ? 'rowan' : 'pine';
      const t = treeAt(x, z, sp, sp === 'rowan' ? (r() < 0.5 ? 'sapling' : 'young') : r() < 0.6 ? 'sapling' : 'young', false);
      if (t) add(t);
    }
    // understorey: holly in the shade of oaks (dense along the dark passage), hazel stools on moist ground, rowan on rock
    for (let n = 0; n < 9000; n++) {
      const x = x0 + r() * ext, z = z0 + r() * ext, f = fields(x, z);
      if (f.trailDist < 1.4) continue;
      const dark = site.trails.find((t) => t.id === 'dark-passage')!;
      const nn = dark.idx.nearest(f.u, f.v, { dist: 0, seg: 0, t: 0, side: 0 });
      const passage = nn.seg >= 0 ? smoothstep(9, 2.5, nn.dist) : 0;
      let sp: Species | null = null;
      const q = r();
      if (q < 0.004 + 0.07 * passage + 0.02 * f.stand * f.stand * (1 - f.fringe)) sp = 'holly';
      else if (q < 0.012 + 0.006 * f.moisture) sp = r() < 0.6 ? 'hazel' : null;
      else if (q < 0.014 + 0.01 * f.oc) sp = 'rowan';
      if (!sp) continue;
      const t = treeAt(x, z, sp, 'young', !site.inside(f.u, f.v));
      if (t) add(t);
    }
    // pole-stage regeneration under the old stand: young oak, pine and rowan filling gaps, layering the interior
    for (let n = 0; n < 2600; n++) {
      const x = x0 + r() * ext, z = z0 + r() * ext, f = fields(x, z);
      if (f.trailDist < 1.6 || f.clear > 0.3 || r() > f.stand * (1 - f.fringe) * 0.5) continue;
      const sp: Species = r() < 0.45 ? 'oak' : r() < 0.6 ? 'pine' : 'rowan';
      const t = treeAt(x, z, sp, sp === 'rowan' || r() < 0.4 ? 'young' : 'sapling', !site.inside(f.u, f.v));
      if (t) add(t);
    }
  }

  // lean and crown shift: away from neighbours, towards open sky (clearings, trails); a little downhill on slopes
  for (const t of trees) {
    if (t.unique || opts.basic) continue;
    let ax = 0, az = 0;
    hash.query(t.x, t.z, 12, (o: TreeInst) => {
      if (o === t) return;
      const dx = t.x - o.x, dz = t.z - o.z, d2 = dx * dx + dz * dz + 1;
      const w = (o.height / Math.max(t.height, 1)) / d2;
      ax += dx * w; az += dz * w;
    });
    for (const c of CLEARINGS) {
      const dx = SITE.x0 + c.u - t.x, dz = SITE.z0 + c.v - t.z, d = Math.sqrt(dx * dx + dz * dz) + 1;
      const w = 2.5 * Math.max(0, 1 - d / 35) / d;
      ax += dx * w; az += dz * w;
    }
    const gx = (hAt(t.x + 2, t.z) - hAt(t.x - 2, t.z)) / 4, gz = (hAt(t.x, t.z + 2) - hAt(t.x, t.z - 2)) / 4;
    ax -= gx * 0.6; az -= gz * 0.6;
    const m = Math.sqrt(ax * ax + az * az) + 1e-6;
    const k = Math.min(1, m * 3);
    const lean = (t.species === 'birch' ? 0.07 : t.species === 'pine' ? 0.035 : 0.025) * k * (0.4 + 0.9 * r()) * (t.age === 'young' ? 1.6 : 1);
    t.leanX = ax / m * lean; t.leanZ = az / m * lean;
    const shift = t.crownR * (0.25 + 0.35 * r()) * k;
    t.shiftX = ax / m * shift; t.shiftZ = az / m * shift;
  }

  // ---------------------------------------------------------------- 3. canopy volume → light
  const vc = 2, vcy = 2;
  let ymin = 1e9, ymax = -1e9;
  for (let i = 0; i < heights.length; i++) { ymin = Math.min(ymin, heights[i]); ymax = Math.max(ymax, heights[i]); }
  const vol = { x0: hGrid.x0, z0: hGrid.z0, y0: Math.floor(ymin - 2), cell: vc, cellY: vcy, nx: Math.ceil(hGrid.nx / vc), ny: Math.ceil((ymax + 36 - ymin) / vcy), nz: Math.ceil(hGrid.nz / vc), data: new Uint8Array(0) };
  const nV = vol.nx * vol.ny * vol.nz;
  const dens = new Float32Array(nV);
  const vi = (i: number, j: number, k: number) => i + vol.nx * (j + vol.ny * k);
  for (const t of trees) {
    if (t.age === 'snag') continue;
    const info = SPECIES_INFO[t.species];
    const cy = t.y + t.height * (t.species === 'pine' ? 0.78 : t.species === 'oak' ? 0.62 : 0.65), ry = t.height * (t.species === 'pine' ? 0.22 : 0.33) + 1;
    const cx = t.x + t.shiftX * 0.7, cz = t.z + t.shiftZ * 0.7, rr = t.crownR + 0.5;
    const i0 = Math.max(0, Math.floor((cx - rr - vol.x0) / vc)), i1 = Math.min(vol.nx - 1, Math.ceil((cx + rr - vol.x0) / vc));
    const k0 = Math.max(0, Math.floor((cz - rr - vol.z0) / vc)), k1 = Math.min(vol.nz - 1, Math.ceil((cz + rr - vol.z0) / vc));
    const j0 = Math.max(0, Math.floor((cy - ry - vol.y0) / vcy)), j1 = Math.min(vol.ny - 1, Math.ceil((cy + ry - vol.y0) / vcy));
    const dmax = info.leafDensity * (t.age === 'veteran' ? 0.9 : 1) * (t.unique ? 1 : t.health);
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = vol.x0 + (i + 0.5) * vc, py = vol.y0 + (j + 0.5) * vcy, pz = vol.z0 + (k + 0.5) * vc;
      const q = ((px - cx) / rr) ** 2 + ((py - cy) / ry) ** 2 + ((pz - cz) / rr) ** 2;
      if (q < 1) dens[vi(i, j, k)] += dmax * (1 - q) * 0.55;
    }
  }
  // sky visibility: transmittance towards five sky directions (zenith and four 45° diagonals) via prefix sums from the top
  const ext5 = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const skyAcc = new Float32Array(nV);
  const S2 = new Float32Array(nV);
  const kExt = 0.55 * vcy;
  for (const [dx, dz] of ext5) {
    for (let j = vol.ny - 1; j >= 0; j--) for (let k = 0; k < vol.nz; k++) for (let i = 0; i < vol.nx; i++) {
      const ii = i + dx, kk = k + dz;
      const above = j + 1 < vol.ny && ii >= 0 && kk >= 0 && ii < vol.nx && kk < vol.nz ? S2[vi(ii, j + 1, kk)] : 0;
      S2[vi(i, j, k)] = dens[vi(i, j, k)] + above;
    }
    const wgt = dx === 0 && dz === 0 ? 0.4 : 0.15;
    for (let n = 0; n < nV; n++) skyAcc[n] += wgt * Math.exp(-kExt * (dx || dz ? 1.41 : 1) * S2[n]);
  }
  const volData = new Uint8Array(nV * 2);
  // local density blurred for AO
  const lb = blur3(dens, vol.nx, vol.ny, vol.nz);
  for (let n = 0; n < nV; n++) { volData[n * 2] = Math.round(sat(skyAcc[n]) * 255); volData[n * 2 + 1] = Math.round(sat(lb[n] * 0.8) * 255); }
  vol.data = volData;
  const volAt = (x: number, y: number, z: number): number => {
    const i = Math.floor((x - vol.x0) / vc), j = Math.floor((y - vol.y0) / vcy), k = Math.floor((z - vol.z0) / vc);
    if (i < 0 || j < 0 || k < 0 || i >= vol.nx || j >= vol.ny || k >= vol.nz) return 1;
    return volData[vi(i, j, k) * 2] / 255;
  };
  // direct sun reaching the ground (for plant placement only; the renderer uses the real shadow map)
  const sunDir = FOREST_SUN_DAY; // matches the day lighting preset
  const sunAt = (x: number, y: number, z: number): number => {
    let s = 0;
    for (let n = 1; n <= 18; n++) {
      const d = n * 2, px = x + sunDir[0] * d / sunDir[1], py = y + d, pz = z + sunDir[2] * d / sunDir[1];
      const i = Math.floor((px - vol.x0) / vc), j = Math.floor((py - vol.y0) / vcy), k = Math.floor((pz - vol.z0) / vc);
      if (i < 0 || j < 0 || k < 0 || i >= vol.nx || j >= vol.ny || k >= vol.nz) break;
      s += dens[vi(i, j, k)];
    }
    return Math.exp(-0.9 * s);
  };
  const lightAt = (x: number, z: number) => { const y = hAt(x, z) + 1; return sat(0.55 * volAt(x, y, z) + 0.45 * sunAt(x, y, z)); };

  // ---------------------------------------------------------------- deadwood and rocks
  const rocks: RockInst[] = [], logs: LogInst[] = [], branches: Cover[] = [];
  const ferns: Cover[] = [], grass: Cover[] = [], berries: Cover[] = [];
  const logHits = (x: number, z: number, pad: number) => {
    for (const l of logs) {
      const dx = l.x1 - l.x0, dz = l.z1 - l.z0, L2 = dx * dx + dz * dz;
      const tt = Math.max(0, Math.min(1, ((x - l.x0) * dx + (z - l.z0) * dz) / L2));
      if ((l.x0 + dx * tt - x) ** 2 + (l.z0 + dz * tt - z) ** 2 < (l.radius + pad) ** 2) return true;
    }
    return false;
  };
  const trunkHit = (x: number, z: number, pad: number) => {
    let hit = false;
    hash.query(x, z, 4, (t: TreeInst) => { const rr = t.height * (t.age === 'veteran' ? 0.05 : 0.022) + pad; if ((t.x - x) ** 2 + (t.z - z) ** 2 < rr * rr) hit = true; });
    return hit;
  };
  if (!opts.basic) {
    // rocks: outcrop boulder fields (power-law sizes), plus scattered glacial erratics
    for (const o of OUTCROPS) {
      const n = Math.round(o.r * o.r * 0.32);
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, d = o.r * Math.sqrt(r()) * 1.05;
        const x = SITE.x0 + o.u + Math.cos(a) * d * 1.3, z = SITE.z0 + o.v + Math.sin(a) * d * 0.7;
        const f = fields(x, z);
        if (f.trailDist < 1.2) continue;
        const size = 0.25 + 2.6 * Math.pow(r(), 3.2) * (0.5 + f.oc);
        if (trunkHit(x, z, size * 0.6)) continue;
        rocks.push({ x, y: hAt(x, z) - size * (0.25 + 0.2 * r()), z, size, yaw: r() * 6.283, tiltX: (r() - 0.5) * 0.5, tiltZ: (r() - 0.5) * 0.5, arch: Math.floor(r() * 8), moss: sat(0.3 + f.moisture * 0.6 + (1 - lightAt(x, z)) * 0.4), seed: Math.floor(r() * 1e6) });
      }
    }
    for (let i = 0; i < 70; i++) {
      const x = SITE.x0 - 20 + r() * (S + 40), z = SITE.z0 - 20 + r() * (S + 40), f = fields(x, z);
      if (f.trailDist < 1.5 || r() > 0.6) continue;
      const size = 0.3 + 2.2 * Math.pow(r(), 2.5);
      if (trunkHit(x, z, size * 0.7)) continue;
      rocks.push({ x, y: hAt(x, z) - size * 0.35, z, size, yaw: r() * 6.283, tiltX: (r() - 0.5) * 0.3, tiltZ: (r() - 0.5) * 0.3, arch: Math.floor(r() * 8), moss: sat(0.4 + f.moisture * 0.5), seed: Math.floor(r() * 1e6) });
    }
    // fallen trees: the windthrow gap (aligned, with root plates), then scattered logs, more where the stand is old
    const wt = CLEARINGS.find((c) => c.kind === 'windthrow')!;
    for (let i = 0; i < 3; i++) {
      const a = wt.rot + (r() - 0.5) * 0.35 + (i === 1 ? Math.PI : 0);
      const cx = SITE.x0 + wt.u + (r() - 0.5) * 6, cz = SITE.z0 + wt.v + (r() - 0.5) * 4;
      const L = 14 + 6 * r();
      logs.push({ x0: cx - Math.cos(a) * L * 0.5, z0: cz - Math.sin(a) * L * 0.5, x1: cx + Math.cos(a) * L * 0.5, z1: cz + Math.sin(a) * L * 0.5, radius: 0.32 + 0.12 * r(), decay: 0.15 + 0.2 * r(), rootPlate: true, species: i === 2 ? 'oak' : 'pine', seed: Math.floor(r() * 1e6) });
    }
    for (let n = 0; n < 400 && logs.length < 46; n++) {
      const x = SITE.x0 - 10 + r() * (S + 20), z = SITE.z0 - 10 + r() * (S + 20), f = fields(x, z);
      if (r() > f.stand * 0.8 + 0.1) continue;
      const a = r() * Math.PI * 2, L = 3 + 11 * Math.pow(r(), 1.5), rad = 0.1 + 0.035 * L * (0.6 + 0.6 * r());
      const xe = x + Math.cos(a) * L, ze = z + Math.sin(a) * L;
      let blocked = false;
      for (let s = 0; s <= 1; s += 0.1) {
        const px = x + (xe - x) * s, pz = z + (ze - z) * s, fs = fields(px, pz);
        if (fs.trailDist < 1.0 + rad || trunkHit(px, pz, rad + 0.2) || fs.oc > 0.5 || !site.inside(fs.u, fs.v, 15)) { blocked = true; break; }
      }
      if (blocked || logHits((x + xe) / 2, (z + ze) / 2, L * 0.5)) continue;
      logs.push({ x0: x, z0: z, x1: xe, z1: ze, radius: rad, decay: 0.2 + 0.75 * r(), rootPlate: L > 9 && r() < 0.4, species: r() < 0.5 ? 'pine' : r() < 0.6 ? 'birch' : 'oak', seed: Math.floor(r() * 1e6) });
    }
    // fallen branches: under crowns, in proportion to crown size; dead pine branches are common
    for (const t of trees) {
      if (!site.inside(t.x - SITE.x0, t.z - SITE.z0, 10) || t.age === 'sapling') continue;
      const n = Math.round(t.crownR * (t.age === 'veteran' ? 2.5 : 0.7) * r());
      for (let i = 0; i < n; i++) {
        const a = r() * 6.283, d = t.crownR * Math.sqrt(r()) * 1.1;
        const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d, f = fields(x, z);
        if (f.trailDist < 0.9 || trunkHit(x, z, 0.3) || logHits(x, z, 0.3)) continue;
        branches.push({ x, y: hAt(x, z), z, yaw: r() * 6.283, size: 0.6 + 2.4 * Math.pow(r(), 1.8) * (t.age === 'veteran' ? 1.6 : 1), kind: Math.floor(r() * 6), seed: Math.floor(r() * 1e6), light: 0 });
      }
    }
  }

  // ---------------------------------------------------------------- ground layer: ferns, grass, blaeberry
  const coreX0 = SITE.x0 - 12, coreZ0 = SITE.z0 - 12, coreS = S + 24;
  if (!opts.basic) {
    for (let j = 0; j < coreS / 0.55; j++) for (let i = 0; i < coreS / 0.55; i++) {
      const x = coreX0 + (i + 0.5 + (r() - 0.5) * 0.9) * 0.55, z = coreZ0 + (j + 0.5 + (r() - 0.5) * 0.9) * 0.55;
      const f = fields(x, z);
      if (f.trailDist < 0.8 + 0.4 * r() || f.oc > 0.45) continue;
      const light = lightAt(x, z);
      // patchiness at two scales: rhizome spread of bracken, and clumps
      const patch = fbm(f.u * 0.06, f.v * 0.06, sd + 201, 3), clump = noise(f.u * 0.4, f.v * 0.4, sd + 202);
      // bracken: lighter, drier, deeper soil; buckler ferns: shade and moisture
      const bracken = smoothstep(0.25, 0.55, light) * (1 - smoothstep(0.75, 1, light) * 0.5) * f.soil * (1 - f.moisture * 0.5) * smoothstep(-0.05, 0.25, patch) * (1 - f.clear * 0.6);
      const buckler = smoothstep(0.8, 0.3, light) * smoothstep(0.25, 0.6, f.moisture) * smoothstep(-0.15, 0.25, patch + clump * 0.3);
      const q = r();
      if (q < bracken * 0.38 || q < buckler * 0.3) {
        if (trunkHit(x, z, 0.5) || logHits(x, z, 0.25)) continue;
        const kind = q < bracken * 0.38 && bracken >= buckler ? 0 : r() < 0.82 ? 1 : 2; // 0 bracken, 1 buckler, 2 hard fern
        ferns.push({ x, y: hAt(x, z), z, yaw: r() * 6.283, size: (kind === 0 ? 0.8 + 0.6 * r() : kind === 1 ? 0.55 + 0.45 * r() : 0.35 + 0.2 * r()) * (0.7 + 0.5 * light), kind, seed: Math.floor(r() * 1e6), light });
        continue;
      }
      // grass tussocks: where light reaches, trail verges, clearings, the birch fringe; wavy hair-grass under pines
      const grassy = smoothstep(0.35, 0.8, light) * (0.4 + 0.6 * Math.max(f.clear, f.fringe, smoothstep(3.5, 1.2, f.trailDist))) * (1 - f.moisture * 0.3);
      if (r() < grassy * 0.85) {
        if (trunkHit(x, z, 0.3) || logHits(x, z, 0.15)) continue;
        grass.push({ x, y: hAt(x, z), z, yaw: r() * 6.283, size: 0.35 + 0.4 * r() * (0.5 + light), kind: f.moisture > 0.6 && r() < 0.5 ? 1 : 0, seed: Math.floor(r() * 1e6), light });
        continue;
      }
      // blaeberry (bilberry): the dwarf shrub carpet of Caledonian pinewood, moderate shade, acid soil
      const blae = smoothstep(0.12, 0.4, light) * smoothstep(0.85, 0.5, light) * (1 - f.moisture * 0.5) * smoothstep(0.0, 0.35, patch - clump * 0.2) * (1 - f.fringe * 0.5);
      if (r() < blae * 0.5) {
        if (trunkHit(x, z, 0.3) || logHits(x, z, 0.2)) continue;
        berries.push({ x, y: hAt(x, z), z, yaw: r() * 6.283, size: 0.3 + 0.25 * r(), kind: 0, seed: Math.floor(r() * 1e6), light });
      }
    }
  } else {
    // basic forest: sparse uniform grass only
    for (let n = 0; n < 6000; n++) {
      const x = coreX0 + r() * coreS, z = coreZ0 + r() * coreS;
      grass.push({ x, y: hAt(x, z), z, yaw: r() * 6.283, size: 0.4 + 0.3 * r(), kind: 0, seed: Math.floor(r() * 1e6), light: 0.5 });
    }
  }

  // ---------------------------------------------------------------- ground material maps (0.5 m)
  const mGrid: Grid = { x0: SITE.x0 - 30, z0: SITE.z0 - 30, cell: 0.5, nx: (S + 60) * 2, nz: (S + 60) * 2 };
  const nM = mGrid.nx * mGrid.nz;
  const matA = new Uint8Array(nM * 4), matB = new Uint8Array(nM * 4);
  // litter type from crowns: splat broadleaf / needle cover at 1 m
  const cn = hGrid.nx * hGrid.nz, broad = new Float32Array(cn), needle = new Float32Array(cn);
  for (const t of trees) {
    if (t.age === 'sapling') continue;
    const tgt = SPECIES_INFO[t.species].litter ? needle : broad;
    const rr = t.crownR * 1.15, cx = t.x + t.shiftX * 0.5, cz = t.z + t.shiftZ * 0.5, w = t.age === 'snag' ? 0.3 : 1;
    for (let j = Math.floor(cz - rr); j <= cz + rr; j++) for (let i = Math.floor(cx - rr); i <= cx + rr; i++) {
      const gi = i - hGrid.x0, gj = j - hGrid.z0;
      if (gi < 0 || gj < 0 || gi >= hGrid.nx || gj >= hGrid.nz) continue;
      const q = 1 - ((i - cx) ** 2 + (j - cz) ** 2) / (rr * rr);
      if (q > 0) tgt[gj * hGrid.nx + gi] += q * w;
    }
  }
  const sample1 = (a: Float32Array, x: number, z: number) => { const i = Math.round(x - hGrid.x0), j = Math.round(z - hGrid.z0); return i < 0 || j < 0 || i >= hGrid.nx || j >= hGrid.nz ? 0 : a[j * hGrid.nx + i]; };
  // light on a 1 m grid first (the volume is coarse anyway), then bilinear into the 0.5 m map
  const L1 = new Float32Array(cn);
  for (let j = 0; j < hGrid.nz; j++) for (let i = 0; i < hGrid.nx; i++) L1[j * hGrid.nx + i] = lightAt(hGrid.x0 + i, hGrid.z0 + j);
  const L1b = boxBlur(L1, hGrid.nx, hGrid.nz, 1, 1);
  for (let j = 0; j < mGrid.nz; j++) for (let i = 0; i < mGrid.nx; i++) {
    const x = mGrid.x0 + (i + 0.5) * 0.5, z = mGrid.z0 + (j + 0.5) * 0.5;
    const f = fields(x, z);
    const light = sat(sample1(L1b, x, z));
    const nb = sat(sample1(broad, x, z) * 0.8), nn = sat(sample1(needle, x, z) * 0.8);
    const mott = fbm(f.u * 0.35, f.v * 0.35, sd + 301, 3);
    const moss = sat((1 - light) * 0.7 + f.moisture * 0.6 - 0.35 + mott * 0.35 + f.tpi * 0.15 + nn * 0.25 - nb * 0.25 + f.oc * 0.3) * (1 - f.trail * 0.8);
    const mud = sat(smoothstep(0.62, 0.9, f.moisture) * (0.6 + 0.4 * mott) + f.trail * f.moisture * 0.9 + f.hol * 0.4);
    const rock = sat(smoothstep(0.35, 0.75, f.oc + mott * 0.15) + smoothstep(0.7, 1.1, f.slope) * 0.6);
    const grassW = sat(smoothstep(0.4, 0.85, light) * (0.4 + 0.6 * Math.max(f.clear, f.fringe)) * (1 - f.trail) + 0.25 * smoothstep(3, 1.2, f.trailDist) * light);
    const k = (j * mGrid.nx + i) * 4;
    matA[k] = moss * 255; matA[k + 1] = mud * 255; matA[k + 2] = rock * 255; matA[k + 3] = grassW * 255;
    matB[k] = nb * 255; matB[k + 1] = nn * 255; matB[k + 2] = f.trail * 255; matB[k + 3] = light * 255;
  }

  const stats = {
    ms: Math.round(performance.now() - t0), trees: trees.length, treesCore: trees.filter((t) => !t.ring).length, rocks: rocks.length, logs: logs.length,
    branches: branches.length, ferns: ferns.length, grass: grass.length, berries: berries.length,
  };
  return { site, hGrid, heights, trees, rocks, logs, branches, ferns, grass, berries, mGrid, matA, matB, vol, stats };
}

// ---------------------------------------------------------------------------------------------- helpers
class SpatialHash {
  private m = new Map<number, unknown[]>();
  private cell: number;
  constructor(cell: number) { this.cell = cell; }
  private key(i: number, j: number) { return i * 73856093 ^ j * 19349663; }
  add(x: number, z: number, o: unknown) { const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)); let l = this.m.get(k); if (!l) this.m.set(k, (l = [])); l.push(o); }
  query(x: number, z: number, r: number, fn: (o: any) => void) {
    const i0 = Math.floor((x - r) / this.cell), i1 = Math.floor((x + r) / this.cell), j0 = Math.floor((z - r) / this.cell), j1 = Math.floor((z + r) / this.cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const l = this.m.get(this.key(i, j)); if (l) for (const o of l) fn(o); }
  }
}

export function boxBlur(src: Float32Array, nx: number, nz: number, r: number, passes: number): Float32Array {
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      let s = 0, c = 0;
      for (let k = -r; k <= r; k++) { const ii = i + k; if (ii >= 0 && ii < nx) { s += a[j * nx + ii]; c++; } }
      b[j * nx + i] = s / c;
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      let s = 0, c = 0;
      for (let k = -r; k <= r; k++) { const jj = j + k; if (jj >= 0 && jj < nz) { s += b[jj * nx + i]; c++; } }
      a[j * nx + i] = s / c;
    }
  }
  return a;
}

function blur3(src: Float32Array, nx: number, ny: number, nz: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let s = 0, c = 0;
    for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj, kk = k + dk;
      if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue;
      s += src[ii + nx * (jj + ny * kk)]; c++;
    }
    out[i + nx * (j + ny * k)] = s / c;
  }
  return out;
}
