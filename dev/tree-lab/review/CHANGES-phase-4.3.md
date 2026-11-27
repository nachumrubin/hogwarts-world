# Tree Lab, Phase 4.3: LOD transition fidelity

Baseline: 8d541c3 (Phase 4.2). Chain B (LOD0 → LOD1 shoot cards → impostor) stays the default; the four-level chain
(A, clump cards) stays selectable and is in the benchmark. No work went into the clump cards. Skeletons, bark, crown
architecture, LOD0 foliage distribution and specimen seeds are unchanged (see "LOD0" below for the one shared-data
effect on LOD0's deep-interior cards).

Everything here was measured in SwiftShader (software). No hardware performance is claimed.

## 1. Method

* **Protocol measurements** (unchanged definitions): `tools/evidence/lodcheck.js` + `tools/lod_metrics.py`, both
  sides of each switch at the switch size, 900 × 900, `day` light, eye 0.12 rad and overhead 1.45 rad at azimuth 0.6.
  Before = the Phase 4.2 run of 8d541c3, after = this phase. `tools/lod_compare.py` writes the table and the sheets.
* **Shading diagnostics** (new, `viewer.diag`, `tools/evidence/diag.js`, `tools/diag_metrics.py`): the foliage shader
  writes one term at a time: unlit albedo (1), world normal (2), visible side (3), direct sun (4), ambient (5), no
  transmission (6), no self-shadowing (7), coverage (8), card/blade facing (10), top mip only (12), full linear (13),
  output on black (15), coverage from the top mip (16), ground shadow alone (14). Wood and ground are magenta and the
  background black, so every pixel's term is recovered exactly from its foliage coverage (un-premultiplied); the first
  attempt drew the sky behind the terms, which blended each partly covered pixel with the sky and made the terms
  non-additive. That attempt's numbers were discarded.
* **The baseline** for diagnostics is a worktree of 8d541c3 with only the diagnostic modes added
  (`/home/claude/work/before`, not committed).

## 2. Pine luminance: root cause

(see §2 table, filled from review/lod/pine-diagnostics.md)
