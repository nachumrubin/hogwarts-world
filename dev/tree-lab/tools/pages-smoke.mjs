// Smoke test of a deployed Tree Lab (used by .github/workflows/request-pages-deploy.yml after each deploy).
//   node dev/tree-lab/tools/pages-smoke.mjs https://nachumrubin.github.io/hogwarts-world/dev/tree-lab/ [expectedCommit]
// Loads the public page in headless Chrome with WebGPU (SwiftShader), one fresh page per specimen: waits for the
// lab, grows the tree in the page's own worker and renders it offscreen; then renders the oak comparison. Fails on
// any page error, WebGPU error, failed request or implausible result.
import puppeteer from 'puppeteer-core';
const url = process.argv[2];
const expect = process.argv[3] || '';
const chrome = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const browser = await puppeteer.launch({
  executablePath: chrome, headless: 'new', protocolTimeout: 1800000,
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--disable-vulkan-surface', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'],
});
const problems = [], requests = [], consoleLog = [];
const results = {}; let adapter = '';
const t0 = Date.now();
// one fresh page per specimen (software WebGPU on CI runners has little memory), on-demand rendering
const q = '?live=0&shadow=2048';
async function open(extra) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => { consoleLog.push(`${m.type()}: ${m.text()}`); if (m.type() === 'error') problems.push(`console error: ${m.text()}`); });
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { requests.push(`${r.status()} ${r.url()}`); if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  await page.goto(url + q + extra, { waitUntil: 'load' });
  await page.waitForFunction('window.__labReady || window.__labError', { timeout: 900000, polling: 500 });
  const err = await page.evaluate('window.__labError || null');
  if (err) throw new Error(`lab error: ${err}`);
  // report a lost GPU device with its reason (the promise resolves even if the loss already happened)
  const info = await page.evaluate(() => { const v = window.__lab.viewer; v.device.lost.then((i) => console.error(`device lost: ${i.reason} ${i.message}`)); return `${v.adapterName}, timestamp-query ${v.hasTs}`; });
  if (!adapter) console.log(`adapter: ${info}`);
  return page;
}
try {
  for (const id of ['oak-a', 'oak-b', 'oak-c', 'pine', 'birch']) {
    const page = await open(`&specimen=${id}`);
    const r = await page.evaluate(async (id) => {
      const lab = window.__lab;
      const blob = await lab.shoot('three', 'clay', { width: 640, height: 480 });
      const b = lab.store.get(id).built;
      return { height: b.diag.height, crown: b.diag.crownWidth, tris: b.lods[0].tris, png: blob.size, adapter: lab.viewer.adapterName, gpuErrors: window.__errors || [] };
    }, id);
    adapter = adapter || r.adapter; for (const e of r.gpuErrors) problems.push(`WebGPU (${id}): ${e}`);
    if (!(r.height > 5 && r.tris > 1000 && r.png > 5000)) problems.push(`${id}: implausible build ${JSON.stringify(r)}`);
    results[id] = r; console.log(`${id}: ${r.height} m tall, ${r.crown} m crown, ${r.tris} LOD0 triangles, render ${r.png} B`);
    await page.close();
  }
  const page = await open('&compare=oaks&lod=1');
  const cmp = await page.evaluate(async () => (await window.__lab.shoot('front', 'silhouette', { width: 1200, height: 400, common: false, lod: 1 })).size);
  console.log(`oak comparison render: ${cmp} B`);
  await page.close();
} catch (e) { problems.push(String(e?.message || e)); }
const assets = requests.filter((r) => /\/assets\//.test(r));
console.log(`Tested ${url} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log([...new Set(assets)].join('\n'));
await browser.close();
if (problems.length) { console.error('FAILED\n' + problems.join('\n') + '\n--- console ---\n' + consoleLog.slice(-30).join('\n')); process.exit(1); }
console.log(`Tree Lab smoke test passed${expect ? ` (expected commit ${expect})` : ''}`);
