// Fixed camera viewpoints of the forest POC (keys 1–8 in forest mode, ?view=N) and the benchmark/recording route.
// u, v: site-local metres (east, north from the test area's south-west corner); agl: eye height above the ground;
// yaw: degrees clockwise from north; pitch: degrees, up positive.
import { SITE } from './site.ts';

export interface ForestView { id: string; name: string; u: number; v: number; agl: number; yaw: number; pitch: number }

export const FOREST_VIEWS: ForestView[] = [
  { id: 'entrance', name: 'Forest entrance, eye level', u: -14, v: 16, agl: 1.7, yaw: 62, pitch: 2 },
  { id: 'interior', name: 'Dense woodland interior', u: 152, v: 190, agl: 1.7, yaw: 255, pitch: 2 },
  { id: 'veteran', name: 'Veteran oak close-up', u: 82.9, v: 111.6, agl: 1.6, yaw: 40, pitch: 17 },
  { id: 'ferns', name: 'Ferns and moss at ground level', u: 80, v: 43, agl: 0.9, yaw: 4, pitch: -10 },
  { id: 'sunlight', name: 'Sunlight through the canopy', u: 140, v: 140, agl: 1.7, yaw: 222, pitch: 12 },
  { id: 'passage', name: 'Dark woodland passage', u: 46, v: 92, agl: 1.7, yaw: -12, pitch: 0 },
  { id: 'broom', name: 'Elevated broom-flight view', u: 70, v: -10, agl: 28, yaw: 25, pitch: -14 },
  { id: 'altitude', name: 'High-altitude canopy coverage', u: 100, v: -260, agl: 260, yaw: 0, pitch: -38 },
];

export const toWorldView = (v: ForestView) => ({ x: SITE.x0 + v.u, z: SITE.z0 + v.v, agl: v.agl, yaw: v.yaw, pitch: v.pitch });

/** Recording routes: a walk along the deer trail at eye height, and a broom flight over the stand. */
export const FOREST_WALK: [number, number, number][] = [
  [-30, 26, 1.7], [-10, 32, 1.7], [10, 40, 1.7], [30, 51, 1.7], [52, 68, 1.7], [66, 80, 1.7], [80, 93, 1.7], [96, 102, 1.7],
].map(([u, v, h]) => [SITE.x0 + u, SITE.z0 + v, h]);
export const FOREST_FLIGHT: [number, number, number][] = [
  [100, 104, 2], [112, 114, 8], [128, 132, 18], [150, 160, 26], [180, 185, 30], [205, 175, 40], [215, 130, 55],
  [190, 70, 80], [130, 30, 110], [60, 20, 130], [10, 70, 100], [20, 140, 50], [70, 180, 28], [120, 190, 22],
].map(([u, v, h]) => [SITE.x0 + u, SITE.z0 + v, h]);

/** Benchmark route: walk the deer trail at eye height, take off in the clearing, fly low over the canopy, climb, circle back. */
export const FOREST_ROUTE: [number, number, number][] = [
  [-40, 22, 1.7], [-10, 32, 1.7], [22, 46, 1.7], [52, 68, 1.7], [78, 92, 1.7], [100, 104, 3],
  [118, 118, 14], [140, 150, 30], [175, 190, 34], [215, 210, 45], [230, 150, 60], [220, 60, 90], [150, -40, 140],
  [40, -60, 110], [-30, 40, 50], [10, 120, 32], [60, 170, 26], [120, 180, 24],
].map(([u, v, h]) => [SITE.x0 + u, SITE.z0 + v, h]);
