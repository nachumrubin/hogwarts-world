"""Run with blender -b --python-exit-code 1 -P tools/check-hippogriff-fold.py."""
from pathlib import Path
from subprocess import Popen, PIPE
from itertools import combinations
import json
import numpy as np
from mathutils.bvhtree import BVHTree

exporter = Path(__file__).with_name("hippogriff-audit-stream.mjs")
for lod in range(3):
    with Popen(["node", str(exporter), str(lod)], stdout=PIPE) as stream:
        groups = json.loads(stream.stdout.readline())
        faces = [np.array(g["indices"]).reshape(-1, 3).tolist() for g in groups]
        counts = [g["vertices"] for g in groups]
        pairs = [(i, j) for i, j in combinations(range(len(groups)), 2)
                 if groups[i]["wing"] or groups[j]["wing"]]
        hits = 0
        midline_clearance = float("inf")
        for frame in range(482):
            raw = stream.stdout.read(12 * sum(counts))
            vertices = np.frombuffer(raw, dtype=np.float32).reshape(-1, 3)
            parts = np.split(vertices, np.cumsum(counts)[:-1])
            trees, lower, upper = [], [], []
            for g, part, triangles in zip(groups, parts, faces):
                lower.append(part.min(axis=0))
                upper.append(part.max(axis=0))
                if g["wing"]:
                    midline_clearance = min(midline_clearance, lower[-1][0])
                trees.append(BVHTree.FromPolygons(part.tolist(), triangles, all_triangles=True))
            for i, j in pairs:
                if np.all(lower[i] <= upper[j]) and np.all(lower[j] <= upper[i]):
                    hits += len(trees[i].overlap(trees[j]))
        assert stream.wait() == 0
        print(f"LOD {lod}: 482 poses; {hits} intersecting triangle pairs; "
              f"nearest right wing vertex to midline {midline_clearance:.3f} m.")
        # The other wing is its mirror. Positive X clearance excludes
        # cross-wing contact throughout the sampled sequence.
        assert hits == 0 and midline_clearance > 0
