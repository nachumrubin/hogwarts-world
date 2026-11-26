// Rendering-efficiency evaluation (§4): hull-fitted vs full-quad cards (rasterized fragments, wasted fraction),
// coverage-preserving alpha mips vs none vs the Phase 4 heuristic (crown fill at distance, from silhouettes), and
// instance memory packed vs float. Software adapter: fragment counts and memory are exact; timings are not GPU timings.
const lab = window.__lab, v = lab.viewer, out = {}, res = { cards: {}, alpha: {}, memory: {} };
const ids = ['oak-b', 'pine', 'birch'];
const reup = () => { for (const id of ids) { const e = lab.store.get(id); for (const g of Object.values(e.gpuFolRep ?? {})) v.destroyFoliage(g); e.gpuFolRep = undefined; } };
for (const id of ids) {
  await lab.select(id, 'three'); lab.setEnv(false);
  const bb = lab.store.get(id).built.bounds, Ht = bb.max[1];
  const t = [(bb.min[0] + bb.max[0]) / 2, Ht * 0.5, (bb.min[2] + bb.max[2]) / 2];
  const k = 900 / (2 * Math.tan((45 * Math.PI) / 360));
  const orbitPx = (px) => ({ target: t, az: 0.6, el: 0.12, dist: (Ht / px) * k });
  // 1. card boundaries
  res.cards[id] = {};
  for (const hull of [false, true]) {
    v.hullCards = hull; reup();
    for (const lod of [0, 1, 2]) {
      let od = {};
      await lab.shoot('three', 'lit', { width: 1200, height: 900, light: 'day', lod, orbit: orbitPx([700, 240, 110][lod] * 1.6), overdraw: (r) => { od = r; } });
      res.cards[id][`lod${lod}-${hull ? 'hull' : 'quad'}`] = { rasterizedPerFoliagePixel: od.rasterized, shadedFraction: od.shadedFraction, fragments: od.fragments, foliageCoverage: od.foliageCoverage };
    }
  }
  v.hullCards = true; reup();
  // 2. alpha coverage at distance: crown fill from silhouettes, tree 700 / 160 / 60 px tall
  const configs = [['none', false, 0, 0], ['phase4-heuristic', false, 0.22, 1.5], ['preserved', true, 0, 0], ['chosen', true, 0.15, 0.5]];
  for (const [name, preserve, bl, bn] of configs) {
    if (v.alphaCoverage !== preserve) { v.alphaCoverage = preserve; await v.loadFoliage('textures/', ''); }
    v.alphaBoost = { leaf: bl, needle: bn };
    for (const px of [700, 160, 60]) out[`alpha/${id}-${name}-${px}.png`] = await window.__b64(await lab.shoot('three', 'silhouette', { width: 900, height: 900, lod: 0, orbit: orbitPx(px) }));
  }
  v.alphaCoverage = true; await v.loadFoliage('textures/', ''); v.alphaBoost = { leaf: 0.15, needle: 0.5 };
  // 3. memory
  const f = lab.store.get(id).built.foliage;
  res.memory[id] = f.lods.map((l) => ({ instances: l.instances, packedBytes: l.sets.reduce((a, s) => a + s.data.byteLength, 0), floatBytes: l.instances * 64 }));
}
out['efficiency.json'] = res;
return out;
