// Entry point: parse options, check WebGPU support, start the app or explain why it cannot run.
import { App } from './app.js';
import { GpuContext, UnsupportedError } from './gpu/gpu-context.js';
import { PRESETS, DEFAULT_PRESET, WORLD } from './config.js';

const q = new URLSearchParams(location.search);
let stored = null; try { stored = localStorage.getItem('highlands.preset'); } catch {}
const preset = PRESETS[q.get('preset')] ? q.get('preset') : PRESETS[stored] ? stored : DEFAULT_PRESET;
const options = {
  preset,
  seed: q.has('seed') ? (parseInt(q.get('seed'), 10) | 0) : WORLD.seed,
  bench: q.get('bench') === '1',
  duration: Math.max(5, +(q.get('duration') || 180)),
  view: Math.max(0, (+(q.get('view') || 1)) - 1),
  debug: q.get('debug') || 'normal',
  hud: q.get('hud') !== '0',
  dynres: q.get('dynres') !== '0',
  walk: q.get('walk') === '1',
  labels: q.get('labels') === '1',
  cam: q.has('cam') ? q.get('cam').split(',').map(Number) : null,
  scale: q.has('scale') ? Math.max(0.25, Math.min(2, +q.get('scale'))) : 0,
  forest: ['A', 'B', 'C'].includes((q.get('forest') || '').toUpperCase()) ? q.get('forest').toUpperCase() : null,
  light: q.get('light') || 'day',
  tex: q.has('tex') ? Math.max(128, Math.min(2048, +q.get('tex'))) : 0,
  forestLod: q.has('flod') ? Math.max(0.3, Math.min(3, +q.get('flod'))) : 0,
  shafts: q.get('shafts') !== '0',
  freeze: q.get('freeze') === '1',
  time: q.has('t') ? +q.get('t') : null,
};

const $ = (id) => document.getElementById(id);
function fail(msg, unsupported) {
  const el = $('error');
  el.hidden = false;
  el.querySelector('h1').textContent = unsupported ? 'WebGPU is not available' : 'The prototype could not start';
  el.querySelector('p').textContent = msg;
  window.__startError = msg;
}

(async () => {
  const why = GpuContext.unsupportedReason();
  if (why) return fail(why, true);
  try {
    const app = new App({ canvas: $('view'), overlayEl: $('overlay'), statusEl: $('status'), resultEl: $('result'), mapEl: $('map'), labelsEl: $('labels'), options });
    await app.start();
    $('help').hidden = false;
    setTimeout(() => $('help').classList.add('fade'), 9000);
  } catch (e) {
    console.error(e);
    fail(e.message || String(e), e instanceof UnsupportedError);
  }
})();
