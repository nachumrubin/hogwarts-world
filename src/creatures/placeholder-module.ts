// A placeholder creature module that exercises the full contract: it patrols its encounter zone (circling at depth
// for water creatures, wandering on the ground for land creatures), honours LOD, reports bounds, and draws a simple
// marker through RenderHooks when available. Real modules replace it per zone.

import type { BoundingVolume, CreatureContext, CreatureModule, Vec3 } from './types.ts';

export class PlaceholderCreature implements CreatureModule {
  private ctx!: CreatureContext;
  private pos: Vec3 = { x: 0, y: 0, z: 0 };
  private home: Vec3 = { x: 0, y: 0, z: 0 };
  private lod = 3; private phase = 0; private size: number;
  updates = 0; lodChanges = 0; disposed = false;
  constructor(size = 6) { this.size = size; }

  async initialize(context: CreatureContext): Promise<void> {
    this.ctx = context;
    this.home = { ...context.zone.center };
    this.phase = (context.id.length * 0.37) % 1;
  }
  setPosition(p: Vec3): void { this.pos = { ...p }; this.home = { ...p }; }
  setLOD(level: number): void { if (level !== this.lod) this.lodChanges++; this.lod = level; }
  update(dt: number, t: number): void {
    this.updates++;
    const z = this.ctx.zone, a = this.phase * Math.PI * 2 + t * (z.medium === 'water' ? 0.02 : 0.035);
    const W = this.ctx.world;
    if (z.medium === 'water') {
      // patrol on a circle, pulled in towards the zone centre wherever the water is too shallow for the body
      const need = this.size * 2 + 2;
      let x = this.home.x, zz = this.home.z;
      for (const k of [0.45, 0.3, 0.15, 0]) {
        x = this.home.x + Math.cos(a) * z.radius * k; zz = this.home.z + Math.sin(a) * z.radius * k;
        if (W.waterDepthAt(x, zz) >= need) break;
      }
      const floor = W.heightAt(x, zz), top = W.waterLevel - this.size * 0.5 - 1;
      this.pos = { x, y: Math.min(top, Math.max(floor + this.size * 0.5 + 1, Math.min(W.waterLevel - (z.minDepth ?? 5), this.home.y))), z: zz };
    } else {
      const r = z.radius * 0.45, x = this.home.x + Math.cos(a) * r, zz = this.home.z + Math.sin(a) * r;
      this.pos = { x, y: W.heightAt(x, zz) + this.size * 0.5, z: zz };
    }
  }
  getBounds(): BoundingVolume {
    const s = this.size;
    return { min: { x: this.pos.x - s, y: this.pos.y - s * 0.5, z: this.pos.z - s }, max: { x: this.pos.x + s, y: this.pos.y + s * 0.5, z: this.pos.z + s } };
  }
  get position(): Vec3 { return this.pos; }
  get level(): number { return this.lod; }
  dispose(): void { this.disposed = true; }
}
