"""Phase 4.3 shading diagnostics (tools/evidence/diag.js output): per viewing angle, the two sides' crown coverage and
the mean of each foliage diagnostic term over the foliage pixels, and the ratio finer → coarser.
  python3 dev/tree-lab/tools/diag_metrics.py <dir>/diag [out.json]
Linear modes (4 direct, 5 ambient, 6 no transmission, 7 no self-shadow, 13 full) were written as srgb(value × exposure
× 0.5) without the tone curve: decoded, their ratios are ratios of radiance. Mode 1 is srgb(albedo). Modes 2, 3, 9, 10,
11 are raw values. Mode 8 (alpha) gives the foliage pixels; bark and ground are magenta in every diagnostic mode."""
import json, os, re, sys, glob
import numpy as np
from PIL import Image
from scipy import ndimage

def srgb2lin(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
Y = np.array([0.2126, 0.7152, 0.0722])
LIN = {1, 4, 5, 6, 7, 13, 17}
TONED = {12, 15}   # tone-mapped (the normal output path), on a black background
NAMES = {0: 'output', 1: 'albedo', 2: 'normal', 3: 'underside share', 4: 'direct', 5: 'ambient', 6: 'no transmission', 7: 'no self-shadow',
         8: 'coverage', 9: 'N·L', 10: 'facing |Ng·V|', 11: 'mip level', 12: 'top mip only', 13: 'full', 15: 'output (black bg)', 17: 'sun transmission', 18: 'transmission shadow', 19: 'direct shadow', 20: 'mean-normal length', 21: 'back term'}

def img(p): return np.asarray(Image.open(p).convert('RGB')).astype(np.float64) / 255

def side(base, modes):
    """Per-pixel term values, un-premultiplied: diagnostic renders have a black background and magenta wood, so in the
    alpha view (mode 8: white foliage) green = foliage coverage f and red − green = wood coverage w, and any term
    image's value is ((R − w) / f, G / f, (B − w) / f) in the stored (sRGB-encoded) space. Pixels with f > 0.5 count."""
    sil = img(base + '-sil.png')[..., 0] < 0.35
    a = img(base + '-m8.png')
    f = a[..., 1]; w = np.clip(a[..., 0] - f, 0, 1)
    fol = f > 0.5
    out = {'_sil': sil, '_fol': fol, '_fcov': f}
    for m in modes:
        p = f'{base}-m{m}.png'
        if not os.path.exists(p) or m == 8: continue
        c = img(p)
        if m == 0:
            # the lab's output (real sky behind, tone-mapped): the protocol's mask (silhouette ∩ green-dominant pixels,
            # tools/lod_metrics.py) and the foliage pixels
            g = sil & (c[..., 1] > c[..., 2] - 0.02) & (c[..., 1] >= c[..., 0] - 0.02)
            out[m] = float((srgb2lin(c[fol]) @ Y).mean()); out['official'] = float((srgb2lin(c[g]) @ Y).mean())
            continue
        v = np.stack([(c[..., 0] - w), c[..., 1], (c[..., 2] - w)], -1)[fol] / f[fol][:, None]
        v = np.clip(v, 0, 1)
        if m in LIN or m in TONED: out[m] = float((srgb2lin(v) @ Y).mean())
        elif m == 2: n = v * 2 - 1; out[m] = {'up': float(n[:, 1].mean()), 'horiz': float(np.hypot(n[:, 0], n[:, 2]).mean())}
        else: out[m] = float(v[:, 0].mean())
    return out

def run(d):
    bases = sorted({re.sub(r'-(sil|m\d+)\.png$', '', os.path.basename(f)) for f in glob.glob(os.path.join(d, '*-m8.png'))})
    groups = {}
    for b in bases:
        key, lod = b.rsplit('-', 1); groups.setdefault(key, {})[lod] = b
    res = {}
    for key, g in sorted(groups.items(), key=lambda kv: (kv[0].split('-a')[1], int(re.search(r'-e(\d+)', kv[0]).group(1)))):
        lods = sorted(g, key=lambda s: (s == 'imp', s))
        if len(lods) != 2: continue
        A = side(os.path.join(d, g[lods[0]]), range(0, 22)); B = side(os.path.join(d, g[lods[1]]), range(0, 22))
        r_ = max(3, int(A['_sil'].shape[0] * 0.035)); yy, xx = np.mgrid[-r_:r_ + 1, -r_:r_ + 1]
        env = ndimage.binary_fill_holes(ndimage.binary_closing(A['_sil'], structure=(xx * xx + yy * yy) <= r_ * r_))
        # foliage coverage: summed fractional coverage over the finer side's crown envelope
        row = {'coverage': [round(A['_fcov'][env].sum() / env.sum() * 100, 1), round(B['_fcov'][env].sum() / env.sum() * 100, 1)]}
        row['coverageDiffPts'] = round(row['coverage'][1] - row['coverage'][0], 1)
        if 'official' in A and 'official' in B: row['protocol luminance'] = [round(A['official'], 5), round(B['official'], 5), round((B['official'] / A['official'] - 1) * 100, 1)]
        for m in range(0, 22):
            if m in A and m in B:
                if m == 2: row[NAMES[m]] = {k: [round(A[m][k], 3), round(B[m][k], 3)] for k in A[m]}
                elif m in LIN or m in TONED or m == 0: row[NAMES[m]] = [round(A[m], 5), round(B[m], 5), round((B[m] / A[m] - 1) * 100, 1)]
                else: row[NAMES[m]] = [round(A[m], 3), round(B[m], 3)]
        res[key] = row
    return res

if __name__ == '__main__':
    r = run(sys.argv[1])
    for k, v in r.items():
        s = f"{k:28s} cov {v['coverage'][0]:5.1f}→{v['coverage'][1]:5.1f} ({v['coverageDiffPts']:+5.1f})"
        for n in ('protocol luminance', 'output', 'output (black bg)', 'albedo', 'direct', 'ambient', 'no transmission', 'no self-shadow', 'full', 'sun transmission', 'top mip only'):
            if n in v: s += f"  {n[:8]} {v[n][2]:+6.1f}%"
        for n in ('N·L', 'underside share', 'facing |Ng·V|', 'mip level', 'transmission shadow', 'direct shadow', 'mean-normal length', 'back term'):
            if n in v: s += f"  {n[:6]} {v[n][0]:.2f}/{v[n][1]:.2f}"
        if 'normal' in v: s += f"  Nup {v['normal']['up'][0]:+.2f}/{v['normal']['up'][1]:+.2f}"
        print(s)
    if len(sys.argv) > 2: json.dump(r, open(sys.argv[2], 'w'), indent=1)
