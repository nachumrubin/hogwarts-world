// Hosts external creature modules: registration against encounter zones, initialisation, per-frame update with LOD,
// zone activation (modules far from the viewer go dormant), bounds queries, and disposal.

import type { CreatureContext, CreatureModule, EncounterZoneInfo, RenderHooks, Vec3, WorldQueries, BoundingVolume } from './types.ts';
import { LOD_DISTANCES } from './types.ts';

interface Entry { id: string; module: CreatureModule; zone: EncounterZoneInfo; lod: number; ready: boolean; failed: string | null }

export class CreatureHost {
  private entries: Entry[] = [];
  private world: WorldQueries; private render: RenderHooks | null;
  worldTime = 0;
  constructor(world: WorldQueries, render: RenderHooks | null) { this.world = world; this.render = render; }

  /** Register a module for a zone and initialise it. Errors are contained: a failing module never stops the world. */
  async add(id: string, module: CreatureModule, zone: EncounterZoneInfo): Promise<void> {
    const e: Entry = { id, module, zone, lod: 3, ready: false, failed: null };
    this.entries.push(e);
    const ctx: CreatureContext = { id, zone, world: this.world, render: this.render, log: (m) => console.log(`[creature ${id}] ${m}`) };
    try {
      await module.initialize(ctx);
      module.setPosition(zone.center);
      module.setLOD(3);
      e.ready = true;
    } catch (err) {
      e.failed = String(err instanceof Error ? err.message : err);
      console.error(`[creature ${id}] failed to initialise: ${e.failed}`);
    }
  }

  static lodFor(distance: number): number {
    for (let i = 0; i < LOD_DISTANCES.length; i++) if (distance <= LOD_DISTANCES[i]) return i;
    return 3;
  }

  update(dt: number): void {
    const step = Math.min(Math.max(dt, 0), 0.1);
    this.worldTime += step;
    const v = this.world.viewerPosition();
    for (const e of this.entries) {
      if (!e.ready) continue;
      const b = e.module.getBounds();
      const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2, cz = (b.min.z + b.max.z) / 2;
      const lod = CreatureHost.lodFor(Math.hypot(v.x - cx, v.y - cy, v.z - cz));
      if (lod !== e.lod) { e.lod = lod; e.module.setLOD(lod); }
      if (lod < 3) {
        try { e.module.update(step, this.worldTime); } catch (err) { e.ready = false; e.failed = String(err); console.error(`[creature ${e.id}] update failed`, err); }
      }
    }
  }

  /** Bounds of every active module (for collision and debug drawing). */
  bounds(): { id: string; bounds: BoundingVolume; lod: number }[] {
    return this.entries.filter((e) => e.ready).map((e) => ({ id: e.id, bounds: e.module.getBounds(), lod: e.lod }));
  }

  status(): { id: string; ready: boolean; lod: number; failed: string | null }[] { return this.entries.map((e) => ({ id: e.id, ready: e.ready, lod: e.lod, failed: e.failed })); }

  dispose(): void { for (const e of this.entries) { try { e.module.dispose(); } catch { /* ignore */ } } this.entries = []; }
}

export function zoneInfo(z: { id: string; creature: string; x: number; z: number; radius: number; medium: 'water' | 'land' | 'air'; minDepth?: number }, world: WorldQueries): EncounterZoneInfo {
  const ground = world.heightAt(z.x, z.z);
  const y = z.medium === 'water' ? Math.min(world.waterLevel - (z.minDepth ?? 5), (ground + world.waterLevel) / 2) : ground;
  return { id: z.id, creature: z.creature, center: { x: z.x, y, z: z.z } as Vec3, radius: z.radius, medium: z.medium, minDepth: z.minDepth };
}
