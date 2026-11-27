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
    # front-face reflectance calibrated to summer leaves (green ≈ 0.10–0.12 linear; Phase 4 used about half that):
    # pedunculate oak a deep green, silver birch a lighter yellow-green, Scots pine needles a glaucous blue-green
    'oak': ('LeafSet016', (0.058, 0.102, 0.024), 0.85),
    'birch': ('LeafSet014', (0.070, 0.118, 0.028), 0.8),
    'pine': ('PineNeedles001', (0.046, 0.082, 0.066), 0.75),
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
        # veins and midrib transmit less. Phase 4.4: no longer zeroed in transparent texels, which hold the dilated colour
        # of the nearest leaf and now its translucency too: mips averaged those zeros in, and at the LOD0 → LOD1 switch a
        # leaf transmitted only coverage × its translucency (pine 0.04, birch 0.23, oak 0.29 instead of 0.75), while the
        # spray cards transmit 0.75: backlit LOD1 was up to 45 % brighter than LOD0
        trans = np.clip(0.75 - 2.5 * (L - np.median(L[layer['a'] > 0.5])), 0.2, 1)
        files = save(lid, layer, trans)
        layer['t'] = trans
        sheets[lid] = (layer, meta)
        polys = outlines(layer)
        man['layers'].append({'id': lid, 'source': f'https://ambientcg.com/view?id={src}', 'sprites': meta, 'outlines': polys, 'alphaScale': alpha_scales(layer['a'], (4, 2)), **files})
        print(lid, 'outline triangles per sprite', [len(p) // 6 for p in polys])
        print(lid, len(meta), files)
    for lid, card in build_cards(sheets):
        # card normal maps store the folded normal's z in the blue channel (Phase 4.3) instead of roughness (the renderer
        # uses each species' sprite mean, 0.43 oak, 0.35 birch, 0.40 pine): filtering then averages whole normals, and the
        # averaged vector's length keeps the spread of the needles' and leaves' normals (render/viewer.ts fsFol). With z
        # rebuilt from a filtered x, y as unit length, every distant needle texel faced the card's front.
        card['r'] = np.clip(card['n'][..., 2], 0, 1)
        files = save(lid, card, card['t'])   # (dilated: mips must not average zeros into the side share)
        man['layers'].append({'id': lid, 'source': 'composited from the sprite layers (tools/foliage_textures.py)', 'grid': [2, 2], 'quadrants': ['spray', 'spray', 'clump from above', 'clump from the side'],
                              'hulls': card_hulls(card['a']), 'alphaScale': alpha_scales(card['a'], (2, 2)), **files})
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


def alpha_scales(a, grid=(1, 1), thr=0.5):
    """Coverage-preserving alpha mips (Castaño), per atlas cell: for each mip level of the box-filtered alpha, the scale
    that keeps the fraction of each cell's texels above the alpha-test threshold equal to level 0's. Per cell, because
    one scale for a whole layer is set by its densest cell (the clump card) and lets sparse cells (a birch spray)
    dissolve. Returns [[scale per cell] per level]; levels where a cell is under 2 texels repeat the last scales."""
    gx, gy = grid; N0 = a.shape[0]
    cells = lambda m: [m[(c // gx) * m.shape[0] // gy:(c // gx + 1) * m.shape[0] // gy, (c % gx) * m.shape[1] // gx:(c % gx + 1) * m.shape[1] // gx] for c in range(gx * gy)]
    cov0 = [float((c > thr).mean()) for c in cells(a)]
    out = [[1.0] * (gx * gy)]; m = a.astype(np.float64)
    while m.shape[0] > 1:
        m = m.reshape(m.shape[0] // 2, 2, m.shape[1] // 2, 2).mean(axis=(1, 3))
        if m.shape[0] // max(gx, gy) < 2: out.append(out[-1]); continue
        lev = []
        for c, c0 in zip(cells(m), cov0):
            if c0 <= 0: lev.append(1.0); continue
            lo, hi = 0.0, 64.0
            for _ in range(30):
                mid = (lo + hi) / 2
                if (np.clip(c * mid, 0, 1) > thr).mean() < c0: lo = mid
                else: hi = mid
            lev.append(round(hi, 4))
        out.append(lev)
    return out


def card_hulls(a, keep=8):
    """Tight card boundaries: per card kind (the three shoot quadrants together, the clump quadrant) the convex hull
    of the opaque texels, simplified to ≤ keep vertices (grown slightly so that nothing is clipped), triangulated as
    a fan, in template coordinates (x −0.5…0.5, y 0…1). Fewer empty fragments than the full quad."""
    import cv2
    H = a.shape[0] // 2; out = {}
    for kind, cells in (('shoot', (0, 1)), ('clump', (2, 3))):
        m = np.zeros((H, H), np.uint8)
        for c in cells:
            cx, cy = (c % 2) * H, (c // 2) * H
            m |= (a[cy:cy + H, cx:cx + H] > 0.02).astype(np.uint8)
        yx = np.argwhere(m > 0)
        pts = yx[:, ::-1].astype(np.int32).reshape(-1, 1, 2) if len(yx) else None
        if pts is None: out[kind] = [-0.5, 0, 0.5, 0, 0.5, 1, -0.5, 0, 0.5, 1, -0.5, 1]; continue
        hull = cv2.convexHull(pts)[:, 0, :].astype(np.float64)
        eps = 1.0
        while len(hull) > keep:
            ap = cv2.approxPolyDP(hull.astype(np.float32).reshape(-1, 1, 2), eps, True)[:, 0, :]
            if len(ap) <= keep: hull = ap.astype(np.float64); break
            eps *= 1.3
        # simplification cuts corners: push every edge outwards until all opaque texels are inside
        c0 = hull.mean(axis=0); P = pts[:, 0, :].astype(np.float64)
        grow = 1.0
        for _ in range(40):
            hh = c0 + (hull - c0) * grow
            hv = cv2.convexHull(hh.astype(np.float32))[:, 0, :].astype(np.float64)
            e0, e1 = hv, np.roll(hv, -1, axis=0)
            cr = (e1[:, 0] - e0[:, 0])[None] * (P[:, 1:2] - e0[None, :, 1]) - (e1[:, 1] - e0[:, 1])[None] * (P[:, 0:1] - e0[None, :, 0])
            if ((cr >= -0.5).all(axis=1) | (cr <= 0.5).all(axis=1)).all(): break
            grow *= 1.01
        hh = np.clip(c0 + (cv2.convexHull((c0 + (hull - c0) * grow).astype(np.float32))[:, 0, :] - c0), 0, H - 1)
        q = [(float(x) / H - 0.5, 1 - float(y) / H) for x, y in hh]
        tri = []
        for i in range(1, len(q) - 1): tri += [q[0], q[i], q[i + 1]]
        out[kind] = [round(v, 4) for p in tri for v in p]
        print('card hull', kind, len(q), 'vertices, area', round(cv2.contourArea(hh.astype(np.float32)) / H / H, 3))
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
        # premultiplied 'over', like paste3d (the card divides by coverage when it is complete); the twig's normal is
        # the card's (folded side = its upper side)
        if 'n' in dst: dst['n'][region] = np.array([0, 0, 1], np.float32) * A + dst['n'][region] * (1 - A)
        dst['r'][region] = 0.7 * a + dst['r'][region] * (1 - a)
        dst['t'][region] = 1.0 * a + dst['t'][region] * (1 - a)
        dst['a'][region] = a + dst['a'][region] * (1 - a)


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


# spray cards (LOD1, and the shaded interior at LOD0): one whole spray at true scale, so leaf size does not jump
# at the LOD switch. SPRAY[lid] = card height (m), leader length as a fraction of it (framework/foliage.ts sizes the
# card from the spray's leader with the same fraction).
# the leader lengths match the generator's mean leader (species shootLen), so the leaves keep their true size when a
# card is scaled to its spray: oak 0.62 m, birch 0.25 m, pine 0.084 m (its needles reach well past the leader)
SPRAY = {'oak': (1.0, 0.62), 'birch': (0.42, 0.6), 'pine': (0.24, 0.35)}
# leaves per card relative to the generator's density for one spray (a spray is two crossed cards, so 0.5 would be
# the same leaf area). Calibrated so that LOD1's projected crown coverage matches LOD0's at the LOD0/LOD1 switch
# (tools/evidence/lodcheck.js + tools/lod_metrics.py): minified alpha-tested leaves lose coverage, by species
CARD_DENSITY = {'oak': 0.85, 'birch': 1.05, 'pine': 1.0}


def spray_card(dst, sheet, lid, r):
    """A spray drawn as framework/foliage.ts grows it: a leader with laterals (oak: and sub-laterals), leaves along
    every shoot, seen from the front; the card's bottom centre is the spray's base, +y the leader's direction."""
    lyr, _ = sheet
    spr = lambda: cell_sprite(lyr, int(r.integers(0, 8)))
    H, frac = SPRAY[lid]; ppm = 512 / H
    shoots = []  # (base px, angle, length px, level)
    def grow(base, ang, L, level):
        shoots.append((base, ang, L, level))
        nlat = {'oak': (3, 5) if level == 0 else (1, 2) if level == 1 else (0, 0), 'birch': (2, 4) if level == 0 else (0, 1), 'pine': (1, 2) if level == 0 else (0, 0)}[lid]
        n = int(r.integers(nlat[0], nlat[1] + 1))
        for j in range(n):
            t = 0.2 + 0.7 * (j + r.uniform(0, 0.8)) / max(n, 1)
            lb = (base[0] + np.sin(ang) * L * t, base[1] - np.cos(ang) * L * t)
            a2 = ang + (1 if j % 2 else -1) * r.uniform(*({'oak': (0.5, 1.0), 'birch': (0.8, 1.3), 'pine': (0.45, 0.85)}[lid]))
            l2 = L * r.uniform(*({'oak': (0.45, 0.7), 'birch': (0.45, 0.8), 'pine': (0.5, 0.8)}[lid])) * (1 - t * 0.35)
            if l2 > 12: grow(lb, a2, l2, level + 1)
    grow((256.0, 505.0), r.uniform(-0.12, 0.12), H * frac * ppm * r.uniform(0.92, 1.05), 0)
    # wood first (thinner with level), then leaves from the back (spray base) to the front
    tw = {'oak': ((0.07, 0.058, 0.046), 0.006), 'birch': ((0.06, 0.03, 0.02), 0.003), 'pine': ((0.12, 0.06, 0.03), 0.005)}[lid]
    for (bx, by), ang, L, lv in shoots:
        tip = (bx + np.sin(ang) * L, by - np.cos(ang) * L)
        twig(dst, [(bx, by), tip], max(1.2, tw[1] * ppm * (0.7 ** lv)), tw[0])
    leaves = []
    for (bx, by), ang, L, lv in shoots:
        lm = L / ppm
        if lid == 'pine':
            n = int(lm * 900); 
            for k in range(n):
                t = r.random() ** 0.8; leaves.append(((bx + np.sin(ang) * L * t, by - np.cos(ang) * L * t), ang + (1 if k % 2 else -1) * r.uniform(0.4, 1.1), r.uniform(0.055, 0.08), 1.0, r.uniform(0.78, 1.0)))
        elif lid == 'oak':
            n = max(3, int(lm * 18 * 1.6))  # rosette-heavy towards the tip, like the generator
            for k in range(n):
                t = 1 - (r.random() ** 0.75) * 0.85
                leaves.append(((bx + np.sin(ang) * L * t, by - np.cos(ang) * L * t), ang + (1 if k % 2 else -1) * r.uniform(0.35, 1.3), r.uniform(0.085, 0.125), r.uniform(0.55, 1.0), r.uniform(0.86, 1.0)))
        else:
            n = max(2, int(lm * 24 * 1.4))
            for k in range(n):
                t = (k + 0.4) / n
                leaves.append(((bx + np.sin(ang) * L * t, by - np.cos(ang) * L * t), ang + (1 if k % 2 else -1) * r.uniform(1.9, 2.7), r.uniform(0.05, 0.075), r.uniform(0.6, 1.0), r.uniform(0.86, 1.0)))
    order = r.permutation(len(leaves))
    for k in order:
        p, ang, ln, ws, sh = leaves[k]
        paste(dst, spr(), p, ang, ln * ppm * 1.05, ws, 0.5 + 0.5 * sh)


def paste3d(dst, sp, base, w, a, nb, length_px, ws=1.0, needle=False):
    """Paste a sprite as a leaf in 3D, projected onto the card (card space: x right, y up, z towards the viewer). `w`,
    `a`, `nb`: the blade's across, along (towards the tip) and normal unit vectors; `base` in px. The blade is
    foreshortened by the projection; its normal map is carried into card space; a blade seen from behind is drawn the
    way the renderer draws a leaf underside (paler, greyer: render/viewer.ts fsFol) with its normal turned to the
    viewer. Returns nothing when the blade is edge-on."""
    k = length_px / CH
    U = np.array([w[0], -w[1]]) * k * ws; V = np.array([a[0], -a[1]]) * k     # image vector per sprite px
    M = np.array([[U[0], V[0]], [U[1], V[1]]]); det = np.linalg.det(M)
    if abs(det) < 0.02 * k * k: return
    Mi = np.linalg.inv(M)
    corners = [np.array(base) + U * (x - CW / 2) + V * (CH - 1 - y) for x in (0, CW) for y in (0, CH)]
    xs = [c[0] for c in corners]; ys = [c[1] for c in corners]
    H, W_ = dst['a'].shape
    x0, x1 = int(max(0, min(xs) - 2)), int(min(W_, max(xs) + 2)); y0, y1 = int(max(0, min(ys) - 2)), int(min(H, max(ys) + 2))
    if x1 <= x0 or y1 <= y0: return
    Y, X = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    dx, dy = X - base[0], Y - base[1]
    u = Mi[0, 0] * dx + Mi[0, 1] * dy; v = Mi[1, 0] * dx + Mi[1, 1] * dy
    sx, sy = CW / 2 + u, CH - 1 - v
    ok = (sx >= 0) & (sx < CW - 1) & (sy >= 0) & (sy < CH - 1)
    samp = lambda q: ndimage.map_coordinates(q, [sy, sx], order=1, mode='constant', cval=0)
    al = samp(sp['a']) * ok
    if al.max() <= 0: return
    col = np.stack([samp(sp['col'][..., j]) for j in range(3)], -1)
    nx, ny, nz = samp(sp['n'][..., 0]), samp(sp['n'][..., 1]), samp(sp['n'][..., 2])
    # the leaf's own (upper-side) normal in card space, not turned to the viewer, and which side of the blade faces the
    # card's front (stored in the translucency channel: 1 upper side, 0 underside). The renderer decides per view which
    # side each texel shows, so a card seen from below shows undersides, as LOD0's leaves do (render/viewer.ts fsFol)
    # the blade normal perturbed by the scan's normal map the way the renderer does it (render/viewer.ts fsFol:
    # normalize(Ng + (T nx + B ny) * 0.8))
    # (Phase 4.3: the blade's own normal, without the scan's normal map: filtered card normals are used at their mean
    # length, which must measure the spread between leaves, as LOD0 shows it; LOD0 filters a leaf's normal-map detail
    # away and renormalises, so that detail must not darken the cards)
    N = np.broadcast_to(np.asarray(nb, np.float64), nx.shape + (3,)).copy()
    # Phase 4.3: the normal is stored folded to the card's front hemisphere (z ≥ 0), so that only its in-plane part
    # needs storing and the renderer can rebuild z ≥ 0 from it; the translucency channel holds whether that folded side
    # is the blade's upper side. Needle blades are treated exactly like leaves: LOD0 pales the back of a needle blade
    # as it does a leaf's underside. (Phase 4.2 stored the unfolded normal's x, y and, for needles, a side share of 0.5:
    # the renderer rebuilt z from (2·share − 1) = 0 and every pine card normal lay in the card plane, which darkened
    # pine LOD1 by 21 % at eye level and 40 % from above.)
    up_side = (N[..., 2] >= 0).astype(np.float32)
    N = N * np.where(N[..., 2:3] >= 0, 1.0, -1.0)
    front = up_side
    region = (slice(y0, y1), slice(x0, x1)); A = al[..., None]
    dst['col'][region] = col * A + dst['col'][region] * (1 - A)
    dst['n'][region] = N * A + dst['n'][region] * (1 - A)
    dst['r'][region] = samp(sp['r']) * al + dst['r'][region] * (1 - al)
    dst['t'][region] = front * al + dst['t'][region] * (1 - al)   # (per texel: the folded side is the upper side)
    dst['a'][region] = al + dst['a'][region] * (1 - al)


def _n(v): v = np.asarray(v, np.float64); return v / max(np.linalg.norm(v), 1e-9)


def spray3d(lid, r, origin, d0, lead, density=1.0, light=(0.0, 0.0, 1.0)):
    """Generate one spray (shoots and leaves, card space, metres) as framework/foliage.ts grows it, in 3D, seen along the card normal: leader up the card, laterals
    spreading sideways and in depth, leaves turned round their shoots at the generator's angles (blades leaning towards
    the light, which is the card's front), at the generator's leaf density (leaves per metre, sun factor included).
    Leaves are painted back to front. The atlas stores full card-space normals, so a card is lit like the leaves it
    stands for."""
    up, Z = np.array([0.0, 1.0, 0.0]), np.array([0.0, 0.0, 1.0])
    shoots = []
    def grow(base, d, L, level):
        shoots.append((base, d, L, level))
        nlat = {'oak': (3, 5) if level == 0 else (1, 2) if level == 1 else (0, 0), 'birch': (2, 4) if level == 0 else (0, 1), 'pine': (1, 2) if level == 0 else (0, 0)}[lid]
        n = int(r.integers(nlat[0], nlat[1] + 1))
        for j in range(n):
            t = 0.2 + 0.7 * (j + r.uniform(0, 0.8)) / max(n, 1)
            lb = base + d * L * t
            ang = r.uniform(*({'oak': (0.5, 1.0), 'birch': (0.8, 1.3), 'pine': (0.45, 0.85)}[lid]))
            side = _n(np.cross(d, Z)) * (1 if j % 2 else -1)
            d2 = _n(d * np.cos(ang) + side * np.sin(ang) + Z * r.uniform(-0.45, 0.45))
            l2 = L * r.uniform(*({'oak': (0.45, 0.7), 'birch': (0.45, 0.8), 'pine': (0.5, 0.8)}[lid])) * (1 - t * 0.35)
            if l2 > 0.03: grow(lb, d2, l2, level + 1)
    grow(np.asarray(origin, np.float64), _n(d0), lead, 0)
    Lg = np.asarray(light, np.float64)   # light direction in card space (gravity is its opposite)
    leaves = []
    # leaf attitudes exactly as framework/foliage.ts sets them. The card's front is the sky (the renderer turns cards
    # so), so in card space the light direction is +z and gravity −z
    toLight = {'oak': 0.7, 'birch': 0.5, 'pine': 0.0}[lid]; droop = {'oak': 0.0, 'birch': 0.5, 'pine': 0.0}[lid]
    rot = lambda v, k, ang: v * np.cos(ang) + np.cross(k, v) * np.sin(ang) + k * np.dot(k, v) * (1 - np.cos(ang))
    for b, d, L, lv in shoots:
        side0 = _n(np.cross(d, Z if abs(d[2]) < 0.9 else up))
        if lid == 'pine':
            n = max(3, int(L * 260 * CARD_DENSITY[lid] * density))
            for k in range(n):
                t = r.random() ** 0.75; along = 1 - t
                p = b + d * L * along
                around = rot(side0, d, r.uniform(0, 2 * np.pi))
                splay = 0.5 + 0.55 * r.random() + 0.25 * along
                a = _n(d * np.cos(splay) + around * np.sin(splay))
                nb = rot(around, a, r.random() * np.pi); nb = _n(nb - a * np.dot(nb, a))
                leaves.append((p, a, nb, r.uniform(0.055, 0.075) * (0.85 + 0.25 * along), 1.0))
        else:
            per = {'oak': 18, 'birch': 24}[lid] * 0.8 * CARD_DENSITY[lid] * density
            n = max(2, int(round(L * per)))
            sun = 0.6
            for k in range(n):
                t = (k + 0.5) / n
                along = 1 - t if droop > 0 else 1 - t ** 1.15
                p = b + d * L * along
                around = rot(side0, d, r.uniform(0, 2 * np.pi))
                spread = 0.75 + 0.5 * r.random()
                a = _n(d * np.cos(spread) + around * np.sin(spread))
                a = _n(a - Lg * droop * (0.6 + 0.6 * r.random()))
                nb = Lg * toLight * (0.55 + 0.45 * (1 - sun)) + rot(around, a, (r.random() - 0.5) * 1.2) * (1 - toLight * 0.7)
                nb = _n(nb - a * np.dot(nb, a))
                ln = (r.uniform(0.085, 0.125) if lid == 'oak' else r.uniform(0.05, 0.075)) * (1.15 - 0.25 * sun)
                leaves.append((p, a, nb, ln, r.uniform(0.6, 1.0)))
    return shoots, leaves


def render_leaves(dst, sheet, r, shoots, leaves, ppm, to_px, wood=True, needle=False):
    """Paint generated leaves (and the leaders' wood) into a card, back to front."""
    lyr, _ = sheet
    tw = (0.07, 0.058, 0.046)
    if wood:
        for b, d, L, lv in shoots:
            if lv == 0: twig(dst, [to_px(b), to_px(b + d * L)], 1.0, tw)
    for p, a, nb, ln, ws in sorted(leaves, key=lambda q: q[0][2]):
        paste3d(dst, cell_sprite(lyr, int(r.integers(0, 8))), to_px(p), _n(np.cross(a, nb)), a, nb, ln * ppm * 1.05, ws, needle)


def spray_card3d(dst, sheet, lid, r):
    """A spray card (LOD1, and shaded interior sprays at LOD0): one spray at true scale, its leader up the card. Leaves
    keep the generator's attitudes; the atlas stores full card-space normals and the leaf-side share, so a card is lit
    like the leaves it stands for (render/viewer.ts fsFol)."""
    H, frac = SPRAY[lid]; ppm = 512 / H
    shoots, leaves = spray3d(lid, r, (0, 0, 0), (r.uniform(-0.1, 0.1), 1, 0), H * frac * r.uniform(0.92, 1.05))
    render_leaves(dst, sheet, r, shoots, leaves, ppm, lambda p: (256 + p[0] * ppm, 505 - p[1] * ppm), needle=lid == 'pine')


# LOD2 clump cards: a cluster of sprays at true scale; (card edge m, sprays, leaf density per card). A clump is drawn
# as a tent of three cards and a cap (framework/foliage.ts), so each card carries part of the cluster's leaves
CLUMP = {'oak': (1.6, 9, 0.52), 'birch': (1.1, 14, 0.75), 'pine': (1.3, 70, 0.42)}


def clump_card3d(dst, sheet, lid, r, view='side'):
    """A clump (LOD2): sprays radiating from a branchlet into a dome (birch: hanging curtains), in 3D, seen from the
    side, the card's bottom centre at the branchlet's base. Same leaves, attitudes and channels as the spray cards."""
    E, n, dens = CLUMP[lid]; ppm = 512 / E; H, frac = SPRAY[lid]
    # the same clump (same seed) from the side (the tent cards; light +y, card bottom at the branchlet) or from above
    # (the cap card; light +z towards the viewer, the clump centred): world (x, up, z) → card space
    top = view == 'top'
    if top: ppm = 512 / (E * 1.35)   # seen from above the sprays spread wider than the side view's edge
    to_card = (lambda v: np.array([v[0], -v[2], v[1]])) if top else (lambda v: np.asarray(v, np.float64))
    shoots, leaves = [], []
    for k in range(n):
        az = r.uniform(0, 2 * np.pi)
        if lid == 'birch':   # hanging: sprays start high and fall
            o = np.array([r.uniform(-0.38, 0.38) * E, r.uniform(0.6, 0.9) * E, r.uniform(-0.2, 0.2) * E])
            d = _n([r.uniform(-0.25, 0.25), -1.0, r.uniform(-0.25, 0.25)])
        else:                # a dome: sprays leaving a centre outwards and upwards
            rr = 0.12 if lid == 'oak' else 0.32   # pine tufts spread over the clump
            o = np.array([np.cos(az) * r.uniform(0, rr) * E, r.uniform(0.25, 0.45 if lid == 'oak' else 0.75) * E, np.sin(az) * r.uniform(0, rr) * E])
            el = r.uniform(0.1, 1.2)
            d = _n([np.cos(az) * np.cos(el), np.sin(el), np.sin(az) * np.cos(el)])
        # a clump card stands upright (seen from the side): the light is up the card, +y
        s_, l_ = spray3d(lid, r, to_card(o), to_card(d), H * frac * r.uniform(0.8, 1.05), dens, light=tuple(to_card((0.0, 1.0, 0.0))))
        shoots += s_; leaves += l_
    oy = 256 + 0.0 * E * ppm if top else 505
    render_leaves(dst, sheet, r, shoots, leaves, ppm, lambda p: (256 + p[0] * ppm, oy - p[1] * ppm), wood=False, needle=lid == 'pine')


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
        # every channel is composited premultiplied ('over' from zero, paste3d) and divided by the coverage afterwards.
        # (Phase 4.2 started the normal at (0, 0, 1), the roughness at 0.6 and the colour at black and kept the result
        # as straight values: every partly covered texel was darkened, and two-to-three-texel needles are mostly partly
        # covered texels: pine card albedo was 13 % below its needles' and edge texels up to 38 %)
        card = {'col': np.zeros((N, N, 3), np.float32), 'a': np.zeros((N, N), np.float32), 'n': np.zeros((N, N, 3), np.float32), 'r': np.zeros((N, N), np.float32), 't': np.zeros((N, N), np.float32)}
        for q in range(2): spray_card3d(quadrant(card, q), sheets[lid], lid, r)
        clump_card3d(quadrant(card, 2), sheets[lid], lid, np.random.default_rng(77), view='top')
        clump_card3d(quadrant(card, 3), sheets[lid], lid, np.random.default_rng(77), view='side')
        cov = np.maximum(card['a'], 1e-6)
        card['col'] /= cov[..., None]; card['n'] /= cov[..., None]; card['r'] /= cov; card['t'] /= cov
        m = card['a'] > 0.35
        _, (iy, ix) = ndimage.distance_transform_edt(~m, return_indices=True)
        for key in ('col', 'n', 'r', 't'): card[key] = card[key][iy, ix]
        card['n'] = card['n'] / np.maximum(np.linalg.norm(card['n'], axis=-1, keepdims=True), 1e-6)
        out.append(('card-' + lid, card))
    return out


if __name__ == '__main__':
    if '--fetch' in sys.argv: fetch()
    build()
