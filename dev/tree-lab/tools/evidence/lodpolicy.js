// LOD chain A vs B (§3): A = LOD0 → LOD1 → LOD2 clump cards → impostor (switches at 700 / 240 / 110 px projected
// height); B = LOD0 → LOD1 → impostor (700 / 140 px; no clump cards). Per stand and camera: trees per LOD, triangles,
// foliage instances, instance memory, draw calls and rasterized foliage fragments (exact on any adapter; no timings).
const lab = window.__lab, out = {}, W = 960, H = 540;
const policies = { A: [700, 240, 110], B: [700, 140, 140] };
const res = [];
for (const [n, cam] of [[12, 'ground'], [50, 'ground'], [200, 'ground'], [50, 'aerial'], [200, 'aerial']]) {
  await lab.standOf(n); lab.setEnv(true); lab.setLight('day'); lab.scene.pinned = true;
  const c = lab.benchCamera(`stand${n}`, cam);
  for (const [name, px] of Object.entries(policies)) {
    lab.scene.lodPolicy.px = px; lab.scene.resetTransitions();
    const vp = lab.lodStep(c.eye, c.target, W, H, 0);
    const dr = lab.viewer.draws;
    const od = await lab.viewer.measureOverdraw(W, H, vp, c.eye);
    const trees = dr.filter((d) => d.kind === 0);
    res.push({ stand: n, camera: cam, policy: name, lod: [...lab.scene.lodCounts], triangles: trees.reduce((a, d) => a + d.mesh.triangles + (d.foliage?.triangles ?? 0), 0) + 2 * lab.impostors.count,
      foliageInstances: trees.reduce((a, d) => a + (d.foliage?.instances ?? 0), 0) + lab.impostors.count, instanceBytes: trees.reduce((a, d) => a + (d.foliage?.bytes ?? 0), 0) + 32 * lab.impostors.count,
      drawCalls: dr.length + trees.reduce((a, d) => a + (d.foliage?.sets.length ?? 0), 0) + (lab.impostors.count ? 1 : 0) + 1, fragments: od.fragments, rasterizedPerFoliagePixel: od.rasterized, foliageCoverage: od.foliageCoverage });
    if (n === 200) out[`policy/stand${n}-${cam}-${name}.png`] = await window.__b64(await lab.frame(c.eye, c.target, vp, W, H));
  }
}
lab.scene.lodPolicy.px = policies.A; lab.scene.pinned = false;
out['policy/lod-policy.json'] = res;
return out;
