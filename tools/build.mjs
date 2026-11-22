// Bundles the browser app (src/main.js) and the terrain worker into dist/ with esbuild. TypeScript is stripped by
// esbuild; `npm run typecheck` runs the type checker separately.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const common = { bundle: true, format: 'esm', target: 'es2022', sourcemap: true, absWorkingDir: root, logLevel: 'warning', minify: false };
const t0 = Date.now();
await build({ ...common, entryPoints: ['src/main.js'], outfile: 'dist/main.js' });
await build({ ...common, entryPoints: ['src/terrain/terrain-worker.js'], outfile: 'dist/terrain-worker.js' });
console.log(`built dist/ in ${Date.now() - t0} ms`);
