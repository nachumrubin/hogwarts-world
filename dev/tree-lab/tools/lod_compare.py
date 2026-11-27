"""Phase 4.3 LOD boundary evidence: before/after sheets and the measurement table (review/lod/), from two
tools/evidence/lodcheck.js runs with identical cameras, light, resolution and metric definitions (tools/lod_metrics.py).
  python3 dev/tree-lab/tools/lod_compare.py <before dir> <after dir> [angular dir] [--mid <dir>]
  (--mid: a third, intermediate run (Phase 4.3) shown between before and after on the plates and in the table)
Writes lod-metrics.json / .md (after), before-after-<id>.jpg, and, given an angular run (extra elevations and azimuths),
lod-angular.json / .md with the worst cases per specimen and boundary."""
import json, os, sys
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from lod_metrics import metrics
from crown_evidence import grid
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'review', 'lod')
NAMES = {'oak-a': 'Oak A', 'oak-b': 'Oak B', 'oak-c': 'Oak C', 'pine': 'Scots pine', 'birch': 'Silver birch'}
BN = {'b0': 'LOD0 → LOD1 (700 px)', 'b1': 'LOD1 → impostor (140 px)'}
COV, LUM = 5.0, 5.0
ok = lambda v: abs(v['coverageDiffPts']) <= COV and abs(v['luminanceDiffPct']) <= LUM
mark = lambda x, lim: f"{x:+.1f}" + ('' if abs(x) <= lim else ' ✗')

def crop(d, name, b):
    im = Image.open(os.path.join(d, 'lod', name + '.png')); S = im.width
    px = 700 if b == 'b0' else 140; s_ = min(S, int(px * S / 900 * 1.5)); c = S // 2
    return im.crop((c - s_ // 2, c - s_ // 2, c + s_ // 2, c + s_ // 2))

def main(bd, ad, ang=None, mid=None):
    mb, ma = metrics(bd), metrics(ad)
    mm = metrics(mid) if mid else {}
    json.dump(ma, open(os.path.join(OUT, 'lod-metrics.json'), 'w'), indent=1)
    md = ['| specimen | boundary | view | Δ coverage 4.2 → ' + ('4.3 → ' if mid else '') + 'now (pts) | Δ luminance 4.2 → ' + ('4.3 → ' if mid else '') + 'now | fractional Δ coverage now (diagnostic) | ΔE now | IoU now | triangles | instance bytes | verdict |',
          '|---|---|---|---|---|---|---|---|---|---|---|']
    npass = [0, 0]
    for id_ in NAMES:
        rows = []
        for key in sorted(k for k in ma if k.startswith(id_ + '-b')):
            v, v0 = ma[key], mb.get(key)
            b = 'b0' if '-b0-' in key else 'b1'; view = key.split(f'-{b}-', 1)[1]
            vm = mm.get(key)
            row = [(crop(bd, v0['sides'][0], b), f"4.2 · {BN[b]} · {view} · {v0['sides'][0].split('-')[-1]}") if v0 else (Image.new('RGB', (10, 10)), '4.2: —'),
                   (crop(bd, v0['sides'][1], b), f"4.2 · {v0['sides'][1].split('-')[-1]} · cov {v0['coverageDiffPts']:+.1f} · lum {v0['luminanceDiffPct']:+.1f} %") if v0 else (Image.new('RGB', (10, 10)), '')]
            if mid and vm: row += [(crop(mid, vm['sides'][0], b), f"4.3 · {vm['sides'][0].split('-')[-1]}"), (crop(mid, vm['sides'][1], b), f"4.3 · {vm['sides'][1].split('-')[-1]} · cov {vm['coverageDiffPts']:+.1f} · lum {vm['luminanceDiffPct']:+.1f} %")]
            tagA = '4.4' if mid else 'after'
            row += [(crop(ad, v['sides'][0], b), f"{tagA} · {v['sides'][0].split('-')[-1]}"), (crop(ad, v['sides'][1], b), f"{tagA} · {v['sides'][1].split('-')[-1]} · cov {v['coverageDiffPts']:+.1f} · lum {v['luminanceDiffPct']:+.1f} %")]
            rows.append(row)
            npass[0] += abs(v['coverageDiffPts']) <= COV; npass[1] += abs(v['luminanceDiffPct']) <= LUM
            mcv = f"{mark(vm['coverageDiffPts'], COV)} → " if mid and vm else ''
            mlm = f"{mark(vm['luminanceDiffPct'], LUM)} % → " if mid and vm else ''
            md.append(f"| {NAMES[id_]} | {BN[b]} | {view} | {mark(v0['coverageDiffPts'], COV) if v0 else '—'} → {mcv}{mark(v['coverageDiffPts'], COV)} | "
                      f"{mark(v0['luminanceDiffPct'], LUM) + ' %' if v0 else '—'} → {mlm}{mark(v['luminanceDiffPct'], LUM)} % | {v.get('fractionalDiffPts', 0):+.1f} | {v['deltaE']:.1f} | {v['silhouetteIoU']:.2f} | "
                      f"{v['triangles'][0]:,} → {v['triangles'][1]:,} | {v['instanceBytes'][0] / 1048576:.2f} → {v['instanceBytes'][1] / 1048576:.2f} MB | {'pass' if ok(v) else 'fail'} |")
        if rows:
            im = grid(rows, (300, 300) if mid else (360, 360), head=f'{NAMES[id_]}: each LOD boundary in Phase 4.2 (8d541c3){", 4.3 (24de3b8)" if mid else ""} and {"4.4" if mid else "after"}, same camera, at the switch size')
            p = os.path.join(OUT, f'before-after-{id_}.jpg'); im.save(p, quality=86); print(p)
    n = len(ma)
    md.insert(0, f"Coverage within ±{COV:.0f} points: {npass[0]} of {n}; luminance within ±{LUM:.0f} %: {npass[1]} of {n}.\n")
    open(os.path.join(OUT, 'lod-metrics.md'), 'w').write('\n'.join(md) + '\n'); print('\n'.join(md))
    if ang:
        mg = metrics(ang)
        json.dump(mg, open(os.path.join(OUT, 'lod-angular.json'), 'w'), indent=1)
        out = ['| specimen | boundary | views | worst Δ coverage (view) | worst Δ luminance (view) | views passing |', '|---|---|---|---|---|---|']
        allv = {**{k: v for k, v in ma.items()}, **mg}
        for id_ in NAMES:
            for b in ('b0', 'b1'):
                ks = [k for k in allv if k.startswith(f'{id_}-{b}-')]
                if not ks: continue
                wc = max(ks, key=lambda k: abs(allv[k]['coverageDiffPts'])); wl = max(ks, key=lambda k: abs(allv[k]['luminanceDiffPct']))
                vw = lambda k: k.split(f'-{b}-', 1)[1]
                out.append(f"| {NAMES[id_]} | {BN[b]} | {len(ks)} | {allv[wc]['coverageDiffPts']:+.1f} ({vw(wc)}) | {allv[wl]['luminanceDiffPct']:+.1f} % ({vw(wl)}) | {sum(ok(allv[k]) for k in ks)} of {len(ks)} |")
        out.append('\nEvery view (protocol views first, then the angular set; view = elevation tag @ azimuth in radians, 0.6 when omitted):\n')
        out.append('| key | Δ coverage (pts) | Δ luminance | fractional Δ coverage (diagnostic) | ΔE | IoU |'); out.append('|---|---|---|---|---|---|')
        for k in sorted(allv): out.append(f"| {k} | {mark(allv[k]['coverageDiffPts'], COV)} | {mark(allv[k]['luminanceDiffPct'], LUM)} % | {allv[k].get('fractionalDiffPts', 0):+.1f} | {allv[k]['deltaE']:.1f} | {allv[k]['silhouetteIoU']:.2f} |")
        open(os.path.join(OUT, 'lod-angular.md'), 'w').write('\n'.join(out) + '\n'); print('\n'.join(out[:14]))

if __name__ == '__main__':
    args = sys.argv[1:]; mid = None
    if '--mid' in args: i = args.index('--mid'); mid = args[i + 1]; del args[i:i + 2]
    main(args[0], args[1], args[2] if len(args) > 2 else None, mid)
