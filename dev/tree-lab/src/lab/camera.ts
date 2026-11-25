// Camera controller: orbit (drag), pan (right/middle drag, shift-drag, two-finger drag), zoom (wheel, pinch),
// free-fly (WASD/QE + drag to look; on touch one finger looks, two fingers move). Presets frame a box from a named
// direction with the actual viewport aspect; transitions are eased so the eye can follow them.
export type V3 = [number, number, number];
export interface Box { min: V3; max: V3 }
export type Preset = 'front' | 'side' | 'rear' | 'three' | 'top';
export const FOV = (45 * Math.PI) / 180;

interface Orbit { target: V3; az: number; el: number; dist: number }

export class CameraController {
  orbit: Orbit = { target: [0, 9, 0], az: 0, el: 0.08, dist: 40 };
  free = false;
  eye: V3 = [0, 2, 30]; yaw = Math.PI; pitch = 0;
  private anim: { from: Orbit; to: Orbit; t: number; dur: number } | null = null;
  private keys = new Set<string>();
  private pointers = new Map<number, { x: number; y: number; button: number }>();
  private pinch = 0; private mid: [number, number] = [0, 0];
  onChange: () => void = () => {};
  aspect = 1.5;
  speed = 4;

  attach(el: HTMLElement): void {
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId); el.focus?.();
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.pointerType === 'mouse' ? (e.shiftKey ? 2 : e.button) : 0 });
      this.anim = null;
      if (this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; this.pinch = Math.hypot(a.x - b.x, a.y - b.y); this.mid = [(a.x + b.x) / 2, (a.y + b.y) / 2]; }
    });
    const up = (e: PointerEvent) => { this.pointers.delete(e.pointerId); if (this.pointers.size < 2) this.pinch = 0; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), m: [number, number] = [(a.x + b.x) / 2, (a.y + b.y) / 2];
        if (this.pinch > 0) {
          if (this.free) this.fly(0, 0, (d - this.pinch) * 0.05);
          else this.orbit.dist = clamp(this.orbit.dist * this.pinch / Math.max(d, 1), 0.6, 400);
          this.pan(m[0] - this.mid[0], m[1] - this.mid[1], el.clientHeight);
        }
        this.pinch = d; this.mid = m; this.onChange(); return;
      }
      if (this.free) { this.yaw -= dx * 0.004; this.pitch = clamp(this.pitch - dy * 0.004, -1.5, 1.5); }
      else if (p.button === 1 || p.button === 2) this.pan(dx, dy, el.clientHeight);
      else { this.orbit.az -= dx * 0.006; this.orbit.el = clamp(this.orbit.el + dy * 0.005, -0.25, 1.55); }
      this.onChange();
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault(); this.anim = null;
      if (this.free) this.fly(0, 0, -e.deltaY * 0.01);
      else this.orbit.dist = clamp(this.orbit.dist * Math.exp(e.deltaY * 0.0012), 0.6, 400);
      this.onChange();
    }, { passive: false });
    window.addEventListener('keydown', (e: KeyboardEvent) => { if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return; this.keys.add(e.code); });
    window.addEventListener('keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Screen-space pan of the orbit target (or the free eye). */
  pan(dx: number, dy: number, h: number): void {
    const { r, u } = this.basis();
    const s = (this.free ? 8 : this.orbit.dist) * 2 * Math.tan(FOV / 2) / Math.max(h, 1);
    const d: V3 = [(-r[0] * dx + u[0] * dy) * s, (-r[1] * dx + u[1] * dy) * s, (-r[2] * dx + u[2] * dy) * s];
    if (this.free) this.eye = add(this.eye, d); else this.orbit.target = add(this.orbit.target, d);
  }
  private fly(right: number, up: number, fwd: number): void {
    const f = this.forward(), r: V3 = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    this.eye = [this.eye[0] + f[0] * fwd + r[0] * right, this.eye[1] + f[1] * fwd + up, this.eye[2] + f[2] * fwd + r[2] * right];
  }
  private forward(): V3 { return [Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)]; }
  private basis(): { r: V3; u: V3 } {
    const { eye, target } = this.view();
    const f = norm(sub(target, eye)); const r = norm(cross(f, [0, 1, 0])); const u = cross(r, f);
    return { r, u };
  }

  setFree(on: boolean): void {
    if (on === this.free) return;
    if (on) { const { eye, target } = this.view(); this.eye = eye; const f = norm(sub(target, eye)); this.yaw = Math.atan2(f[0], f[2]); this.pitch = Math.asin(clamp(f[1], -1, 1)); }
    else { const f = this.forward(); this.orbit.target = add(this.eye, mul(f, this.orbit.dist)); this.orbit.az = Math.atan2(-f[0], -f[2]); this.orbit.el = Math.asin(clamp(-f[1], -1, 1)); }
    this.free = on; this.onChange();
  }

  /** Advance animation and free-fly keys; returns true if the view changed. */
  update(dt: number): boolean {
    let moved = false;
    if (this.anim) {
      const a = this.anim; a.t = Math.min(1, a.t + dt / a.dur); const k = a.t * a.t * (3 - 2 * a.t);
      let daz = a.to.az - a.from.az; daz = Math.atan2(Math.sin(daz), Math.cos(daz));
      this.orbit = { target: lerp3(a.from.target, a.to.target, k), az: a.from.az + daz * k, el: a.from.el + (a.to.el - a.from.el) * k, dist: Math.exp(Math.log(a.from.dist) + (Math.log(a.to.dist) - Math.log(a.from.dist)) * k) };
      if (a.t >= 1) this.anim = null;
      moved = true;
    }
    if (this.free && this.keys.size) {
      const sp = this.speed * (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 4 : 1) * dt;
      const k = (c: string) => (this.keys.has(c) ? 1 : 0);
      const fw = k('KeyW') - k('KeyS'), rt = k('KeyD') - k('KeyA'), upv = k('KeyE') - k('KeyQ');
      if (fw || rt || upv) { this.fly(-rt * sp, upv * sp, fw * sp); moved = true; }
    }
    return moved;
  }

  view(): { eye: V3; target: V3 } {
    if (this.free) return { eye: this.eye, target: add(this.eye, this.forward()) };
    const o = this.orbit;
    return { eye: [o.target[0] + Math.sin(o.az) * Math.cos(o.el) * o.dist, o.target[1] + Math.sin(o.el) * o.dist, o.target[2] + Math.cos(o.az) * Math.cos(o.el) * o.dist], target: o.target };
  }

  /** Orbit parameters that frame a box from a named direction, using the current aspect. */
  static framing(box: Box, preset: Preset, aspect: number, margin = 1.08): Orbit {
    const c: V3 = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
    const sx = box.max[0] - box.min[0], sy = box.max[1] - box.min[1], sz = box.max[2] - box.min[2];
    const az = { front: 0, side: Math.PI / 2, rear: Math.PI, three: Math.PI / 4, top: 0 }[preset];
    const el = { front: 0.04, side: 0.04, rear: 0.04, three: 0.22, top: 1.5 }[preset];
    // the box's width as seen from this direction, and its depth (perspective: the near face is closer)
    const w = Math.abs(Math.cos(az)) * sx + Math.abs(Math.sin(az)) * sz, depth = Math.abs(Math.sin(az)) * sx + Math.abs(Math.cos(az)) * sz;
    const t = Math.tan(FOV / 2);
    let dist: number;
    if (preset === 'top') dist = Math.max(Math.max(sx, sz) / 2 / (t * Math.min(aspect, 1)), sy) * margin + sy / 2;
    else dist = Math.max((sy / 2) * Math.cos(el) / t + sy * Math.sin(el) * 0.5, (w / 2) / (t * aspect)) * margin + depth * 0.3;
    return { target: c, az, el, dist };
  }
  frame(box: Box, preset: Preset, animate = true): void {
    this.setFree(false);
    this.go(CameraController.framing(box, preset, this.aspect), animate);
  }
  go(to: Orbit, animate = true): void {
    if (this.free) this.setFree(false);
    if (!animate) { this.orbit = { ...to, target: [...to.target] as V3 }; this.anim = null; }
    else this.anim = { from: { ...this.orbit, target: [...this.orbit.target] as V3 }, to, t: 0, dur: 0.45 };
    this.onChange();
  }
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
