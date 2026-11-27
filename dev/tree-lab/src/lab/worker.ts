// Generation worker: grows and meshes a specimen off the main thread and hands the buffers over (transferred).
import { buildSpecimen } from '../build.ts';

self.onmessage = (e: MessageEvent<{ id: string; job: number; density?: number; fol?: Record<string, unknown> | null }>) => {
  const { id, job, density, fol } = e.data;
  try {
    const b = buildSpecimen(id, [0, 1, 2], density ?? 1, fol ?? null);
    const transfer: Transferable[] = [];
    for (const l of b.lods) transfer.push(l.v.buffer, l.i.buffer);
    for (const l of b.foliage.lods) for (const s of l.sets) transfer.push(s.data.buffer);
    (self as unknown as Worker).postMessage({ job, ok: true, built: b }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ job, ok: false, error: String((err as Error)?.stack || err) });
  }
};
