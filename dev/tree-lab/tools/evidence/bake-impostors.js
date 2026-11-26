// Offline impostor bake (the lab's own baker): returns each specimen's atlas layer as raw RGBA (base64) with its
// fingerprint, centre and radius; tools/impostor_atlas.py writes textures/impostor.<id>.*.webp and impostors.json.
const lab = window.__lab, out = {};
const ids = ['oak-a', 'oak-b', 'oak-c', 'pine', 'birch'];
await lab.ensure(ids);
const man = {};
for (const id of ids) {
  const t0 = performance.now();
  await lab.ensureImpostors([id]);
  const sp = lab.impostors.specs.get(id);
  const px = await lab.impostors.read(sp.layer);
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  out[`${id}.albedo.rgba.b64`] = b64(px.albedo); out[`${id}.normal.rgba.b64`] = b64(px.normal);
  man[id] = { fingerprint: lab.fingerprint(id), center: sp.center, radius: sp.radius, bakeMs: performance.now() - t0 };
}
out['impostors-bake.json'] = man;
return out;
