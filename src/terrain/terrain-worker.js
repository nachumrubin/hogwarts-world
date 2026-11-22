// Worker entry: terrain generation off the main thread. Messages:
//   {type:'init', seed}
//   {type:'chunk', key, depth, ix, iz}            → {type:'chunk', key, buffer, minY, maxY, ms}   (buffer transferred)
//   {type:'heights', id, res, half, rowStart, rowEnd} → {type:'heights', id, rowStart, data}
//   {type:'shade', id, heights, res, half, sun}   → {type:'shade', id, data}
import { TerrainGenerator } from './generator.js';
import { buildChunk } from './chunk-mesher.js';
import { sampleHeights, shadeOverview } from './overview.js';

let gen = null;
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') { gen = new TerrainGenerator(m.seed); return; }
  if (m.type === 'chunk') {
    const t0 = performance.now();
    const c = buildChunk(gen, m.depth, m.ix, m.iz);
    self.postMessage({ type: 'chunk', key: m.key, buffer: c.buffer, minY: c.minY, maxY: c.maxY, ms: performance.now() - t0 }, [c.buffer]);
  } else if (m.type === 'heights') {
    const data = sampleHeights(gen, m.res, m.half, m.rowStart, m.rowEnd);
    self.postMessage({ type: 'heights', id: m.id, rowStart: m.rowStart, data }, [data.buffer]);
  } else if (m.type === 'shade') {
    const data = shadeOverview(m.heights, m.res, m.half, m.sun);
    self.postMessage({ type: 'shade', id: m.id, data }, [data.buffer]);
  }
};
