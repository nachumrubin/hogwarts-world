// LOD selection over a square quadtree. Pure logic: no GPU, no workers, used by the streamer and by tests.
//
// Per frame, select(camera) produces:
//   leaves    the nodes to draw, each with
//               coarser  edge bits whose neighbour is one level coarser (→ stitched index buffer)
//               finer    edge bits whose neighbour is finer (→ the shader locks morphing on that edge)
//   requests  nodes that should be generated, with a priority (lower = sooner)
//
// Rules:
//   - a node wants to split when the camera is within lodFactor · size of its 3D bounds
//   - it is refined only if all four children are resident (generated + uploaded); otherwise it is drawn itself,
//     so the drawn set always covers the whole root without holes
//   - 2:1 balance: a leaf whose neighbour is ≥ 2 levels coarser forces that neighbour to split (if its children are
//     resident; children of a node split this way are beyond its morph range, so they appear fully morphed = no pop).
//     Only if they are not resident does the finer side collapse into its parent instead. Repeated until stable.
//
// Node key = (depth · 2^16 + ix) · 2^16 + iz  (exact in a double for depth ≤ 16).

import { WORLD, PREFETCH, BOUNDS_PAD_FRACTION, BOUNDS_PAD_MIN, morphStartFor } from '../config.js';
import { EDGE_Z0, EDGE_X1, EDGE_Z1, EDGE_X0 } from './index-patterns.js';

export const nodeKey = (d, ix, iz) => (d * 65536 + ix) * 65536 + iz;
export const keyDepth = (k) => Math.floor(k / 4294967296);
export const keyIx = (k) => Math.floor(k / 65536) % 65536;
export const keyIz = (k) => k % 65536;

const SIDES = [[0, -1, EDGE_Z0], [1, 0, EDGE_X1], [0, 1, EDGE_Z1], [-1, 0, EDGE_X0]];
const GLOBAL_MIN_Y = 150, GLOBAL_MAX_Y = 1800;

export class TerrainQuadtree {
  /**
   * @param {object} o
   * @param {number} o.lodFactor
   * @param {(key:number)=>boolean} o.isResident
   * @param {(key:number)=>(null|{minY:number,maxY:number})} o.boundsOf  known vertical bounds of a node, if generated
   */
  constructor({ lodFactor, isResident, boundsOf, rootSize = WORLD.rootSize, maxDepth = WORLD.maxDepth, rootMinX = WORLD.rootMinX, rootMinZ = WORLD.rootMinZ }) {
    this.rootSize = rootSize; this.maxDepth = maxDepth; this.lodFactor = lodFactor; this.rootMinX = rootMinX; this.rootMinZ = rootMinZ;
    this.morphStart = morphStartFor(lodFactor);
    this.isResident = isResident; this.boundsOf = boundsOf;
    this.forced = new Set(); // nodes forced to stay leaves
    this.forcedSplit = new Set(); // nodes forced to split for balance
    this.internal = new Set();
    this.leafSet = new Set();
    this.leaves = [];
    this.requests = new Map(); // key → priority
    this._pool = [];
    this.iterations = 0;
  }

  splitRange(depth) { return this.lodFactor * this.rootSize / 2 ** depth; }

  /** Distance where a node at `depth` gets replaced by its parent: the morph range of its vertices. */
  morphRange(depth) { return depth === 0 ? Infinity : this.splitRange(depth - 1); }

  /** Vertical bounds of a node: own if known, else nearest known ancestor's, else global. Padded. */
  bounds(d, ix, iz, out) {
    let dd = d, x = ix, z = iz, b = null;
    while (dd >= 0) { b = this.boundsOf(nodeKey(dd, x, z)); if (b) break; dd--; x >>= 1; z >>= 1; }
    const size = this.rootSize / 2 ** d, pad = Math.max(BOUNDS_PAD_MIN, size * BOUNDS_PAD_FRACTION);
    out[0] = b ? b.minY - pad : GLOBAL_MIN_Y; out[1] = b ? b.maxY + pad : GLOBAL_MAX_Y;
    return out;
  }

  /** Distance from point to a node's padded 3D box. */
  distance(d, ix, iz, cx, cy, cz) {
    const size = this.rootSize / 2 ** d, x0 = this.rootMinX + ix * size, z0 = this.rootMinZ + iz * size;
    const yb = this.bounds(d, ix, iz, this._yb || (this._yb = [0, 0]));
    const dx = cx < x0 ? x0 - cx : cx > x0 + size ? cx - x0 - size : 0;
    const dz = cz < z0 ? z0 - cz : cz > z0 + size ? cz - z0 - size : 0;
    const dy = cy < yb[0] ? yb[0] - cy : cy > yb[1] ? cy - yb[1] : 0;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /** Run selection for a camera position (world metres). Results in this.leaves / this.requests. */
  select(cx, cy, cz) {
    this.requests.clear();
    this.forced.clear(); this.forcedSplit.clear();
    let i = 0;
    for (; i < 40; i++) {
      this._collect(cx, cy, cz, i === 0);
      if (!this._balance()) break;
    }
    this.iterations = i + 1;
    this._edges();
    return this.leaves;
  }

  _collect(cx, cy, cz, gatherRequests) {
    for (const l of this.leaves) this._pool.push(l);
    this.leaves.length = 0;
    this.internal.clear(); this.leafSet.clear();
    // iterative DFS: stack of [d, ix, iz]
    const stack = this._stack || (this._stack = []);
    stack.length = 0; stack.push(0, 0, 0);
    while (stack.length) {
      const iz = stack.pop(), ix = stack.pop(), d = stack.pop();
      const key = nodeKey(d, ix, iz);
      let refine = false;
      if (d < this.maxDepth) {
        const dist = this.distance(d, ix, iz, cx, cy, cz), range = this.splitRange(d);
        const want = dist < range;
        if (gatherRequests && dist < range * PREFETCH) {
          const pri = (want ? 0 : 1000) + dist / (this.rootSize / 2 ** (d + 1));
          for (let c = 0; c < 4; c++) {
            const ck = nodeKey(d + 1, ix * 2 + (c & 1), iz * 2 + (c >> 1));
            if (!this.isResident(ck)) { const p = this.requests.get(ck); if (p === undefined || pri < p) this.requests.set(ck, pri); }
          }
        }
        if ((want || this.forcedSplit.has(key)) && !this.forced.has(key)) {
          refine = true;
          for (let c = 0; c < 4 && refine; c++) refine = this.isResident(nodeKey(d + 1, ix * 2 + (c & 1), iz * 2 + (c >> 1)));
        }
      }
      if (refine) {
        this.internal.add(key);
        for (let c = 3; c >= 0; c--) stack.push(d + 1, ix * 2 + (c & 1), iz * 2 + (c >> 1));
      } else {
        const leaf = this._pool.pop() || { key: 0, depth: 0, ix: 0, iz: 0, coarser: 0, finer: 0 };
        leaf.key = key; leaf.depth = d; leaf.ix = ix; leaf.iz = iz; leaf.coarser = 0; leaf.finer = 0;
        this.leaves.push(leaf); this.leafSet.add(key);
      }
    }
  }

  /** Depth of the drawn leaf covering the same-depth neighbour slot, or −1 if finer (internal), or −2 if outside the root. */
  neighbourDepth(d, ix, iz) {
    const n = 2 ** d;
    if (ix < 0 || iz < 0 || ix >= n || iz >= n) return -2;
    if (this.internal.has(nodeKey(d, ix, iz))) return -1;
    for (let dd = d, x = ix, z = iz; dd >= 0; dd--, x >>= 1, z >>= 1) if (this.leafSet.has(nodeKey(dd, x, z))) return dd;
    return -2; // unreachable when the tree is consistent
  }

  _balance() {
    let changed = false;
    for (const l of this.leaves) {
      if (l.depth < 2) continue;
      for (const [dx, dz] of SIDES) {
        const nx = l.ix + dx, nz = l.iz + dz, nd = this.neighbourDepth(l.depth, nx, nz);
        if (nd >= 0 && l.depth - nd >= 2) {
          const sh = l.depth - nd, cx = nx >> sh, cz = nz >> sh, ck = nodeKey(nd, cx, cz);
          let resident = true;
          for (let c = 0; c < 4; c++) {
            const k = nodeKey(nd + 1, cx * 2 + (c & 1), cz * 2 + (c >> 1));
            if (!this.isResident(k)) { resident = false; if (!this.requests.has(k)) this.requests.set(k, 0.5); }
          }
          const canSplit = resident && !this.forced.has(ck);
          if (canSplit && !this.forcedSplit.has(ck)) { this.forcedSplit.add(ck); changed = true; }
          else if (!canSplit) {
            const pk = nodeKey(l.depth - 1, l.ix >> 1, l.iz >> 1);
            if (!this.forced.has(pk)) { this.forced.add(pk); changed = true; }
          }
          break;
        }
      }
    }
    return changed;
  }

  _edges() {
    for (const l of this.leaves) {
      for (const [dx, dz, bit] of SIDES) {
        const nd = this.neighbourDepth(l.depth, l.ix + dx, l.iz + dz);
        if (nd === -1) l.finer |= bit;
        else if (nd >= 0 && nd < l.depth) l.coarser |= bit;
      }
    }
  }

  /** True if every drawn leaf differs by at most one level from each neighbour (tests). */
  isBalanced() {
    for (const l of this.leaves) for (const [dx, dz] of SIDES) {
      const nd = this.neighbourDepth(l.depth, l.ix + dx, l.iz + dz);
      if (nd >= 0 && l.depth - nd > 1) return false;
    }
    return true;
  }
}
