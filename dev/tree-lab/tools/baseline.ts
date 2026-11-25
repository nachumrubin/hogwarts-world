// dev tool: geometry fingerprint + timings of every specimen (skeleton hash, LOD triangle counts, mesh hash)
import { SPECIES } from '../src/species/index.ts';
import { MeshOut, LODS, meshChains, type BarkFn } from '../src/framework/mesher.ts';
import { createHash } from 'node:crypto';
const ids = (process.env.TREES || SPECIES.map((s) => s.id).join(',')).split(',');
const lods = (process.env.LODS || '0,1,2').split(',').map(Number);
for (const id of ids) {
  const d = SPECIES.find((s) => s.id === id)!;
  let t = performance.now(); const { sk } = d.grow(); const g = performance.now() - t;
  const h = createHash('sha1'); for (const n of sk.nodes) h.update(`${n.p.map((x) => x.toFixed(5))}|${n.r.toFixed(5)}|${n.parent?.id ?? -1};`);
  const ch = sk.chains(); const row = [`${id}: grow ${g.toFixed(0)} ms, nodes ${sk.nodes.length}, skel ${h.digest('hex').slice(0, 12)}`];
  for (const li of lods) {
    t = performance.now(); const o = new MeshOut(); d.mesh ? d.mesh(sk, ch, LODS[li], o) : meshChains(sk, ch, LODS[li], d.bark as BarkFn, o);
    const mh = createHash('sha1').update(new Float32Array(o.v)).digest('hex').slice(0, 12);
    row.push(`  LOD${li}: ${(performance.now() - t).toFixed(0)} ms, ${o.count} verts, ${o.i.length / 3} tris, ${(o.v.length * 4 / 1e6).toFixed(1)} MB, mesh ${mh}`);
  }
  console.log(row.join('\n'));
}
