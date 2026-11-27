// Benchmark smoke test: waits for the ?bench= run started on load and returns its JSON (software adapter: not GPU performance).
const t0 = Date.now();
while (!window.__benchResult && Date.now() - t0 < 2700000) await new Promise((r) => setTimeout(r, 2000));
return { 'bench-smoke.json': window.__benchResult || { error: 'no result' } };
