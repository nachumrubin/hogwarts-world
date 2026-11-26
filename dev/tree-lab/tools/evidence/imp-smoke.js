// quick check: impostor bake for oak-b, and the 200-tree stand from the ground and the air
const lab = window.__lab, out = {};
await lab.ensureImpostors(['oak-b']);
const shot = async (name, eye, target, W = 960, H = 640) => {
  const d = [eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]], L = Math.hypot(...d);
  out[name] = await window.__b64(await lab.shoot('three', 'lit', { width: W, height: H, light: 'day', orbit: { target, az: Math.atan2(d[0], d[2]), el: Math.asin(d[1] / L), dist: L } }));
};
await lab.standOf(200); lab.setEnv(true);
for (const cam of ['ground', 'aerial']) {
  const c = lab.benchCamera('stand200', cam);
  lab.scene.eye = c.eye; lab.scene.lodPolicy.screenH = 640;
  lab.scene.cullVP = null; lab.scene.apply(0);
  out[`stand200-${cam}.png`] = null;
  await shot(`stand200-${cam}.png`, c.eye, c.target);
  out[`stand200-${cam}.json`] = { lod: lab.scene.lodCounts, foliageBytes: lab.viewer.foliageBytes };
}
return out;
