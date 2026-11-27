// LOD consistency check: for each specimen and each LOD boundary, both sides rendered at the boundary's projected size
// with the same camera, lit and as silhouettes (tools/lod_metrics.py measures coverage, overlap, luminance, colour).
// window.__args: { ids, scale (screen = 900 × scale), boundaries, angles ([tag, elevation rad]), azs (azimuths, rad;
// names carry the azimuth unless it is the protocol's 0.6), light, noShadow }
const lab = window.__lab, out = {}, a = window.__args || {};
const ids = a.ids || ['oak-a', 'oak-b', 'oak-c', 'pine', 'birch'];
const S = Math.round(900 * (a.scale || 1));
const keepPx = [...lab.scene.lodPolicy.px];
const P = a.px || keepPx;
const force = (l) => { lab.scene.lodPolicy.px = l === 0 ? [0, 0, 0] : l === 1 ? [1e9, 0, 0] : l === 2 ? [1e9, 1e9, 0] : [1e9, 1e9, 1e9]; };
const bounds = a.boundaries || [[0, 0, 1], [1, 1, 2], [2, 2, 3]];
const stats = {};
const LT = a.light || 'day'; lab.setLight(LT); const keepSh = lab.viewer.light.shadow; if (a.noShadow) lab.viewer.light.shadow = 0;
for (const id of ids) {
  if (bounds.some((b) => b[2] === 3)) await lab.ensureImpostors([id]);
  await lab.select(id, 'three'); lab.setEnv(false);
  lab.scene.custom = [{ id, x: 0, z: 0, yaw: 0 }]; lab.scene.standN = 1; lab.scene.pinned = true; lab.scene.cullVP = null; lab.scene.set([], 0, true);
  const bb = lab.store.get(id).built.bounds, Ht = bb.max[1];
  const t = [(bb.min[0] + bb.max[0]) / 2, Ht * 0.5, (bb.min[2] + bb.max[2]) / 2];
  const k = S / (2 * Math.tan((45 * Math.PI) / 360));
  for (const [sw, lo, hi] of bounds) {
    const px = P[sw] * S / 900, dist = (Ht / px) * k;
    for (const az of (a.azs || [0.6])) for (const [tag0, el] of (a.angles || [['eye', 0.12]])) {
      const tag = az === 0.6 ? tag0 : `${tag0}@${az.toFixed(1)}`;
      const o = { target: t, az, el, dist };
      lab.scene.eye = [t[0] + Math.sin(az) * Math.cos(el) * dist, t[1] + Math.sin(el) * dist, t[2] + Math.cos(az) * Math.cos(el) * dist];
      for (const l of [lo, hi]) {
        force(l);
        const name = `${id}-b${sw}-${tag}-${l === 3 ? 'imp' : 'lod' + l}`;
        let od = {};
        const shot = await window.__b64(await lab.shoot('three', 'lit', { width: S, height: S, light: LT, orbit: o, overdraw: a.noOverdraw ? undefined : (r) => { od = r; } }));
        window.__emit(`lod/${name}.png`, shot);
        window.__emit(`lod/${name}-sil.png`, await window.__b64(await lab.shoot('three', 'silhouette', { width: S, height: S, orbit: o })));
        lab.scene.apply(0);
        const dr = lab.viewer.draws.filter((d) => d.kind === 0);
        stats[name] = { id, boundary: sw, side: l, px: P[sw], foliageInstances: dr.reduce((x, d) => x + (d.foliage?.instances ?? 0), 0) + lab.impostors.count,
          triangles: dr.reduce((x, d) => x + d.mesh.triangles + (d.foliage?.triangles ?? 0), 0) + 2 * lab.impostors.count,
          instanceBytes: dr.reduce((x, d) => x + (d.foliage?.bytes ?? 0), 0) + 32 * lab.impostors.count, overdraw: od };
        window.__emit('lod/lod-stats.json', stats);
      }
    }
  }
}
lab.scene.lodPolicy.px = keepPx; lab.scene.custom = null; lab.scene.eye = null; lab.scene.pinned = false;
lab.viewer.light.shadow = keepSh;
out['lod/lod-stats.json'] = stats;
return out;
