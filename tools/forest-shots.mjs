// Forest POC headless captures (software or real GPU).
//   node tools/forest-shots.mjs views [outDir]    MODES=A,B,C  VIEWS=1..8  LIGHT=day|overcast  SIZE=WxH
//   node tools/forest-shots.mjs record [outDir]   frame-stepped walkthrough + flight along the forest route → PNG frames
// Env: CHROME_PATH, SOFTWARE=1, PRESET (default high), TEX (detail texture size), T (wind time for stills), PORT.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

async function loadPuppeteer() {
  try { return (await import('puppeteer-core')).default; } catch {}
  for (const base of ['/opt/npm-tools/node_modules/', process.env.NODE_PATH || '']) { try { return createRequire(base)('puppeteer-core'); } catch {} }
  throw new Error('puppeteer-core not found');
}
const mode = process.argv[2] || 'views';
const out = process.argv[3] || 'out-forest';
const PORT = +(process.env.PORT || 8795);
const [W, H] = (process.env.SIZE || '960x540').split('x').map(Number);
mkdirSync(out, { recursive: true });
const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 400));
const puppeteer = await loadPuppeteer();
const args = ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--disable-vulkan-surface', `--window-size=${W},${H}`];
if (process.env.SOFTWARE === '1') args.push('--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: 'new', args, protocolTimeout: 1800000 });
const log = [];
async function open(params) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.on('console', (m) => log.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
  const q = new URLSearchParams({ preset: process.env.PRESET || 'high', dynres: '0', scale: '1', hud: '0', ...params });
  if (process.env.TEX) q.set('tex', process.env.TEX);
  await page.goto(`http://127.0.0.1:${PORT}/?${q}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__app || window.__startError', { timeout: 600000, polling: 1000 });
  const err = await page.evaluate('window.__startError || null');
  if (err) throw new Error('start error: ' + err + '\n' + log.slice(-10).join('\n'));
  if (params.freeze) await page.waitForFunction(() => { const a = window.__app; return a && a._settled && a.settledFrames >= +(window.__needFrames || 4); }, { timeout: 1800000, polling: 500 }).catch(() => log.push('[headless] settle timeout'));
  else await page.waitForFunction(() => { const a = window.__app; if (!a) return false; a._idle = a.streamer.stats.backlog === 0 && a.streamer.pending.size === 0 && a.overviewFade >= 1 && a.frameIndex > 3 ? (a._idle || 0) + 1 : 0; return a._idle > 2; }, { timeout: 900000, polling: 1000 }).catch(() => log.push('[headless] settle timeout'));
  return page;
}
async function grab(page) {
  const url = await page.evaluate(() => Promise.race([window.__app.renderer.capture(), new Promise((r) => setTimeout(() => r('timeout'), 600000))]));
  if (url === 'timeout') throw new Error('capture timed out ' + log.slice(-8).join(' | '));
  return Buffer.from(url.split(',')[1], 'base64');
}
const info = (page) => page.evaluate(() => { const a = window.__app; return { adapter: a.gpu.adapterInfo, stats: { ...a.renderer.stats }, forest: a.forest ? { ...a.forest.stats, lod: a.forest.stats.lod.slice() } : null, errors: a.gpu.errors.slice(0, 5), pos: [a.flight.x, a.flight.y, a.flight.z].map((v) => +v.toFixed(1)) }; });
const report = { mode, size: `${W}x${H}`, results: [] };
try {
  if (mode === 'views') {
    for (const m of (process.env.MODES || 'C').split(',')) for (const v of (process.env.VIEWS || '1,2,3,4,5,6,7,8').split(',')) {
      const t0 = Date.now();
      const page = await open({ forest: m, view: v, freeze: '1', t: process.env.T || '12', light: process.env.LIGHT || 'day' });
      const file = `${out}/${m}-view${v}${process.env.LIGHT && process.env.LIGHT !== 'day' ? '-' + process.env.LIGHT : ''}.png`;
      writeFileSync(file, await grab(page));
      report.results.push({ mode: m, view: +v, file, ms: Date.now() - t0, ...(await info(page)) });
      console.log(file, Date.now() - t0, 'ms');
      await page.close();
    }
  } else if (mode === 'record') {
    const page = await open({ forest: process.env.MODE || 'C', view: '1', light: process.env.LIGHT || 'day', t: '0' });
    const fps = +(process.env.FPS || 24), secs = +(process.env.SECS || 20), n = Math.round(fps * secs);
    await page.evaluate(() => { const a = window.__app; a.startBenchmark(false); a.bench.duration = 1e9; });
    for (let i = 0; i < n; i++) {
      const t = i / fps;
      await page.evaluate((t, total) => { const a = window.__app; a.opt.time = t; const p = a.route.at ? null : null; a.bench._t = t; a.bench.forceU = t / total; }, t, secs);
      writeFileSync(`${out}/f${String(i).padStart(5, '0')}.png`, await grab(page));
      if (i % 24 === 0) console.log('frame', i, '/', n);
    }
  }
} catch (e) { report.error = String(e.stack || e); console.error(e); }
report.log = log.filter((l) => !l.includes('[verbose]')).slice(-60);
writeFileSync(`${out}/report-${mode}.json`, JSON.stringify(report, null, 2));
await browser.close(); server.kill();
