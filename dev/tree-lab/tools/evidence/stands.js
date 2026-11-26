// Woodland stands (12, 50, 200 trees) from the ground (1.7 m) and from broom-flight altitude (80 m), with the
// projected-size LOD mix; then a short headless benchmark pass to check the benchmark itself and its JSON (on a
// software adapter these timings are not GPU performance).
const lab = window.__lab, out = {}, W = 1200, H = 800, stats = [];
for (const n of [12, 50, 200]) {
  await lab.standOf(n); lab.setEnv(true); lab.scene.pinned = true;
  for (const cam of ['ground', 'aerial']) {
    const c = lab.benchCamera(`stand${n}`, cam);
    const d = [c.eye[0] - c.target[0], c.eye[1] - c.target[1], c.eye[2] - c.target[2]], L = Math.hypot(...d);
    lab.scene.eye = c.eye; lab.scene.lodPolicy.screenH = H; lab.scene.cullVP = null;
    let od = {};
    out[`stands/stand${n}-${cam}.png`] = await window.__b64(await lab.shoot('three', 'lit', { width: W, height: H, light: 'day', orbit: { target: c.target, az: Math.atan2(d[0], d[2]), el: Math.asin(d[1] / L), dist: L }, overdraw: (r) => { od = r; } }));
    lab.scene.apply(0);
    const dr = lab.viewer.draws;
    stats.push({ stand: n, camera: cam, eye: c.eye, lod: { lod0: lab.scene.lodCounts[0], lod1: lab.scene.lodCounts[1], lod2: lab.scene.lodCounts[2], impostor: lab.scene.lodCounts[3] },
      foliageInstances: dr.reduce((a, x) => a + (x.foliage?.instances ?? 0), 0) + lab.impostors.count, foliageTriangles: dr.reduce((a, x) => a + (x.foliage?.triangles ?? 0), 0) + 2 * lab.impostors.count,
      barkTriangles: dr.reduce((a, x) => a + (x.kind === 0 ? x.mesh.triangles : 0), 0), overdraw: od });
  }
}
lab.scene.eye = null; lab.scene.pinned = false;
out['stands/stand-stats.json'] = stats;
const bench = [];
for (const [scene, camera] of [['oak-b', 'ground'], ['stand200', 'ground'], ['stand200', 'aerial']]) bench.push(await lab.bench({ scene, camera, width: 1280, height: 720, shadow: 2048, frames: 3 }));
out['stands/bench-headless-swiftshader.json'] = bench;
return out;
