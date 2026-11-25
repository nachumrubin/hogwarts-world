// Lab interface: binds the DOM (index.html) to the Lab controller. Specimen library with thumbnails, comparison
// sets, display modes, camera presets, lighting, LOD, live telemetry, diagnostics, growth history, captures.
import type { Lab, View } from './lab.ts';
import { COMPARISONS, LIGHTS } from './lab.ts';
import { SPECIES } from '../species/index.ts';
import { download } from './capture.ts';
import type { Mode } from '../render/viewer.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const h = (tag: string, attrs: Record<string, string> = {}, html = '') => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.innerHTML = html; return e; };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const fmt = (x: number | null | undefined, d = 1) => (x === null || x === undefined || !isFinite(x) ? '—' : x.toFixed(d));

const MODE_BTNS: [Mode, string, string][] = [['clay', 'Clay', 'KeyC'], ['silhouette', 'Silhouette', 'KeyS'], ['wire', 'Wireframe', 'KeyW'], ['normals', 'Normals', 'KeyN'], ['hierarchy', 'Hierarchy', 'KeyH'], ['lit', 'Materials', 'KeyM']];
const VIEW_BTNS: [View, string, string][] = [['front', 'Front', 'Digit1'], ['side', 'Side', 'Digit2'], ['rear', 'Rear', 'Digit3'], ['three', '¾', 'Digit4'], ['top', 'Top', 'Digit5'], ['trunk', 'Trunk', 'Digit6'], ['junction', 'Junction', 'Digit7'], ['broken', 'Broken', 'Digit8']];

export function bindUI(lab: Lab): void {
  const toast = (msg: string) => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout((t as any)._h); (t as any)._h = setTimeout(() => t.classList.remove('show'), 2600); };
  const busy = (on: boolean, msg = '') => { $('loading').hidden = !on; $('loadingText').textContent = msg; document.querySelector('.dot')!.classList.toggle('busy', on); $('status').textContent = on ? msg : 'Ready · foliage phase (summer; no wind)'; };
  lab.onStatus = (msg, b) => busy(b, msg);
  const guard = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { console.error(e); const el = $('error'); el.hidden = false; el.textContent = String((e as Error).message || e); busy(false); } };

  // ---- library cards
  const cards = $('cards');
  for (const def of SPECIES) {
    const c = h('button', { class: 'card', 'data-id': def.id }, `<div class="thumb wait"></div><div><b>${esc(def.name)}</b><em>${esc(def.species)} · <i>${esc(def.latin)}</i></em><div class="meta" data-meta>growing…</div><span class="badge ${def.status}">${def.status}</span></div>`);
    c.onclick = () => guard(() => lab.select(def.id, lab.state.kind === 'compare' ? 'three' : lab.state.view));
    cards.appendChild(c);
  }
  lab.store.onBuilt = (id) => {
    const card = cards.querySelector(`[data-id="${id}"]`)!; const d = lab.store.get(id).built!.diag;
    card.querySelector('[data-meta]')!.textContent = `${d.height.toFixed(1)} m tall · ${d.crownWidth.toFixed(1)} m crown`;
    lab.thumbnail(id).then((b) => { const t = card.querySelector('.thumb') as HTMLElement; t.style.backgroundImage = `url(${URL.createObjectURL(b)})`; t.classList.remove('wait'); }).catch(console.error);
  };
  const sets = $('sets');
  for (const s of COMPARISONS) {
    const b = h('button', { class: 'set', 'data-id': s.id }, `${esc(s.label)}<small>${s.members.length} specimens</small>`);
    b.onclick = () => guard(() => lab.compare(s.id));
    sets.appendChild(b);
  }

  // ---- modes, views, tools
  const modes = $('modes');
  for (const [m, label] of MODE_BTNS) { const b = h('button', { 'data-mode': m, role: 'tab' }, label); b.onclick = () => lab.setMode(m); modes.appendChild(b); }
  const views = $('views');
  for (const [v, label] of VIEW_BTNS) { const b = h('button', { class: 'chip', 'data-view': v }, label); b.onclick = () => lab.setView(v); views.appendChild(b); }
  $('flyBtn').onclick = () => { lab.cam.setFree(!lab.cam.free); sync(); toast(lab.cam.free ? 'Free-fly: WASD/QE move, drag to look (touch: two fingers move)' : 'Orbit camera'); };
  $('resetBtn').onclick = () => { lab.resetCamera(); sync(); };
  $('shotBtn').onclick = () => guard(async () => { const b = await lab.screenshot(); download(b, `treelab-${lab.subject().id}-${lab.state.view}-${lab.state.mode}.png`); toast('Screenshot saved'); });
  const lights = $('lights');
  for (const L of LIGHTS) { const b = h('button', { 'data-light': L.id }, L.label); b.onclick = () => lab.setLight(L.id); lights.appendChild(b); }
  ($('lod') as HTMLSelectElement).onchange = (e) => lab.setLod(+(e.target as HTMLSelectElement).value);
  ($('live') as HTMLInputElement).onchange = (e) => lab.setLive((e.target as HTMLInputElement).checked);
  ($('foliage') as HTMLInputElement).onchange = (e) => lab.setFoliage((e.target as HTMLInputElement).checked);
  ($('woodland') as HTMLInputElement).onchange = (e) => lab.setEnv((e.target as HTMLInputElement).checked);
  ($('rep') as HTMLSelectElement).onchange = (e) => lab.setRep((e.target as HTMLSelectElement).value as never);
  $('helpBtn').onclick = () => ($('help') as HTMLDialogElement).showModal();

  // ---- capture
  const capButtons = ['sheetBtn', 'matBtn', 'studyBtn', 'cmpBtn', 'zipBtn'].map((id) => $<HTMLButtonElement>(id));
  const capturing = async (label: string, fn: (p: (m: string) => void) => Promise<void>) => {
    capButtons.forEach((b) => (b.disabled = true));
    const keep = { kind: lab.state.kind, specimen: lab.state.specimen, compare: lab.state.compare, view: lab.state.view };
    try { await fn((m) => busy(true, `${label}: ${m}`)); toast(`${label} saved`); }
    finally { capButtons.forEach((b) => (b.disabled = false)); busy(false); if (keep.kind === 'compare') await lab.compare(keep.compare); else await lab.select(keep.specimen, keep.view); }
  };
  $('sheetBtn').onclick = () => guard(() => capturing('Review sheet', async (p) => {
    const id = lab.subject().id; const r = await lab.review(id, (k, n) => p(`shot ${Math.min(k + 1, n)} of ${n}`)); download(r.sheet, `treelab-${id}-review.png`);
  }));
  $('matBtn').onclick = () => guard(() => capturing('Material sheet', async (p) => {
    const id = lab.subject().id; const r = await lab.materialReview(id, (k, n) => p(`shot ${Math.min(k + 1, n)} of ${n}`)); download(r.sheet, `treelab-${id}-materials.png`);
  }));
  $('studyBtn').onclick = () => guard(() => capturing('Foliage study', async (p) => {
    const id = lab.subject().id; const r = await lab.foliageStudy(id, 800, 600, (k, n) => p(`shot ${Math.min(k + 1, n)} of ${n}`)); download(r.sheet, `treelab-${id}-foliage-study.png`);
  }));
  $('standBtn').onclick = () => guard(async () => { await lab.stand(); lab.setEnv(true); ($('woodland') as HTMLInputElement).checked = true; });
  $('cmpBtn').onclick = () => guard(() => capturing('Oak comparison', async (p) => { p('rendering'); download(await lab.comparisonSheet('oaks'), 'treelab-compare-oaks.png'); }));
  $('zipBtn').onclick = () => guard(() => capturing('Export', async (p) => { download(await lab.exportAll(p), `treelab-review-${new Date().toISOString().slice(0, 10)}.zip`); }));

  // ---- mobile tabs
  const tabs = $('tabs');
  const showTab = (t: string) => { tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t)); document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('on', (p as HTMLElement).dataset.tab === t)); };
  tabs.querySelectorAll('button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab!)));
  showTab('library');

  // ---- keyboard
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT' || e.metaKey || e.ctrlKey) return;
    if (lab.cam.free && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(e.code)) return;
    const m = MODE_BTNS.find((x) => x[2] === e.code); if (m) { lab.setMode(m[0]); return; }
    const v = VIEW_BTNS.find((x) => x[2] === e.code); if (v) { lab.setView(v[0]); return; }
    if (e.code === 'KeyF') $('flyBtn').click(); if (e.code === 'KeyR') $('resetBtn').click(); if (e.code === 'KeyP') $('shotBtn').click();
  });

  // ---- state → DOM
  const sync = () => {
    const s = lab.state;
    cards.querySelectorAll('.card').forEach((c) => c.classList.toggle('on', s.kind === 'specimen' && (c as HTMLElement).dataset.id === s.specimen));
    sets.querySelectorAll('.set').forEach((c) => c.classList.toggle('on', s.kind === 'compare' && (c as HTMLElement).dataset.id === s.compare));
    modes.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === s.mode));
    views.querySelectorAll('.chip').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.view === s.view && !lab.cam.free));
    lights.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.light === s.light));
    $('flyBtn').classList.toggle('on', lab.cam.free);
    ($('lod') as HTMLSelectElement).value = String(s.lod); ($('live') as HTMLInputElement).checked = s.live;
    const fb = $('focusbar');
    if (s.kind === 'compare') {
      fb.hidden = false; fb.innerHTML = '';
      const all = h('button', {}, 'Whole line-up'); all.classList.toggle('on', !s.focus); all.onclick = () => lab.focus(null); fb.appendChild(all);
      for (const id of lab.members()) { const b = h('button', {}, esc(lab.store.get(id).def.name.split(' — ')[0] + (lab.store.get(id).def.name.includes('—') ? ' ' + lab.store.get(id).def.variant : ''))); b.classList.toggle('on', s.focus === id); b.onclick = () => lab.focus(id); fb.appendChild(b); }
      const set = COMPARISONS.find((c) => c.id === s.compare) ?? { label: 'Woodland stand — 12 trees, LOD by distance (stress test)' };
      $('capKicker').textContent = 'COMPARISON · TRUE SCALE'; $('capName').textContent = set.label; $('capLatin').textContent = s.focus ? `inspecting ${lab.store.get(s.focus).def.name}` : '';
    } else {
      fb.hidden = true;
      const def = lab.store.get(s.specimen).def;
      $('capKicker').textContent = `SPECIMEN · ${def.status.toUpperCase()}`; $('capName').textContent = def.name; $('capLatin').textContent = `${def.species} · ${def.latin}`;
    }
    inspector();
  };
  const dl = (rows: [string, string][]) => rows.map(([a, b]) => (a ? `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>` : `<dd class="txt">${esc(b)}</dd>`)).join('');
  const inspector = () => {
    const id = lab.subject()?.id ?? lab.state.specimen; const e = lab.store.get(id); const b = e.built; const def = e.def;
    if (!b) return;
    const d = b.diag;
    $('specData').innerHTML = dl([
      ['Specimen', def.name], ['Species', `${def.species} (${def.latin})`], ['Status', def.status],
      ['Height', `${d.height.toFixed(1)} m`], ['Crown width', `${d.crownWidth.toFixed(1)} m`], ['Crown x × z', `${d.crownX.toFixed(1)} × ${d.crownZ.toFixed(1)} m`],
      ['Trunk diameter (1.3 m)', `${d.dbh.toFixed(2)} m`], ['Base diameter', `${d.baseDiameter.toFixed(2)} m`],
      ['Primary limbs (≥20 % trunk r)', String(d.primaryLimbs)], ['Branches off stem', String(d.stemBranches)], ['Total branches', d.branches.toLocaleString()],
      ['Live tips', d.liveTips.toLocaleString()], ['Dead branches / broken ends', `${d.deadBranches} / ${d.brokenEnds}`],
    ]);
    $('specSummary').textContent = def.summary;
    const L = b.lods;
    geo = () => {
      const ps = lab.perf.stats(), v = lab.viewer;
      $('geoData').innerHTML = dl([
        ['Vertices (LOD0/1/2)', L.map((l) => l.verts.toLocaleString()).join(' / ')], ['Triangles (LOD0/1/2)', L.map((l) => l.tris.toLocaleString()).join(' / ')],
        ['Mesh memory (LOD0)', `${((L[0].v.byteLength + L[0].i.byteLength) / 1e6).toFixed(1)} MB`],
        ['Growth time', `${d.growMs} ms`], ['Mesh time (LOD0/1/2)', d.meshMs.join(' / ') + ' ms'],
        ['Scene: draws / triangles', `${v.drawCalls} / ${v.tris.toLocaleString()}`], ['GPU geometry resident', `${(v.geometryBytes / 1e6).toFixed(1)} MB`],
        ['Bark textures', v.tex ? `${v.tex.layers} layers × ${v.tex.size}², ${(v.tex.bytes / 1048576).toFixed(1)} MiB with mips (download ${(v.tex.download / 1048576).toFixed(1)} MiB)` : 'not loaded'],
        ['Frame (mean / p95)', `${fmt(ps.frameMs)} / ${fmt(ps.frameP95)} ms`], ['CPU encode', `${fmt(ps.cpuMs, 2)} ms`], ['GPU pass', v.hasTs ? `${fmt(ps.gpuMs, 2)} ms` : 'not exposed by this browser'],
      ]);
    };
    geo();
    $('growData').innerHTML = dl([['Seed', String(def.seed)], ['Preset', def.preset], ...Object.entries(def.params).map(([k, v]) => [k, String(v)] as [string, string]), ['Skeleton nodes', d.nodes.toLocaleString()]]);
    const mx = Math.max(...d.hierarchy);
    $('hier').innerHTML = d.hierarchy.map((n, i) => `<div style="height:${Math.max(3, (Math.log1p(n) / Math.log1p(mx)) * 100)}%" title="level ${i + 1}: ${n} branches"><span>${n}</span></div>`).join('');
    $('history').innerHTML = (d.history.length ? d.history : ['no recorded events']).map((x) => `<li>${esc(x)}</li>`).join('');
  };
  let geo = () => {};

  // ---- telemetry
  const tel = $('telemetry');
  const T = ['FPS', 'Frame ms', 'GPU ms', 'CPU ms', 'Triangles', 'Vertices', 'Draw calls', 'Geometry'];
  tel.innerHTML = T.map((t) => `<div><small>${t}</small><b>—</b></div>`).join('');
  const cells = [...tel.querySelectorAll('b')];
  let lastTel = 0;
  lab.onFrame = () => {
    const now = performance.now(); if (now - lastTel < 250) return; lastTel = now;
    const ps = lab.perf.stats(), v = lab.viewer;
    const vals = [lab.state.live ? fmt(ps.fps, 0) : 'idle', lab.state.live ? fmt(ps.frameMs) : fmt(ps.cpuMs, 2), v.hasTs ? fmt(ps.gpuMs, 2) : 'n/a', fmt(ps.cpuMs, 2), (v.tris / 1e6).toFixed(2) + 'M', (v.verts / 1e6).toFixed(2) + 'M', String(v.drawCalls), (v.geometryBytes / 1e6).toFixed(0) + ' MB'];
    cells.forEach((c, i) => (c.textContent = vals[i]));
    geo();
  };
  lab.onState = sync;
  $('adapter').textContent = lab.viewer.adapterName;
}
