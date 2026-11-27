// Tree Lab entry. URL options: ?specimen=oak-a|oak-b|oak-c|pine|birch  ?compare=all|oaks|a-b|b-c|pine-birch
//   &view=front|side|rear|three|top|trunk|junction  &mode=lit (materials, default)|clay|silhouette|wire|normals|hierarchy
//   &light=studio|day|overcast|low  &lod=0..2  &live=0  &shadow=4096  &ui=0 (viewport only, for headless capture)
//   &bench=oak-b|pine|birch|stand12|stand50|stand200|suite &cam=ground|aerial &res=1920x1080 &shadow=2048 &frames=120
//   &chain=B|A|both (three- or four-level LOD) &motion=1 (moving camera: LOD selection and cross-fades every frame)
// window.__lab exposes the controller for the headless capture script (capture.mjs).
import { Lab, MODES, COMMIT } from './lab/lab.ts';
import { PROTOCOL } from './lab/capture.ts';
import { bindUI } from './lab/ui.ts';
import type { Mode } from './render/viewer.ts';

declare const __WORKER_URL__: string;

async function main() {
  const q = new URLSearchParams(location.search);
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const workerUrl = typeof __WORKER_URL__ === 'string' && __WORKER_URL__ ? __WORKER_URL__ : new URL('./worker.js', import.meta.url);
  const lab = new Lab(canvas, workerUrl);
  (window as any).__lab = lab; (window as any).__labProtocol = PROTOCOL;
  try {
    await lab.init(+(q.get('shadow') || 4096));
  } catch (e) {
    const el = document.getElementById('error')!; el.hidden = false;
    el.textContent = `This lab needs WebGPU (Chrome/Edge 113+, Safari 18+ with WebGPU enabled, or Firefox Nightly).\n\n${(e as Error).message}`;
    document.getElementById('status')!.textContent = 'WebGPU unavailable';
    (window as any).__labError = String(e); return;
  }
  bindUI(lab);
  if (q.get('ui') === '0') document.body.classList.add('bare');
  if (q.get('live') === '0') lab.setLive(false);
  lab.setLight(q.get('light') || 'day');
  if (q.get('foliage') === '0') lab.setFoliage(false);
  if (q.get('lod')) lab.setLod(+q.get('lod')!);
  const m = q.get('mode') as Mode | null; lab.setMode(m && MODES.includes(m) ? m : 'lit');
  if (q.get('compare')) await lab.compare(q.get('compare')!);
  else await lab.select(q.get('specimen') || 'oak-a', (q.get('view') as any) || 'three');
  if (q.get('view') && q.get('compare')) lab.setView(q.get('view') as any, false);
  (window as any).__labReady = true;
  // ?bench=<scene|suite>&cam=ground|aerial&res=WxH&shadow=N&frames=N: run the benchmark on load (window.__benchResult)
  if (q.get('bench')) {
    const [w, h] = (q.get('res') || '1920x1080').split('x').map(Number);
    const o = { width: w, height: h, shadow: +(q.get('shadow') ?? 2048), frames: +(q.get('frames') || 120) };
    const sc = q.get('bench')!, ch = q.get('chain') || 'B', motion = q.get('motion') === '1';
    const chains = (ch === 'both' ? ['B', 'A'] : [ch]) as ('A' | 'B')[];
    const res: Record<string, unknown>[] = [];
    if (sc === 'suite') res.push(...await lab.benchSuite({ ...o, chains, motion }));
    else for (const chain of chains) res.push(await lab.bench({ scene: sc, camera: (q.get('cam') as 'ground' | 'aerial') || 'ground', chain, motion, ...o }));
    (window as any).__benchResult = res;
    console.log('benchmark done');
  }
  // keep growing the rest of the collection in the background so switching is instant
  for (const id of ['oak-a', 'oak-b', 'oak-c', 'pine', 'birch']) lab.store.load(id).catch(console.error);
  console.log(`Tree Lab ${COMMIT} ready`);
}
main().catch((e) => { console.error(e); (window as any).__labError = String(e?.stack || e); const el = document.getElementById('error'); if (el) { el.hidden = false; el.textContent = String(e?.stack || e); } });
