// Phase 4.3 experiment: LOD1 spray-card V angle (foliage spec cardV) against LOD0, at the LOD0 → LOD1 switch size,
// with lodcheck.js's cameras (protocol views: eye 0.12 rad, overhead 1.45 rad; azimuth 0.6). LOD0 is rendered once.
// window.__args: { id, values (rad), angles, lod0 (bool), scale }
const lab = window.__lab, a = window.__args || {};
const id = a.id || 'oak-b', S = Math.round(900 * (a.scale || 1)), LT = 'day';
const angles = a.angles || [['eye', 0.12], ['over', 1.45]];
const keepPx = [...lab.scene.lodPolicy.px];
const force = (l) => { lab.scene.lodPolicy.px = l === 0 ? [0, 0, 0] : [1e9, 0, 0]; };
lab.setLight(LT);
const shots = async (tag, l) => {
  await lab.select(id, 'three'); lab.setEnv(false);
  lab.scene.custom = [{ id, x: 0, z: 0, yaw: 0 }]; lab.scene.standN = 1; lab.scene.pinned = true; lab.scene.cullVP = null; lab.scene.set([], 0, true);
  const bb = lab.store.get(id).built.bounds, Ht = bb.max[1];
  const t = [(bb.min[0] + bb.max[0]) / 2, Ht * 0.5, (bb.min[2] + bb.max[2]) / 2];
  const k = S / (2 * Math.tan((45 * Math.PI) / 360)), dist = (Ht / (700 * S / 900)) * k;
  for (const [vt, el] of angles) {
    const o = { target: t, az: 0.6, el, dist };
    lab.scene.eye = [t[0] + Math.sin(0.6) * Math.cos(el) * dist, t[1] + Math.sin(el) * dist, t[2] + Math.cos(0.6) * Math.cos(el) * dist];
    force(l);
    window.__emit(`cardv/${id}-${vt}-${tag}.png`, await window.__b64(await lab.shoot('three', 'lit', { width: S, height: S, light: LT, orbit: o })));
    window.__emit(`cardv/${id}-${vt}-${tag}-sil.png`, await window.__b64(await lab.shoot('three', 'silhouette', { width: S, height: S, orbit: o })));
  }
};
if (a.lod0) await shots('lod0', 0);
for (const v of a.values || [0.7, 0.45]) {
  await lab.setFoliageOverride(v === 0.7 ? null : { cardV: v });
  for (const off of a.offsets || [null]) for (const bo of a.boosts || [null]) for (const ac of a.area || [null]) {
    if (off !== null) lab.viewer.cardShadowOffset = off;
    if (bo !== null) lab.viewer.alphaBoost.needleCard = bo;
    if (ac !== null) lab.viewer.cardAreaCorrection = ac;
    await shots(`v${Math.round(v * 100)}${off !== null ? '-o' + Math.round(off * 100) : ''}${bo !== null ? '-b' + Math.round(bo * 100) : ''}${ac !== null ? (ac ? '-ra' : '-r0') : ''}`, 1);
  }
}
lab.viewer.cardShadowOffset = 0.5; lab.viewer.cardAreaCorrection = true;
await lab.setFoliageOverride(null);
lab.scene.lodPolicy.px = keepPx; lab.scene.custom = null; lab.scene.eye = null; lab.scene.pinned = false;
return {};
