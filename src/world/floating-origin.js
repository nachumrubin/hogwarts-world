// Floating origin: the GPU works in coordinates relative to a render origin that follows the camera in
// power-of-two steps. See docs/ARCHITECTURE.md §3.4.

export function snapOrigin(v, snap) { return Math.round(v / snap) * snap; }

export class FloatingOrigin {
  constructor(snap) { this.snap = snap; this.x = 0; this.y = 0; this.z = 0; this.changed = true; }
  /** Re-snap around the camera. Vertical origin stays 0: heights are small and stored absolute. */
  update(cx, cz) {
    const x = snapOrigin(cx, this.snap), z = snapOrigin(cz, this.snap);
    this.changed = x !== this.x || z !== this.z;
    this.x = x; this.z = z;
    return this.changed;
  }
}
