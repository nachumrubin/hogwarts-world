// Smoke test of a deployed Tree Lab (used by .github/workflows/request-pages-deploy.yml after each deploy).
//   node dev/tree-lab/tools/pages-smoke.mjs https://nachumrubin.github.io/hogwarts-world/dev/tree-lab/ [expectedCommit]
// Loads the public page in headless Chrome with WebGPU (SwiftShader), waits for the lab, grows and renders every
// specimen through the page's own worker, and fails on any page error, WebGPU validation error or failed request.
import puppeteer from 'puppeteer-core';
const url = process.argv[2];
const expect = process.argv[3] || '';
const chrome = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const browser = await puppeteer.launch({
  executablePath: chrome, headless: 'new', protocolTimeout: 1800000,
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--disable-vulkan-surface', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const problems = [], requests = [];
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console error: ${m.text()}`); });
page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => { requests.push(`${r.status()} ${r.url()}`); if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction('window.__labReady || window.__labError', { timeout: 900000, polling: 500 });
const err = await page.evaluate('window.__labError || null');
if (err) problems.push(`lab error: ${err}`);
let result = null;
if (!err) {
  result = await page.evaluate(async () => {
    const lab = window.__lab; lab.setLive(false);
    const out = {};
    for (const id of ['oak-a', 'oak-b', 'oak-c', 'pine', 'birch']) {
      await lab.select(id);
      const blob = await lab.shoot('three', 'clay', { width: 640, height: 480 });
      const d = lab.store.get(id).built.diag;
      out[id] = { height: d.height, crown: d.crownWidth, tris: lab.store.get(id).built.lods[0].tris, png: blob.size };
    }
    await lab.compare('oaks');
    const cmp = await lab.shoot('front', 'silhouette', { width: 1200, height: 400, common: false });
    return { specimens: out, comparePng: cmp.size, adapter: lab.viewer.adapterName, gpuErrors: window.__errors || [], commit: document.title };
  });
  for (const e of result.gpuErrors) problems.push(`WebGPU: ${e}`);
  for (const [id, s] of Object.entries(result.specimens)) if (!(s.height > 5 && s.tris > 1000 && s.png > 5000)) problems.push(`${id}: implausible build ${JSON.stringify(s)}`);
}
const assets = requests.filter((r) => /\/assets\//.test(r));
console.log(`Loaded ${url} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(assets.join('\n'));
if (result) { console.log(`adapter: ${result.adapter}`); for (const [id, s] of Object.entries(result.specimens)) console.log(`${id}: ${s.height} m tall, ${s.crown} m crown, ${s.tris} LOD0 triangles, render ${s.png} B`); console.log(`oak comparison render: ${result.comparePng} B`); }
await browser.close();
if (problems.length) { console.error('FAILED\n' + problems.join('\n')); process.exit(1); }
console.log(`Tree Lab smoke test passed${expect ? ` (expected commit ${expect})` : ''}`);
