// Phase 4.4: impostor coverage hypothesis. LOD1 at the LOD1 → impostor switch size (140 px on a 900 px screen) and
// at the size the impostor bake draws it (the bounding sphere × 1.04 across a 112-texel frame), eye level and
// overhead, lit and silhouette. tools/coverage_single.py measures each image's own crown coverage.
// window.__args: { ids, radii ({ id: bake radius }), angles }
const lab = window.__lab, a = window.__args || {};
const keepPx = [...lab.scene.lodPolicy.px];
lab.setLight('day');
for (const id of a.ids || ['oak-a', 'oak-b', 'pine']) {
  await lab.select(id, 'three'); lab.setEnv(false);
  lab.scene.custom = [{ id, x: 0, z: 0, yaw: 0 }]; lab.scene.standN = 1; lab.scene.pinned = true; lab.scene.cullVP = null; lab.scene.set([], 0, true);
  lab.scene.lodPolicy.px = [1e9, 0, 0];
  const bb = lab.store.get(id).built.bounds, Ht = bb.max[1];
  const t = [(bb.min[0] + bb.max[0]) / 2, Ht * 0.5, (bb.min[2] + bb.max[2]) / 2];
  const R = a.radii[id], bakePx = Ht * 112 / (2 * R * 1.04);
  for (const [tag, px, S] of [['switch', 140, 900], ['bake', bakePx, Math.round(900 * bakePx / 140)]]) {
    const k = S / (2 * Math.tan((45 * Math.PI) / 360)), dist = (Ht / (px * S / S)) * k * (S / S);
    for (const [vt, el] of a.angles || [['eye', 0.12], ['over', 1.45]]) {
      const d2 = (Ht / px) * k;
      const o = { target: t, az: 0.6, el, dist: d2 };
      lab.scene.eye = [t[0] + Math.sin(0.6) * Math.cos(el) * d2, t[1] + Math.sin(el) * d2, t[2] + Math.cos(0.6) * Math.cos(el) * d2];
      window.__emit(`bakesize/${id}-${vt}-${tag}-sil.png`, await window.__b64(await lab.shoot('three', 'silhouette', { width: S, height: S, orbit: o })));
    }
    window.__emit(`bakesize/${id}-${tag}.json`, { px, S, bakePx, R, Ht });
  }
}
lab.scene.lodPolicy.px = keepPx; lab.scene.custom = null; lab.scene.eye = null; lab.scene.pinned = false;
return {};
