"""LOD consistency metrics from tools/evidence/lodcheck.js output: per boundary, coverage (silhouette pixels / image),
silhouette overlap (IoU), mean foliage luminance (Rec. 709 luma of linear colour), colour difference (CIE ΔE76 of the
mean foliage colour), triangles, instance memory, overdraw.
  python3 dev/tree-lab/tools/lod_metrics.py <dir> [out.json]"""
import json, os, sys, glob
import numpy as np
from PIL import Image
from scipy import ndimage

def srgb2lin(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def lab(rgb):
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]]); x = M @ rgb / np.array([0.9505, 1.0, 1.089])
    f = np.where(x > 0.008856, np.cbrt(x), 7.787 * x + 16 / 116)
    return np.array([116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])])

def load(base):
    lit = np.asarray(Image.open(base + '.png').convert('RGB')).astype(np.float64) / 255
    sil = np.asarray(Image.open(base + '-sil.png').convert('L')).astype(np.float64) / 255 < 0.35
    lin = srgb2lin(lit)
    fol = sil & (lit[..., 1] > lit[..., 2] - 0.02) & (lit[..., 1] >= lit[..., 0] - 0.02)   # green-dominant tree pixels
    return lin, sil, fol

def pair(a, b):
    """Metrics between two renders (paths without .png; each with its -sil.png)."""
    A, B = load(a), load(b)
    r_ = max(3, int(A[1].shape[0] * 0.035)); yy, xx = np.mgrid[-r_:r_ + 1, -r_:r_ + 1]
    env = ndimage.binary_fill_holes(ndimage.binary_closing(A[1], structure=(xx * xx + yy * yy) <= r_ * r_))
    ca, cb = A[1].sum() / max(env.sum(), 1), B[1].sum() / max(env.sum(), 1)
    Y = np.array([0.2126, 0.7152, 0.0722]); ma, mb = A[0][A[2]].mean(0), B[0][B[2]].mean(0)
    return {'crownCoverage': [round(ca * 100, 1), round(cb * 100, 1)], 'coverageDiffPts': round((cb - ca) * 100, 1),
            'silhouetteIoU': round(float((A[1] & B[1]).sum() / max((A[1] | B[1]).sum(), 1)), 3),
            'luminanceDiffPct': round(float((mb @ Y - ma @ Y) / (ma @ Y) * 100), 1), 'deltaE': round(float(np.linalg.norm(lab(ma) - lab(mb))), 2)}


def metrics(d):
    st = json.load(open(os.path.join(d, 'lod', 'lod-stats.json')))
    rows = {}
    for f in sorted(glob.glob(os.path.join(d, 'lod', '*-b*-*-lod*.png')) + glob.glob(os.path.join(d, 'lod', '*-b*-*-imp.png'))):
        if f.endswith('-sil.png'): continue
        name = os.path.basename(f)[:-4]; parts = name.rsplit('-', 1); key = parts[0]
        rows.setdefault(key, []).append(name)
    out = {}
    for key, names in rows.items():
        if len(names) != 2: continue
        names.sort(key=lambda n: (n.endswith('imp'), n))
        A = load(os.path.join(d, 'lod', names[0])); B = load(os.path.join(d, 'lod', names[1]))
        # crown coverage: silhouette pixels over the LOD-A (higher detail) crown envelope (closed with a disk of 3.5 %
        # of the image, holes filled), so both sides are measured against the same crown outline
        r_ = max(3, int(A[1].shape[0] * 0.035)); yy, xx = np.mgrid[-r_:r_ + 1, -r_:r_ + 1]
        env = ndimage.binary_fill_holes(ndimage.binary_closing(A[1], structure=(xx * xx + yy * yy) <= r_ * r_))
        ca, cb = A[1].sum() / max(env.sum(), 1), B[1].sum() / max(env.sum(), 1)
        iou = (A[1] & B[1]).sum() / max((A[1] | B[1]).sum(), 1)
        ma, mb = A[0][A[2]].mean(0), B[0][B[2]].mean(0)
        la, lb = ma @ [0.2126, 0.7152, 0.0722], mb @ [0.2126, 0.7152, 0.0722]
        de = float(np.linalg.norm(lab(ma) - lab(mb)))
        # perceived crown brightness: mean luma over the shared crown envelope, gaps included (what the eye integrates
        # once leaves are near or below a pixel)
        Y = np.array([0.2126, 0.7152, 0.0722]); ea, eb = (A[0][env] @ Y).mean(), (B[0][env] @ Y).mean()
        dflt = {'triangles': 0, 'instanceBytes': 0, 'overdraw': {}}
        sa, sb = st.get(names[0], dflt), st.get(names[1], dflt)
        out[key] = {'sides': names, 'crownCoverage': [round(ca * 100, 1), round(cb * 100, 1)], 'coverageDiffPts': round((cb - ca) * 100, 2),
                    'coverageRelDiffPct': round((cb - ca) / max(ca, 1e-9) * 100, 1), 'silhouetteIoU': round(float(iou), 3),
                    'luminance': [round(float(la), 4), round(float(lb), 4)], 'luminanceDiffPct': round((lb - la) / la * 100, 1), 'deltaE': round(de, 2), 'envelopeLuminanceDiffPct': round((eb - ea) / ea * 100, 1),
                    'triangles': [sa['triangles'], sb['triangles']], 'instanceBytes': [sa['instanceBytes'], sb['instanceBytes']],
                    'overdraw': [round(sa['overdraw'].get('meanFoliage', 0), 2), round(sb['overdraw'].get('meanFoliage', 0), 2)],
                    'rasterized': [round(sa['overdraw'].get('rasterized', 0), 2), round(sb['overdraw'].get('rasterized', 0), 2)]}
    return out

if __name__ == '__main__':
    if sys.argv[1] == 'pair': print(json.dumps(pair(sys.argv[2], sys.argv[3]))); sys.exit()
    r = metrics(sys.argv[1])
    for k, v in r.items(): print(f"{k:28s} cov {v['crownCoverage'][0]:5.1f}→{v['crownCoverage'][1]:5.1f} ({v['coverageDiffPts']:+.1f} pts)  IoU {v['silhouetteIoU']:.2f}  lum {v['luminanceDiffPct']:+.1f}%  ΔE {v['deltaE']:.1f}  env-lum {v['envelopeLuminanceDiffPct']:+.1f}%  tris {v['triangles'][0]:,}→{v['triangles'][1]:,}")
    if len(sys.argv) > 2: json.dump(r, open(sys.argv[2], 'w'), indent=1)
