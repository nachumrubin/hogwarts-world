"""Rebuild the production centaur bind packet from the approved B.5 geometry.

Run python tools/prepare-centaur-bind.py PATH_TO_MAKEHUMAN_DATA
with NumPy, SciPy, Node and Blender 4.3 available. The CC0 hand source is
makehumancommunity/makehuman, a8bc2d54ff0ac92e78ff71431b1023eda42bf482.
"""

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np


def pose_donor(p, data):
    vs = []
    groups = {}
    for line in (data / "3dobjs/base.obj").open():
        w = line.split()
        if not w:
            continue
        if w[0] == "v":
            vs.append(list(map(float, w[1:4])))
        if w[0] == "g":
            g = groups[w[1]] = []
        if w[0] == "f":
            g.append([int(i.split("/")[0]) - 1 for i in w[1:]])
    v = np.array(vs)
    for name, fac in [
        ("caucasian-male-young", 1),
        ("universal-male-young-maxmuscle-averageweight", 0.55),
    ]:
        a = np.loadtxt(data / "targets/macrodetails" / (name + ".target"))
        v[a[:, 0].astype(int)] += fac * a[:, 1:]

    def center(name):
        return v[np.unique(np.array(groups["joint-" + name]))].mean(0)

    from scipy.spatial.transform import Rotation

    original = v.copy()
    weights = json.loads((data / "rigs/default_weights.mhw").read_text())["weights"]
    arm_mask = np.zeros(len(v))
    for side, sign in [("l", 1), ("r", -1)]:
        shoulder, elbow, wrist = [
            center(side + "-" + j) for j in ["shoulder", "elbow", "hand"]
        ]

        def orient(a, b):
            a = a / np.linalg.norm(a)
            b = b / np.linalg.norm(b)
            ax = np.cross(a, b)
            return Rotation.from_rotvec(
                ax / np.linalg.norm(ax) * np.arccos(np.dot(a, b))
            )

        u = orient(elbow - shoulder, np.array([sign * 0.28, -1, -0.10]))
        eu = shoulder + u.apply(elbow - shoulder)
        fore = u.apply(wrist - elbow)
        lo = orient(fore, np.array([sign * 0.11, -1, 0.26])) * u
        for name, items in weights.items():
            if not name.endswith(side.upper()) or not name.startswith(
                ("upperarm", "lowerarm", "finger", "metacarpal", "wrist")
            ):
                continue
            influence = np.array(items)
            idx = influence[:, 0].astype(int)
            ww = influence[:, 1]
            alt = (
                u.apply(original[idx] - shoulder) + shoulder
                if name.startswith("upperarm")
                else lo.apply(original[idx] - elbow) + eu
            )
            v[idx] += (alt - original[idx]) * ww[:, None]
            arm_mask[idx] += ww
    np.savez(
        p / "upper.npz",
        verts=v,
        faces=np.array(groups["body"]),
        keep=(original[:, 1] > 1.55) | (arm_mask > 0.6),
    )


def prepare_digits(p, data):
    import bmesh
    import bpy

    bpy.ops.wm.read_factory_settings(use_empty=True)
    a = np.load(p / "upper.npz")
    q = a["verts"]
    v = np.column_stack(
        (q[:, 0] * 0.108, 1.467 + (q[:, 1] - 1.55) * 0.108, 0.668 + q[:, 2] * 0.108)
    )
    # Relax the donor digits around their own knuckles. Digit 1 is the opposable
    # thumb; each subsequent phalanx inherits the preceding joint transform.

    from mathutils import Matrix, Vector

    weights = json.loads((data / "rigs/default_weights.mhw").read_text())["weights"]
    neutral = v.copy()
    for suffix, sign in [("L", 1), ("R", -1)]:
        for digit in range(1, 6):
            rows = [np.array(weights[f"finger{digit}-{k}.{suffix}"]) for k in (1, 2, 3)]
            centers = [
                np.average(
                    neutral[row[:, 0].astype(int)], axis=0, weights=row[:, 1] ** 3
                )
                for row in rows
            ]
            tr = np.eye(4)
            for k, row in enumerate(rows):
                # Proximal end of the phalanx, inferred from adjacent segment centres.
                pivot = centers[k] - 0.48 * (
                    centers[min(k + 1, 2)] - centers[max(k - 1, 0)]
                ) / (2 if k == 1 else 1)
                rz = -sign * (
                    [0.06, 0.09, 0.105, 0.15, 0.18][digit - 1] if k == 0 else 0.115
                )
                rx = (0.46 if k == 0 else 0.08) if digit == 1 else -0.025
                rot = Matrix.Rotation(rx, 4, "X") @ Matrix.Rotation(rz, 4, "Z")
                v0 = Vector(pivot)
                tr = tr @ np.array(
                    Matrix.Translation(v0) @ rot @ Matrix.Translation(-v0)
                )
                idx = row[:, 0].astype(int)
                vv = neutral[idx] @ tr[:3, :3].T + tr[:3, 3]
                v[idx] += (vv - neutral[idx]) * row[:, 1, None]
    f = a["faces"]
    mask = a["keep"] & (abs(v[:, 0]) > 0.193) & (v[:, 1] < 1.54)
    f = f[mask[f].all(1)]
    ids, rev = np.unique(f, return_inverse=True)
    m = bpy.data.meshes.new("Thumb webs and fingers")
    m.from_pydata(v[ids].tolist(), [], rev.reshape(-1, 4).tolist())
    m.update()
    o = bpy.data.objects.new("Hand", m)
    bpy.context.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    sub = o.modifiers.new("Smooth knuckles", "SUBSURF")
    sub.levels = 2
    bpy.ops.object.modifier_apply(modifier=sub.name)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    # Cut both forearms normal to the resting forearm.
    bmesh.ops.bisect_plane(
        bm,
        geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
        plane_co=(0, 1.510, 0),
        plane_no=(0, 1, 0),
        clear_outer=True,
    )
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.to_mesh(o.data)
    v = np.array([list(v.co) for v in o.data.vertices])
    f = np.array([list(f.vertices) for f in o.data.polygons])
    np.savez(p / "hands.npz", v=v, f=f)


def fit_grafts_and_limbs(p):
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    from scipy.spatial import Delaunay, cKDTree

    v = np.fromfile(p / "verts.bin", "<f4").reshape(-1, 3).astype(float)
    f = np.fromfile(p / "faces.bin", "<u4").reshape(-1, 3).astype(int)

    def edge_loops(f):
        ed = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
        _, idx, count = np.unique(
            np.sort(ed, axis=1), axis=0, return_index=True, return_counts=True
        )
        edges = ed[idx[count == 1]]
        # Orient opposite to the existing faces, ready to continue the surface.
        nxt = dict(edges[:, ::-1])
        out = []
        while nxt:
            i = next(iter(nxt))
            loop = []
            while i in nxt:
                loop.append(i)
                i = nxt.pop(i)
            out.append(np.array(loop))
        return out

    x, h, z = v.T
    remove = (abs(x) > 0.163) & (h < 1.444) & (h > 1.035) & (z > 0.48)
    f = f[~remove[f].any(1)]
    loops = edge_loops(f)

    vs = list(v)
    fs = list(f)
    wrist_loops = {}

    def addtri(a, b, c):
        fs.append([a, b, c])

    for loop in loops:
        s = np.sign(v[loop, 0].mean())
        if v[loop, 1].min() > 1.4:
            wrist_loops[s] = loop
            continue
        # Harmonic disk spans the intact lateral shoulder around the former finger contact.

        edge = v[loop]
        length = np.linalg.norm(np.roll(edge, -1, axis=0) - edge, axis=1)
        t = 2 * np.pi * np.r_[0, np.cumsum(length[:-1])] / sum(length)
        rim = np.column_stack([np.cos(t), np.sin(t)])
        # The radial Poisson kernel gives a harmonic extension of the complete spatial
        # rim. Sampling on a disk avoids overlapping rays on the concave axillary edge.
        grid = np.arange(-0.96, 0.97, 0.058)
        uv = np.array(
            [
                (u + 0.029 * (i % 2), w)
                for i, w in enumerate(grid)
                for u in grid
                if (u + 0.029 * (i % 2)) ** 2 + w * w < 0.968**2
            ]
        )
        wt = (np.roll(length, 1) + length) * 0.5
        factor = wt[None, :] / np.maximum(
            1e-10, ((uv[:, None, :] - rim[None, :, :]) ** 2).sum(2)
        )
        pts = (factor @ edge) / factor.sum(1)[:, None]
        r2 = np.sum(uv * uv, axis=1)
        pts += (1 - r2)[:, None] * np.array([s * 0.046, 0, 0.018])
        idx = np.r_[loop, np.arange(len(vs), len(vs) + len(pts))]
        vs.extend(pts)
        fs.extend(idx[Delaunay(np.vstack((rim, uv))).simplices])
    # Fit the donor forearm to each cut loop; zipper triangulation preserves both loops.
    d = np.load(p / "hands.npz")
    dv = d["v"]
    df = d["f"]
    for side in [-1, 1]:
        mask = dv[:, 0] * side > 0.19
        ff = df[mask[df].all(1)]
        ids, inv = np.unique(ff, return_inverse=True)
        hv = dv[ids].copy()
        hf = inv.reshape(-1, 3)
        # Only the arm component is retained.
        edges = np.concatenate([hf[:, [0, 1]], hf[:, [1, 2]]])
        _, labels = connected_components(
            coo_matrix((np.ones(len(edges)), edges.T), shape=(len(hv), len(hv))),
            directed=False,
        )
        which = labels[np.argmin(hv[:, 1])]
        ff = hf[(labels[hf] == which).all(1)]
        ids, inv = np.unique(ff, return_inverse=True)
        hv = hv[ids]
        hf = inv.reshape(-1, 3)
        lower = edge_loops(hf)[0]
        old = wrist_loops[side]

        top = hv[lower].mean(0)
        bind = v[old].mean(0)
        # Keep the palm/pollex web intact. Shorten the distal phalanges and flex
        # the fingers progressively towards the palm without thickening the wrist.
        y = hv[:, 1].copy()
        x = hv[:, 0] * side
        fwd = hv[:, 2].copy()
        wrist = 1.405
        fold = np.clip((1.322 - y) / 0.133, 0, 1)
        thumb = np.clip((0.288 - x) / 0.052, 0, 1) * np.clip(
            (fwd - 0.743) / 0.065, 0, 1
        )
        hv[:, 1] = y + 0.17 * np.maximum(0, wrist - y) + 0.012 * fold**2
        hv[:, 0] -= side * (0.017 * fold**2 * (1 - thumb) - 0.009 * thumb)
        hv[:, 2] += 0.010 * fold * (1 - thumb) - 0.008 * thumb
        delta = bind - top
        delta[1] -= 0.012
        hv += delta
        # Match proximal radii progressively over 7 cm, retaining palm breadth.
        scale = np.ptp(v[old][:, [0, 2]], axis=0) / np.ptp(hv[lower][:, [0, 2]], axis=0)
        fade = np.clip((y - 1.435) / 0.075, 0, 1)
        for k, m in [(0, 0), (2, 1)]:
            hv[:, k] += (hv[:, k] - bind[k]) * (scale[m] - 1) * fade
        start = len(vs)
        vs.extend(hv)
        fs.extend(hf + start)
        # Ordered loops wound in opposite directions at the graft.
        aa = old
        bb = lower[::-1] + start
        j = np.argmin(np.linalg.norm(hv[bb - start] - v[aa[0]], axis=1))
        bb = np.roll(bb, -j)

        def fractions(ring):
            length = np.linalg.norm(np.roll(ring, -1, axis=0) - ring, axis=1)
            return np.r_[0, np.cumsum(length)] / sum(length)

        ta = fractions(v[aa])
        tb = fractions(hv[bb - start])
        ii = jj = 0
        while ii < len(aa) or jj < len(bb):
            a0 = aa[ii % len(aa)]
            b0 = bb[jj % len(bb)]
            if ii < len(aa) and (jj == len(bb) or ta[ii + 1] <= tb[jj + 1]):
                addtri(a0, aa[(ii + 1) % len(aa)], b0)
                ii += 1
            else:
                addtri(a0, bb[(jj + 1) % len(bb)], b0)
                jj += 1
    v = np.array(vs)
    f = np.array(fs)
    ids, inv = np.unique(f, return_inverse=True)
    v = v[ids]
    f = inv.reshape(-1, 3)
    # Fair both grafts across the joined perimeter, preserving the wrist and the
    # broad scapular attachment outside a narrow collar around each cut.
    edges = np.concatenate((f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]))
    adj = coo_matrix((np.ones(len(edges)), edges.T), shape=(len(v), len(v))).tocsr()
    adj = adj + adj.T
    degree = np.asarray(adj.sum(1)).ravel()
    x, h, z = v.T.copy()
    arm = (abs(x) > 0.257) & (z > 0.617)
    graft = arm * np.exp(-(((h - 1.449) / 0.035) ** 2))
    shoulder = np.zeros(len(v))
    for loop in loops:
        if len(loop) < 200:
            continue
        # The original vertex ids map to the trimmed surface through the compacted index.
        dist = cKDTree(np.array(vs)[loop]).query(v)[0]
        shoulder = np.maximum(shoulder, np.exp(-((dist / 0.031) ** 2)))
    w = 0.72 * np.maximum(graft, shoulder)
    region = np.flatnonzero(w > 0.005)
    subset = adj[region]
    for _ in range(44):
        v[region] += w[region, None] * (subset @ v / degree[region, None] - v[region])
    # Taper the cannon, ease the ring at the fetlock and keep the toe wall
    # continuous with the pastern. Each bearing rim remains on y=0.
    x, h, z = v.T.copy()
    leg = (h < 0.72) & (z > -0.80)
    cx = np.sign(x) * np.where(z > 0, 0.215, 0.220)
    g = lambda c, r: np.exp(-(((h - c) / r) ** 2))
    v[:, 0] += (
        (x - cx)
        * leg
        * (
            -0.095 * g(0.176, 0.035)
            - 0.085 * g(0.50, 0.040)
            - 0.028 * g(0.33, 0.095)
            + 0.025 * g(0.12, 0.030)
        )
    )
    v[:, 2] += leg * (
        0.006 * g(0.14, 0.05) - 0.005 * g(0.17, 0.024) + 0.003 * g(0.035, 0.035)
    )
    if edge_loops(f):
        raise ValueError("Unclosed graft on the production bind mesh")
    np.savez(p / "sculpt.npz", v=v, f=f)


def decimate_levels(p):
    import bpy

    d = np.load(p / "sculpt.npz")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for name, ratio in [("near", 0.74), ("mid", 0.33), ("far", 0.12)]:
        m = bpy.data.meshes.new(name)
        m.from_pydata(d["v"].tolist(), [], d["f"].tolist())
        m.update()
        o = bpy.data.objects.new(name, m)
        bpy.context.collection.objects.link(o)
        bpy.context.view_layer.objects.active = o
        mod = o.modifiers.new(name, "DECIMATE")
        mod.ratio = ratio
        bpy.ops.object.modifier_apply(modifier=mod.name)
        v = np.array([v.co[:] for v in o.data.vertices])
        f = np.array([f.vertices[:] for f in o.data.polygons])
        np.savez(p / f"{name}.npz", v=v, f=f)
        bpy.data.objects.remove(o, do_unlink=True)


def pack_levels(p, out):
    import base64
    import struct
    import zlib

    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components

    def components(v, f, mask):
        ff = f[mask[f].all(1)]
        edges = np.concatenate((ff[:, [0, 1]], ff[:, [1, 2]]))
        _, lab = connected_components(
            coo_matrix((np.ones(len(edges)), edges.T), shape=(len(v), len(v))),
            directed=False,
        )
        return lab

    with out.open("w") as fp:
        fp.write(
            "// Production bind surfaces derived from the approved B.5 mesh. The wrist grafts\n// use the CC0 MakeHuman hands (the same source as the B.2 upper body).\n// Each zlib stream stores counts, delta-coded XYZ micrometres, triangle deltas, and anatomical regions.\nexport const bindLevels = [\n"
        )
        for name in ["near", "mid", "far"]:
            d = np.load(p / f"{name}.npz")
            v = d["v"]
            f = d["f"]
            x, h, z = v.T
            tags = np.zeros(len(v), np.uint8)
            allmask = np.ones(len(v), bool)
            cc = components(v, f, allmask)
            tags[cc == cc[np.argmin(z)]] = 1
            cut = components(v, f, h < 1.755)
            for side in [1, -1]:
                idx = np.flatnonzero(
                    (x * side > 0.28) & (h < 1.44) & (h > 1.37) & (z > 0.67)
                )
                arm = cut == cut[idx[np.argmax(x[idx] * side)]]
                tags[arm] = 2
            quant = np.round(v * 1e6).astype("i4").T
            pd = np.diff(quant, axis=1, prepend=np.zeros((3, 1), dtype="i4")).astype(
                "<i4"
            )
            ix = f.flatten().astype("i4")
            ind = np.diff(ix, prepend=np.int32(0)).astype("<i4")
            packet = (
                struct.pack("<II", len(v), len(f))
                + pd.tobytes()
                + ind.tobytes()
                + tags.tobytes()
            )
            fp.write(
                "  '" + base64.b64encode(zlib.compress(packet, 9)).decode() + "',\n"
            )
        fp.write("];\n")


def main():
    if "--" in sys.argv:
        phase, work, data = sys.argv[sys.argv.index("--") + 1 :]
        if phase == "digits":
            prepare_digits(Path(work), Path(data))
        elif phase == "levels":
            decimate_levels(Path(work))
        else:
            raise ValueError(phase)
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data", type=Path)
    root = Path(__file__).resolve().parents[1]
    parser.add_argument(
        "--output", type=Path, default=root / "creature-lab/species/centaur-bind.js"
    )
    args = parser.parse_args()
    seed = """
import {readFile, writeFile} from 'node:fs/promises';
import {loadCentaurB5Geometry} from './creature-lab/species/static/centaur-b5.js';
globalThis.fetch = async url => new Response(await readFile(url));
const geo = await loadCentaurB5Geometry();
for (const [name, array] of [['verts',geo.attributes.position.array],['faces',geo.index.array]]) {
  await writeFile(process.argv[1] + '/' + name + '.bin',Buffer.from(array.buffer,array.byteOffset,array.byteLength));
}
"""
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp)
        subprocess.run(
            ["node", "--input-type=module", "-e", seed, tmp], cwd=root, check=True
        )
        pose_donor(p, args.data)

        def blender(phase):
            subprocess.run(
                [
                    "blender",
                    "-b",
                    "--threads",
                    "2",
                    "--python-exit-code",
                    "1",
                    "-P",
                    str(Path(__file__).resolve()),
                    "--",
                    phase,
                    tmp,
                    str(args.data.resolve()),
                ],
                check=True,
            )

        blender("digits")
        fit_grafts_and_limbs(p)
        blender("levels")
        pack_levels(p, p / "bind.js")
        args.output.write_bytes((p / "bind.js").read_bytes())


if __name__ == "__main__":
    main()
