// Bundles the Tree Lab: TypeScript → dist/main.js (UI + renderer) and dist/worker.js (growth + meshing worker).
//   node dev/tree-lab/build.mjs        (then serve dev/tree-lab/ over http and open index.html)
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
let commit = 'dev';
try { commit = execSync('git rev-parse --short HEAD', { cwd: here }).toString().trim() + (execSync('git status --porcelain -- .', { cwd: here }).toString().trim() ? '+' : ''); } catch { /* not a checkout */ }
const common = { bundle: true, format: 'esm', target: 'es2022', sourcemap: true, logLevel: 'warning', define: { __COMMIT__: JSON.stringify(commit) } };
await build({ ...common, entryPoints: [here + 'src/lab/worker.ts'], outfile: here + 'dist/worker.js' });
await build({ ...common, entryPoints: [here + 'src/main.ts'], outfile: here + 'dist/main.js', define: { ...common.define, __WORKER_URL__: '""' } });
console.log(`tree lab built (${commit})`);
