// Per-tree LOD selection with hysteresis and cross-fades (stand mode). Pure: no GPU, no DOM, so it is unit-tested
// (tests/treelab-lod.test.ts).
export interface LodState { lod: number; prev: number; t: number }

/** Base LOD for a projected crown height `px` (screen pixels) and thresholds `P` (LOD0, LOD1, LOD2 above them; below
 *  the last, the impostor when there is one, LOD2 otherwise). */
export function baseLod(px: number, P: readonly number[], hasImp: boolean): number {
  return px >= P[0] ? 0 : px >= P[1] ? 1 : px >= P[2] ? 2 : hasImp ? 3 : 2;
}

/** One step of a tree's LOD state. `h`: hysteresis (share of each threshold); `dt` (s): cross-fade over `fade` seconds,
 *  undefined: switch at once (still shots). Returns the new state (the input is not modified).
 *  A reversal mid-fade (back to the LOD being faded out) continues from the current blend instead of restarting it,
 *  and a change to a third LOD mid-fade fades out whichever side was showing more. */
export function stepLod(px: number, P: readonly number[], h: number, hasImp: boolean, st: LodState | undefined, dt: number | undefined, fade: number): LodState {
  let l = baseLod(px, P, hasImp);
  if (!st) return { lod: l, prev: -1, t: 1 };
  if (l !== st.lod) {
    // hysteresis: move to finer detail only once past the threshold by h, to coarser only once below it by h
    const t2 = l < st.lod ? baseLod(px / (1 + h), P, hasImp) : baseLod(px / (1 - h), P, hasImp);
    l = l < st.lod ? Math.min(st.lod, t2) : Math.max(st.lod, t2);
  }
  if (l !== st.lod) {
    if (dt === undefined) return { lod: l, prev: st.lod, t: 1 };
    const midFade = st.t < 1 && st.prev >= 0;
    if (midFade && l === st.prev) return { lod: l, prev: st.lod, t: 1 - st.t };          // reversal: same blend
    if (midFade) return { lod: l, prev: st.t >= 0.5 ? st.lod : st.prev, t: 0 };           // a third LOD
    return { lod: l, prev: st.lod, t: 0 };
  }
  if (st.t < 1) return { lod: l, prev: st.prev, t: dt === undefined ? 1 : Math.min(1, st.t + dt / fade) };
  return st;
}

/** Whether an impostor instance [x, y, z, yaw, layer, scale, fade, outgoing] casts its shadow: during a cross-fade
 *  only the side with more weight casts (outgoing until halfway, incoming from halfway). */
export function impostorCasts(t: readonly number[]): boolean {
  return t[7] ? (t[6] ?? 1) < 0.5 : (t[6] ?? 1) >= 0.5;
}
