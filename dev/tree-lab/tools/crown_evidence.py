"""Phase 4.1 evidence composition: matched Phase 4 vs 4.1 pairs, density-experiment sheets and crown coverage,
impostor and LOD-transition sheets. Inputs are capture outputs (capture.mjs); outputs go to review/crown/.
  python3 dev/tree-lab/tools/crown_evidence.py <what> <args…>
    pairs <phase4 dir> <4.1 dir>               matched foliage-set pairs (per specimen and shot)
    density <phase4 dir> <4.1 dir>             density sheets + density-coverage.json
    impostor <dir>                             impostor / LOD sheets
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, '..', 'review', 'crown')
IDS = ['oak-a', 'oak-b', 'oak-c', 'pine', 'birch']
try: FONT = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18); SMALL = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 14)
except Exception: FONT = SMALL = ImageFont.load_default()


def label(im, text, font=FONT):
    d = ImageDraw.Draw(im); w = d.textlength(text, font=font)
    d.rectangle([0, 0, w + 14, font.size + 10], fill=(20, 22, 24)); d.text((7, 4), text, fill=(235, 235, 235), font=font)
    return im


def grid(rows, cell, gap=4, head=None, bg=(14, 15, 16)):
    """rows: list of lists of (PIL image | None, label)."""
    W = len(rows[0]) * (cell[0] + gap) + gap; H = len(rows) * (cell[1] + gap) + gap + (34 if head else 0)
    sheet = Image.new('RGB', (W, H), bg)
    if head: ImageDraw.Draw(sheet).text((gap + 4, 8), head, fill=(240, 240, 240), font=FONT)
    for r, row in enumerate(rows):
        for c, (im, lab) in enumerate(row):
            if im is None: continue
            t = im.convert('RGB').resize(cell, Image.LANCZOS)
            if lab: label(t, lab, SMALL)
            sheet.paste(t, (gap + c * (cell[0] + gap), gap + (34 if head else 0) + r * (cell[1] + gap)))
    return sheet


def save(im, name, q=88):
    p = os.path.join(OUT, name); os.makedirs(os.path.dirname(p), exist_ok=True); im.save(p, quality=q); print(p)


SHOTS = ['full-day', 'full-bare', 'elevated', 'aerial', 'up', 'interior', 'macro', 'junction-foliage', 'full-backlit', 'full-woodland-overcast', 'lod0', 'lod1', 'lod2']


def pairs(p4, p41):
    for id_ in IDS:
        rows = []
        for s in SHOTS:
            a, b = os.path.join(p4, id_, 'foliage', f'{id_}-{s}.png'), os.path.join(p41, id_, 'foliage', f'{id_}-{s}.png')
            if not (os.path.exists(a) and os.path.exists(b)): continue
            A, B = Image.open(a), Image.open(b)
            pair = grid([[(A, f'Phase 4 · {s}'), (B, f'Phase 4.1 · {s}')]], (800, 600))
            save(pair, f'compare/{id_}-{s}.jpg')
            rows.append([(A, f'P4 · {s}'), (B, f'4.1 · {s}')])
        if rows:
            # overview: the key views only
            key = [r for r in rows if any(k in r[0][1] for k in ('full-day', 'elevated', 'aerial', 'up', 'interior', 'macro', 'full-backlit'))]
            save(grid(key, (480, 360), head=f'{id_}: Phase 4 (left) vs Phase 4.1 (right), matched cameras and light'), f'compare-{id_}.jpg', 85)


def coverage(sil):
    """Opaque fraction of the crown envelope in a silhouette render (tree black, ground 0.92, sky white)."""
    a = np.asarray(Image.open(sil).convert('L')).astype(np.float32) / 255
    tree = a < 0.35
    if tree.sum() < 50: return None
    r = max(4, int(min(a.shape) * 0.035))
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]; disk = (xx * xx + yy * yy) <= r * r
    env = ndimage.binary_fill_holes(ndimage.binary_closing(tree, structure=disk, iterations=1))
    return float(tree.sum() / max(env.sum(), 1)), float(env.mean())


def density(p4, p41):
    stats = {}
    for d in (p4, p41):
        f = os.path.join(d, 'density-stats.json')
        if os.path.exists(f): stats.update(json.load(open(f)))
    levels = [('phase4', p4), ('moderate', p41), ('full', p41)]
    views = ['ground', 'eye', 'elevated', 'above']
    table = {}
    for id_ in IDS:
        rows = []
        for lev, d in levels:
            row = []; cov = {}
            for v in views:
                im = os.path.join(d, lev, f'{id_}-{v}.png'); sil = os.path.join(d, lev, f'{id_}-{v}-sil.png')
                c = coverage(sil) if os.path.exists(sil) else None
                cov[v] = None if c is None else {'fill': round(c[0], 3), 'envelope': round(c[1], 3)}
                row.append((Image.open(im) if os.path.exists(im) else None, f'{lev} · {v}' + (f' · fill {c[0]:.2f}' if c else '')))
            rows.append(row)
            st = stats.get(f'{lev}/{id_}', {})
            table[f'{lev}/{id_}'] = {**st, 'coverage': cov}
        save(grid(rows, (420, 315), head=f'{id_}: density experiment · rows Phase 4 baseline, moderate (fullness × 0.55), full (chosen)'), f'density-{id_}.jpg', 85)
    json.dump(table, open(os.path.join(OUT, 'density-coverage.json'), 'w'), indent=1)
    # summary table (markdown)
    lines = ['| specimen | level | LOD0 instances | LOD0 triangles | instance MB | crown fill ground / eye / elevated / above | overdraw mean (eye) |', '|---|---|---|---|---|---|---|']
    for id_ in IDS:
        for lev, _ in levels:
            t = table.get(f'{lev}/{id_}', {}); c = t.get('coverage', {}); od = t.get('overdrawEye', {}) or {}
            fills = ' / '.join(f"{c[v]['fill']:.2f}" if c.get(v) else '–' for v in views)
            lines.append(f"| {id_} | {lev} | {t.get('instances', 0):,} | {t.get('triangles', 0):,} | {t.get('instanceBytes', 0) / 1048576:.1f} | {fills} | {od.get('meanFoliage', 0):.2f} |")
    open(os.path.join(OUT, 'density-table.md'), 'w').write('\n'.join(lines) + '\n'); print('\n'.join(lines))


def bbox_crop(im, pad=24):
    a = np.asarray(im.convert('RGB')).astype(np.int32)
    bg = a[2, 2]; diff = np.abs(a - bg).sum(-1) > 40
    ys, xs = np.where(diff)
    if not len(ys): return im
    return im.crop((max(0, xs.min() - pad), max(0, ys.min() - pad), min(im.width, xs.max() + pad), min(im.height, ys.max() + pad)))


def impostor(d):
    for id_ in ['oak-b', 'pine', 'birch']:
        rows = []
        for tag in ['eye', 'elevated', 'steep', 'overhead']:
            a, b = os.path.join(d, 'impostor', f'{id_}-{tag}-lod1.png'), os.path.join(d, 'impostor', f'{id_}-{tag}-impostor.png')
            if os.path.exists(a): rows.append([(Image.open(a), f'geometry (LOD1) · {tag}'), (Image.open(b), f'impostor · {tag}')])
        if rows: save(grid(rows, (420, 420), head=f'{id_}: geometry vs octahedral impostor (9 × 9 frames, 112 px)'), f'impostor-{id_}.jpg', 88)
        sw = [os.path.join(d, 'impostor', f'{id_}-sweep-{k}.png') for k in range(6)]
        if all(os.path.exists(p) for p in sw): save(grid([[(Image.open(p), f'az +{6 * k}°') for k, p in enumerate(sw)]], (300, 300), head=f'{id_}: impostor, camera orbiting in 6° steps (elevated 20°): frames blend, the tree does not turn with the camera'), f'impostor-sweep-{id_}.jpg', 88)
        rows = []
        for sw_, a, b, P in [(0, 'lod0', 'lod1', 700), (1, 'lod1', 'lod2', 240), (2, 'lod2', 'impostor', 110)]:
            pa, pb = os.path.join(d, 'lod', f'{id_}-switch{sw_}-{a}.png'), os.path.join(d, 'lod', f'{id_}-switch{sw_}-{b}.png')
            if os.path.exists(pa):
                A, B = Image.open(pa), Image.open(pb)
                # the camera targets the tree's mid-height: a square of 1.5 × its projected height holds it
                s_ = min(A.width, int(P * 1.5)); c = A.width // 2, A.height // 2
                box = (c[0] - s_ // 2, c[1] - s_ // 2, c[0] + s_ // 2, c[1] + s_ // 2)
                rows.append([(A.crop(box), f'{a} · {P} px tall'), (B.crop(box), f'{b} · same camera')])
        if rows: save(grid(rows, (420, 420), head=f'{id_}: both sides of each LOD switch, same camera (projected height 700 / 240 / 110 px)'), f'lod-transitions-{id_}.jpg', 88)


def _square(A, B, pad=30):
    a = np.asarray(A.convert('RGB')).astype(np.int32); b = np.asarray(B.convert('RGB')).astype(np.int32)
    bg = a[2, 2]; m = (np.abs(a - bg).sum(-1) > 40) | (np.abs(b - bg).sum(-1) > 40)
    # ignore the ground plane: only rows above the lowest 12 % of the tree's extent matter little; use the union bbox
    ys, xs = np.where(m)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    s = max(x1 - x0, y1 - y0) + 2 * pad; cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    return (max(0, cx - s // 2), max(0, cy - s // 2), min(A.width, cx + s // 2), min(A.height, cy + s // 2))


def alpha(d):
    """Crown fill (silhouette opaque fraction of the envelope) vs projected size, per alpha configuration."""
    rows, table = [], {}
    for id_ in ['oak-b', 'pine', 'birch']:
        for name in ['none', 'phase4-heuristic', 'preserved', 'chosen']:
            fills = {}
            row = []
            for px in (700, 160, 60):
                p = os.path.join(d, 'alpha', f'{id_}-{name}-{px}.png')
                if not os.path.exists(p): continue
                c = coverage(p); fills[px] = None if c is None else round(c[0], 3)
                im = Image.open(p); s_ = min(im.width, int(px * 1.5)); cx, cy = im.width // 2, im.height // 2
                row.append((im.crop((cx - s_ // 2, cy - s_ // 2, cx + s_ // 2, cy + s_ // 2)), f'{name} · {px} px · fill {fills[px]}'))
            table[f'{id_}/{name}'] = fills
            if row: rows.append(row)
    if rows: save(grid(rows, (300, 300), head='Crown fill vs distance (silhouettes): no preservation, Phase 4 heuristic, coverage-preserving mips, chosen (preserved + small boost)'), 'alpha-coverage.jpg', 88)
    json.dump(table, open(os.path.join(OUT, 'alpha-coverage.json'), 'w'), indent=1); print(json.dumps(table, indent=1))


if __name__ == '__main__':
    what = sys.argv[1]
    {'pairs': lambda: pairs(sys.argv[2], sys.argv[3]), 'density': lambda: density(sys.argv[2], sys.argv[3]), 'impostor': lambda: impostor(sys.argv[2]), 'alpha': lambda: alpha(sys.argv[2])}[what]()
