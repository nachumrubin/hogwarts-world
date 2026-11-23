"""blender -b -P tools/check-equine-intersections.py -- LAB_DIRECTORY REPORT.json"""
from pathlib import Path
from subprocess import Popen, PIPE
from itertools import combinations
from mathutils.bvhtree import BVHTree
import json
import sys
import numpy as np

lab, output = sys.argv[sys.argv.index("--") + 1:]
exporter = Path(__file__).with_name("equine-intersection-stream.mjs")
report = {"samplesPerAnimal": 481, "lod": 0, "species": {}}
for species in ("centaur", "unicorn"):
    with Popen(["node", str(exporter), lab, species], stdout=PIPE) as process:
        groups = json.loads(process.stdout.readline())
        counts = [g["vertices"] for g in groups]
        faces = [np.array(g["faces"]).reshape(-1, 3).tolist() for g in groups]
        labels = [g["name"] for g in groups]
        findings = {}
        for frame in range(481):
            raw = process.stdout.read(12 * sum(counts))
            points = np.split(np.frombuffer(raw, dtype=np.float32).reshape(-1, 3), np.cumsum(counts)[:-1])
            bvh = [BVHTree.FromPolygons(p.tolist(), f, all_triangles=True) for p, f in zip(points, faces)]
            low = [p.min(axis=0) for p in points]
            high = [p.max(axis=0) for p in points]
            checks = []
            for i, j in combinations(range(len(groups)), 2):
                a, b = labels[i], labels[j]
                if (a == "body" and b.startswith("leg")) or a[-1] == b[-1]:
                    continue  # Proximal body attachments and each pastern/hoof join overlap by design.
                if (low[i] <= high[j]).all() and (low[j] <= high[i]).all():
                    checks.append((a + "/" + b, len(bvh[i].overlap(bvh[j]))))
            for i, g in enumerate(groups):
                if g["distalFaces"]:
                    distal = BVHTree.FromPolygons(points[i].tolist(), g["distalFaces"], all_triangles=True)
                    checks.append(("body/distal-" + labels[i], len(bvh[0].overlap(distal))))
            for i, name in enumerate(labels):
                if not (name.startswith("leg") or (name == "body" and species == "unicorn")):
                    continue
                # Connected faces meet along their shared edge or vertex.
                overlaps = sum(1 for a,b in bvh[i].overlap(bvh[i]) if a < b and set(faces[i][a]).isdisjoint(faces[i][b]))
                checks.append((name + "/self", overlaps))
            for name, hits in checks:
                if hits:
                    detail = findings.setdefault(name, {"frames": [], "peakIntersectingPairs": 0})
                    detail["frames"].append(frame)
                    detail["peakIntersectingPairs"] = max(hits,detail["peakIntersectingPairs"])
        if process.wait():
            raise RuntimeError("Frame export failed")
        report["species"][species] = findings
Path(output).write_text(json.dumps(report, indent=2) + "\n")
