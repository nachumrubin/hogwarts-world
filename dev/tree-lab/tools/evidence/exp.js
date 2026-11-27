// Phase 4.4 isolated experiments: one LOD (default LOD1) of one specimen at a boundary's switch size, for a list of
// views ([tag, elevation rad, azimuth rad]) and a list of viewer settings ({ name, ex, alphaBoost, ... }), lit and
// silhouette, named like lodcheck.js (`<id>-b<boundary>-<tag>-<name>.png`), so they pair with lodcheck renders of the
// other side. window.__args: { id, boundary, lod, views, configs }
const lab = window.__lab, a = window.__args || {};
const id = a.id || 'pine', sw = a.boundary ?? 0, lod = a.lod ?? 1, S = 900;
const views = a.views || [['e0@2.7', 0.0, 2.7], ['eye', 0.12, 0.6], ['over', 1.45, 0.6]];
const keepPx = [...lab.scene.lodPolicy.px], P = keepPx;
const keep = { ex: [...lab.viewer.ex], ey: [...lab.viewer.ey], alphaBoost: { ...lab.viewer.alphaBoost }, cardAreaCorrection: lab.viewer.cardAreaCorrection, cardShadowOffset: lab.viewer.cardShadowOffset };
lab.setLight('day');
if (lod === 3) await lab.ensureImpostors([id]);
await lab.select(id, 'three'); lab.setEnv(false);
lab.scene.custom = [{ id, x: 0, z: 0, yaw: 0 }]; lab.scene.standN = 1; lab.scene.pinned = true; lab.scene.cullVP = null; lab.scene.set([], 0, true);
lab.scene.lodPolicy.px = lod === 0 ? [0, 0, 0] : lod === 1 ? [1e9, 0, 0] : lod === 2 ? [1e9, 1e9, 0] : [1e9, 1e9, 1e9];
const bb = lab.store.get(id).built.bounds, Ht = bb.max[1];
const t = [(bb.min[0] + bb.max[0]) / 2, Ht * 0.5, (bb.min[2] + bb.max[2]) / 2];
const k = S / (2 * Math.tan((45 * Math.PI) / 360)), dist = (Ht / P[sw]) * k;
for (const c of a.configs || [{ name: 'base' }]) {
  Object.assign(lab.viewer, { ex: c.ex ? [...c.ex] : [...keep.ex], ey: c.ey ? [...c.ey] : [...keep.ey], alphaBoost: { ...keep.alphaBoost, ...(c.alphaBoost || {}) }, cardAreaCorrection: c.cardAreaCorrection ?? keep.cardAreaCorrection, cardShadowOffset: c.cardShadowOffset ?? keep.cardShadowOffset });
  for (const [tag, el, az] of views) {
    const o = { target: t, az, el, dist };
    lab.scene.eye = [t[0] + Math.sin(az) * Math.cos(el) * dist, t[1] + Math.sin(el) * dist, t[2] + Math.cos(az) * Math.cos(el) * dist];
    if (c.diag) lab.viewer.diag = c.diag;
    window.__emit(`exp/${id}-b${sw}-${tag}-${c.name}.png`, await window.__b64(await lab.shoot('three', 'lit', { width: S, height: S, light: 'day', orbit: o })));
    lab.viewer.diag = 0;
    if (!c.noSil) window.__emit(`exp/${id}-b${sw}-${tag}-${c.name}-sil.png`, await window.__b64(await lab.shoot('three', 'silhouette', { width: S, height: S, orbit: o })));
  }
}
Object.assign(lab.viewer, keep);
lab.scene.lodPolicy.px = keepPx; lab.scene.custom = null; lab.scene.eye = null; lab.scene.pinned = false;
return {};
