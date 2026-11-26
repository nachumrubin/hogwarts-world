"""Write pre-baked impostor atlases: raw RGBA dumps from tools/evidence/bake-impostors.js (run through capture.mjs
RUN=…) → textures/impostor.<id>.{albedo,normal}.webp (lossless, exact) and textures/impostors.json.
  python3 dev/tree-lab/tools/impostor_atlas.py <capture out dir>"""
import base64, hashlib, json, os, sys
import numpy as np
from PIL import Image
S = 1008
src = sys.argv[1]; here = os.path.dirname(os.path.abspath(__file__)); tex = os.path.join(here, '..', 'textures')
bake = json.load(open(os.path.join(src, 'impostors-bake.json')))
man = {}
for id_, m in bake.items():
    files = {}
    for k in ('albedo', 'normal'):
        raw = base64.b64decode(open(os.path.join(src, f'{id_}.{k}.rgba.b64')).read())
        im = Image.fromarray(np.frombuffer(raw, np.uint8).reshape(S, S, 4), 'RGBA')
        p = os.path.join(tex, f'impostor.{id_}.{k}.webp')
        im.save(p, 'WEBP', lossless=True, exact=True, method=4)
        files[k] = f'impostor.{id_}.{k}.webp?{hashlib.sha256(open(p, "rb").read()).hexdigest()[:10]}'
    man[id_] = {'fingerprint': m['fingerprint'], 'center': m['center'], 'radius': m['radius'], **files}
    print(id_, files, f"{m['bakeMs'] / 1000:.0f} s")
json.dump(man, open(os.path.join(tex, 'impostors.json'), 'w'), indent=1)
