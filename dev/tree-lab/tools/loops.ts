// dev tool: find limbs that double back on themselves (direction reverses within a short arc)
import { SPECIES } from '../src/species/index.ts';
import { sub, norm, dot } from '../src/framework/math.ts';
for (const id of (process.env.TREES || 'oak-a').split(',')) {
  const { sk } = SPECIES.find((s) => s.id === id)!.grow();
  const hits: string[] = [];
  for (const ch of sk.chains()) {
    const ns = ch.attach ? [ch.attach, ...ch.nodes] : ch.nodes;
    if (ns.length < 4 || ns[1].r < 0.06 || ns[1].root) continue;
    for (let i = 1; i < ns.length - 1; i++) {
      const d0 = norm(sub(ns[i].p, ns[i - 1].p)); let L = 0;
      for (let j = i + 1; j < ns.length && L < 3.5; j++) { const s = sub(ns[j].p, ns[j - 1].p); L += Math.hypot(...s); const c = dot(d0, norm(s)); if (c < -0.2) { hits.push(`chain ${ch.id} node ${ns[i].id} y=${ns[i].p[1].toFixed(1)} r=${ns[i].r.toFixed(2)} reverses (cos ${c.toFixed(2)}) within ${L.toFixed(1)} m`); i = j; break; } }
    }
  }
  console.log(id, hits.length, '\n' + hits.join('\n'));
}
