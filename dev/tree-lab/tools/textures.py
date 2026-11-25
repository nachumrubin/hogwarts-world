#!/usr/bin/env python3
"""Tree Lab bark texture build (offline, deterministic).

Input: Poly Haven CC0 photoscanned bark sets at 1k (diffuse, OpenGL normal, roughness, displacement, AO) in
dev/tree-lab/textures/source/ (not committed; fetch with --fetch, see SOURCES). Output: one packed pair per material
layer, used by the renderer as two texture arrays:
  <layer>.albedo.webp  RGB albedo (sRGB), A height (0 = deepest fissure, 1 = outermost bark)
  <layer>.normal.webp  RG tangent-space normal (x across the branch, y along it, OpenGL), B roughness, A occlusion
and textures/manifest.json (layer order, real-world tile size, sources and licences).

Layers:
  0 oak      bark_willow_02 (deep longitudinal fissures, weathered plates) -- also the birch base, recoloured in the shader
  1 pinelow  pine_bark (thick fractured plates, red-brown in the fissures)
  2 pineup   japanese_zelkova_bark, recoloured to the thin orange papery flakes of an upper Scots pine stem
  3 birch    sakura_bark (horizontal lenticels, fine vertical cracks), recoloured to silver birch: white paper bark,
             lenticels and cracks dark, plus synthetic long dark lenticels and peeling strips (deterministic)

Usage: python3 tools/textures.py [--fetch]
"""
import json, hashlib, os, subprocess, sys
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'textures')
SRC = os.path.join(OUT, 'source')
MIRROR = 'https://github.com/zuujis-cc0'  # CC0 mirror of polyhaven.com (git), see SOURCES
SOURCES = {
    'bark_willow_02': 'polyhaven-textures-wood', 'pine_bark': 'polyhaven-textures-wood-3',
    'japanese_zelkova_bark': 'polyhaven-textures-wood-2', 'sakura_bark': 'polyhaven-textures-wood-3',
    'forest_leaves_02': 'polyhaven-textures-ground-and-terrain-2',
}
# layer id, source, real-world tile width/height (m), notes
LAYERS = [
    ('oak', 'bark_willow_02', 1.0, 'old pedunculate oak trunk and limbs; birch base (recoloured in the shader)'),
    ('pinelow', 'pine_bark', 1.5, 'Scots pine lower trunk plates'),
    ('pineup', 'japanese_zelkova_bark', 0.7, 'Scots pine upper stem flakes (recoloured orange)'),
    ('birch', 'sakura_bark', 1.1, 'silver birch paper bark (recoloured white, dark lenticels)'),
    ('ground', 'forest_leaves_02', 2.5, 'woodland review environment: summer forest floor (moss, leaf litter)'),
]
MAPS = ['diff', 'nor_gl', 'rough', 'disp', 'ao']


def fetch():
    os.makedirs(SRC, exist_ok=True)
    for name, repo in SOURCES.items():
        tmp = f'/tmp/tl-{repo}'
        if not os.path.isdir(tmp):
            subprocess.run(['git', 'clone', '-q', '--depth', '1', '--filter=blob:none', '--no-checkout', f'{MIRROR}/{repo}', tmp], check=True,
                           env={**os.environ, 'GIT_LFS_SKIP_SMUDGE': '1'})
        for m in MAPS:
            r = subprocess.run(['git', '-C', tmp, 'show', f'HEAD:{name}/1k/{name}_{m}_1k.jpg'], capture_output=True)
            if r.returncode and m == 'diff': r = subprocess.run(['git', '-C', tmp, 'show', f'HEAD:{name}/1k/{name}_diffuse_1k.jpg'], check=True, capture_output=True)
            data = r.stdout
            open(os.path.join(SRC, f'{name}_{m}.jpg'), 'wb').write(data)


def load(name, m, mode='RGB'):
    return np.asarray(Image.open(os.path.join(SRC, f'{name}_{m}.jpg')).convert(mode), dtype=np.float32) / 255.0


def srgb2lin(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def lin2srgb(c): c = np.clip(c, 0, 1); return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)
def lum(c): return c[..., 0] * 0.2126 + c[..., 1] * 0.7152 + c[..., 2] * 0.0722


def blur_wrap(a, s): return ndimage.gaussian_filter(a, s, mode='wrap')


def norm01(a, lo=1, hi=99):
    p0, p1 = np.percentile(a, [lo, hi]); return np.clip((a - p0) / max(p1 - p0, 1e-6), 0, 1)


def tile_noise(n, cells, seed, aniso=(1, 1)):
    """Tileable smooth value noise: a random lattice, tiled 3 x 3, cubic-upsampled, centre tile kept."""
    rng = np.random.default_rng(seed)
    g = rng.random((cells, cells)).astype(np.float32)
    big = ndimage.zoom(np.tile(g, (3, 3)), n / cells, order=3)
    return big[n:2 * n, n:2 * n]


def recolour(lin_rgb, L_target_dark, L_target_light, t):
    """Map a mask t in [0,1] to a colour between two linear colours."""
    return L_target_dark[None, None, :] * (1 - t[..., None]) + L_target_light[None, None, :] * t[..., None]


def birch_layer(diff, nrm, rough, disp, ao, n):
    """White paper bark from the cherry scan: its lenticels and cracks (lighter than its dark bark) become the dark
    marks; long horizontal lenticels and thin peeling strips are added (seeded, tileable)."""
    L = lum(srgb2lin(diff))
    hp = L - blur_wrap(L, 6)                      # local contrast: lenticels and crack edges
    marks = np.clip(hp * 9, 0, 1) ** 1.2           # bright features of the cherry bark
    cracks = np.clip((blur_wrap(disp, 1) - blur_wrap(disp, 10)) * -10, 0, 1)  # recessed cracks
    rng = np.random.default_rng(7)
    lent = np.zeros((n, n), np.float32)
    for _ in range(330):  # long dark horizontal lenticels, 1-6 cm at 1.1 m per tile (drawn in a local window, wrapped)
        cx, cy = rng.random() * n, rng.random() * n
        half = rng.uniform(5, 28) * (1 if rng.random() > 0.15 else 1.8)
        th = rng.uniform(1.4, 3.4); sk = 0.02 * rng.uniform(-1, 1); amp = rng.uniform(0.55, 1.0)
        x0, y0 = int(cx - half) - 1, int(cy - 8)
        yy, xx = np.mgrid[y0:y0 + 17, x0:x0 + int(2 * half) + 3].astype(np.float32)
        dx = xx - cx; dy = yy - cy + sk * dx
        e = np.clip(1 - (dx / half) ** 2, 0, 1) ** 0.6 * np.exp(-(dy / th) ** 2) * amp
        iy, ix = (yy.astype(int) % n), (xx.astype(int) % n)
        np.maximum.at(lent, (iy, ix), e)
    # peeling strips: horizontal bands where the outer paper has lifted, showing the cream-orange layer beneath
    strip = np.clip((tile_noise(n, 8, 12) - 0.68) * 7, 0, 1) * np.clip((ndimage.uniform_filter1d(tile_noise(n, 64, 13), 61, axis=1, mode='wrap') - 0.45) * 6, 0, 1)
    white = np.array([0.80, 0.79, 0.75], np.float32); grey = np.array([0.50, 0.50, 0.49], np.float32)
    dark = np.array([0.045, 0.040, 0.038], np.float32); under = np.array([0.72, 0.50, 0.34], np.float32)
    shade = norm01(blur_wrap(L, 2)) * 0.35 + norm01(tile_noise(n, 6, 14)) * 0.65
    base = recolour(None, grey, white, np.clip(0.35 + 0.8 * shade, 0, 1))
    dm = np.clip(np.maximum(np.maximum(marks * 0.55, cracks * 0.3), lent), 0, 1)
    col = base * (1 - dm[..., None]) + dark * dm[..., None]
    col = col * (1 - 0.35 * strip[..., None]) + under * 0.35 * strip[..., None]
    h = np.clip(disp * 0.6 + 0.4 - 0.35 * dm + 0.12 * strip, 0, 1)
    # normals: the scan's, plus the lenticels as shallow horizontal grooves
    gy = np.gradient(blur_wrap(lent, 0.8), axis=0)
    nx, ny = nrm[..., 0] * 2 - 1, nrm[..., 1] * 2 - 1
    ny = ny - gy * 1.5  # image row index grows downwards; OpenGL green points up
    r = np.clip(rough * 0.5 + 0.45 + 0.1 * dm, 0, 1)
    return col, h, nx, ny, r, ao


def build():
    if not os.path.isdir(SRC) or len(os.listdir(SRC)) < 20:
        sys.exit('missing sources: run with --fetch')
    man = {'layers': [], 'size': 1024, 'license': 'CC0 1.0 (Poly Haven)', 'tool': 'tools/textures.py'}
    for lid, name, tile, note in LAYERS:
        diff, nrm, rough = load(name, 'diff'), load(name, 'nor_gl'), load(name, 'rough', 'L')
        disp, ao = load(name, 'disp', 'L'), load(name, 'ao', 'L')
        n = diff.shape[0]
        lin = srgb2lin(diff)
        nx, ny = nrm[..., 0] * 2 - 1, nrm[..., 1] * 2 - 1
        h = norm01(disp, 0.5, 99.5)
        if lid == 'oak':
            # slightly browner and darker than the willow scan, fissures a little deeper in tone
            col = lin * np.array([1.0, 0.93, 0.82], np.float32) * (0.78 + 0.22 * h[..., None])
            r = rough
        elif lid == 'pinelow':
            # Scots pine plates: grey-brown, the scan's orange retained in the fissures but less saturated
            g = lum(lin)[..., None]
            col = (lin * 0.65 + g * 0.35) * np.array([0.92, 0.82, 0.74], np.float32) * (0.72 + 0.28 * h[..., None])
            r = rough
        elif lid == 'pineup':
            # thin papery flakes: orange-copper ground, paler apricot where flakes have freshly fallen, grey edges
            L = lum(lin); t = norm01(L) ** 1.4
            fresh = np.clip((lin[..., 0] - lin[..., 2]) * 6 - 0.4, 0, 1)  # the scan's orange patches
            ground = recolour(None, np.array([0.12, 0.045, 0.02], np.float32), np.array([0.50, 0.21, 0.085], np.float32), t)
            col = ground * (1 - fresh[..., None]) + np.array([0.70, 0.36, 0.17], np.float32) * fresh[..., None]
            edge = np.clip((blur_wrap(h, 3) - h) * 8, 0, 1)
            col = col * (1 - 0.3 * edge[..., None]) + np.array([0.14, 0.12, 0.10], np.float32) * 0.3 * edge[..., None]
            r = np.clip(rough * 0.6 + 0.3, 0, 1)
        elif lid == 'ground':
            # remove the scan's low-frequency light falloff (it betrays the tiling): divide by a wide blur, keep the mean
            lo = np.stack([blur_wrap(lin[..., c], 60) for c in range(3)], -1)
            col = lin / np.maximum(lo, 1e-4) * lo.reshape(-1, 3).mean(0)
            r = rough
        else:
            col, h, nx, ny, r, ao = birch_layer(diff, nrm, rough, h, ao, n)
        a = Image.fromarray(np.dstack([lin2srgb(col) * 255, h * 255]).round().astype(np.uint8), 'RGBA')
        b = Image.fromarray(np.dstack([(nx * 0.5 + 0.5) * 255, (ny * 0.5 + 0.5) * 255, r * 255, ao * 255]).clip(0, 255).round().astype(np.uint8), 'RGBA')
        files = {}
        for k, im in (('albedo', a), ('normal', b)):
            p = os.path.join(OUT, f'{lid}.{k}.webp')
            im.save(p, 'WEBP', quality=88, method=4, exact=True)
            files[k] = f'{lid}.{k}.webp?{hashlib.sha256(open(p, "rb").read()).hexdigest()[:10]}'
        man['layers'].append({'id': lid, 'source': f'https://polyhaven.com/a/{name}', 'tile': tile, 'note': note, **files})
        print(lid, files)
    json.dump(man, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)


if __name__ == '__main__':
    if '--fetch' in sys.argv: fetch()
    build()
