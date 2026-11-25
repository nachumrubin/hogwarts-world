// Bundles the Tree Lab: TypeScript → dist/main.js (UI + renderer) and dist/worker.js (growth + meshing worker).
//   node dev/tree-lab/build.mjs                 local build (then serve dev/tree-lab/ over http and open index.html)
//   node dev/tree-lab/build.mjs --pages <dir>   stage a static site for GitHub Pages in <dir>: content-hashed
//                                               assets (Pages caches for 10 min), relative URLs only, so it works
//                                               under any base path (…/hogwarts-world/dev/tree-lab/)
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
let commit = 'dev';
try { commit = execSync('git rev-parse --short HEAD', { cwd: here }).toString().trim() + (execSync('git status --porcelain -- .', { cwd: here }).toString().trim() ? '+' : ''); } catch { /* not a checkout */ }
const common = { bundle: true, format: 'esm', target: 'es2022', logLevel: 'warning', define: { __COMMIT__: JSON.stringify(commit) } };

const pagesAt = process.argv.indexOf('--pages');
if (pagesAt < 0) {
  await build({ ...common, sourcemap: true, entryPoints: [here + 'src/lab/worker.ts'], outfile: here + 'dist/worker.js' });
  await build({ ...common, sourcemap: true, entryPoints: [here + 'src/main.ts'], outfile: here + 'dist/main.js', define: { ...common.define, __WORKER_URL__: '""' } });
  console.log(`tree lab built (${commit})`);
} else {
  const out = resolve(process.argv[pagesAt + 1] || 'dist/tree-lab-pages');
  const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
  const bundle = async (entry, define) => (await build({ ...common, minify: true, write: false, entryPoints: [here + entry], define: { ...common.define, ...define } })).outputFiles[0].text;
  // the worker first: its hashed name is baked into the main bundle (a relative URL resolves against the page)
  const worker = await bundle('src/lab/worker.ts', {});
  const workerName = `assets/worker-${hash(worker)}.js`;
  const main = await bundle('src/main.ts', { __WORKER_URL__: JSON.stringify(workerName) });
  const mainName = `assets/main-${hash(main)}.js`;
  const css = await readFile(here + 'style.css', 'utf8');
  const cssName = `assets/style-${hash(css)}.css`;
  const html = await readFile(here + 'index.html', 'utf8');
  const tagCss = '<link rel="stylesheet" href="./style.css">', tagJs = '<script type="module" src="./dist/main.js"></script>';
  if (!html.includes(tagCss) || !html.includes(tagJs)) throw new Error('Tree Lab entry stylesheet or script tag changed');
  const page = html.replace(tagCss, `<link rel="stylesheet" href="./${cssName}">`).replace(tagJs, `<script type="module" src="./${mainName}"></script>`);
  await rm(out, { recursive: true, force: true });
  await mkdir(out + '/assets', { recursive: true });
  await Promise.all([
    writeFile(`${out}/index.html`, page), writeFile(`${out}/${mainName}`, main), writeFile(`${out}/${workerName}`, worker), writeFile(`${out}/${cssName}`, css),
    writeFile(`${out}/version.json`, JSON.stringify({ commit, built: new Date().toISOString(), main: mainName, worker: workerName, css: cssName }, null, 2)),
  ]);
  for (const f of ['README.md', 'REPORT.md']) if (existsSync(here + f)) await cp(here + f, `${out}/${f}`);
  if (existsSync(here + 'review')) await cp(here + 'review', `${out}/review`, { recursive: true });
  console.log(`tree lab staged for Pages in ${out} (${commit}): ${mainName}, ${workerName}`);
}
