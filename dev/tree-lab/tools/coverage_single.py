"""Crown coverage of single silhouette renders (tools/lod_metrics.py definitions, each image against its own envelope):
threshold-based (silhouette pixels ≥ 65 % covered) and integrated fractional coverage (Σ coverage / envelope).
  python3 dev/tree-lab/tools/coverage_single.py <sil.png> ..."""
import sys, json
import numpy as np
from PIL import Image
from scipy import ndimage
def cov(p, env_from=None):
    g = np.asarray(Image.open(p).convert('L')).astype(np.float64) / 255
    sil = g < 0.35; f = np.clip((0.92 - g) / 0.92, 0, 1)   # silhouette mode: tree 0 on a 0.92 ground
    r_ = max(3, int(g.shape[0] * 0.035)); yy, xx = np.mgrid[-r_:r_ + 1, -r_:r_ + 1]
    env = ndimage.binary_fill_holes(ndimage.binary_closing(sil if env_from is None else env_from, structure=(xx * xx + yy * yy) <= r_ * r_))
    return sil, {'threshold': round(sil.sum() / env.sum() * 100, 1), 'fractional': round(f[env].sum() / env.sum() * 100, 1)}
if __name__ == '__main__':
    for p in sys.argv[1:]: print(p.split('/')[-1], json.dumps(cov(p)[1]))
