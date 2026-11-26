// Impostor bake source (§4): the birch's impostor baked from LOD0 and from LOD1 (spray cards), each compared with
// LOD0 geometry at the same cameras (eye, elevated, overhead; one azimuth between frames), at 2.5 × the switch size
// so differences are visible. tools/lod_metrics.py style numbers are computed by tools/crown_evidence.py imp-source.
const lab = window.__lab, out = {}, a = window.__args || {};
const id = a.id || 'birch', S = 600;
await lab.select(id, 'three'); lab.setEnv(false); lab.setLight('day');
lab.scene.custom = [{ id, x: 0, z: 0, yaw: 0 }]; lab.scene.standN = 1; lab.scene.pinned = true; lab.scene.cullVP = null; lab.scene.set([], 0, true);
const keepPx = [...lab.scene.lodPolicy.px];
const force = (l) => { lab.scene.lodPolicy.px = l === 0 ? [0, 0, 0] : l === 1 ? [1e9, 0, 0] : l === 2 ? [1e9, 1e9, 0] : [1e9, 1e9, 1e9]; };
const bb = lab.store.get(id).built.bounds, Ht = bb.max[1];
const t = [(bb.min[0] + bb.max[0]) / 2, Ht * 0.5, (bb.min[2] + bb.max[2]) / 2];
const dist = (Ht / (110 * 2.5 * S / 900)) * (S / (2 * Math.tan((45 * Math.PI) / 360)));
const views = [['eye', 0.6, 0.12], ['between', 0.79, 0.3], ['elevated', 0.6, 0.5], ['overhead', 0.6, 1.45]];
const shot = async (name, l, az, el, mode = 'lit') => {
  lab.scene.eye = [t[0] + Math.sin(az) * Math.cos(el) * dist, t[1] + Math.sin(el) * dist, t[2] + Math.cos(az) * Math.cos(el) * dist]; force(l);
  out[name] = await window.__b64(await lab.shoot('three', mode, { width: S, height: S, light: 'day', orbit: { target: t, az, el, dist } }));
};
for (const [tag, az, el] of views) { await shot(`imp-source/${id}-${tag}-lod0.png`, 0, az, el); await shot(`imp-source/${id}-${tag}-lod0-sil.png`, 0, az, el, 'silhouette'); }
const times = {};
for (const src of [0, 1]) {
  lab.impostors.specs.delete(id); lab.impostorSource[id] = src;
  const t0 = performance.now(); await lab.ensureImpostors([id]); times[src] = performance.now() - t0;
  for (const [tag, az, el] of views) { await shot(`imp-source/${id}-${tag}-src${src}.png`, 3, az, el); await shot(`imp-source/${id}-${tag}-src${src}-sil.png`, 3, az, el, 'silhouette'); }
}
lab.impostorSource[id] = 1; lab.scene.lodPolicy.px = keepPx; lab.scene.custom = null; lab.scene.eye = null; lab.scene.pinned = false;
out['imp-source/bake-ms.json'] = times;
return out;
