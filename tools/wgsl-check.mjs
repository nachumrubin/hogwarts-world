// Compile every forest/terrain WGSL source in headless Chrome and print compilation messages (fast shader iteration).
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const req = createRequire('/opt/npm-tools/node_modules/');
let puppeteer; try { puppeteer = (await import('puppeteer-core')).default; } catch { puppeteer = req('puppeteer-core'); }
const { VEGETATION_WGSL } = await import('../src/forest/shaders/vegetation.wgsl.ts');
const { COVER_WGSL } = await import('../src/forest/shaders/cover.wgsl.ts');
const { IMPOSTOR_WGSL, SHAFTS_WGSL } = await import('../src/forest/shaders/impostor-shafts.wgsl.ts');
const { BAKE_HEIGHT_WGSL, BAKE_FINAL_WGSL, MIP_WGSL, BAKE_LEAF_WGSL } = await import('../src/forest/shaders/bake.wgsl.ts');
const { FOREST_STRUCT_WGSL, FOREST_BINDINGS_WGSL, FOREST_FUNCS_WGSL } = await import('../src/forest/shaders/forest-common.wgsl.ts');
const { terrainWGSL } = await import('../src/gpu/shaders/terrain.wgsl.js');
const { SKY_WGSL } = await import('../src/gpu/shaders/sky-water-post.wgsl.js');
const srcs = { VEGETATION_WGSL, COVER_WGSL, IMPOSTOR_WGSL, SHAFTS_MS: SHAFTS_WGSL(true), BAKE_HEIGHT_WGSL, BAKE_FINAL_WGSL, MIP_WGSL, BAKE_LEAF_WGSL, TERRAIN_FOREST: terrainWGSL(FOREST_STRUCT_WGSL + FOREST_BINDINGS_WGSL + FOREST_FUNCS_WGSL), SKY_WGSL };
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--enable-unsafe-webgpu', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] });
import { spawn } from 'node:child_process';
const srv = spawn(process.execPath, [new URL('./serve.mjs', import.meta.url).pathname, '8799'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 400));
const page = await browser.newPage();
await page.goto('http://127.0.0.1:8799/blank-check');
const res = await page.evaluate(async (srcs) => {
  const a = await navigator.gpu.requestAdapter(); const d = await a.requestDevice();
  const out = {};
  for (const [k, code] of Object.entries(srcs)) { const m = d.createShaderModule({ code }); const ci = await m.getCompilationInfo(); out[k] = ci.messages.filter((x) => x.type !== 'info').map((x) => `${x.type} ${x.lineNum}:${x.linePos} ${x.message} | ${code.split('\n')[x.lineNum - 1]?.trim().slice(0, 120)}`); }
  return out;
}, srcs).catch((e) => ({ error: String(e) }));
for (const [k, v] of Object.entries(res)) console.log(k, Array.isArray(v) ? (v.length ? '\n  ' + v.join('\n  ') : 'ok') : v);
await browser.close(); srv.kill();
