// Continuous LOD-transition recordings (§5): a scripted camera through a woodland stand with the live view's LOD
// machinery (projected size, hysteresis, dithered cross-fades) advanced by the frame time. Frames are returned as JPEG;
// tools/lod_video.py labels them and encodes MP4. window.__args: { kind: 'ground' | 'aerial', fps, w, h }
const lab = window.__lab, out = {}, a = window.__args || {};
const kind = a.kind || 'ground', fps = a.fps || 12, W = a.w || 640, H = a.h || 360, dt = 1 / fps;
const n = a.stand || 12;   // the 50-tree stand at 1080p LOD took ~4 min a frame on SwiftShader
await lab.ensureImpostors(['oak-a', 'oak-b', 'oak-c', 'pine', 'birch']);
await lab.standOf(n); lab.setEnv(true); lab.setLight('day'); lab.setMode('lit');
lab.scene.pinned = true; lab.scene.resetTransitions();
const lerp = (p, q, t) => p.map((v, i) => v + (q[i] - v) * t);
const ease = (t) => t * t * (3 - 2 * t);
// segments: [seconds, (t 0…1) => { eye, target, label }]
const T = lab.store.get('oak-b').built.bounds.max[1];
const segs = kind === 'ground' ? [
  // LOD thresholds are evaluated as on a 1080p screen (policyH): Oak B switches LOD0/LOD1 at ~36 m (±12 %)
  [6, (t) => ({ eye: [0, 1.7, 45 - 14 * t], target: [0, 9, 0], label: 'walking towards Oak B, 2.3 m/s' })],
  [6, (t) => ({ eye: [0, 1.7, 31 + 14 * t], target: [0, 9, 0], label: 'walking away, 2.3 m/s' })],
  [4, (t) => { const az = t * 0.6; return { eye: [Math.sin(az) * 45, 1.7, Math.cos(az) * 45], target: [0, 9, 0], label: 'orbiting Oak B at 45 m' }; }],
  [4, (t) => ({ eye: [21, 1.7, 41 + 160 * ease(t)], target: [0, 8, 0], label: 'moving out through the stand, up to 60 m/s' })],
  [4, (t) => ({ eye: [21, 1.7, 201 - 160 * ease(t)], target: [0, 8, 0], label: 'moving back in' })],
] : [
  [6, (t) => ({ eye: [10, 15 + 105 * ease(t), 70], target: [0, 5, 0], label: 'vertical ascent from 15 m to 120 m' })],
  [6, (t) => ({ eye: [-110 + 180 * t, 60, 60], target: [-70 + 180 * t, 10, -30], label: 'broom flight at 60 m, 30 m/s' })],
  [6, (t) => ({ eye: [-80 + 160 * t, 35, 0], target: [-50 + 160 * t, 0, 0], label: 'directly above the canopy, 35 m, 27 m/s' })],
  [6, (t) => ({ eye: [10, 120 - 105 * ease(t), 70], target: [0, 5, 0], label: 'vertical descent to 15 m' })],
];
const frames = [];
let k = 0;
const limit = a.seconds ? Math.round(a.seconds * fps) : Infinity;
for (const [sec, f] of segs) {
  if (k >= limit) break;
  const N = Math.round(sec * fps);
  for (let j = 0; j < N && k < limit; j++, k++) {
    const { eye, target, label } = f(j / N);
    const vp = lab.lodStep(eye, target, W, H, dt, a.policyH || 1080);
    const png = await lab.frame(eye, target, vp, W, H);
    const bmp = await createImageBitmap(png); const c = new OffscreenCanvas(W, H); c.getContext('2d').drawImage(bmp, 0, 0);
    await window.__emit(`video-${kind}/f${String(k).padStart(4, '0')}.jpg`, await window.__b64(await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })));
    frames.push({ k, t: k * dt, label, lod: [...lab.scene.lodCounts], fading: lab.scene.fading });
    if (k % 10 === 0) await window.__emit(`video-${kind}/frames.json`, { fps, w: W, h: H, frames });
  }
}
lab.scene.pinned = false;
out[`video-${kind}/frames.json`] = { fps, w: W, h: H, frames };
return out;
