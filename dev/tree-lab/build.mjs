// Bundles the tree lab (TypeScript → dist/main.js). node dev/tree-lab/build.mjs
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
await build({ entryPoints: [here + 'src/main.ts'], outfile: here + 'dist/main.js', bundle: true, format: 'esm', target: 'es2022', sourcemap: true, logLevel: 'warning' });
console.log('tree lab built');
