// Stage C: greybox placeholders for every landmark, plus the railway, viaduct, river water and waterfall, generated
// from data/world.json and the terrain model. These are explicitly placeholders: they fix positions, scale and
// silhouette at the approved anchors until real architecture (the CC BY castle model in HP-world, or authored kits)
// replaces them. Every mesh is built in local coordinates around its anchor (X east, Y up, Z north).

import { MeshBuilder, MAT, type BuiltMesh } from '../meshes/mesh-builder.ts';
import type { PropInstance } from '../gpu/prop-renderer.ts';
import type { WorldTerrain } from './world-terrain.ts';
import { landmark } from './world-db.ts';

export interface Label { id: string; name: string; x: number; y: number; z: number }
export interface ProxySet { meshes: BuiltMesh[]; instances: PropInstance[]; labels: Label[] }

const D = Math.PI / 180;
const W: [number, number, number] = [1, 1, 1];

export function buildLandmarkProxies(T: WorldTerrain): ProxySet {
  const meshes: BuiltMesh[] = [], instances: PropInstance[] = [], labels: Label[] = [];
  const add = (mb: MeshBuilder, x: number, y: number, z: number, rot = 0, tint = W) => { meshes.push(mb.build()); instances.push({ mesh: meshes.length - 1, x, y, z, rot, scale: 1, tint }); };
  const h = (x: number, z: number) => T.heightAt(x, z);
  const db = T.db;
  for (const l of db.landmarks) labels.push({ id: l.id, name: l.name, x: l.x, y: (l.site === 'underwater' ? T.water : Math.max(h(l.x, l.z), T.water)) + 12, z: l.z });

  // ---------------------------------------------------------------------------------------------- castle
  {
    const c = landmark(db, 'hogwarts-castle'), base = c.elevation! - 0.5, m = new MeshBuilder('castle');
    const tower = (x: number, z: number, r: number, ht: number, roof = 1.0) => { m.frustum(x, 0, z, r, r * 0.92, ht, 12, MAT.STONE); m.frustum(x, ht, z, r * 1.25, 0, r * 2.4 * roof, 12, MAT.SLATE); };
    const wall = (ax: number, az: number, bx: number, bz: number, ht: number, th = 3) => { const l = Math.hypot(bx - ax, bz - az); m.box((ax + bx) / 2, 0, (az + bz) / 2, th, ht, l, MAT.STONE, Math.atan2(bx - ax, bz - az)); };
    const hall = (x: number, z: number, len: number, wid: number, ht: number, rot: number, rise: number) => { m.box(x, 0, z, wid, ht, len, MAT.STONE, rot); m.gable(x, ht, z, len, wid, rise, MAT.SLATE, rot - Math.PI / 2, 0.8, MAT.STONE); };
    hall(-62, 18, 74, 24, 22, 18 * D, 15);          // Great Hall, along the lake-facing cliff
    hall(-10, -10, 50, 40, 28, 18 * D, 12);         // central range
    hall(30, 70, 44, 18, 20, 100 * D, 10);          // courtyard range
    hall(75, 150, 50, 14, 16, 10 * D, 8);           // courtyard east range
    hall(5, 160, 46, 14, 16, 100 * D, 8);           // courtyard north range
    m.box(70, 0, 112, 13, 46, 13, MAT.STONE); m.pyramid(70, 46, 112, 15, 15, 14, MAT.SLATE); // clock tower
    tower(-98, -64, 7.5, 70);                         // Astronomy Tower
    tower(42, -58, 8, 52); tower(-30, 92, 8, 58);     // two great towers
    for (const [x, z, r, t] of [[-40, -42, 3.5, 34], [20, 38, 3.5, 40], [-84, 62, 4, 36], [84, -18, 3.5, 30], [-12, -92, 4, 38], [112, 44, 3.5, 28], [-118, -10, 4, 32], [-50, 125, 3.5, 30], [108, 150, 3.5, 26], [-70, -100, 3, 26]] as const) tower(x, z, r, t, 1.2);
    wall(-100, -72, -122, 40, 12); wall(-122, 40, -60, 128, 12); wall(-60, 128, 0, 168, 12); wall(-100, -72, -12, -100, 12); wall(-12, -100, 84, -20, 12); wall(84, -20, 115, 48, 10);
    add(m, c.x, base, c.z);
    // lake-facing cliff foot: landing jetty and the passage entrance arch
    const L = landmark(db, 'lakeside-landing'), j = new MeshBuilder('landing');
    j.box(-14, -1.5, -4, 26, 2.2, 4.5, MAT.DARK_STONE, -75 * D); j.box(0, 0, 0, 10, 0.8, 8, MAT.DARK_STONE);
    add(j, L.x, L.elevation! - 0.6, L.z);
    const P = landmark(db, 'passage-entrance'), a = new MeshBuilder('passage'), py = h(P.x, P.z);
    a.box(-2.6, 0, 0, 1.4, 4.5, 2, MAT.DARK_STONE).box(2.6, 0, 0, 1.4, 4.5, 2, MAT.DARK_STONE).box(0, 4.5, 0, 6.6, 1.4, 2.2, MAT.DARK_STONE);
    add(a, P.x, py - 0.3, P.z, 40 * D);
  }
  // ---------------------------------------------------------------------------------------------- grounds
  {
    const H = landmark(db, 'hagrids-hut'), m = new MeshBuilder('hut');
    m.frustum(0, 0, 0, 5, 4.8, 4.2, 10, MAT.STONE).frustum(0, 4.2, 0, 6.4, 0, 5.2, 10, MAT.SHINGLE).box(3.6, 3, 1, 1.2, 4.5, 1.2, MAT.DARK_STONE);
    add(m, H.x, H.elevation! - 0.2, H.z);
    const G = landmark(db, 'greenhouses'), g = new MeshBuilder('greenhouses');
    for (const dz of [-15, 0, 15]) { g.box(0, 0, dz, 30, 3.2, 10, MAT.GLASS, 12 * D); g.gable(0, 3.2, dz, 30, 10, 3, MAT.GLASS, 12 * D, 0.2); }
    add(g, G.x, h(G.x, G.z) - 0.2, G.z);
    const Wl = landmark(db, 'whomping-willow'), w = new MeshBuilder('willow');
    w.frustum(0, 0, 0, 1.7, 0.9, 8, 8, MAT.TIMBER).blob(0, 10, 0, 8, 4.5, 7.5, MAT.FOLIAGE, 1).blob(3, 8.5, -2, 5, 3, 5, MAT.FOLIAGE, 2).blob(-4, 9, 2, 5, 3, 4.5, MAT.FOLIAGE, 3);
    add(w, Wl.x, h(Wl.x, Wl.z) - 0.3, Wl.z);
    const O = landmark(db, 'owlery'), o = new MeshBuilder('owlery');
    o.frustum(0, 0, 0, 6, 5, 22, 12, MAT.STONE).frustum(0, 22, 0, 7, 0, 9, 12, MAT.SLATE);
    add(o, O.x, h(O.x, O.z) - 0.5, O.z);
    const F = landmark(db, 'forest-entrance'), f = new MeshBuilder('forest-gate');
    f.box(-5, 0, 0, 1.6, 6, 1.6, MAT.STANDING_STONE).box(5, 0, 0, 1.6, 7, 1.6, MAT.STANDING_STONE);
    add(f, F.x, h(F.x, F.z) - 0.3, F.z, 40 * D);
  }
  // ---------------------------------------------------------------------------------------------- Quidditch pitch
  {
    const Q = landmark(db, 'quidditch-pitch'), m = new MeshBuilder('pitch'), houses: [number, number, number][] = [[0.75, 0.15, 0.12], [0.15, 0.45, 0.2], [0.85, 0.7, 0.15], [0.15, 0.25, 0.7]];
    for (const end of [-1, 1]) for (const [dx, ht] of [[-9, 15], [0, 18], [9, 15]] as const) {
      const z = end * 72; m.frustum(dx, 0, z, 0.25, 0.2, ht, 6, MAT.GOLD);
      for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2; m.box(dx + Math.sin(a) * 2.4, ht + 2.4 + Math.cos(a) * 2.4, z, 0.35, 0.35, 0.25, MAT.GOLD); }
    }
    add(m, Q.x, h(Q.x, Q.z) - 0.1, Q.z);
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2, s = new MeshBuilder(`stand-${k}`), tint = houses[k % 4];
      s.box(0, 0, 0, 9, 17, 9, MAT.FABRIC).pyramid(0, 17, 0, 10, 10, 7, MAT.FABRIC);
      const x = Q.x + Math.sin(a) * 58, z = Q.z + Math.cos(a) * 100;
      add(s, x, h(x, z) - 0.3, z, a, tint);
    }
  }
  // ---------------------------------------------------------------------------------------------- Hogsmeade
  {
    const V = landmark(db, 'hogsmeade'), m = new MeshBuilder('hogsmeade'), vy = h(V.x, V.z);
    const dirx = (1550 - 1950), dirz = (4550 - 4380), dl = Math.hypot(dirx, dirz), ux = dirx / dl, uz = dirz / dl; // main street direction
    const rot = Math.atan2(ux, uz);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const named: Record<number, string> = { 0: 'three-broomsticks', 3: 'honeydukes', 5: 'zonkos', [-2]: 'post-office', [-5]: 'hogs-head' };
    const shopLabels: Record<string, string> = { 'three-broomsticks': 'The Three Broomsticks', honeydukes: 'Honeydukes', zonkos: "Zonko's Joke Shop", 'post-office': 'Hogsmeade Post Office', 'hogs-head': "The Hog's Head" };
    for (let i = -9; i <= 9; i++) for (const side of [-1, 1]) {
      const along = i * 15 + (rnd() - 0.5) * 3, off = side * (11 + rnd() * 2);
      const lx = ux * along + uz * off, lz = uz * along - ux * off;
      const big = side === 1 && named[i] !== undefined;
      const wdt = big ? 15 : 8 + rnd() * 4, dep = big ? 12 : 7 + rnd() * 3, ht = big ? 9 : 5.5 + rnd() * 3;
      const gy = h(V.x + lx, V.z + lz) - vy;
      m.box(lx, gy - 1.5, lz, wdt, ht + 1.5, dep, rnd() < 0.6 ? MAT.PLASTER : MAT.STONE, rot);
      m.gable(lx, gy + ht, lz, wdt, dep, 4.5 + rnd() * 2, rnd() < 0.5 ? MAT.SHINGLE : MAT.SLATE, rot, 0.6, MAT.PLASTER);
      if (rnd() < 0.5) m.box(lx + uz * 2, gy + ht, lz - ux * 2, 0.9, 4.5, 0.9, MAT.DARK_STONE);
      if (big) labels.push({ id: named[i], name: shopLabels[named[i]], x: V.x + lx, y: gy + vy + ht + 8, z: V.z + lz });
    }
    add(m, V.x, vy, V.z);
    const S = landmark(db, 'shrieking-shack'), s = new MeshBuilder('shack');
    s.box(0, 0, 0, 10, 7, 8, MAT.TIMBER, 0.3).gable(0, 7, 0, 10, 8, 5, MAT.SHINGLE, 0.36, 0.5, MAT.TIMBER).box(2, 7, 2, 1.2, 5, 1.2, MAT.DARK_STONE);
    add(s, S.x, h(S.x, S.z) - 0.4, S.z);
  }
  // ---------------------------------------------------------------------------------------------- station, boathouse
  {
    const St = landmark(db, 'hogsmeade-station'), R = T.rail;
    // direction of the line at the station
    let k = 0, best = Infinity;
    R.pts.forEach((p, i) => { const d = Math.hypot(p[0] - St.x, p[1] - St.z); if (d < best) { best = d; k = i; } });
    const a = R.pts[Math.max(0, k - 3)], b = R.pts[Math.min(R.pts.length - 1, k + 3)], rot = Math.atan2(b[0] - a[0], b[1] - a[1]);
    const m = new MeshBuilder('station'), off = 6;
    const nx = Math.cos(rot), nz = -Math.sin(rot); // right-hand normal of the line
    m.box(nx * off, -0.4, nz * off, 5, 1.3, 230, MAT.STONE, rot);
    m.box(nx * (off + 9), 0.5, nz * (off + 9), 9, 6, 24, MAT.STONE, rot).gable(nx * (off + 9), 6.5, nz * (off + 9), 24, 9, 4, MAT.SLATE, rot - Math.PI / 2, 0.5, MAT.STONE);
    m.box(nx * off, 3.6, nz * off, 5.5, 0.4, 60, MAT.TIMBER, rot);
    add(m, St.x, St.elevation!, St.z);
    const B = landmark(db, 'boathouse'), bh = new MeshBuilder('boathouse');
    bh.box(0, 0, 0, 10, 5.5, 14, MAT.TIMBER, 15 * D).gable(0, 5.5, 0, 14, 10, 4, MAT.SHINGLE, 15 * D - Math.PI / 2, 0.5, MAT.TIMBER).box(4, -1.2, 18, 3, 1.4, 24, MAT.TIMBER, 15 * D);
    add(bh, B.x, B.elevation! - 0.3, B.z);
  }
  // ---------------------------------------------------------------------------------------------- railway + viaduct
  {
    const R = T.rail, ax = R.pts[0][0], az = R.pts[0][1];
    const local = R.pts.map(([x, z]) => [x - ax, z - az] as [number, number]);
    const tr = new MeshBuilder('track');
    // run the track in pieces so a viaduct span gets its deck instead of ground ballast
    tr.ribbon(local, Array.from(R.elev, (e) => e - 0.25), 3.2, MAT.SLEEPER);
    tr.ribbon(local, Array.from(R.elev, (e) => e + 0.05), 0.14, MAT.STEEL, -0.72);
    tr.ribbon(local, Array.from(R.elev, (e) => e + 0.05), 0.14, MAT.STEEL, 0.72);
    add(tr, ax, 0, az);
    const vi = new MeshBuilder('viaduct');
    for (let i = 0; i < R.pts.length - 1; i++) {
      if (R.kind[i] !== 1) continue;
      const [x0, z0] = local[i], [x1, z1] = local[i + 1], rot = Math.atan2(x1 - x0, z1 - z0), len = Math.hypot(x1 - x0, z1 - z0);
      vi.box((x0 + x1) / 2, R.elev[i] - 2.6, (z0 + z1) / 2, 5.6, 2.2, len + 0.2, MAT.STONE, rot);
      if (i % 2 === 0) { const g = R.ground[i]; vi.box(x0, g - 2, z0, 4.2, R.elev[i] - 2.6 - g + 2, 3.4, MAT.STONE, rot); }
    }
    add(vi, ax, 0, az);
  }
  // ---------------------------------------------------------------------------------------------- rivers + waterfall
  for (const r of T.rivers) {
    const ax = r.pts[0][0], az = r.pts[0][1], m = new MeshBuilder(`river-${r.def.id}`);
    const local = r.pts.map(([x, z]) => [x - ax, z - az] as [number, number]);
    const surf = Array.from(r.bed, (b) => b + r.def.depth * 0.72);
    // split at the waterfall so the ribbon does not stretch down the face
    let start = 0;
    for (let i = 1; i < surf.length; i++) {
      if (surf[i - 1] - surf[i] > 4) {
        m.ribbon(local.slice(start, i), surf.slice(start, i), r.def.width + 1.5, MAT.RIVER);
        const [px, pz] = local[i - 1], [qx, qz] = local[i], dx = qx - px, dz = qz - pz, l = Math.hypot(dx, dz) || 1, w = (r.def.width + 2) / 2;
        m.sheet(qx - dz / l * w, qz + dx / l * w, qx + dz / l * w, qz - dx / l * w, surf[i] - 0.5, surf[i - 1], MAT.FALLS);
        start = i;
      }
    }
    m.ribbon(local.slice(start), surf.slice(start), r.def.width + 1.5, MAT.RIVER);
    add(m, ax, 0, az);
  }
  // ---------------------------------------------------------------------------------------------- forest destinations
  {
    const U = landmark(db, 'unicorn-glade'), u = new MeshBuilder('glade');
    for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2; u.box(Math.sin(a) * 14, -0.5, Math.cos(a) * 14, 1.2, 2.2, 0.9, MAT.STANDING_STONE, a); }
    add(u, U.x, h(U.x, U.z), U.z);
    const C = landmark(db, 'centaur-uplands'), c = new MeshBuilder('centaur-ring');
    for (let k = 0; k < 13; k++) { const a = k / 13 * Math.PI * 2, x = Math.sin(a) * 24, z = Math.cos(a) * 24; c.box(x, h(C.x + x, C.z + z) - h(C.x, C.z) - 0.8, z, 1.8, 4.5 + (k % 3), 1.1, MAT.STANDING_STONE, a); }
    add(c, C.x, h(C.x, C.z), C.z);
    const A = landmark(db, 'aragogs-hollow'), w = new MeshBuilder('hollow-webs'), ay = h(A.x, A.z);
    for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2, r0 = 10, r1 = 38; w.sheet(Math.sin(a) * r0, Math.cos(a) * r0, Math.sin(a) * r1, Math.cos(a) * r1, h(A.x + Math.sin(a) * r1, A.z + Math.cos(a) * r1) - ay - 1, 9, MAT.WEB); }
    w.frustum(0, -1, 0, 9, 4, 5, 9, MAT.DARK_STONE);
    add(w, A.x, ay, A.z);
  }
  return { meshes, instances, labels };
}

