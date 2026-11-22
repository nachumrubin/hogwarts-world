// Fast CPU preview of the skeletons (no GPU): orthographic capsule rasteriser with a z-buffer and Lambert shading.
// Used to iterate on the growth models in seconds; the GPU viewer makes the real renders.
//   node dev/tree-lab/tools/preview.ts out.png [views=front,side] [mode=clay|silhouette|hierarchy]
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { SPECIES } from '../src/species/index.ts';
import type { Skeleton } from '../src/framework/skeleton.ts';

const out = process.argv[2] || 'preview.png';
const views = (process.argv[3] || 'front,side').split(',');
const mode = process.argv[4] || 'clay';
const W = 520, H = 520, SCALE = 16; // px per metre… fit 32 m
const pal: Record<number, number[]> = { 0: [110, 70, 40], 1: [215, 70, 40], 2: [240, 160, 40], 3: [230, 225, 60], 4: [90, 200, 80], 5: [60, 190, 215], 6: [100, 110, 240] };

function render(sk: Skeleton, az: number): Uint8Array {
  const img = new Uint8Array(W * H * 3).fill(0);
  const zb = new Float32Array(W * H).fill(1e9);
  for (let i = 0; i < W * H; i++) { const y = Math.floor(i / W); const g = mode === 'silhouette' ? 255 : 200 - y * 0.12; img[i * 3] = g; img[i * 3 + 1] = g + (mode === 'silhouette' ? 0 : 8); img[i * 3 + 2] = g + (mode === 'silhouette' ? 0 : 25); }
  const ca = Math.cos(az), sa = Math.sin(az);
  const proj = (p: number[]) => { const x = p[0] * ca - p[2] * sa, z = p[0] * sa + p[2] * ca; return [W / 2 + x * SCALE, H - 30 - p[1] * SCALE, z]; };
  const L = [0.5, 0.65, -0.55]; const ll = Math.hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll;
  for (const n of sk.nodes) {
    if (!n.parent) continue;
    const a = proj(n.parent.p), b = proj(n.p);
    const ra = Math.max(0.5, n.parent.r * SCALE), rb = Math.max(0.5, n.r * SCALE);
    const x0 = Math.floor(Math.min(a[0] - ra, b[0] - rb)), x1 = Math.ceil(Math.max(a[0] + ra, b[0] + rb));
    const y0 = Math.floor(Math.min(a[1] - ra, b[1] - rb)), y1 = Math.ceil(Math.max(a[1] + ra, b[1] + rb));
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-6;
    const col = n.dead ? [120, 120, 125] : n.root ? [120, 60, 150] : pal[Math.min(6, n.order)] || pal[6];
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
      const px = a[0] + dx * t - x, py = a[1] + dy * t - y, d = Math.hypot(px, py), r = ra + (rb - ra) * t;
      if (d > r) continue;
      const h = Math.sqrt(r * r - d * d);
      const z = a[2] + (b[2] - a[2]) * t - h / SCALE;
      const k = y * W + x;
      if (z >= zb[k]) continue;
      zb[k] = z;
      if (mode === 'silhouette') { img[k * 3] = img[k * 3 + 1] = img[k * 3 + 2] = 0; continue; }
      // normal: from the axis towards the pixel, plus the out-of-screen component
      const nx = -px / r, ny = py / r, nz = -h / r;
      const lam = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      const c = mode === 'hierarchy' ? col : [200, 196, 188];
      const s = 0.35 + 0.65 * lam;
      img[k * 3] = Math.min(255, c[0] * s); img[k * 3 + 1] = Math.min(255, c[1] * s); img[k * 3 + 2] = Math.min(255, c[2] * s);
    }
  }
  // ground line
  for (let x = 0; x < W; x++) for (let y = H - 30; y < H; y++) { const k = y * W + x; if (zb[k] > 1e8) { img[k * 3] = 150; img[k * 3 + 1] = 150; img[k * 3 + 2] = 140; } }
  return img;
}

function png(w: number, h: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b: Buffer) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const which = (process.env.TREES || 'pine,oak,birch').split(',');
const tiles: Uint8Array[] = [];
const stats: string[] = [];
for (const id of which) {
  const def = SPECIES.find((s) => s.id === id)!;
  const t0 = performance.now();
  const { sk, info } = def.grow();
  stats.push(`${id}: ${(performance.now() - t0).toFixed(0)} ms ${JSON.stringify(info)}`);
  for (const v of views) tiles.push(render(sk, v === 'side' ? Math.PI / 2 : v === 'three' ? Math.PI / 4 : 0));
}
const cols = views.length * which.length, big = new Uint8Array(W * cols * H * 3);
tiles.forEach((t, i) => { for (let y = 0; y < H; y++) big.set(t.subarray(y * W * 3, (y + 1) * W * 3), (y * W * cols + i * W) * 3); });
writeFileSync(out, png(W * cols, H, big));
console.log(stats.join('\n'));
