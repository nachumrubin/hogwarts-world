// dev tool: mean radius of fused (flag 16) vs tube vertices around the takeover height of the trunk
import { SPECIES } from '../src/species/index.ts';
import { MeshOut, LODS, VFLOATS } from '../src/framework/mesher.ts';
for (const id of (process.env.TREES || 'pine,birch').split(',')) {
  const d = SPECIES.find((s) => s.id === id)!; const { sk } = d.grow(); const ch = sk.chains();
  const out = new MeshOut(); d.mesh!(sk, ch, LODS[0], out);
  const trunk = sk.nodes.filter((n) => n.order === 0 && !n.root);
  const cAt = (y: number) => { let a = trunk[0], b = trunk[0]; for (const n of trunk) { if (n.p[1] <= y && n.p[1] > a.p[1]) a = n; } b = a.children.find((c) => c.order === 0) || a; const t = b === a ? 0 : (y - a.p[1]) / (b.p[1] - a.p[1]); return [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[2] + (b.p[2] - a.p[2]) * t]; };
  const v = out.v; const rows: string[] = [];
  for (let y = +(process.env.Y0 || 0.8); y < +(process.env.Y1 || 2.4); y += 0.1) {
    const c = cAt(y); const f: number[] = [], t: number[] = [];
    for (let i = 0; i < out.count; i++) { const o = i * VFLOATS; if (Math.abs(v[o + 1] - y) > 0.05) continue; const rr = Math.hypot(v[o] - c[0], v[o + 2] - c[1]); if (rr > 1.2) continue; ((v[o + 7] & 16) ? f : t).push(rr); }
    const m = (a: number[]) => a.length ? (a.reduce((s, x) => s + x, 0) / a.length).toFixed(3) : '  -  ';
    rows.push(`${y.toFixed(1)} fused ${m(f)} (${f.length})  tube ${m(t)} (${t.length})`);
  }
  console.log(id + '\n' + rows.join('\n'));
}
