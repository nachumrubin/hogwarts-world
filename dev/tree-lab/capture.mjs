// Headless captures of the tree lab. node dev/tree-lab/capture.mjs <outDir>
//   TREES=pine,oak,birch VIEWS=front,side,... MODE (optional override) SIZE=WxH SOFTWARE=1 LOD=0 LIGHT=day
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const req = createRequire('/opt/npm-tools/node_modules/');
let puppeteer; try { puppeteer = (await import('puppeteer-core')).default; } catch { puppeteer = req('puppeteer-core'); }
const out = process.argv[2] || 'out-treelab'; mkdirSync(out, { recursive: true });
const [W, H] = (process.env.SIZE || '960x720').split('x').map(Number);
const PORT = +(process.env.PORT || 8797);
const srv = spawn(process.execPath, [fileURLToPath(new URL('../../tools/serve.mjs', import.meta.url)), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 400));
const args = ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--disable-vulkan-surface', `--window-size=${W},${H}`];
if (process.env.SOFTWARE === '1') args.push('--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: 'new', args, protocolTimeout: 1800000 });
const report = [];
const log = [];
for (const tree of (process.env.TREES || 'pine,oak,birch').split(',')) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.on('console', (m) => log.push(`[${tree}] ${m.text()}`)); page.on('pageerror', (e) => log.push(`[${tree}] pageerror ${e.message}`));
  for (const view of (process.env.VIEWS || 'three').split(',')) {
    const q = new URLSearchParams({ tree, view, hud: '0', lod: process.env.LOD || '0', light: process.env.LIGHT || 'day' });
    if (process.env.MODE) q.set('mode', process.env.MODE);
    await page.goto(`http://127.0.0.1:${PORT}/dev/tree-lab/?${q}`, { waitUntil: 'load' });
    await page.waitForFunction('(window.__lab && window.__lab.frames > 2) || window.__labError', { timeout: 900000, polling: 500 });
    const err = await page.evaluate('window.__labError || null'); if (err) { log.push(err); continue; }
    const url = await page.evaluate(() => window.__lab.viewer.capture());
    const file = `${out}/${tree}-${view}${process.env.MODE ? '-' + process.env.MODE : ''}${process.env.LOD && process.env.LOD !== '0' ? '-lod' + process.env.LOD : ''}.png`;
    writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    const info = await page.evaluate(() => ({ built: window.__lab.built, genMs: window.__lab.genMs, errors: window.__errors || [] }));
    report.push({ tree, view, file, ...info }); console.log(file);
  }
  await page.close();
}
writeFileSync(`${out}/report.json`, JSON.stringify({ report, log: log.slice(-40) }, null, 2));
await browser.close(); srv.kill();
