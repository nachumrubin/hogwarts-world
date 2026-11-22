// Worker entry: terrain generation off the main thread. Messages:
//   {type:'chunk', key, depth, ix, iz}                → {type:'chunk', key, buffer, minY, maxY, ms}   (buffer transferred)
//   {type:'heights', id, grid, rowStart, rowEnd}       → {type:'heights', id, rowStart, data}
//   {type:'materials', id, grid, heights, rowStart, rowEnd} → {type:'materials', id, rowStart, rgba, paved}
//   {type:'shade', id, heights, grid, sun, paved}      → {type:'shade', id, data}
import { WorldTerrain } from '../world/world-terrain.ts';
import { buildChunk } from './chunk-mesher.js';
import { sampleHeights, sampleMaterials, shadeOverview } from './overview.js';

const gen = new WorldTerrain();
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'chunk') {
    const t0 = performance.now();
    const c = buildChunk(gen, m.depth, m.ix, m.iz);
    self.postMessage({ type: 'chunk', key: m.key, buffer: c.buffer, minY: c.minY, maxY: c.maxY, ms: performance.now() - t0 }, [c.buffer]);
  } else if (m.type === 'heights') {
    const data = sampleHeights(gen, m.grid, m.rowStart, m.rowEnd);
    self.postMessage({ type: 'heights', id: m.id, rowStart: m.rowStart, data }, [data.buffer]);
  } else if (m.type === 'materials') {
    const r = sampleMaterials(gen, m.grid, m.heights, m.rowStart, m.rowEnd);
    self.postMessage({ type: 'materials', id: m.id, rowStart: m.rowStart, rgba: r.rgba, paved: r.paved }, [r.rgba.buffer, r.paved.buffer]);
  } else if (m.type === 'shade') {
    const data = shadeOverview(m.heights, m.grid, m.sun, m.paved);
    self.postMessage({ type: 'shade', id: m.id, data }, [data.buffer]);
  }
};
