"""Matched-camera LOD boundary sheets and the metrics table (review/lod/), from tools/evidence/lodcheck.js output.
  python3 dev/tree-lab/tools/lod_sheets.py <lodcheck dir>"""
import json, os, sys
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from lod_metrics import metrics
from crown_evidence import grid, save as _save
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'review', 'lod')
d = sys.argv[1]
m = metrics(d)
json.dump(m, open(os.path.join(OUT, 'lod-metrics.json'), 'w'), indent=1)
names = {'oak-a': 'Oak A', 'oak-b': 'Oak B', 'oak-c': 'Oak C', 'pine': 'Scots pine', 'birch': 'Silver birch'}
bnames = {'b0': 'LOD0 → LOD1 (700 px)', 'b1': 'LOD1 → impostor (140 px)'}
rows_md = ['| specimen | boundary | view | crown coverage (pts) | Δ pts | silhouette IoU | Δ luminance | ΔE | triangles | instance bytes | overdraw |', '|---|---|---|---|---|---|---|---|---|---|---|']
for id_ in names:
    rows = []
    for key in sorted(k for k in m if k.startswith(id_ + '-b')):
        v = m[key]; b, view = key.split('-')[-2], key.split('-')[-1]
        A, B = (Image.open(os.path.join(d, 'lod', n + '.png')) for n in v['sides'])
        S = A.width; px = 700 if b == 'b0' else 140; s_ = min(S, int(px * S / 900 * 1.5)); c = S // 2
        box = (c - s_ // 2, c - s_ // 2, c + s_ // 2, c + s_ // 2)
        lab = f"{bnames[b]} · {view}"
        rows.append([(A.crop(box), f"{lab} · {v['sides'][0].split('-')[-1]}"), (B.crop(box), f"{v['sides'][1].split('-')[-1]} · cov {v['coverageDiffPts']:+.1f} pts · lum {v['luminanceDiffPct']:+.1f} % · IoU {v['silhouetteIoU']:.2f}")])
        rows_md.append(f"| {names[id_]} | {bnames[b]} | {view} | {v['crownCoverage'][0]} → {v['crownCoverage'][1]} | {v['coverageDiffPts']:+.1f} | {v['silhouetteIoU']:.2f} | {v['luminanceDiffPct']:+.1f} % | {v['deltaE']:.1f} | {v['triangles'][0]:,} → {v['triangles'][1]:,} | {v['instanceBytes'][0] / 1048576:.2f} → {v['instanceBytes'][1] / 1048576:.2f} MB | {v['overdraw'][0]:.2f} → {v['overdraw'][1]:.2f} |")
    if rows:
        im = grid(rows, (450, 450), head=f'{names[id_]}: both sides of each LOD boundary, same camera, at the switch size')
        p = os.path.join(OUT, f'boundaries-{id_}.jpg'); im.save(p, quality=88); print(p)
open(os.path.join(OUT, 'lod-metrics.md'), 'w').write('\n'.join(rows_md) + '\n'); print('\n'.join(rows_md))
