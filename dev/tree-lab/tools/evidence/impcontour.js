// Phase 4.3 impostor contour check: the impostor magnified (2× and 4× its switch size, i.e. closer than it is ever used)
// beside LOD1 from the same camera, so internal dark contour lines inside leaf clumps are visible if present.
// window.__args: { ids, mags, el }
const lab = window.__lab, a = window.__args || {};
const ids = a.ids || ['oak-b'], mags = a.mags || [2, 4], S = 640;
const keepPx = [...lab.scene.lodPolicy.px];
const force = (l) => { lab.scene.lodPolicy.px = l === 1 ? [1e9, 0, 0] : [1e9, 1e9, 1e9]; };
lab.setLight('day');
for (const id of ids) {
  await lab.ensureImpostors([id]);
  await lab.select(id, 'three'); lab.setEnv(false);
  lab.scene.custom = [{ id, x: 0, z: 0, yaw: 0 }]; lab.scene.standN = 1; lab.scene.pinned = true; lab.scene.cullVP = null; lab.scene.set([], 0, true);
  const bb = lab.store.get(id).built.bounds, Ht = bb.max[1];
  const t = [(bb.min[0] + bb.max[0]) / 2, Ht * 0.5, (bb.min[2] + bb.max[2]) / 2];
  const k = S / (2 * Math.tan((45 * Math.PI) / 360));
  for (const m of mags) {
    const px = 140 * m * S / 900, dist = (Ht / px) * k, el = a.el ?? 0.12;
    const o = { target: t, az: 0.6, el, dist };
    lab.scene.eye = [t[0] + Math.sin(0.6) * Math.cos(el) * dist, t[1] + Math.sin(el) * dist, t[2] + Math.cos(0.6) * Math.cos(el) * dist];
    for (const l of [1, 3]) { force(l); window.__emit(`contour/${id}-x${m}-${l === 3 ? 'imp' : 'lod1'}.png`, await window.__b64(await lab.shoot('three', 'lit', { width: S, height: S, light: 'day', orbit: o }))); }
  }
}
lab.scene.lodPolicy.px = keepPx; lab.scene.custom = null; lab.scene.eye = null; lab.scene.pinned = false;
return {};
