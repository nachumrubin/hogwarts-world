// dev tool: generation time and triangle counts per specimen and LOD (Node, single thread).
//   node tools/timing.ts            TREES=oak-a,pine
import { SPECIES } from '../src/species/index.ts';
import { buildSpecimen } from '../src/build.ts';
const ids = (process.env.TREES || SPECIES.map((s) => s.id).join(',')).split(',');
for (const id of ids) {
  const t0 = performance.now(); const b = buildSpecimen(id); const all = performance.now() - t0;
  const F = b.foliage;
  console.log(`${id.padEnd(6)} foliage ${F.stats.ms} ms, ${F.stats.leaves} leaves on ${F.stats.shoots} shoots (${F.stats.shed} shed), instances ${F.lods.map((l) => l.instances).join(' / ')}, tris ${F.lods.map((l) => l.triangles).join(' / ')}, bytes ${F.lods.map((l) => l.sets.reduce((a, x) => a + x.data.byteLength, 0)).join(' / ')}`);
  console.log(`${id.padEnd(6)} grow ${(b.diag.growMs / 1000).toFixed(2)} s  mesh ${b.diag.meshMs.map((m) => (m / 1000).toFixed(2)).join(' / ')} s  total ${(all / 1000).toFixed(2)} s  tris ${b.lods.map((l) => l.tris).join(' / ')}  verts ${b.lods.map((l) => l.verts).join(' / ')}`);
}
