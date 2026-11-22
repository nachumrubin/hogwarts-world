// Headless verification in Chrome (works with a software WebGPU adapter such as SwiftShader, or a real GPU).
//   node tools/headless.mjs shots  [outDir]          fixed viewpoints → PNG
//   node tools/headless.mjs crack  [outDir]          crack check: magenta-sky render, count magenta pixels below the horizon
//   node tools/headless.mjs bench  [outDir]          run the benchmark route, write the JSON result
// Options via env: CHROME_PATH, PRESET (default high), SIZE (WxH, default 960x540), DURATION (bench seconds),
// SOFTWARE=1 forces the SwiftShader adapter, PORT.
// Needs puppeteer-core (npm i -D puppeteer-core) or a global install.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

async function loadPuppeteer() {
  try { return (await import('puppeteer-core')).default; } catch {}
  for (const base of ['/opt/npm-tools/node_modules/', process.env.NODE_PATH || '']) {
    try { return createRequire(base)('puppeteer-core'); } catch {}
  }
  throw new Error('puppeteer-core not found: npm i -D puppeteer-core');
}

const mode = process.argv[2] || 'shots';
const out = process.argv[3] || 'out';
const PORT = +(process.env.PORT || 8791);
const PRESET = process.env.PRESET || 'high';
const [W, H] = (process.env.SIZE || '960x540').split('x').map(Number);
mkdirSync(out, { recursive: true });

const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 400));
const puppeteer = await loadPuppeteer();
const args = ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--disable-vulkan-surface', `--window-size=${W},${H}`];
if (process.env.SOFTWARE === '1') args.push('--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: 'new', args, protocolTimeout: 900000 });
const log = [];

async function open(params, { settle = true, timeout = 120000 } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.on('console', (m) => log.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
  const q = new URLSearchParams({ preset: PRESET, dynres: '0', scale: '1', ...params });
  await page.goto(`http://127.0.0.1:${PORT}/?${q}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__app || window.__startError', { timeout: 60000 });
  const err = await page.evaluate('window.__startError || null');
  if (err) throw new Error('start error: ' + err);
  if (settle) {
    // wait until streaming is idle for a few consecutive frames and the overview map has faded in
    const t0 = Date.now();
    await page.waitForFunction(() => {
      const a = window.__app; if (!a) return false;
      a._idle = a.streamer.stats.backlog === 0 && a.streamer.pending.size === 0 && a.overviewFade >= 1 ? (a._idle || 0) + 1 : 0;
      return a._idle > 3;
    }, { timeout, polling: 500 }).catch(() => log.push(`[headless] settle timeout after ${Date.now() - t0} ms`));
    await new Promise((r) => setTimeout(r, 1500));
  }
  return page;
}

/** PNG bytes of the next frame via the app's GPU readback. */
async function grab(page) {
  const url = await page.evaluate(() => Promise.race([window.__app.renderer.capture(), new Promise((r) => setTimeout(() => r('timeout'), 20000))]));
  if (url === 'timeout') throw new Error('GPU capture timed out; log: ' + log.slice(-8).join(' | '));
  return Buffer.from(url.split(',')[1], 'base64');
}

const info = async (page) => page.evaluate(() => {
  const a = window.__app;
  return { adapter: a.gpu.adapterInfo, frames: a.frameIndex, time: +a.time.toFixed(1), errors: a.gpu.errors.slice(0, 5), stats: { ...a.renderer.stats }, resident: a.streamer.stats.resident, generated: a.streamer.stats.generated, avgGenMs: +(a.streamer.stats.genMsTotal / Math.max(1, a.streamer.stats.generated)).toFixed(2), leaves: a.tree.leaves.length, balanced: a.tree.isBalanced(), bootstrapMs: +a.bootstrapMs.toFixed(0), overviewMs: a.overviewMs ? +a.overviewMs.toFixed(0) : null };
});

const report = { mode, preset: PRESET, size: `${W}x${H}`, results: [] };
try {
  if (mode === 'shots') {
    const views = (process.env.VIEWS || '1,2,3,4,5,6,7,8').split(',');
    for (const v of views) {
      const page = await open({ view: v, hud: '0', labels: process.env.LABELS || '0', debug: process.env.DEBUG || 'normal' }, { timeout: 300000 });
      const file = `${out}/view${v}${process.env.DEBUG ? '-' + process.env.DEBUG : ''}.png`;
      writeFileSync(file, await grab(page));
      report.results.push({ view: +v, file, ...(await info(page)) });
      await page.close();
    }
  } else if (mode === 'crack') {
    // cameras looking steeply down across LOD boundaries; any magenta pixel = a hole in the terrain
    const cams = (process.env.CAMS || '0,120,0,0,-89;-300,60,150,45,-70;400,250,-300,200,-75;-700,30,-200,300,-60;800,400,600,120,-85').split(';');
    for (const c of cams) {
      const page = await open({ cam: c, hud: '0', debug: 'crack' });
      const shot = await grab(page);
      const file = `${out}/crack_${c.replace(/[,.-]/g, '_')}.png`;
      writeFileSync(file, shot);
      // count magenta pixels in the page via canvas readback of the PNG
      const count = await page.evaluate(async (b64) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
        const cv = new OffscreenCanvas(img.width, img.height), g = cv.getContext('2d'); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, img.width, img.height).data; let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] > 200) n++;
        return { magenta: n, pixels: img.width * img.height };
      }, Buffer.from(shot).toString('base64'));
      report.results.push({ cam: c, file, ...count, ...(await info(page)) });
      await page.close();
    }
  } else if (mode === 'loss') {
    // simulate a device loss twice and confirm the app rebuilds and keeps rendering from its CPU chunk cache
    const page = await open({ view: '3', hud: '0' });
    const before = await info(page);
    for (let k = 0; k < 2; k++) {
      await page.evaluate(() => window.__app.gpu.simulateLoss());
      await page.waitForFunction((n) => window.__app.losses >= n && !window.__app.paused, { timeout: 60000, polling: 250 }, k + 1);
      await new Promise((r) => setTimeout(r, 3000));
    }
    const f0 = await page.evaluate('window.__app.frameIndex');
    await new Promise((r) => setTimeout(r, 4000));
    const after = await info(page);
    const file = `${out}/after-loss.png`;
    writeFileSync(file, await grab(page));
    report.results.push({ before, after, losses: await page.evaluate('window.__app.losses'), framesAdvancedAfterRecovery: after.frames - f0, file });
    await page.close();
  } else if (mode === 'unsupported') {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => { delete Navigator.prototype.gpu; });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
    await page.waitForFunction('window.__startError', { timeout: 20000 });
    report.results.push(await page.evaluate(() => ({ message: window.__startError, panelVisible: !document.getElementById('error').hidden, title: document.querySelector('#error h1').textContent })));
    await page.close();
  } else if (mode === 'bench') {
    const duration = process.env.DURATION || '90';
    const page = await open({ bench: '1', duration, hud: '1' }, { settle: false });
    await page.waitForFunction('window.__benchResult', { timeout: (+duration + 240) * 1000, polling: 1000 });
    const r = await page.evaluate('window.__benchResult');
    writeFileSync(`${out}/bench-end.png`, await grab(page));
    writeFileSync(`${out}/bench-${PRESET}.json`, JSON.stringify(r, null, 2));
    report.results.push(r);
    await page.close();
  }
} catch (e) {
  report.error = e.message;
}
report.log = log.filter((l) => !l.includes('HIGHLANDS_BENCHMARK')).slice(0, 80);
writeFileSync(`${out}/headless-${mode}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2).slice(0, 6000));
await browser.close();
server.kill();
