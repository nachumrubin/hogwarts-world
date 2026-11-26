// Headless evidence capture: drives the lab's own one-click review pipeline (window.__lab.review / comparisonSheet),
// so these files are exactly what the in-browser buttons export.
//   node dev/tree-lab/capture.mjs <outDir>
//   SPECIMENS=oak-a,oak-b,oak-c,pine,birch  COMPARE=oaks,all  SOFTWARE=1 (SwiftShader)  SHADOW=2048  UI=1 (also grab the
//   interface: lab-ui.png)  SHOT=1200x900 (review shot size)
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const req = createRequire('/opt/npm-tools/node_modules/');
let puppeteer; try { puppeteer = (await import('puppeteer-core')).default; } catch { puppeteer = req('puppeteer-core'); }
const out = process.argv[2] || 'out-treelab'; mkdirSync(out, { recursive: true });
const PORT = +(process.env.PORT || 8797);
const srv = spawn(process.execPath, [fileURLToPath(new URL('../../tools/serve.mjs', import.meta.url)), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 400));
const args = ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--disable-vulkan-surface', '--window-size=1440,900'];
if (process.env.SOFTWARE === '1') args.push('--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: 'new', args, protocolTimeout: 7200000 });
const log = [];
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
page.on('console', (m) => log.push(m.text())); page.on('pageerror', (e) => log.push(`pageerror ${e.message}`));
const q = new URLSearchParams({ specimen: 'oak-a', view: 'three', live: '0', shadow: process.env.SHADOW || '2048' });
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${PORT}/dev/tree-lab/?${q}`, { waitUntil: 'load' });
await page.waitForFunction('window.__labReady || window.__labError', { timeout: 1800000, polling: 500 });
const err = await page.evaluate('window.__labError || null');
const save = (name, dataUrl) => { writeFileSync(`${out}/${name}`, Buffer.from(dataUrl.split(',')[1], 'base64')); console.log(`${out}/${name}`); };
if (err) { console.error(err); writeFileSync(`${out}/log.txt`, log.join('\n') + '\n' + err); process.exit(1); }
console.log(`lab ready in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
const save0 = (name, dataUrl) => { writeFileSync(`${out}/${name}`, Buffer.from(dataUrl.split(',')[1], 'base64')); console.log(`${out}/${name}`); };
await page.evaluate(() => { window.__b64 = (b) => new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }); });
if (process.env.UI === '1') {
  await page.evaluate(() => new Promise((r) => { const f0 = window.__lab.frames; const t = () => (window.__lab.frames > f0 && !document.querySelector('.thumb.wait') ? setTimeout(r, 1500) : setTimeout(t, 300)); window.__lab.invalidate(); t(); }));
  writeFileSync(`${out}/lab-ui.png`, await page.screenshot()); console.log(`${out}/lab-ui.png`);
  // the frame actually presented to the canvas (headless compositing of WebGPU canvases is unreliable)
  save('lab-viewport.png', await page.evaluate(() => new Promise((r) => { window.__lab.viewer.readback = (b) => window.__b64(b).then(r); window.__lab.invalidate(); })));
}
// STAND=1: woodland stand stress test only
if (process.env.STAND === '1') {
  const r = await page.evaluate(async () => { const res = await window.__lab.standStress(); return { shots: await Promise.all(res.shots.map((b) => window.__b64(b))), labels: res.labels, stats: res.stats }; });
  r.shots.forEach((u, k) => save(`stand-${k + 1}.png`, u));
  writeFileSync(`${out}/stand-stats.json`, JSON.stringify(r.stats.map((s, k) => ({ label: r.labels[k], ...s })), null, 2));
  await browser.close(); srv.kill(); process.exit(0);
}
// RUN=tools/evidence/<script>.js: evaluate a script in the page (body of an async function using window.__lab and
// window.__b64); it returns { 'file name': data URL | JSON-able value }, written to <outDir>
if (process.env.RUN) {
  const code = readFileSync(process.env.RUN, 'utf8');
  const r = await page.evaluate(`(async () => { ${code}\n })()`);
  for (const [name, v] of Object.entries(r)) {
    mkdirSync(`${out}/${name}`.replace(/\/[^/]*$/, ''), { recursive: true });
    if (typeof v === 'string' && v.startsWith('data:')) save(name, v); else { writeFileSync(`${out}/${name}`, typeof v === 'string' ? v : JSON.stringify(v, null, 2)); console.log(`${out}/${name}`); }
  }
  const errs = await page.evaluate('window.__errors || []'); if (errs.length) console.log('WebGPU errors:', errs.slice(0, 5));
  await browser.close(); srv.kill(); process.exit(0);
}
// STUDY=oak-b,pine,birch: foliage studies only (sheets, shots and stats)
if (process.env.STUDY) {
  const all = {};
  for (const id of process.env.STUDY.split(',')) {
    const r = await page.evaluate(async (id) => { const res = await window.__lab.foliageStudy(id); return { sheet: await window.__b64(res.sheet), shots: await Promise.all(res.shots.map(async (s) => ({ rep: s.rep, range: s.range, stats: s.stats, url: await window.__b64(s.blob) }))) }; }, id);
    mkdirSync(`${out}/study-${id}`, { recursive: true });
    save(`study-${id}.png`, r.sheet);
    for (const s of r.shots) save(`study-${id}/${s.rep}-${s.range.split(' ')[0]}.png`, s.url);
    all[id] = r.shots.map((s) => ({ rep: s.rep, range: s.range, ...s.stats }));
  }
  writeFileSync(`${out}/study-stats.json`, JSON.stringify(all, null, 2));
  await browser.close(); srv.kill(); process.exit(0);
}
// DEBUG=id:view:mode,... renders individual shots only (e.g. DEBUG=pine:trunk:normals)
if (process.env.DEBUG) {
  // id:view:mode[:lod[:foliage 0/1]]
  for (const spec of process.env.DEBUG.split(',')) {
    const [id, view, mode, lod, fol] = spec.split(':');
    const tag = `${id}-${view}-${mode}${lod ? '-lod' + lod : ''}${fol === '0' ? '-bare' : ''}${process.env.DLIGHT ? '-' + process.env.DLIGHT : ''}`;
    save(`dbg-${tag}.png`, await page.evaluate(async (id, view, mode, W, H, L, NS, lod, fol) => { await window.__lab.select(id); window.__lab.setFoliage(fol !== '0'); if (NS) for (const l of [window.__lab.viewer.light]) l.shadow = 0; return window.__b64(await window.__lab.shoot(view, mode, { width: W, height: H, light: L || undefined, lod: lod ? +lod : undefined })); }, id, view, mode, +(process.env.DW || 800), +(process.env.DH || 600), process.env.DLIGHT || '', process.env.DNOSHADOW === '1', lod || '', fol || '1'));
  }
  await browser.close(); srv.kill(); process.exit(0);
}
if (process.env.MOBILE === '1') {
  // phone-sized interface check (touch, narrow layout)
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  // (switching to a mobile viewport reloads the page)
  await page.waitForFunction('window.__labReady || window.__labError', { timeout: 1800000, polling: 500 });
  await page.evaluate(() => { window.__b64 = (b) => new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }); });
  await page.evaluate(() => new Promise((r) => { const t = () => (!document.querySelector('.thumb.wait') ? setTimeout(r, 1500) : setTimeout(t, 300)); t(); }));
  writeFileSync(`${out}/lab-mobile.png`, await page.screenshot()); console.log(`${out}/lab-mobile.png`);
  save('lab-mobile-viewport.png', await page.evaluate(() => new Promise((r) => { window.__lab.viewer.readback = (b) => window.__b64(b).then(r); window.__lab.invalidate(); })));
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.waitForFunction('window.__labReady || window.__labError', { timeout: 1800000, polling: 500 });
  await page.evaluate(() => { window.__b64 = (b) => new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }); });
}
const [sw, sh] = (process.env.SHOT || '1200x900').split('x').map(Number);
await page.evaluate((w, h) => { const P = window.__labProtocol; if (P) { P.width = w; P.height = h; } }, sw, sh);
const diag = {};
if (process.env.STRUCT !== '0') for (const id of (process.env.SPECIMENS ?? 'oak-a,oak-b,oak-c,pine,birch').split(',').filter(Boolean)) {
  const t = Date.now();
  const r = await page.evaluate(async (id) => {
    const res = await window.__lab.review(id);
    return { shots: await Promise.all(res.shots.map(async (s) => ({ file: s.spec.file, url: await window.__b64(s.blob) }))), sheet: await window.__b64(res.sheet), diag: window.__lab.diagnostics(id) };
  }, id);
  mkdirSync(`${out}/${id}`, { recursive: true });
  for (const s of r.shots) save(`${id}/${id}-${s.file}.png`, s.url);
  save(`${id}-review-sheet.png`, r.sheet);
  diag[id] = r.diag; console.log(`  ${id}: ${((Date.now() - t) / 1000).toFixed(0)} s`);
}
// bark/material review set (MATERIALS=0 to skip) with texture and render-time statistics
const stats = {};
if (process.env.MATERIALS !== '0') for (const id of (process.env.SPECIMENS ?? 'oak-a,oak-b,oak-c,pine,birch').split(',').filter(Boolean)) {
  const t = Date.now();
  const r = await page.evaluate(async (id) => {
    const res = await window.__lab.materialReview(id);
    return { shots: await Promise.all(res.shots.map(async (s) => ({ file: s.spec.file, url: await window.__b64(s.blob) }))), sheet: await window.__b64(res.sheet), stats: res.stats };
  }, id);
  mkdirSync(`${out}/${id}/materials`, { recursive: true });
  for (const s of r.shots) save(`${id}/materials/${id}-${s.file}.png`, s.url);
  save(`${id}-material-sheet.png`, r.sheet);
  stats[id] = r.stats; console.log(`  ${id} materials: ${((Date.now() - t) / 1000).toFixed(0)} s`);
}
if (Object.keys(stats).length) writeFileSync(`${out}/render-stats.json`, JSON.stringify(stats, null, 2));
// foliage review set (FOLIAGE=0 to skip)
const fstats = {};
if (process.env.FOLIAGE !== '0') for (const id of (process.env.SPECIMENS ?? 'oak-a,oak-b,oak-c,pine,birch').split(',').filter(Boolean)) {
  const t = Date.now();
  const r = await page.evaluate(async (id) => {
    const res = await window.__lab.foliageReview(id);
    return { shots: await Promise.all(res.shots.map(async (s) => ({ file: s.spec.file, url: await window.__b64(s.blob) }))), sheet: await window.__b64(res.sheet), stats: res.stats };
  }, id);
  mkdirSync(`${out}/${id}/foliage`, { recursive: true });
  for (const s of r.shots) save(`${id}/foliage/${id}-${s.file}.png`, s.url);
  save(`${id}-foliage-sheet.png`, r.sheet);
  fstats[id] = r.stats; console.log(`  ${id} foliage: ${((Date.now() - t) / 1000).toFixed(0)} s`);
}
if (Object.keys(fstats).length) writeFileSync(`${out}/foliage-stats.json`, JSON.stringify(fstats, null, 2));
for (const c of (process.env.COMPARE ?? 'oaks,all,a-b,b-c,pine-birch').split(',').filter(Boolean)) {
  const url = await page.evaluate(async (c) => window.__b64(await window.__lab.comparisonSheet(c)), c);
  save(`compare-${c}.png`, url);
}
const meta = await page.evaluate(() => ({ adapter: window.__lab.viewer.adapterName, hasTimestamps: window.__lab.viewer.hasTs }));
if (Object.keys(diag).length) writeFileSync(`${out}/diagnostics.json`, JSON.stringify({ ...meta, specimens: diag }, null, 2));
writeFileSync(`${out}/log.txt`, log.join('\n'));
await browser.close(); srv.kill();
