// dev tool: grow the Oak B configuration over a range of seeds and report crown balance (choose a growth history)
import { growOak, OAK_B } from '../src/species/oak.ts';
const [a, b] = (process.env.SEEDS || '2200-2215').split('-').map(Number);
for (let seed = a; seed <= b; seed++) {
  const { sk } = growOak({ ...OAK_B, seed });
  const w = sk.nodes.filter((n) => !n.root);
  const ext = (k: number) => Math.max(...w.map((n) => n.p[k])) - Math.min(...w.map((n) => n.p[k]));
  const cx = w.reduce((s, n) => s + n.p[0] * n.r * n.r, 0) / w.reduce((s, n) => s + n.r * n.r, 0);
  const cz = w.reduce((s, n) => s + n.p[2] * n.r * n.r, 0) / w.reduce((s, n) => s + n.r * n.r, 0);
  const H = Math.max(...w.map((n) => n.p[1]));
  console.log(seed, `H ${H.toFixed(1)} X ${ext(0).toFixed(1)} Z ${ext(2).toFixed(1)} ratio ${(Math.min(ext(0), ext(2)) / Math.max(ext(0), ext(2))).toFixed(2)} wood-centroid offset ${Math.hypot(cx, cz).toFixed(2)} m`);
}
