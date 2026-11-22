// Keyboard + pointer-lock mouse input. Accumulates mouse deltas until the flight model consumes them.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mdx = 0; this.mdy = 0; this.wheel = 0;
    this.pressed = new Set(); // edge-triggered, cleared by consumePressed()
    this.locked = false;
    addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code.startsWith('F') && e.code.length <= 3) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('click', () => {
      if (document.pointerLockElement !== canvas) {
        const p = canvas.requestPointerLock({ unadjustedMovement: true });
        if (p && p.catch) p.catch(() => canvas.requestPointerLock());
      }
    });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
    addEventListener('mousemove', (e) => { if (this.locked) { this.mdx += e.movementX; this.mdy += e.movementY; } });
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  }
  down(...codes) { for (const c of codes) if (this.keys.has(c)) return true; return false; }
  axis(neg, pos) { return (this.down(...pos) ? 1 : 0) - (this.down(...neg) ? 1 : 0); }
  consumeMouse(out) { out[0] = this.mdx; out[1] = this.mdy; this.mdx = this.mdy = 0; return out; }
  consumePressed() { const p = [...this.pressed]; this.pressed.clear(); return p; }
}
