// Impostor proof of concept (§6) and LOD transitions: for oak B, the pine and the birch, the geometry (LOD1 spray
// cards, LOD0 leaves) beside the impostor at eye level, elevated, steep and overhead angles; an azimuth sweep
// (frame blending, no billboard turning); and both sides of every LOD switch at its projected-size threshold.
const lab = window.__lab, out = {}, stats = {};
const ids = (window.__args && window.__args.ids) || ['oak-b', 'pine', 'birch'];
const keepPx = [...lab.scene.lodPolicy.px];
const force = (l) => { lab.scene.lodPolicy.px = l === 0 ? [0, 0, 0] : l === 1 ? [1e9, 0, 0] : l === 2 ? [1e9, 1e9, 0] : [1e9, 1e9, 1e9]; };
for (const id of ids) {
  await lab.ensureImpostors([id]);
  await lab.select(id, 'three'); lab.setEnv(false);
  lab.scene.custom = [{ id, x: 0, z: 0, yaw: 0 }]; lab.scene.standN = 1; lab.scene.pinned = true; lab.scene.cullVP = null; lab.scene.set([], 0, true);
  const bb = lab.store.get(id).built.bounds, Ht = bb.max[1], S = Math.max(Ht, bb.max[0] - bb.min[0], bb.max[2] - bb.min[2]);
  const t = [(bb.min[0] + bb.max[0]) / 2, Ht * 0.5, (bb.min[2] + bb.max[2]) / 2];
  const at = (az, el, dist) => ({ target: t, az, el, dist });
  const eyeOf = (o) => [o.target[0] + Math.sin(o.az) * Math.cos(o.el) * o.dist, o.target[1] + Math.sin(o.el) * o.dist, o.target[2] + Math.cos(o.az) * Math.cos(o.el) * o.dist];
  const shot = async (name, o, l, W = 420, H = 420) => { lab.scene.eye = eyeOf(o); force(l); out[name] = await window.__b64(await lab.shoot('three', 'lit', { width: W, height: H, light: 'day', orbit: o })); };
  // angles: geometry (LOD1) vs impostor
  for (const [tag, el] of [['eye', 0.04], ['elevated', 0.5], ['steep', 1.0], ['overhead', 1.45]]) {
    await shot(`impostor/${id}-${tag}-lod1.png`, at(0.6, el, 1.7 * S), 1);
    await shot(`impostor/${id}-${tag}-impostor.png`, at(0.6, el, 1.7 * S), 3);
  }
  // azimuth sweep, 6° apart, elevated (broom flight)
  for (let k = 0; k < 6; k++) await shot(`impostor/${id}-sweep-${k}.png`, at(0.6 + k * 0.105, 0.35, 1.7 * S), 3, 300, 300);
  // LOD switches at their thresholds (900 px screen): both sides at the same camera
  const P = keepPx, k = 900 / (2 * Math.tan((45 * Math.PI) / 360));
  for (const [sw, a, b] of [[0, 0, 1], [1, 1, 2], [2, 2, 3]]) {
    const dist = (Ht / P[sw]) * k;
    await shot(`lod/${id}-switch${sw}-lod${a}.png`, at(0.6, 0.12, dist), a, 900, 900);
    await shot(`lod/${id}-switch${sw}-${b === 3 ? 'impostor' : 'lod' + b}.png`, at(0.6, 0.12, dist), b, 900, 900);
  }
  stats[id] = lab.impostors.specs.get(id);
}
lab.scene.lodPolicy.px = keepPx; lab.scene.custom = null; lab.scene.eye = null; lab.scene.pinned = false;
out['impostor/impostor-stats.json'] = { specs: stats, atlas: { frames: '9 × 9 hemi-octahedral', framePx: 112, atlasPx: 1008, bytesAllSpecies: lab.impostors.bytes } };
return out;
