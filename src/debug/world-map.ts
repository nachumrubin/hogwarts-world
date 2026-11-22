// Debug map (deliverable 6): world coordinates, landmarks, routes, encounter zones and the player.
// Small in the corner; M toggles a large map where a click teleports (broom mode, 60 m above the ground).
// The base image comes from a quick low-resolution height sample at start, replaced by the baked overview maps.

import type { WorldTerrain } from '../world/world-terrain.ts';

export interface MapPlayer { x: number; z: number; yaw: number; y: number; agl: number; mode: string }

export class WorldMap {
  private canvas: HTMLCanvasElement; private g: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private T: WorldTerrain;
  private big = false;
  // map frame: playable area plus a margin
  private x0 = -400; private z0 = -400; private x1 = 8400; private z1 = 6400;
  onTeleport: ((x: number, z: number) => void) | null = null;
  visible = true;

  constructor(canvas: HTMLCanvasElement, terrain: WorldTerrain) {
    this.canvas = canvas; this.g = canvas.getContext('2d')!; this.T = terrain;
    canvas.addEventListener('click', (e) => {
      if (!this.big || !this.onTeleport) return;
      const r = canvas.getBoundingClientRect(), u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
      this.onTeleport(this.x0 + u * (this.x1 - this.x0), this.z1 - v * (this.z1 - this.z0));
    });
    this.layout();
    this.quickBase();
  }

  toggleSize(): void { this.big = !this.big; this.layout(); }
  toggle(): void { this.visible = !this.visible; this.canvas.hidden = !this.visible; }
  private layout(): void {
    const w = this.big ? Math.min(innerWidth * 0.8, (innerHeight * 0.85) * 1.375) : 300;
    this.canvas.width = Math.round(w); this.canvas.height = Math.round(w / 1.375);
    this.canvas.className = this.big ? 'map big' : 'map';
  }

  /** A fast first image: 176×128 height samples (about 0.1 s). */
  private quickBase(): void {
    const nx = 176, nz = 128, H = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) H[j * nx + i] = this.T.heightAt(this.x0 + (i + 0.5) * (this.x1 - this.x0) / nx, this.z0 + (j + 0.5) * (this.z1 - this.z0) / nz);
    this.base = this.shade(H, nx, nz, null, this.x0, this.z0, (this.x1 - this.x0) / nx);
  }

  /** Replace the base image with the baked overview (heights + materials). */
  setOverview(ov: { grid: { x0: number; z0: number; cell: number; nx: number; nz: number }; heights?: Float32Array; materials: Uint8Array }): void {
    if (!ov.heights) return;
    const g = ov.grid;
    this.base = this.shade(ov.heights, g.nx, g.nz, ov.materials, g.x0, g.z0, g.cell);
    this.baseRect = [g.x0, g.z0, g.x0 + g.nx * g.cell, g.z0 + g.nz * g.cell];
  }
  private baseRect: number[] | null = null;

  private shade(H: Float32Array, nx: number, nz: number, M: Uint8Array | null, ox: number, oz: number, cell: number): HTMLCanvasElement {
    const c = document.createElement('canvas'); c.width = nx; c.height = nz;
    const g = c.getContext('2d')!, img = g.createImageData(nx, nz), W = this.T.water;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, h = H[k];
      const hx = H[j * nx + Math.min(nx - 1, i + 1)] - H[j * nx + Math.max(0, i - 1)], hz = H[Math.min(nz - 1, j + 1) * nx + i] - H[Math.max(0, j - 1) * nx + i];
      const sh = Math.max(0.25, Math.min(1.3, 0.85 + (-hx * 0.6 - hz * 0.6) / (2 * cell)));
      let r: number, gg: number, b: number;
      if (h < W) { const d = Math.min(1, (W - h) / 70); r = 30 - 15 * d; gg = 70 - 30 * d; b = 120 - 30 * d; }
      else {
        const t = Math.min(1, (h - W) / 600);
        r = 110 + 80 * t; gg = 125 + 50 * t; b = 80 + 80 * t;
        if (M) { const f = M[k * 4] / 255, lawn = M[k * 4 + 2] / 255, path = M[k * 4 + 3] / 255;
          r = r * (1 - f) + 35 * f; gg = gg * (1 - f) + (70 - 25 * M[k * 4 + 1] / 255) * f; b = b * (1 - f) + 35 * f;
          r = r * (1 - lawn) + 95 * lawn; gg = gg * (1 - lawn) + 150 * lawn; b = b * (1 - lawn) + 70 * lawn;
          r = r * (1 - path) + 160 * path; gg = gg * (1 - path) + 140 * path; b = b * (1 - path) + 110 * path; }
        r *= sh; gg *= sh; b *= sh;
      }
      const o = ((nz - 1 - j) * nx + i) * 4; // north up
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  private px(x: number): number { return (x - this.x0) / (this.x1 - this.x0) * this.canvas.width; }
  private pz(z: number): number { return (this.z1 - z) / (this.z1 - this.z0) * this.canvas.height; }

  draw(p: MapPlayer): void {
    if (!this.visible) return;
    const g = this.g, w = this.canvas.width, ht = this.canvas.height, db = this.T.db;
    g.fillStyle = '#111'; g.fillRect(0, 0, w, ht);
    if (this.base) {
      if (this.baseRect) { const [a, b, c, d] = this.baseRect; g.drawImage(this.base, this.px(a), this.pz(d), this.px(c) - this.px(a), this.pz(b) - this.pz(d)); }
      else g.drawImage(this.base, 0, 0, w, ht);
    }
    // playable boundary
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1; g.setLineDash([4, 3]);
    g.strokeRect(this.px(0), this.pz(6000), this.px(8000) - this.px(0), this.pz(0) - this.pz(6000)); g.setLineDash([]);
    // grid every 1 km
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    for (let x = 0; x <= 8000; x += 1000) { g.beginPath(); g.moveTo(this.px(x), this.pz(0)); g.lineTo(this.px(x), this.pz(6000)); g.stroke(); }
    for (let z = 0; z <= 6000; z += 1000) { g.beginPath(); g.moveTo(this.px(0), this.pz(z)); g.lineTo(this.px(8000), this.pz(z)); g.stroke(); }
    // railway and paths
    const line = (pts: [number, number][], style: string, lw: number) => { g.strokeStyle = style; g.lineWidth = lw; g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(this.px(x), this.pz(z)) : g.moveTo(this.px(x), this.pz(z)))); g.stroke(); };
    line(this.T.rail.pts, '#ddd', this.big ? 2.5 : 1.5);
    for (const pth of db.paths) line(pth.points, 'rgba(230,200,150,0.8)', 1);
    // encounter zones
    for (const e of db.encounterZones) { g.strokeStyle = 'rgba(255,120,60,0.7)'; g.beginPath(); g.arc(this.px(e.x), this.pz(e.z), e.radius / (this.x1 - this.x0) * w, 0, Math.PI * 2); g.stroke(); }
    // landmarks
    g.font = `${this.big ? 12 : 9}px system-ui, sans-serif`;
    for (const l of db.landmarks) {
      const x = this.px(l.x), y = this.pz(l.z);
      g.fillStyle = '#ffd24a'; g.fillRect(x - 2, y - 2, 4, 4);
      if (this.big) { g.fillStyle = '#fff'; g.fillText(l.name, x + 5, y - 3); }
    }
    // player
    const x = this.px(p.x), y = this.pz(p.z), a = p.yaw;
    g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = p.mode === 'walk' ? '#4cf' : '#f44'; g.beginPath(); g.moveTo(0, -8); g.lineTo(5, 6); g.lineTo(-5, 6); g.closePath(); g.fill(); g.restore();
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, ht - 18, w, 18);
    g.fillStyle = '#fff'; g.font = '11px ui-monospace, monospace';
    g.fillText(`x ${p.x.toFixed(0)} E  z ${p.z.toFixed(0)} N  y ${p.y.toFixed(0)} m  ${p.mode}${this.big ? '   click to teleport' : ''}`, 6, ht - 5);
  }
}

/** World-space landmark labels projected on the CPU (N toggles). */
export class Labels {
  private root: HTMLElement; private els: HTMLElement[] = [];
  private items: { name: string; x: number; y: number; z: number }[];
  visible = false;
  constructor(root: HTMLElement, items: { name: string; x: number; y: number; z: number }[]) {
    this.root = root; this.items = items;
    for (const it of items) { const e = document.createElement('div'); e.className = 'label'; e.textContent = it.name; root.appendChild(e); this.els.push(e); }
    root.hidden = true;
  }
  toggle(): void { this.visible = !this.visible; this.root.hidden = !this.visible; }
  /** vp = column-major viewProj relative to the render origin (ox, oz). */
  update(vp: Float32Array, ox: number, oz: number, cw: number, ch: number, camX: number, camZ: number): void {
    if (!this.visible) return;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i], e = this.els[i], x = it.x - ox, y = it.y, z = it.z - oz;
      const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12], cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13], cwv = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
      const d = Math.hypot(it.x - camX, it.z - camZ);
      if (cwv <= 0.5 || d > 6000) { e.style.display = 'none'; continue; }
      e.style.display = 'block';
      e.style.transform = `translate(${((cx / cwv) * 0.5 + 0.5) * cw}px, ${((-cy / cwv) * 0.5 + 0.5) * ch}px) translate(-50%, -100%)`;
      e.style.opacity = String(Math.max(0.35, 1 - d / 6000));
    }
  }
}
