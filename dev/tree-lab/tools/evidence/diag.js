// Phase 4.3 shading diagnostics: LOD0 and LOD1 (or LOD1 and the impostor) of one specimen at a boundary's projected
// size, for a set of viewing elevations and azimuths, in each foliage diagnostic mode (render/viewer.ts viewer.diag)
// plus a silhouette (the crown mask). tools/diag_metrics.py turns them into per-term ratios.
// window.__args: { id, boundary (0 | 1), scale (screen = 900 × scale), els (degrees), azs (radians), modes, lods }
const lab = window.__lab, a = window.__args || {};
const id = a.id || 'pine', S = Math.round(900 * (a.scale || 0.5)), sw = a.boundary ?? 0;
const els = a.els || [0, 15, 30, 45, 60, 75, 90], azs = a.azs || [0.6];
const modes = a.modes || [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const lods = a.lods || (sw === 0 ? [0, 1] : [1, 3]);
const keepPx = [...lab.scene.lodPolicy.px], P = keepPx;
const force = (l) => { lab.scene.lodPolicy.px = l === 0 ? [0, 0, 0] : l === 1 ? [1e9, 0, 0] : l === 2 ? [1e9, 1e9, 0] : [1e9, 1e9, 1e9]; };
lab.setLight('day');
if (lods.includes(3)) await lab.ensureImpostors([id]);
await lab.select(id, 'three'); lab.setEnv(false);
lab.scene.custom = [{ id, x: 0, z: 0, yaw: 0 }]; lab.scene.standN = 1; lab.scene.pinned = true; lab.scene.cullVP = null; lab.scene.set([], 0, true);
const bb = lab.store.get(id).built.bounds, Ht = bb.max[1];
const t = [(bb.min[0] + bb.max[0]) / 2, Ht * 0.5, (bb.min[2] + bb.max[2]) / 2];
const k = S / (2 * Math.tan((45 * Math.PI) / 360));
const px = P[sw] * S / 900, dist = (Ht / px) * k;
const stats = {};
for (const az of azs) for (const eld of els) {
  // 90°: a hair off vertical (the orbit camera's up vector is world-up)
  const el = Math.min(eld, 89.5) * Math.PI / 180;
  const o = { target: t, az, el, dist };
  lab.scene.eye = [t[0] + Math.sin(az) * Math.cos(el) * dist, t[1] + Math.sin(el) * dist, t[2] + Math.cos(az) * Math.cos(el) * dist];
  for (const l of lods) {
    force(l);
    const tag = `${id}-b${sw}-e${eld}-a${az.toFixed(2)}-${l === 3 ? 'imp' : 'lod' + l}`;
    window.__emit(`diag/${tag}-sil.png`, await window.__b64(await lab.shoot('three', 'silhouette', { width: S, height: S, orbit: o })));
    for (const m of modes) {
      lab.viewer.diag = m;
      window.__emit(`diag/${tag}-m${m}.png`, await window.__b64(await lab.shoot('three', 'lit', { width: S, height: S, light: 'day', orbit: o })));
    }
    lab.viewer.diag = 0;
    lab.scene.apply(0);
    stats[tag] = { instances: lab.viewer.draws.filter((d) => d.kind === 0).reduce((x, d) => x + (d.foliage?.instances ?? 0), 0) };
  }
}
lab.scene.lodPolicy.px = keepPx; lab.scene.custom = null; lab.scene.eye = null; lab.scene.pinned = false;
return { [`diag/${id}-b${sw}-stats.json`]: { id, boundary: sw, S, dist, stats } };
