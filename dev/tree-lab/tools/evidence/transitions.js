// Phase 4.3 transition validation (numbers, not video): scripted camera paths through a stand, stepped at 30 frames a
// second with the live LOD machinery (lodStep: projected size, hysteresis, cross-fades), LODs chosen as on a 1080p
// screen. Per path: LOD switches, reversals (a tree going back within 1 s), oscillating trees, the longest fade,
// simultaneous fades, trees per LOD over time, and the shadow-map cache: after every step the expected casters (draws
// that cast, impostors on their casting side) are compared with the viewer's dirty flag. A stale shadow (casters
// changed, map not flagged) is a bug; a redundant redraw is only wasted work.
// window.__args: { paths (names), stand (12 | 50 | 200), dt, renderChecks (bool) }
const lab = window.__lab, a = window.__args || {};
const dt = a.dt || 1 / 30, H = 1080, W = 1920;
const N = a.stand || 200;
await lab.standOf(N);
const sc = lab.scene, v = lab.viewer;
sc.pinned = true;
// capture the impostor instance lists the scene hands over
let impList = [];
const setI = lab.impostors.setInstances.bind(lab.impostors);
lab.impostors.setInstances = (list) => { impList = list; setI(list); };
const ids = new WeakMap(); let nid = 0; const idOf = (o) => (o ? (ids.has(o) ? ids.get(o) : (ids.set(o, ++nid), nid)) : 0);
const casters = () => v.draws.filter((m) => m.castShadow !== false).map((m) => `${idOf(m.mesh)}:${idOf(m.foliage)}:${m.offset.join(',')}`).join('|') + '#' +
  impList.filter((t) => (t[7] ? t[6] < 0.5 : t[6] >= 0.5)).map((t) => t.slice(0, 5).join(',')).join('|');
const side = N <= 12 ? 80 : Math.sqrt(N) * 12.5;
const lerp = (p, q, t) => p.map((x, k) => x + (q[k] - x) * t);
// camera paths: (t in s) → { eye, target }; duration in s
const P = {
  // walking towards the stand from 220 m and back (1.4 m/s would take minutes: 6 m/s jog, reversal at the end)
  'ground approach and retreat': { T: 60, at: (t) => { const s = t < 30 ? t / 30 : 2 - t / 30; const e = lerp([0, 1.7, side * 0.5 + 220], [0, 1.7, side * 0.5 + 8], s); return { eye: e, target: [0, 6, 0] }; } },
  'vertical ascent and descent': { T: 80, at: (t) => { const s = t < 40 ? t / 40 : 2 - t / 40; return { eye: [side * 0.3, 2 + 400 * s * s, side * 0.5 + 30], target: [0, 0, 0] }; } },
  'low broom flight': { T: 20, at: (t) => ({ eye: lerp([-side, 18, side * 0.2], [side, 18, -side * 0.1], t / 20), target: lerp([-side + 40, 8, side * 0.2], [side + 40, 8, -side * 0.1], t / 20) }) },
  'high forest traversal': { T: 20, at: (t) => ({ eye: lerp([-side * 1.2, 220, side], [side * 1.2, 220, -side], t / 20), target: lerp([-side * 0.6, 0, side * 0.5], [side * 1.6, 0, -side * 1.3], t / 20) }) },
  // aerial path crossing the impostor threshold: a descent from 600 m to 60 m and a climb back, looking down at the stand
  'aerial impostor crossing': { T: 40, at: (t) => { const s = t < 20 ? t / 20 : 2 - t / 20; return { eye: [side * 0.2, 600 - 540 * s, side * 0.6], target: [0, 0, 0] }; } },
  'orbit': { T: 24, at: (t) => { const ang = t * 0.26; return { eye: [Math.sin(ang) * (side * 0.5 + 60), 25, Math.cos(ang) * (side * 0.5 + 60)], target: [0, 8, 0] }; } },
  // rapid reversals: the camera swings back and forth by ±6 m around a point every 0.4 s
  'rapid direction reversals': { T: 12, at: (t) => { const ph = Math.floor(t / 0.4) % 2 ? 1 - (t % 0.4) / 0.4 : (t % 0.4) / 0.4; return { eye: [0, 1.7, side * 0.5 + 40 + 12 * ph - 6], target: [0, 6, 0] }; } },
};
const names = a.paths || Object.keys(P);
const out = {};
for (const name of names) {
  const path = P[name];
  sc.resetTransitions(); impList = [];
  const c0 = path.at(0); lab.lodStep(c0.eye, c0.target, W, H, 0, H); v.shadowDirty = false;
  let prevCast = casters();
  const hist = new Map(); // tree index → [{ t, lod }]
  let stale = 0, redundant = 0, changes = 0, maxFading = 0, frames = 0, maxFadeT = 0;
  const lodSeries = [];
  const fadeStart = new Map();
  for (let t = dt; t <= path.T + 1e-6; t += dt) {
    const c = path.at(t);
    lab.lodStep(c.eye, c.target, W, H, dt, H);
    frames++;
    const cast = casters();
    if (cast !== prevCast) { changes++; if (!v.shadowDirty) stale++; }
    else if (v.shadowDirty) redundant++;
    prevCast = cast; v.shadowDirty = false;   // as if the frame had been rendered
    let fading = 0;
    for (const [idx, st] of sc.lodState) {
      const h = hist.get(idx) || []; if (!h.length || h[h.length - 1].lod !== st.lod) { h.push({ t, lod: st.lod }); hist.set(idx, h); }
      if (st.t < 1 && st.prev >= 0) { fading++; if (!fadeStart.has(idx)) fadeStart.set(idx, t); maxFadeT = Math.max(maxFadeT, t - fadeStart.get(idx)); }
      else fadeStart.delete(idx);
    }
    maxFading = Math.max(maxFading, fading);
    if (frames % 15 === 0) lodSeries.push({ t: +t.toFixed(2), eye: c.eye.map((x) => +x.toFixed(1)), lod: [...sc.lodCounts], fading });
  }
  let switches = 0, reversals = 0, osc = 0; const perTree = [];
  for (const [, h] of hist) {
    const sw = h.length - 1; switches += sw; perTree.push(sw);
    let rv = 0; for (let k = 2; k < h.length; k++) if (h[k].lod === h[k - 2].lod && h[k].t - h[k - 1].t < 1.0) rv++;
    reversals += rv; if (rv > 0) osc++;
  }
  const crossed = new Set(); for (const [, h] of hist) for (let k = 1; k < h.length; k++) crossed.add(`${Math.min(h[k - 1].lod, h[k].lod)}↔${Math.max(h[k - 1].lod, h[k].lod)}`);
  out[name] = { seconds: path.T, frames, trees: sc.placed.length, switches, maxSwitchesPerTree: Math.max(0, ...perTree), reversalsWithin1s: reversals, oscillatingTrees: osc,
    boundariesCrossed: [...crossed], maxSimultaneousFades: maxFading, longestFadeS: +maxFadeT.toFixed(2), fadeS: sc.transition.fade,
    shadow: { casterChanges: changes, staleFrames: stale, redundantRedraws: redundant }, lodOverTime: lodSeries };
  window.__emit(`transitions/${name.replace(/ /g, '-')}.json`, out[name]);
}
// rendered checks of the shadow cache: mid-fade frames rendered with the cached shadow map and with a forced redraw
// must be identical
const checks = [];
if (a.renderChecks) {
  const path = P['aerial impostor crossing'];
  sc.resetTransitions();
  for (let t = 0; t <= 20 && checks.length < 3; t += dt) {
    const c = path.at(t); const vp = lab.lodStep(c.eye, c.target, 320, 180, dt, H);
    if (!sc.fading) continue;
    await lab.frame(c.eye, c.target, vp, 320, 180);   // consumes any pending redraw
    // one more step into the fade: the casters are unchanged unless the fade crosses its halfway point
    const c2 = path.at(t + dt); const vp2 = lab.lodStep(c2.eye, c2.target, 320, 180, dt, H); t += dt;
    const cachedPath = !v.shadowDirty;
    const A = await lab.frame(c2.eye, c2.target, vp2, 320, 180);
    v.shadowDirty = true;
    const B = await lab.frame(c2.eye, c2.target, vp2, 320, 180);
    const ba = new Uint8Array(await A.arrayBuffer()), bb = new Uint8Array(await B.arrayBuffer());
    checks.push({ t: +t.toFixed(2), cachedPath, identicalPng: ba.length === bb.length && ba.every((x, k) => x === bb[k]) });
    window.__emit(`transitions/cache-check-${checks.length}-cached.png`, await window.__b64(A));
    window.__emit(`transitions/cache-check-${checks.length}-redrawn.png`, await window.__b64(B));
    t += 2;
  }
}
lab.impostors.setInstances = setI; sc.pinned = false;
return { 'transitions/summary.json': { dt, screen: `${W}×${H}`, stand: N, policy: sc.lodPolicy.px, transition: sc.transition, paths: Object.fromEntries(Object.entries(out).map(([k, r]) => [k, { ...r, lodOverTime: undefined }])), renderChecks: checks } };
