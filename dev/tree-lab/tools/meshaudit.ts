// dev tool: where do the triangles go? Per specimen and LOD: blended (implicit) junction/root surfaces vs swept
// tubes, tubes by branch radius class, with tube length, rings per metre and sides per ring in each class.
//   node tools/meshaudit.ts            TREES=oak-b,birch LODS=0
import { SPECIES } from '../src/species/index.ts';
import { MeshOut, LODS, VFLOATS, meshChains, type BarkFn } from '../src/framework/mesher.ts';
const ids = (process.env.TREES || SPECIES.map((s) => s.id).join(',')).split(',');
const lods = (process.env.LODS || '0').split(',').map(Number);
const classes: [string, number, number][] = [['twig <1 cm', 0, 0.01], ['1–3 cm', 0.01, 0.03], ['3–10 cm', 0.03, 0.1], ['10–30 cm', 0.1, 0.3], ['>30 cm', 0.3, 99]];
const cls = (r: number) => classes.findIndex(([, a, b]) => r >= a && r < b);
for (const id of ids) {
  const d = SPECIES.find((s) => s.id === id)!; const { sk } = d.grow(); const ch = sk.chains();
  // skeleton length per radius class (woody, non-root)
  const len = classes.map(() => 0);
  for (const n of sk.nodes) if (n.parent && !n.root) len[cls((n.r + n.parent.r) / 2)] += Math.hypot(n.p[0] - n.parent.p[0], n.p[1] - n.parent.p[1], n.p[2] - n.parent.p[2]);
  for (const li of lods) {
    const o = new MeshOut(); d.mesh ? d.mesh(sk, ch, LODS[li], o) : meshChains(sk, ch, LODS[li], d.bark as BarkFn, o);
    const v = o.v, I = o.i; const tri = classes.map(() => 0), vert = classes.map(() => 0); let fused = 0, fusedV = 0, roots = 0;
    for (let k = 0; k < I.length; k += 3) { const a = I[k] * VFLOATS; const fl = v[a + 7]; if (fl & 16) fused++; else if (fl & 4) roots++; else tri[cls(v[a + 8])]++; }
    for (let q = 0; q < o.count; q++) { const a = q * VFLOATS; if (v[a + 7] & 16) fusedV++; else if (!(v[a + 7] & 4)) vert[cls(v[a + 8])]++; }
    const total = I.length / 3;
    console.log(`\n${id} LOD${li}: ${total.toLocaleString()} tris, ${o.count.toLocaleString()} verts`);
    console.log(`  blended junctions/roots: ${fused.toLocaleString()} tris (${(100 * fused / total).toFixed(1)} %), ${fusedV.toLocaleString()} verts;  tube roots ${roots.toLocaleString()}`);
    classes.forEach(([name], c) => {
      const tpm = len[c] > 0 ? tri[c] / len[c] : 0;
      console.log(`  ${name.padEnd(11)} ${tri[c].toLocaleString().padStart(9)} tris (${(100 * tri[c] / total).toFixed(1).padStart(4)} %)  ${len[c].toFixed(0).padStart(6)} m of branch  ${tpm.toFixed(0).padStart(5)} tris/m`);
    });
  }
}
