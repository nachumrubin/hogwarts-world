// Density experiments (Phase 4.1 §3). Same script runs in the Phase 4 build (baseline: one level) and the 4.1 build
// (moderate = fullness × 0.55, full = as defined). Explicit orbits from the woody-skeleton bounds, which both builds
// share, so the framing matches exactly. Per specimen × level × view: a lit and a silhouette image; per specimen ×
// level: LOD0 instances, triangles, instance bytes, overdraw (eye-level view).
const lab = window.__lab, out = {}, W = 720, H = 540;
const levels = lab.setDensity ? [['moderate', 0.55], ['full', 1]] : [['phase4', 1]];
const ids = ['oak-a', 'oak-b', 'oak-c', 'pine', 'birch'];
const stats = {};
for (const [name, d] of levels) {
  if (lab.setDensity) await lab.setDensity(d);
  for (const id of ids) {
    await lab.select(id, 'three'); lab.setEnv(false);
    const b = lab.store.get(id).built, bb = b.bounds, Ht = bb.max[1], Wd = Math.max(bb.max[0] - bb.min[0], bb.max[2] - bb.min[2]);
    const cx = (bb.min[0] + bb.max[0]) / 2, cz = (bb.min[2] + bb.max[2]) / 2, S = Math.max(Ht, Wd);
    const views = {
      ground: (() => { const D = 1.45 * S, t = [cx, Ht * 0.55, cz]; const el = Math.asin((1.6 - t[1]) / D); return { target: t, az: 0.6, el, dist: D }; })(),
      eye: { target: [cx, Ht * 0.5, cz], az: 0.6, el: 0, dist: 1.45 * S },
      elevated: { target: [cx, Ht * 0.45, cz], az: 0.6, el: 0.42, dist: 1.6 * S },
      above: { target: [cx, Ht * 0.5, cz], az: 0.6, el: 1.5, dist: 1.5 * S },
    };
    let od = {};
    for (const [v, orbit] of Object.entries(views)) {
      out[`${name}/${id}-${v}.png`] = await window.__b64(await lab.shoot('three', 'lit', { width: W, height: H, light: 'day', lod: 0, orbit, overdraw: v === 'eye' ? (r) => { od = r; } : undefined }));
      out[`${name}/${id}-${v}-sil.png`] = await window.__b64(await lab.shoot('three', 'silhouette', { width: W, height: H, lod: 0, orbit }));
    }
    const L0 = b.foliage.lods[0];
    stats[`${name}/${id}`] = { level: name, density: d, id, instances: L0.instances, triangles: L0.triangles, instanceBytes: L0.sets.reduce((a, s) => a + s.data.byteLength, 0),
      lod1: { instances: b.foliage.lods[1].instances, triangles: b.foliage.lods[1].triangles }, leaves: b.foliage.stats.leaves, shoots: b.foliage.stats.shoots, overdrawEye: od };
  }
}
if (lab.setDensity) await lab.setDensity(1);
out['density-stats.json'] = stats;
return out;
