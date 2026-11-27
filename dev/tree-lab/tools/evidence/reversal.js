// Phase 4.4 transition test: a deterministic camera path that crosses an LOD boundary and reverses mid-fade.
// One tree (stand mode, LOD from projected size as on a 1080p screen, live hysteresis and cross-fades) at 60 frames
// a second: the camera recedes at broom speed until the tree starts fading LOD0 → LOD1 (or LOD1 → impostor), keeps
// going for `after` seconds, then comes back at the same speed, so the base LOD reverses before the fade finishes.
// Per frame: each representation's visible weight (incoming: fade, outgoing: 1 − fade), which one casts the shadow,
// and the shadow cache. Checks: weights sum to 1 and change by at most dt / fade per frame (no pop at the reversal),
// the side with the larger weight casts (exactly one), the cache is flagged whenever the casters change.
// window.__args: { id, boundary (0: LOD0 ↔ LOD1, 1: LOD1 ↔ impostor), speed (m/s), after (s) }
const lab = window.__lab, a = window.__args || {};
const id = a.id || 'oak-b', bnd = a.boundary ?? 0, speed = a.speed ?? 60, after = a.after ?? 0.1, dt = 1 / 60, H = 1080, W = 1920;
if (bnd === 1) await lab.ensureImpostors([id]);
await lab.select(id, 'three');
const sc = lab.scene, v = lab.viewer;
sc.custom = [{ id, x: 0, z: 0, yaw: 0 }]; sc.standN = 1; sc.pinned = true; sc.set([], 0, true); sc.resetTransitions();
const Ht = lab.store.get(id).built.bounds.max[1];
const k = H / (2 * Math.tan((45 * Math.PI) / 360));
const P = sc.lodPolicy.px[bnd === 0 ? 0 : 1];
const distFor = (px) => (Ht / px) * k;
const tgt = [0, Ht * 0.5, 0], dir = [0, 0, 1];
let d = distFor(P * 1.05);                 // just inside the finer LOD
const eyeAt = (dd) => [tgt[0] + dir[0] * dd, tgt[1], tgt[2] + dir[2] * dd];
let impList = [];
const setI = lab.impostors.setInstances.bind(lab.impostors);
lab.impostors.setInstances = (list) => { impList = list; setI(list); };
const ids = new WeakMap(); let nid = 0; const idOf = (o) => (o ? (ids.has(o) ? ids.get(o) : (ids.set(o, ++nid), nid)) : 0);
const casters = () => v.draws.filter((m) => m.kind === 0 && m.castShadow !== false).map((m) => `${idOf(m.mesh)}:${idOf(m.foliage)}`).join('|') + '#' + impList.filter((t) => (t[7] ? t[6] < 0.5 : t[6] >= 0.5)).length;
const lodOfMesh = (m) => { for (const l of [0, 1, 2]) if (lab.store.gpu(v, id, l) === m.mesh) return l; return -1; };
lab.lodStep(eyeAt(d), tgt, W, H, 0, H); v.shadowDirty = false;
let prev = casters();
const frames = []; let phase = 'recede', tStart = -1, t = 0, reversedAt = -1;
for (let f = 0; f < 600; f++) {
  t += dt;
  d += (phase === 'return' ? -1 : 1) * speed * dt;
  lab.lodStep(eyeAt(d), tgt, W, H, dt, H);
  const st = sc.lodState.get(0);
  if (phase === 'recede' && st.t < 1 && st.prev >= 0 && tStart < 0) tStart = t;
  if (phase === 'recede' && tStart >= 0 && t - tStart >= after) { phase = 'return'; reversedAt = t; }
  // visible weights per representation
  const w = {};
  for (const m of v.draws.filter((x) => x.kind === 0)) { const l = lodOfMesh(m); w[l] = (w[l] ?? 0) + (m.fadeOut ? 1 - (m.fade ?? 1) : (m.fade ?? 1)); }
  for (const im of impList) w[3] = (w[3] ?? 0) + (im[7] ? 1 - im[6] : im[6]);
  const cast = [];
  for (const m of v.draws.filter((x) => x.kind === 0 && x.castShadow !== false)) cast.push(lodOfMesh(m));
  for (const im of impList) if (im[7] ? im[6] < 0.5 : im[6] >= 0.5) cast.push(3);
  const c = casters(); const changed = c !== prev; const stale = changed && !v.shadowDirty; prev = c; v.shadowDirty = false;
  const px = (Ht / d) * k;
  frames.push({ t: +t.toFixed(4), px: +px.toFixed(1), phase, lod: st.lod, prev: st.prev, fade: +st.t.toFixed(4), weights: Object.fromEntries(Object.entries(w).map(([l, x]) => [l, +x.toFixed(4)])), casters: cast, casterChange: changed, stale });
  if (phase === 'return' && st.t >= 1 && f > 10 && px > P * 1.3) break;
}
// checks
const maxStep = dt / sc.transition.fade + 1e-4;
let maxJump = 0, sumErr = 0, wrongCaster = 0, stale = 0, reversalSeen = false;
for (let i = 1; i < frames.length; i++) {
  const A = frames[i - 1].weights, B = frames[i].weights;
  for (const l of new Set([...Object.keys(A), ...Object.keys(B)])) maxJump = Math.max(maxJump, Math.abs((B[l] ?? 0) - (A[l] ?? 0)));
}
for (const fr of frames) {
  const s = Object.values(fr.weights).reduce((x, y) => x + y, 0); sumErr = Math.max(sumErr, Math.abs(s - 1));
  const top = Object.entries(fr.weights).sort((x, y) => y[1] - x[1])[0];
  if (fr.casters.length !== 1 || (Object.keys(fr.weights).length > 1 && String(fr.casters[0]) !== top[0] && Math.abs(top[1] - 0.5) > 1e-6)) wrongCaster++;
  if (fr.stale) stale++;
}
// a reversal mid-fade: the LOD changes back to the one being faded out while the fade is still running
let reversalAt = -1;
for (let i = 1; i < frames.length; i++) { const p0 = frames[i - 1], p1 = frames[i]; if (p0.fade < 1 && p0.prev >= 0 && p1.lod === p0.prev && p1.prev === p0.lod) { reversalSeen = true; reversalAt = p1.t; break; } }
lab.impostors.setInstances = setI; sc.custom = null; sc.pinned = false;
const res = { id, boundary: bnd === 0 ? 'LOD0 ↔ LOD1' : 'LOD1 ↔ impostor', speed, fadeS: sc.transition.fade, fadeStartedAt: tStart, reversedAt, frames: frames.length,
  checks: { reversalMidFade: reversalSeen, reversalAtS: reversalAt, maxWeightStep: +maxJump.toFixed(4), allowedStep: +maxStep.toFixed(4), continuous: maxJump <= maxStep, weightSumMaxError: +sumErr.toFixed(6), wrongCasterFrames: wrongCaster, staleShadowFrames: stale }, trace: frames };
return { [`reversal/${id}-b${bnd}.json`]: res };
