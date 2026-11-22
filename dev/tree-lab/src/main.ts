// Tree lab entry: grows the three specimens, meshes them at every LOD, shows them in the viewer.
// URL: ?tree=oak|pine|birch|all &view=front|side|three|silhouette|trunk|junction|interior|wire|clay|foliage
//      &mode=lit|clay|silhouette|wire|normals|hierarchy &lod=0..2 &light=day|overcast &hud=0
import { Viewer, viewProj, MODES, type Mode } from './render/viewer.ts';
import { MeshOut, meshChains, LODS, VFLOATS, type BarkFn } from './framework/mesher.ts';
import { groundAt, type V3 } from './framework/math.ts';
import { SPECIES, type SpeciesDef } from './species/index.ts';

const q = new URLSearchParams(location.search);
const $ = (id: string) => document.getElementById(id)!;

interface Built { def: SpeciesDef; lods: { v: Float32Array; i: Uint32Array; tris: number; ms: number }[]; info: Record<string, unknown>; growMs: number; poi: SpeciesDef['poi'] extends (...a: never[]) => infer R ? R : never; bounds: { min: V3; max: V3 } }

function buildTree(def: SpeciesDef): Built {
  const t0 = performance.now();
  const { sk, info } = def.grow();
  const growMs = performance.now() - t0;
  const chains = sk.chains();
  const lods = LODS.map((lod) => {
    const t1 = performance.now();
    const o = new MeshOut();
    def.mesh ? def.mesh(sk, chains, lod, o) : meshChains(sk, chains, lod, def.bark as BarkFn, o);
    return { v: new Float32Array(o.v), i: new Uint32Array(o.i), tris: o.i.length / 3, ms: performance.now() - t1 };
  });
  const min: V3 = [1e9, 1e9, 1e9], max: V3 = [-1e9, -1e9, -1e9];
  for (const n of sk.nodes) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], n.p[k]); max[k] = Math.max(max[k], n.p[k]); }
  return { def, lods, info, growMs, poi: def.poi(sk) as never, bounds: { min, max } };
}

function groundMesh(cx: number, cz: number, R: number): { v: Float32Array; i: Uint32Array } {
  const o = new MeshOut(), s = 0.5, n = Math.round((2 * R) / s);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = cx - R + i * s, z = cz - R + j * s;
    const y = groundAt(x, z), e = 0.25;
    const nx = groundAt(x - e, z) - groundAt(x + e, z), nz = groundAt(x, z - e) - groundAt(x, z + e);
    const l = Math.hypot(nx, 2 * e, nz);
    o.vert([x - cx, y, z - cz], [nx / l, (2 * e) / l, nz / l], 0, 0, 0, 0, 0, 0);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i; o.tri(a, a + n + 1, a + 1); o.tri(a + 1, a + n + 1, a + n + 2); }
  return { v: new Float32Array(o.v), i: new Uint32Array(o.i) };
}

/** A 1.8 m human figure (scale reference), built from swept capsules. */
function figure(x: number, z: number): { v: Float32Array; i: Uint32Array } {
  const o = new MeshOut();
  const g = groundAt(x, z);
  const cap = (a: V3, b: V3, r: number) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]);
    const ax = [d[0] / L, d[1] / L, d[2] / L];
    const p = Math.abs(ax[1]) < 0.9 ? [ax[2], 0, -ax[0]] : [1, 0, 0]; const pl = Math.hypot(p[0], p[1], p[2]); const N = [p[0] / pl, p[1] / pl, p[2] / pl];
    const B = [ax[1] * N[2] - ax[2] * N[1], ax[2] * N[0] - ax[0] * N[2], ax[0] * N[1] - ax[1] * N[0]];
    const rings: number[][] = [], S = 14, RN = 10;
    for (let k = 0; k <= RN; k++) {
      const th = (k / RN) * Math.PI, along = -Math.cos(th) * r, rr = Math.sin(th) * r;
      const t = k <= RN / 2 ? 0 : 1;
      const c = [a[0] + d[0] * t + ax[0] * along, a[1] + d[1] * t + ax[1] * along, a[2] + d[2] * t + ax[2] * along];
      const ring: number[] = [];
      for (let s = 0; s <= S; s++) { const ph = (s / S) * Math.PI * 2; const dir: V3 = [N[0] * Math.cos(ph) * Math.sin(th) + B[0] * Math.sin(ph) * Math.sin(th) - ax[0] * Math.cos(th), N[1] * Math.cos(ph) * Math.sin(th) + B[1] * Math.sin(ph) * Math.sin(th) - ax[1] * Math.cos(th), N[2] * Math.cos(ph) * Math.sin(th) + B[2] * Math.sin(ph) * Math.sin(th) - ax[2] * Math.cos(th)]; ring.push(o.vert([c[0] + (N[0] * Math.cos(ph) + B[0] * Math.sin(ph)) * rr, c[1] + (N[1] * Math.cos(ph) + B[1] * Math.sin(ph)) * rr, c[2] + (N[2] * Math.cos(ph) + B[2] * Math.sin(ph)) * rr], dir, 0, 0, 0, 0, 0, 0)); }
      rings.push(ring);
    }
    for (let k = 0; k < RN; k++) for (let s = 0; s < S; s++) { o.tri(rings[k][s], rings[k + 1][s], rings[k][s + 1]); o.tri(rings[k][s + 1], rings[k + 1][s], rings[k + 1][s + 1]); }
  };
  const P = (px: number, py: number, pz: number): V3 => [px, g + py, pz];
  cap(P(-0.1, 0.08, 0), P(-0.1, 0.85, 0), 0.075); cap(P(0.1, 0.08, 0), P(0.1, 0.85, 0), 0.075);
  cap(P(0, 0.95, 0), P(0, 1.42, 0), 0.17); cap(P(-0.24, 1.42, 0), P(-0.28, 0.85, 0.05), 0.05); cap(P(0.24, 1.42, 0), P(0.28, 0.85, 0.05), 0.05);
  cap(P(0, 1.62, 0), P(0, 1.68, 0), 0.11);
  return { v: new Float32Array(o.v), i: new Uint32Array(o.i) };
}

async function main() {
  const canvas = $('view') as HTMLCanvasElement;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const fit = () => { canvas.width = Math.round(canvas.clientWidth * dpr); canvas.height = Math.round(canvas.clientHeight * dpr); };
  fit(); addEventListener('resize', fit);
  const viewer = new Viewer();
  await viewer.init(canvas);
  const which = q.get('tree') || 'oak';
  const defs = which === 'all' ? SPECIES : SPECIES.filter((s) => s.id === which);
  const t0 = performance.now();
  const built = defs.map(buildTree);
  const genMs = performance.now() - t0;
  let lod = Math.max(0, Math.min(2, +(q.get('lod') || 0)));
  viewer.mode = (MODES.includes(q.get('mode') as Mode) ? q.get('mode') : 'lit') as Mode;
  viewer.overcast = q.get('light') === 'overcast' ? 1 : 0;
  // layout: side by side at true relative sizes, 32 m apart
  const spacing = 34;
  const xs = built.map((_, k) => (k - (built.length - 1) / 2) * spacing);
  const upload = () => {
    viewer.clear();
    const R = which === 'all' ? spacing * built.length / 2 + 10 : 34;
    const gm = groundMesh(0, 0, R); viewer.upload(gm.v, gm.i, 1, [0, 0, 0]);
    built.forEach((b, k) => {
      const L = b.lods[lod];
      viewer.upload(L.v, L.i, 0, [xs[k], 0, 0]);
      const fz = b.def.figure ?? [b.def.crownR * 0.25 + 3, 2.5];
      const f = figure(xs[k] + fz[0], fz[1]); viewer.upload(f.v, f.i, 2, [0, 0, 0]);
    });
    const ext = which === 'all' ? spacing * built.length / 2 + 15 : 20;
    viewer.fitShadow(sun3(), [-ext, -1, -ext], [ext, 26, ext]);
  };
  const sunDir = () => (viewer.overcast ? [0.25, 0.9, 0.35] : [0.55, 0.62, 0.42]);
  const sun3 = () => sunDir() as [number, number, number];
  upload();
  // ---- camera
  const cam = { az: 0, el: 0.08, dist: 40, target: [0, 9, 0] as number[], free: false, eye: [0, 2, 30] as number[], yaw: 0, pitch: 0 };
  const b0 = built[0];
  const H = which === 'all' ? Math.max(...built.map((b) => b.bounds.max[1])) : b0.bounds.max[1];
  const W = which === 'all' ? spacing * built.length : Math.max(b0.bounds.max[0] - b0.bounds.min[0], b0.bounds.max[2] - b0.bounds.min[2]);
  const FOV = 50 * Math.PI / 180;
  const fullDist = (Math.max(H * 1.08, W * 0.62 / (canvas.width / canvas.height)) * 0.55) / Math.tan(FOV / 2);
  const setView = (v: string) => {
    cam.free = false;
    const p = b0.poi;
    if (v === 'front' || v === 'silhouette' || v === 'all') { cam.az = 0; cam.el = 0.05; cam.dist = fullDist; cam.target = [0, H * 0.48, 0]; }
    else if (v === 'side') { cam.az = Math.PI / 2; cam.el = 0.05; cam.dist = fullDist; cam.target = [0, H * 0.48, 0]; }
    else if (v === 'three' || v === 'wire' || v === 'clay') { cam.az = Math.PI / 4; cam.el = 0.2; cam.dist = fullDist * 1.02; cam.target = [0, H * 0.45, 0]; }
    else if (v === 'trunk') { cam.az = p.trunkAz; cam.el = 0.08; cam.dist = p.trunkDist; cam.target = [0, p.trunkY, 0]; }
    else if (v === 'junction') { cam.az = p.junctionAz; cam.el = p.junctionEl; cam.dist = p.junctionDist; cam.target = p.junction; }
    else if (v === 'interior') { cam.free = true; cam.eye = p.interiorEye; cam.yaw = p.interiorYaw; cam.pitch = p.interiorPitch; }
    if (v === 'silhouette') viewer.mode = 'silhouette';
    if (v === 'wire') viewer.mode = 'wire';
    if (v === 'clay') viewer.mode = 'clay';
  };
  setView(q.get('view') || 'three');
  // input
  let drag = false, lx = 0, ly = 0;
  const keys = new Set<string>();
  canvas.addEventListener('pointerdown', (e) => { drag = true; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', () => { drag = false; });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return; const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
    if (cam.free) { cam.yaw += dx * 0.004; cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch - dy * 0.004)); }
    else { cam.az -= dx * 0.005; cam.el = Math.max(-0.2, Math.min(1.5, cam.el + dy * 0.005)); }
  });
  canvas.addEventListener('wheel', (e) => { cam.dist *= Math.exp(e.deltaY * 0.001); e.preventDefault(); }, { passive: false });
  addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code === 'KeyM') viewer.mode = MODES[(MODES.indexOf(viewer.mode) + 1) % MODES.length];
    if (e.code === 'KeyO') { viewer.overcast = 1 - viewer.overcast; viewer.fitShadow(sun3(), [-20, -1, -20], [20, 26, 20]); }
    if (e.code === 'KeyL') { lod = (lod + 1) % 3; upload(); }
    if (e.code === 'KeyF') { cam.free = !cam.free; if (cam.free) { cam.eye = eyeOf(); cam.yaw = cam.az + Math.PI; cam.pitch = -cam.el; } }
    if (e.code === 'KeyH') $('hud').hidden = !$('hud').hidden;
    if (e.code === 'KeyT') viewer.wind = 1 - viewer.wind;
    const vmap: Record<string, string> = { Digit1: 'front', Digit2: 'side', Digit3: 'three', Digit4: 'silhouette', Digit5: 'trunk', Digit6: 'junction', Digit7: 'interior', Digit8: 'wire', Digit9: 'clay' };
    if (vmap[e.code]) setView(vmap[e.code]);
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  const eyeOf = () => [cam.target[0] + Math.sin(cam.az) * Math.cos(cam.el) * cam.dist, cam.target[1] + Math.sin(cam.el) * cam.dist, cam.target[2] + Math.cos(cam.az) * Math.cos(cam.el) * cam.dist];
  if (q.get('hud') === '0') $('hud').hidden = true;
  let last = performance.now(), fps = 0;
  const api = { setView: (v: string, mode?: string) => { setView(v); viewer.mode = (MODES.includes(mode as Mode) ? mode : viewer.mode) as Mode; }, setLod: (k: number) => { lod = k; upload(); }, setLight: (o: number) => { viewer.overcast = o; upload(); } };
  (window as any).__lab = { ...api, viewer, built: built.map((b) => ({ id: b.def.id, info: b.info, growMs: Math.round(b.growMs), lods: b.lods.map((l) => ({ tris: l.tris, ms: Math.round(l.ms), bytes: l.v.byteLength + l.i.byteLength })) })), genMs: Math.round(genMs), ready: false, frames: 0 };
  const frame = (t: number) => {
    const dt = Math.min(0.1, (t - last) / 1000); last = t; fps = fps * 0.9 + (1 / Math.max(dt, 1e-3)) * 0.1;
    viewer.time += dt;
    let eye: number[], target: number[];
    if (cam.free) {
      const f = [Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch)];
      const r = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)], sp = (keys.has('ShiftLeft') ? 12 : 3) * dt;
      if (keys.has('KeyW')) cam.eye = cam.eye.map((v, k) => v + f[k] * sp); if (keys.has('KeyS')) cam.eye = cam.eye.map((v, k) => v - f[k] * sp);
      if (keys.has('KeyD')) cam.eye = cam.eye.map((v, k) => v - r[k] * sp); if (keys.has('KeyA')) cam.eye = cam.eye.map((v, k) => v + r[k] * sp);
      eye = cam.eye; target = eye.map((v, k) => v + f[k]);
    } else { eye = eyeOf(); target = cam.target; }
    const vp = viewProj(eye, target, FOV, canvas.width / canvas.height);
    const s = sunDir();
    viewer.render(vp, eye, [s[0], s[1], s[2], viewer.overcast ? 1.5 : 2.1]);
    (window as any).__lab.frames++; (window as any).__lab.ready = true;
    if (!$('hud').hidden && ((window as any).__lab.frames % 10 === 0)) {
      $('hud').textContent = [
        `TREE LAB  ${built.map((b) => b.def.name).join(' · ')}   [1–9 views, M mode (${viewer.mode}), L LOD (${lod}), O light (${viewer.overcast ? 'overcast' : 'daylight'}), F free cam (${cam.free ? 'on' : 'off'}), T wind, H hud]`,
        `FPS ${fps.toFixed(0)}   GPU ${viewer.hasTs ? viewer.gpuMs.toFixed(2) + ' ms' : 'n/a'}   draws ${viewer.draws}   triangles ${viewer.tris.toLocaleString()}`,
        ...built.map((b) => `${b.def.id}: grow ${b.growMs.toFixed(0)} ms, mesh LOD0/1/2 ${b.lods.map((l) => l.ms.toFixed(0)).join('/')} ms, tris ${b.lods.map((l) => l.tris.toLocaleString()).join(' / ')}, ${JSON.stringify(b.info)}`),
      ].join('\n');
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  void VFLOATS;
}
main().catch((e) => { console.error(e); $('hud').textContent = 'Error: ' + e.message; (window as any).__labError = String(e); });
