#!/usr/bin/env python3
"""Tree Lab foliage texture build (offline, deterministic).

Input: ambientCG CC0 photoscanned leaf atlases at 2k (Color, Opacity, NormalGL, Roughness) in
dev/tree-lab/textures/foliage-source/ (not committed; --fetch gets them from the CC0 git mirror). Output, in
dev/tree-lab/textures/: one packed pair per foliage layer, used by the renderer as two texture arrays:
  foliage.<layer>.albedo.webp   RGB front albedo (sRGB), A opacity
  foliage.<layer>.normal.webp   RG tangent normal (x across, y towards the tip, OpenGL), B roughness, A translucency
and textures/foliage.json (layer order, sprite grid, sources, licences).

Sprite layers (single leaves / fascicles, 4 x 2 grid of 256 x 512 cells, base of the leaf at the bottom-centre of
the cell, tip up):
  oak     LeafSet016 (lobed Quercus leaves), recoloured to mid-summer green; 6 scans + 2 mirrored
  birch   LeafSet014 (doubly serrated, acuminate), base widened towards the silver birch's deltoid outline,
          recoloured; 6 scans + 2 mirrored
  pine    PineNeedles001 (two-needle fascicles), turned base-down and recoloured from dry brown to the glaucous
          blue-green of living Scots pine needles; 8 of the 10 scans
Card layers (LOD1 shoot cards, LOD2 clump cards) are composited from the same sprites by compose_cards(), so all
LODs share the scanned leaves.

Usage: python3 tools/foliage_textures.py [--fetch]
"""
import json, hashlib, os, subprocess, sys
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'textures')
SRC = os.path.join(OUT, 'foliage-source')
REPO = 'https://github.com/zuujis-cc0/ambientcg-atlases'  # CC0 mirror of ambientcg.com
SETS = ['LeafSet016', 'LeafSet014', 'PineNeedles001']
MAPS = ['Color', 'Opacity', 'NormalGL', 'Roughness']
N = 1024; CW, CH = 256, 512


def fetch():
    os.makedirs(SRC, exist_ok=True)
    tmp = '/tmp/tl-ambientcg-atlases'
    if not os.path.isdir(tmp):
        subprocess.run(['git', 'clone', '-q', '--depth', '1', '--filter=blob:none', '--no-checkout', REPO, tmp], check=True, env={**os.environ, 'GIT_LFS_SKIP_SMUDGE': '1'})
    for s in SETS:
        for m in MAPS:
            data = subprocess.run(['git', '-C', tmp, 'show', f'HEAD:{s}/2K-JPG/{s}_2K-JPG_{m}.jpg'], check=True, capture_output=True).stdout
            open(os.path.join(SRC, f'{s}_{m}.jpg'), 'wb').write(data)


def load(s, m, mode='RGB'): return np.asarray(Image.open(os.path.join(SRC, f'{s}_{m}.jpg')).convert(mode), dtype=np.float32) / 255.0
def srgb2lin(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def lin2srgb(c): c = np.clip(c, 0, 1); return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)
def lum(c): return c[..., 0] * 0.2126 + c[..., 1] * 0.7152 + c[..., 2] * 0.0722


def sprites(s, min_px=2000):
    """Connected components of the opacity map: each scanned leaf / fascicle with all its maps."""
    col, op, nrm, ro = load(s, 'Color'), load(s, 'Opacity', 'L'), load(s, 'NormalGL'), load(s, 'Roughness', 'L')
    lab, n = ndimage.label(op > 0.5)
    sizes = ndimage.sum(op > 0.5, lab, range(1, n + 1))
    out = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        if sizes[i] < min_px: continue
        y0, y1, x0, x1 = max(sl[0].start - 6, 0), sl[0].stop + 6, max(sl[1].start - 6, 0), sl[1].stop + 6
        m = (lab[y0:y1, x0:x1] == i + 1).astype(np.float32)
        a = np.minimum(op[y0:y1, x0:x1], ndimage.binary_dilation(m > 0, iterations=3))  # this sprite only
        out.append({'col': col[y0:y1, x0:x1], 'a': a, 'n': nrm[y0:y1, x0:x1] * 2 - 1, 'r': ro[y0:y1, x0:x1]})
    out.sort(key=lambda d: -d['a'].sum())
    return out


def rot90(sp, k):
    """Rotate a sprite by k × 90° counter-clockwise, normals included."""
    r = {key: np.rot90(v, k) for key, v in sp.items()}
    n = r['n'].copy()
    for _ in range(k % 4): n = np.stack([-n[..., 1], n[..., 0], n[..., 2]], -1)  # (x, y) → (−y, x)
    r['n'] = n
    return r


def mirror(sp):
    r = {key: v[:, ::-1] for key, v in sp.items()}
    r['n'] = r['n'] * np.array([-1, 1, 1], np.float32)
    return r


def base_down(sp):
    """Turn a needle fascicle upright with its base (where the needles join: the narrower end) at the bottom."""
    if sp['a'].shape[1] > sp['a'].shape[0]: sp = rot90(sp, 1)
    a = sp['a'] > 0.5; k = max(4, a.shape[0] // 10)
    top, bot = a[:k].any(0).sum(), a[-k:].any(0).sum()
    return rot90(sp, 2) if top < bot else sp


def widen_base(sp, amt=0.32):
    """Silver birch outline: a broader, straighter-sided (deltoid) blade base than the scanned leaf."""
    h, w = sp['a'].shape
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    ys_op = np.where(sp['a'] > 0.5)[0]; top, bot = ys_op.min(), ys_op.max()
    t = (ys - top) / max(bot - top, 1)  # 0 tip … 1 petiole end
    s = 1 + amt * np.clip((t - 0.35) / 0.3, 0, 1) * np.clip((0.86 - t) / 0.12, 0, 1)
    cx = w / 2
    pad = int(w * amt * 0.5) + 4
    W2 = w + 2 * pad
    ys2, xs2 = np.mgrid[0:h, 0:W2].astype(np.float32)
    t2 = (ys2 - top) / max(bot - top, 1)
    s2 = 1 + amt * np.clip((t2 - 0.35) / 0.3, 0, 1) * np.clip((0.86 - t2) / 0.12, 0, 1)
    src_x = cx + (xs2 - pad - cx) / s2
    out = {}
    for key, v in sp.items():
        chans = v[..., None] if v.ndim == 2 else v
        res = np.stack([ndimage.map_coordinates(chans[..., c], [ys2, src_x], order=1, mode='constant', cval=0) for c in range(chans.shape[-1])], -1)
        out[key] = res[..., 0] if v.ndim == 2 else res
    out['n'][..., 0] /= np.maximum(s2, 1)
    return out


def recolour(sp, target, keep=0.25, gamma=0.85):
    """Summer pigmentation: the scan's luminance pattern (veins, blotches) on a species base colour, a little of the
    scan's own hue variation kept."""
    lin = srgb2lin(sp['col']); L = lum(lin); m = sp['a'] > 0.5
    rel = (L / max(np.median(L[m]), 1e-4)) ** gamma
    out = np.asarray(target, np.float32)[None, None, :] * rel[..., None]
    hue = lin / np.maximum(L[..., None], 1e-4) * np.asarray(target, np.float32).mean() * rel[..., None]
    return np.clip(out * (1 - keep) + hue * keep, 0, 1)


def place(layer, sp, lin, cell, fill=0.94):
    """Scale a sprite into its cell: base at the bottom centre, height (or width) filling the cell."""
    h, w = sp['a'].shape
    k = min(CH * fill / h, CW * fill / w)
    nh, nw = max(1, int(round(h * k))), max(1, int(round(w * k)))
    rs = lambda v: np.asarray(Image.fromarray(v.astype(np.float32)).resize((nw, nh), Image.LANCZOS)) if v.ndim == 2 else np.stack([np.asarray(Image.fromarray(v[..., c].astype(np.float32)).resize((nw, nh), Image.LANCZOS)) for c in range(v.shape[-1])], -1)
    cx, cy = (cell % 4) * CW, (cell // 4) * CH
    x0, y0 = cx + (CW - nw) // 2, cy + CH - nh - int(CH * 0.02)
    sl = (slice(y0, y0 + nh), slice(x0, x0 + nw))
    layer['col'][sl] = rs(lin); layer['a'][sl] = np.clip(rs(sp['a']), 0, 1)
    layer['n'][sl] = rs(sp['n']); layer['r'][sl] = rs(sp['r'])
    return {'cell': cell, 'aspect': nw / nh, 'fill': nh / CH}


def finish(layer):
    """Bleed colour, normals and roughness into the transparent texels (no dark fringes in the mips)."""
    m = layer['a'] > 0.35
    _, (iy, ix) = ndimage.distance_transform_edt(~m, return_indices=True)
    for key in ('col', 'n', 'r'): layer[key] = layer[key][iy, ix]
    n = layer['n']; n = n / np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6); layer['n'] = n
    return layer


def save(lid, layer, trans):
    a = Image.fromarray(np.dstack([lin2srgb(layer['col']) * 255, layer['a'] * 255]).round().clip(0, 255).astype(np.uint8), 'RGBA')
    b = Image.fromarray(np.dstack([(layer['n'][..., 0] * 0.5 + 0.5) * 255, (layer['n'][..., 1] * 0.5 + 0.5) * 255, layer['r'] * 255, trans * 255]).round().clip(0, 255).astype(np.uint8), 'RGBA')
    files = {}
    for k, im in (('albedo', a), ('normal', b)):
        p = os.path.join(OUT, f'foliage.{lid}.{k}.webp')
        im.save(p, 'WEBP', quality=90, method=4, exact=True)
        files[k] = f'foliage.{lid}.{k}.webp?{hashlib.sha256(open(p, "rb").read()).hexdigest()[:10]}'
    return files


def blank(): return {'col': np.zeros((N, N, 3), np.float32), 'a': np.zeros((N, N), np.float32), 'n': np.dstack([np.zeros((N, N)), np.zeros((N, N)), np.ones((N, N))]).astype(np.float32), 'r': np.full((N, N), 0.6, np.float32)}


SPECIES = {
    # target linear base colour (front face), roughness scale, sources
    'oak': ('LeafSet016', (0.040, 0.068, 0.016), 0.85),
    'birch': ('LeafSet014', (0.055, 0.090, 0.020), 0.8),
    'pine': ('PineNeedles001', (0.030, 0.052, 0.036), 0.75),
}


def build():
    if not os.path.isdir(SRC) or len(os.listdir(SRC)) < 12: sys.exit('missing sources: run with --fetch')
    man = {'size': N, 'grid': [4, 2], 'cell': [CW, CH], 'license': 'CC0 1.0 (ambientCG)', 'tool': 'tools/foliage_textures.py', 'layers': []}
    sheets = {}
    for lid, (src, target, rough) in SPECIES.items():
        sps = sprites(src)
        if lid == 'pine':
            sps = [base_down(s) for s in sps]
            sps = sps[1:7] + [mirror(sps[2]), mirror(sps[4])]  # the two curled scans (base not resolvable) are left out
        else:
            if lid == 'birch': sps = [widen_base(s) for s in sps]
            sps = sps[:6] + [mirror(sps[1]), mirror(sps[4])]
        layer = blank(); meta = []
        for k, sp in enumerate(sps):
            sp = dict(sp); sp['r'] = np.clip(sp['r'] * rough, 0.25, 1)
            meta.append(place(layer, sp, recolour(sp, target), k))
        layer = finish(layer)
        L = lum(layer['col'])
        trans = np.clip(0.75 - 2.5 * (L - np.median(L[layer['a'] > 0.5])), 0.2, 1) * (layer['a'] > 0.05)  # veins and midrib transmit less
        files = save(lid, layer, trans)
        layer['t'] = trans
        sheets[lid] = (layer, meta)
        polys = outlines(layer)
        man['layers'].append({'id': lid, 'source': f'https://ambientcg.com/view?id={src}', 'sprites': meta, 'outlines': polys, **files})
        print(lid, 'outline triangles per sprite', [len(p) // 6 for p in polys])
        print(lid, len(meta), files)
    for lid, card in build_cards(sheets):
        files = save(lid, card, card['t'] * (card['a'] > 0.05))
        man['layers'].append({'id': lid, 'source': 'composited from the sprite layers (tools/foliage_textures.py)', 'grid': [2, 2], 'quadrants': ['shoot', 'shoot', 'shoot', 'clump'], **files})
        print(lid, files)
    json.dump(man, open(os.path.join(OUT, 'foliage.json'), 'w'), indent=1)


# ---------------------------------------------------------------- leaf outlines (the "geometry" representation)
def ear_clip(pts):
    """Triangulate a simple polygon (list of (x, y)), counter-clockwise or not."""
    P = list(pts)
    area = sum(P[i][0] * P[(i + 1) % len(P)][1] - P[(i + 1) % len(P)][0] * P[i][1] for i in range(len(P)))
    if area < 0: P.reverse()
    idx = list(range(len(P))); tris = []
    def inside(p, a, b, c):
        d = lambda u, v, w: (u[0] - w[0]) * (v[1] - w[1]) - (v[0] - w[0]) * (u[1] - w[1])
        d1, d2, d3 = d(p, a, b), d(p, b, c), d(p, c, a)
        return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))
    guard = 0
    while len(idx) > 3 and guard < 10000:
        guard += 1
        for k in range(len(idx)):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            a, b, c = P[i0], P[i1], P[i2]
            if (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 0: continue  # reflex
            if any(inside(P[j], a, b, c) for j in idx if j not in (i0, i1, i2)): continue
            tris += [a, b, c]; idx.pop(k); break
        else: break
    if len(idx) == 3: tris += [P[idx[0]], P[idx[1]], P[idx[2]]]
    return tris


def outlines(layer, eps=0.008):
    """Per cell: the sprite's outline (opacity 0.5), simplified, triangulated, in template coordinates
    (x across −0.5…0.5, y from the base 0…1)."""
    import cv2
    out = []
    for cell in range(8):
        cx, cy = (cell % 4) * CW, (cell // 4) * CH
        m = (layer['a'][cy:cy + CH, cx:cx + CW] > 0.5).astype(np.uint8)
        cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        if not cs: out.append([]); continue
        c = max(cs, key=cv2.contourArea)
        ap = cv2.approxPolyDP(c, eps * CH, True)[:, 0, :]
        pts = [(float(x) / CW - 0.5, 1 - float(y) / CH) for x, y in ap]
        tri = ear_clip(pts)
        out.append([round(v, 4) for p in tri for v in p])
    return out


# ---------------------------------------------------------------- cards (LOD1 shoot cards, LOD2 clump cards)
def cell_sprite(layer, cell):
    cx, cy = (cell % 4) * CW, (cell // 4) * CH
    sl = (slice(cy, cy + CH), slice(cx, cx + CW))
    return {k: layer[k][sl] for k in ('col', 'a', 'n', 'r', 't')}


def paste(dst, sp, base, angle, length, ws=1.0, shade=1.0):
    """Paste a sprite (base at the bottom centre of its cell, tip up) with its base at `base` (px), rotated by
    `angle` (rad, clockwise from up), `length` px from base to the top of the cell, width × ws. Normals rotate with
    it; `shade` darkens leaves deeper in the shoot."""
    k = length / CH
    c, s_ = np.cos(angle), np.sin(angle)
    R = max(CH, CW) * k * 1.05
    x0, x1 = int(max(0, base[0] - R)), int(min(dst['a'].shape[1], base[0] + R))
    y0, y1 = int(max(0, base[1] - R)), int(min(dst['a'].shape[0], base[1] + R))
    if x1 <= x0 or y1 <= y0: return
    Y, X = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    dx, dy = X - base[0], Y - base[1]
    # undo the rotation (screen coordinates, y down), then the scale
    ux, uy = dx * c + dy * s_, -dx * s_ + dy * c
    sx, sy = CW / 2 + ux / (k * ws), CH - 1 + uy / k
    ok = (sx >= 0) & (sx < CW - 1) & (sy >= 0) & (sy < CH - 1)
    samp = lambda v: ndimage.map_coordinates(v, [sy, sx], order=1, mode='constant', cval=0)
    a = samp(sp['a']) * ok
    if a.max() <= 0: return
    region = (slice(y0, y1), slice(x0, x1))
    col = np.stack([samp(sp['col'][..., j]) for j in range(3)], -1) * shade
    nx, ny, nz = samp(sp['n'][..., 0]) / max(ws, 0.2), samp(sp['n'][..., 1]), samp(sp['n'][..., 2])
    rnx, rny = nx * c + ny * s_, -nx * s_ + ny * c
    n = np.stack([rnx, rny, nz], -1)
    ro = samp(sp['r']); tr = samp(sp['t'])
    A = a[..., None]
    dst['col'][region] = col * A + dst['col'][region] * (1 - A)
    dst['n'][region] = n * A + dst['n'][region] * (1 - A)
    dst['r'][region] = ro * a + dst['r'][region] * (1 - a)
    dst['t'][region] = tr * a + dst['t'][region] * (1 - a)
    dst['a'][region] = a + dst['a'][region] * (1 - a)


def twig(dst, pts, width, colour):
    """Draw a thin twig polyline (px) into a card."""
    H, W = dst['a'].shape
    Y, X = np.mgrid[0:H, 0:W].astype(np.float32)
    for (ax, ay), (bx, by) in zip(pts[:-1], pts[1:]):
        x0, x1 = int(max(0, min(ax, bx) - width - 2)), int(min(W, max(ax, bx) + width + 2))
        y0, y1 = int(max(0, min(ay, by) - width - 2)), int(min(H, max(ay, by) + width + 2))
        if x1 <= x0 or y1 <= y0: continue
        xx, yy = X[y0:y1, x0:x1], Y[y0:y1, x0:x1]
        vx, vy = bx - ax, by - ay; L2 = max(vx * vx + vy * vy, 1e-6)
        t = np.clip(((xx - ax) * vx + (yy - ay) * vy) / L2, 0, 1)
        d = np.hypot(xx - ax - t * vx, yy - ay - t * vy)
        a = np.clip(width / 2 + 0.5 - d, 0, 1)
        region = (slice(y0, y1), slice(x0, x1)); A = a[..., None]
        dst['col'][region] = np.asarray(colour, np.float32) * A + dst['col'][region] * (1 - A)
        dst['a'][region] = np.maximum(dst['a'][region], a)
        dst['r'][region] = 0.7 * a + dst['r'][region] * (1 - a)
        dst['t'][region] = dst['t'][region] * (1 - a)


def quadrant(card, q):
    """A 512² quadrant of a card layer as a writable view dict."""
    x, y = (q % 2) * 512, (q // 2) * 512
    sl = (slice(y, y + 512), slice(x, x + 512))
    return {k: card[k][sl] for k in ('col', 'a', 'n', 'r', 't')}


def shoot_card(dst, sheet, lid, r, cx=256, cy=500, scale=1.0, shade=1.0):
    """One shoot drawn as the 3D generator grows it (framework/foliage.ts), seen from the front."""
    lyr, _ = sheet
    spr = lambda: cell_sprite(lyr, int(r.integers(0, 8)))
    if lid == 'oak':
        ppm = 512 / 0.34 * scale  # px per metre
        L = r.uniform(0.07, 0.15) * ppm
        bend = r.uniform(-0.25, 0.25)
        tip = (cx + np.sin(bend) * L, cy - np.cos(bend) * L)
        twig(dst, [(cx, cy), ((cx + tip[0]) / 2 + r.uniform(-4, 4), (cy + tip[1]) / 2), tip], max(2.0, 0.005 * ppm), (0.07, 0.058, 0.046))
        n = int(r.integers(5, 10))
        order = sorted(range(n), key=lambda k: r.random())
        for j, k in enumerate(order):
            t = 1 - (k + 0.5) / n * 0.7
            p = (cx + (tip[0] - cx) * t, cy + (tip[1] - cy) * t)
            ang = bend + (1 if k % 2 else -1) * r.uniform(0.35, 1.25)
            paste(dst, spr(), p, ang, r.uniform(0.085, 0.125) * ppm * 1.05, r.uniform(0.55, 1.0), shade * (0.85 + 0.15 * j / max(n - 1, 1)))
    elif lid == 'birch':
        ppm = 512 / 0.22 * scale
        L = r.uniform(0.11, 0.16) * ppm
        bend = r.uniform(-0.3, 0.3)
        tip = (cx + np.sin(bend) * L, cy - np.cos(bend) * L)
        twig(dst, [(cx, cy), tip], max(1.5, 0.0025 * ppm), (0.06, 0.03, 0.02))
        n = int(r.integers(4, 8))
        for k in range(n):
            t = (k + 0.4) / n
            p = (cx + (tip[0] - cx) * t, cy + (tip[1] - cy) * t)
            # birch leaves hang from their petioles, back along the hanging shoot
            ang = bend + (1 if k % 2 else -1) * r.uniform(1.9, 2.7)
            paste(dst, spr(), p, ang, r.uniform(0.05, 0.075) * ppm * 1.05, r.uniform(0.6, 1.0), shade * r.uniform(0.8, 1.0))
    else:
        ppm = 512 / 0.16 * scale
        L = 0.15 * ppm
        tip = (cx + r.uniform(-6, 6), cy - L)
        twig(dst, [(cx, cy), tip], max(1.5, 0.004 * ppm), (0.12, 0.06, 0.03))
        n = int(r.integers(80, 100))
        for k in range(n):
            t = r.random() ** 0.8
            p = (cx + (tip[0] - cx) * t, cy + (tip[1] - cy) * t)
            ang = (1 if k % 2 else -1) * r.uniform(0.35, 0.95)
            paste(dst, spr(), p, ang, r.uniform(0.045, 0.065) * ppm * 1.05, 1.0, shade * r.uniform(0.75, 1.0))


def clump_card(dst, sheet, lid, r):
    """A cluster of shoots on a branchlet (LOD2), the card's bottom centre being the branchlet's base."""
    edge = {'oak': 1.6, 'birch': 1.1, 'pine': 1.3}[lid]
    unit = {'oak': 0.34, 'birch': 0.22, 'pine': 0.16}[lid]
    scale = unit / edge  # a shoot card's metre scale inside the clump
    n = {'oak': 75, 'birch': 70, 'pine': 70}[lid]
    pts = []
    for k in range(n):
        if lid == 'birch':  # a curtain of hanging shoots
            x = r.uniform(110, 402); y = r.uniform(70, 300)
        else:  # a dome
            a = r.uniform(0, 2 * np.pi); rr = np.sqrt(r.random())
            x = 256 + np.cos(a) * rr * 140; y = 300 + np.sin(a) * rr * 120
        pts.append((x, y))
    pts.sort(key=lambda p: p[1])  # back (top) first: lower ones overlap them
    for j, (x, y) in enumerate(pts):
        sub = {k: v for k, v in dst.items()}
        shoot_card(sub, sheet, lid, r, cx=x, cy=y + (40 if lid != 'birch' else -10), scale=scale * (1.6 if lid == 'pine' else 1.0), shade=0.82 + 0.18 * (j / n))


def build_cards(sheets):
    out = []
    for lid in ('oak', 'birch', 'pine'):
        r = np.random.default_rng({'oak': 5, 'birch': 6, 'pine': 7}[lid])
        card = {'col': np.zeros((N, N, 3), np.float32), 'a': np.zeros((N, N), np.float32), 'n': np.dstack([np.zeros((N, N)), np.zeros((N, N)), np.ones((N, N))]).astype(np.float32), 'r': np.full((N, N), 0.6, np.float32), 't': np.zeros((N, N), np.float32)}
        for q in range(3): shoot_card(quadrant(card, q), sheets[lid], lid, r, cy=500 if lid != 'birch' else 500)
        clump_card(quadrant(card, 3), sheets[lid], lid, r)
        m = card['a'] > 0.35
        _, (iy, ix) = ndimage.distance_transform_edt(~m, return_indices=True)
        for key in ('col', 'n', 'r', 't'): card[key] = card[key][iy, ix]
        card['n'] = card['n'] / np.maximum(np.linalg.norm(card['n'], axis=-1, keepdims=True), 1e-6)
        out.append(('card-' + lid, card))
    return out


if __name__ == '__main__':
    if '--fetch' in sys.argv: fetch()
    build()
