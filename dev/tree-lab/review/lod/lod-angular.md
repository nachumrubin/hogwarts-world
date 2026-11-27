| specimen | boundary | views | worst Δ coverage (view) | worst Δ luminance (view) | views passing |
|---|---|---|---|---|---|
| Oak A | LOD0 → LOD1 (700 px) | 2 | -5.8 (over) | -6.6 % (over) | 1 of 2 |
| Oak A | LOD1 → impostor (140 px) | 2 | +8.9 (over) | -3.1 % (over) | 0 of 2 |
| Oak B | LOD0 → LOD1 (700 px) | 8 | -7.5 (e45@2.7) | +21.2 % (e0@2.7) | 0 of 8 |
| Oak B | LOD1 → impostor (140 px) | 8 | +10.8 (e0) | -13.9 % (e0@2.7) | 1 of 8 |
| Oak C | LOD0 → LOD1 (700 px) | 2 | -6.3 (over) | -7.6 % (over) | 1 of 2 |
| Oak C | LOD1 → impostor (140 px) | 2 | -1.8 (over) | +9.1 % (eye) | 1 of 2 |
| Scots pine | LOD0 → LOD1 (700 px) | 8 | -5.8 (e45@2.7) | +44.7 % (e0@2.7) | 0 of 8 |
| Scots pine | LOD1 → impostor (140 px) | 8 | -16.9 (over) | +19.6 % (eye) | 2 of 8 |
| Silver birch | LOD0 → LOD1 (700 px) | 2 | -1.8 (over) | +15.7 % (over) | 1 of 2 |
| Silver birch | LOD1 → impostor (140 px) | 2 | +2.8 (over) | +7.5 % (eye) | 1 of 2 |

Every view (protocol views first, then the angular set; view = elevation tag @ azimuth in radians, 0.6 when omitted):

| key | Δ coverage (pts) | Δ luminance | ΔE | IoU |
|---|---|---|---|---|
| birch-b0-eye | +1.1 | +4.5 % | 4.0 | 0.72 |
| birch-b0-over | -1.8 | +15.7 ✗ % | 3.8 | 0.79 |
| birch-b1-eye | +0.7 | +7.5 ✗ % | 1.9 | 0.77 |
| birch-b1-over | +2.8 | +2.4 % | 1.3 | 0.82 |
| oak-a-b0-eye | -3.5 | +2.2 % | 0.8 | 0.69 |
| oak-a-b0-over | -5.8 ✗ | -6.6 ✗ % | 1.7 | 0.67 |
| oak-a-b1-eye | +8.8 ✗ | +1.9 % | 1.1 | 0.55 |
| oak-a-b1-over | +8.9 ✗ | -3.1 % | 1.0 | 0.66 |
| oak-b-b0-e0 | -2.9 | +10.0 ✗ % | 2.4 | 0.73 |
| oak-b-b0-e0@2.7 | -2.3 | +21.2 ✗ % | 5.2 | 0.73 |
| oak-b-b0-e45 | -7.0 ✗ | -6.3 ✗ % | 2.0 | 0.70 |
| oak-b-b0-e45@2.7 | -7.5 ✗ | -0.5 % | 0.4 | 0.68 |
| oak-b-b0-e90 | -3.2 | -5.3 ✗ % | 1.1 | 0.73 |
| oak-b-b0-e90@2.7 | -3.1 | -5.1 ✗ % | 1.1 | 0.73 |
| oak-b-b0-eye | -2.6 | +6.6 ✗ % | 1.6 | 0.74 |
| oak-b-b0-over | -3.5 | -5.6 ✗ % | 1.2 | 0.72 |
| oak-b-b1-e0 | +10.8 ✗ | +2.8 % | 0.8 | 0.71 |
| oak-b-b1-e0@2.7 | +10.5 ✗ | -13.9 ✗ % | 4.9 | 0.70 |
| oak-b-b1-e45 | +5.2 ✗ | -5.3 ✗ % | 1.5 | 0.62 |
| oak-b-b1-e45@2.7 | +10.5 ✗ | -3.9 % | 1.0 | 0.67 |
| oak-b-b1-e90 | +6.7 ✗ | -2.1 % | 0.7 | 0.76 |
| oak-b-b1-e90@2.7 | +6.7 ✗ | -2.0 % | 0.7 | 0.76 |
| oak-b-b1-eye | +8.7 ✗ | +6.5 ✗ % | 1.5 | 0.65 |
| oak-b-b1-over | +3.9 | -1.7 % | 0.6 | 0.71 |
| oak-c-b0-eye | -3.2 | +4.2 % | 1.8 | 0.71 |
| oak-c-b0-over | -6.3 ✗ | -7.6 ✗ % | 1.6 | 0.65 |
| oak-c-b1-eye | +0.2 | +9.1 ✗ % | 2.2 | 0.60 |
| oak-c-b1-over | -1.8 | +2.5 % | 0.6 | 0.57 |
| pine-b0-e0 | -4.8 | +7.5 ✗ % | 5.8 | 0.90 |
| pine-b0-e0@2.7 | -4.1 | +44.7 ✗ % | 10.6 | 0.90 |
| pine-b0-e45 | -4.9 | -6.0 ✗ % | 1.9 | 0.88 |
| pine-b0-e45@2.7 | -5.8 ✗ | +37.4 ✗ % | 6.2 | 0.88 |
| pine-b0-e90 | -4.4 | +14.1 ✗ % | 3.3 | 0.89 |
| pine-b0-e90@2.7 | -4.4 | +14.8 ✗ % | 3.4 | 0.89 |
| pine-b0-eye | -5.0 | +5.1 ✗ % | 4.8 | 0.89 |
| pine-b0-over | -4.3 | +7.0 ✗ % | 2.5 | 0.89 |
| pine-b1-e0 | -2.3 | +11.1 ✗ % | 2.7 | 0.71 |
| pine-b1-e0@2.7 | -2.5 | +5.8 ✗ % | 1.9 | 0.72 |
| pine-b1-e45 | -13.6 ✗ | +4.8 % | 2.0 | 0.39 |
| pine-b1-e45@2.7 | -10.0 ✗ | +9.4 ✗ % | 2.7 | 0.47 |
| pine-b1-e90 | -4.3 | +4.2 % | 1.2 | 0.66 |
| pine-b1-e90@2.7 | -4.7 | +4.0 % | 1.2 | 0.66 |
| pine-b1-eye | -4.2 | +19.6 ✗ % | 4.5 | 0.63 |
| pine-b1-over | -16.9 ✗ | +7.4 ✗ % | 2.4 | 0.42 |
