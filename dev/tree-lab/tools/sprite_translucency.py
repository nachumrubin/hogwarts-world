"""Phase 4.4: the sprite layers' normal textures as shipped in Phase 4.3 (normal, roughness: byte-identical after
decoding) with the corrected translucency alpha from tools/foliage_textures.py (no longer zeroed in transparent
texels), stored lossless so that LOD0's leaves and needles are unchanged wherever they have coverage.
  python3 dev/tree-lab/tools/foliage_textures.py   (writes the new translucency into textures/)
  git show 24de3b8:dev/tree-lab/textures/foliage.<sp>.normal.webp > /tmp/old.<sp>.webp   (for oak, birch, pine)
  python3 dev/tree-lab/tools/sprite_translucency.py /tmp/old"""
import sys, json, hashlib, os
import numpy as np
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__)); tex = os.path.join(here, '..', 'textures'); old = sys.argv[1]
man = json.load(open(os.path.join(tex, 'foliage.json')))
for sp in ('oak', 'birch', 'pine'):
    rgb = np.asarray(Image.open(f'{old}.{sp}.webp')).copy(); new = np.asarray(Image.open(os.path.join(tex, f'foliage.{sp}.normal.webp')))
    rgb[..., 3] = new[..., 3]
    p = os.path.join(tex, f'foliage.{sp}.normal.webp'); Image.fromarray(rgb, 'RGBA').save(p, 'WEBP', lossless=True, exact=True, method=6)
    for l in man['layers']:
        if l['id'] == sp: l['normal'] = f'foliage.{sp}.normal.webp?{hashlib.sha256(open(p, "rb").read()).hexdigest()[:10]}'
json.dump(man, open(os.path.join(tex, 'foliage.json'), 'w'), indent=1)
