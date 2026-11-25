// Evidence capture: the standard review set for a specimen, fixed resolution and lighting, composed into a review
// sheet, exported as PNGs or one ZIP (with the diagnostics as JSON). The lab supplies `shoot`, which renders one
// standardized shot offscreen; this module only defines the protocol and composes/exports.
import type { Mode } from '../render/viewer.ts';

export type ShotView = 'front' | 'side' | 'three' | 'rear' | 'top' | 'trunk' | 'junction';
export interface ShotSpec { view: ShotView; mode: Mode; label: string; file: string }

/** The standard structural review set (same for every specimen). */
export const REVIEW_SET: ShotSpec[] = [
  { view: 'front', mode: 'clay', label: 'Front · clay', file: 'front-clay' },
  { view: 'side', mode: 'clay', label: 'Side · clay', file: 'side-clay' },
  { view: 'three', mode: 'clay', label: 'Three-quarter · clay', file: 'three-clay' },
  { view: 'front', mode: 'silhouette', label: 'Front · silhouette', file: 'front-silhouette' },
  { view: 'side', mode: 'silhouette', label: 'Side · silhouette', file: 'side-silhouette' },
  { view: 'trunk', mode: 'clay', label: 'Trunk close-up · clay', file: 'trunk-clay' },
  { view: 'junction', mode: 'clay', label: 'Main junction close-up · clay', file: 'junction-clay' },
];
/** Standard capture protocol. Full-tree views use a common scale (a 36 m × 27 m frame at the tree) so specimens
 *  can be compared sheet to sheet; close-ups are framed on the feature. */
export const PROTOCOL = { width: 1200, height: 900, light: 'studio', lod: 0, commonFrame: { height: 27, width: 36 } };

export interface SheetInfo { title: string; subtitle: string; lines: [string, string][]; footer: string }

/** Compose shots (in REVIEW_SET order) plus an information panel into one review sheet. */
export async function composeSheet(shots: Blob[], labels: string[], info: SheetInfo, cellW = 600, cellH = 450): Promise<Blob> {
  const cols = 4, rows = Math.ceil((shots.length + 1) / cols), head = 92, pad = 10, foot = 30;
  const W = cols * cellW + (cols + 1) * pad, H = head + rows * (cellH + pad) + pad + foot;
  const cv = new OffscreenCanvas(W, H), g = cv.getContext('2d')!;
  g.fillStyle = '#0f1513'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#e8efe9'; g.font = '600 30px system-ui, sans-serif'; g.fillText(info.title, pad + 4, 42);
  g.fillStyle = '#9fb5aa'; g.font = '16px system-ui, sans-serif'; g.fillText(info.subtitle, pad + 4, 70);
  for (let k = 0; k < shots.length; k++) {
    const x = pad + (k % cols) * (cellW + pad), y = head + Math.floor(k / cols) * (cellH + pad);
    const bmp = await createImageBitmap(shots[k]);
    g.drawImage(bmp, x, y, cellW, cellH); bmp.close();
    g.fillStyle = 'rgba(10,16,14,0.72)'; g.fillRect(x, y + cellH - 28, cellW, 28);
    g.fillStyle = '#e8efe9'; g.font = '14px system-ui, sans-serif'; g.fillText(labels[k], x + 10, y + cellH - 9);
  }
  // information panel in the last cell
  const k = shots.length, x = pad + (k % cols) * (cellW + pad), y = head + Math.floor(k / cols) * (cellH + pad);
  g.fillStyle = '#17201d'; g.fillRect(x, y, cellW, cellH);
  g.font = '14px ui-monospace, Menlo, Consolas, monospace';
  info.lines.slice(0, 22).forEach(([a, b], i) => { g.fillStyle = '#8fa69b'; g.fillText(a, x + 14, y + 26 + i * 19.5); g.fillStyle = '#e8efe9'; g.fillText(b.length > 44 ? b.slice(0, 43) + '…' : b, x + 210, y + 26 + i * 19.5); });
  g.fillStyle = '#7d9389'; g.font = '13px system-ui, sans-serif'; g.fillText(info.footer, pad + 4, H - 11);
  return cv.convertToBlob({ type: 'image/png' });
}

/** Side-by-side comparison sheet: rows of full-width line-up images with labels. */
export async function composeRows(rows: Blob[], labels: string[], title: string, footer: string, w = 2400, h = 800): Promise<Blob> {
  const head = 64, pad = 10, foot = 30;
  const cv = new OffscreenCanvas(w + 2 * pad, head + rows.length * (h + pad) + foot), g = cv.getContext('2d')!;
  g.fillStyle = '#0f1513'; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#e8efe9'; g.font = '600 28px system-ui, sans-serif'; g.fillText(title, pad + 4, 42);
  for (let k = 0; k < rows.length; k++) {
    const y = head + k * (h + pad); const bmp = await createImageBitmap(rows[k]); g.drawImage(bmp, pad, y, w, h); bmp.close();
    g.fillStyle = 'rgba(10,16,14,0.72)'; g.fillRect(pad, y + h - 30, w, 30); g.fillStyle = '#e8efe9'; g.font = '15px system-ui, sans-serif'; g.fillText(labels[k], pad + 10, y + h - 10);
  }
  g.fillStyle = '#7d9389'; g.font = '13px system-ui, sans-serif'; g.fillText(footer, pad + 4, cv.height - 11);
  return cv.convertToBlob({ type: 'image/png' });
}

export function download(blob: Blob, name: string): void {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---- minimal ZIP writer (stored, no compression: PNGs are already compressed)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Uint8Array): number { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export async function zip(files: { name: string; data: Blob | string }[]): Promise<Blob> {
  const enc = new TextEncoder(), parts: BlobPart[] = [], central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  const d = new Date(), dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const data = typeof f.data === 'string' ? enc.encode(f.data) : new Uint8Array(await f.data.arrayBuffer());
    const name = enc.encode(f.name), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
    parts.push(lh.buffer, name as Uint8Array<ArrayBuffer>, data as Uint8Array<ArrayBuffer>);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name as Uint8Array<ArrayBuffer>);
    offset += 30 + name.length + data.length;
  }
  const csize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}
