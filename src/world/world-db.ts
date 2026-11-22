// Typed access to data/world.json, the world coordinate database, plus structural validation.
// Convention everywhere: metres; X = east, Y = up (elevation above sea level), Z = north; origin = SW corner of the
// playable area. Note that this axis set is left-handed; see docs/WORLD_ARCHITECTURE.md §2 for what that means for
// rendering (the renderer adapts, the data never changes convention).

import raw from '../../data/world.json' with { type: 'json' };
import type { P2 } from './geometry.ts';

export type SiteKind = 'promontory' | 'on-castle' | 'pad' | 'knoll' | 'shore' | 'cliff-foot' | 'underwater' | 'river-step' | 'hollow' | 'railway';

export interface Landmark {
  id: string; name: string; x: number; z: number; elevation: number | null; kind: string; site: SiteKind; radius: number;
  blend?: number; flatten?: number; rise?: number; knollRadius?: number; depth?: number;
}
export interface River { id: string; name: string; points: P2[]; width: number; depth: number; bank: number; fallAt?: number; fallHeight?: number; glenWidth?: number; glenDepth?: number }
export interface Railway {
  id: string; name: string; points: P2[]; maxGradient: number; minCurveRadius: number; formationHalfWidth: number;
  station: { at: P2; elevation: number; platformLength: number }; viaduct: { at: P2; minClearance: number };
}
export interface PathDef { id: string; name: string; width: number; points: P2[] }
export interface ForestZone { id: string; name: string; fromDepth: number; toDepth: number }
export interface Habitat { id: string; x: number; z: number; radius: number; kind: string }
export interface EncounterZone { id: string; creature: string; x: number; z: number; radius: number; minDepth?: number; medium: 'water' | 'land' | 'air' }
export interface Viewpoint { id: string; name: string; x: number; z: number; agl: number; yaw: number; pitch: number }
export interface DepthBowl { id: string; x: number; z: number; radius: number; depth: number }
export interface SteepShore { id: string; x: number; z: number; radius: number; slope: number }

export interface WorldDB {
  schema: string; seed: number;
  playable: { minX: number; minZ: number; maxX: number; maxZ: number };
  scenicMargin: number;
  lake: { name: string; surface: number; shoreline: P2[]; depthBowls: DepthBowl[]; baseDepth: number; steepShores: SteepShore[]; islands: { id: string; x: number; z: number; radius: number; height: number }[] };
  landmarks: Landmark[];
  regions: { kernelRadius: number; anchors: [number, number, number, number][]; outsideRise: number; outsideRiseDistance: number; outsideRelief: number; valleys: { id: string; points: P2[]; elevations: number[]; halfWidth: number; blend: number; relief: number }[] };
  rivers: River[];
  railway: Railway;
  paths: PathDef[];
  forest: { name: string; outline: P2[]; zones: ForestZone[]; habitats: Habitat[] };
  encounterZones: EncounterZone[];
  viewpoints: Viewpoint[];
}

export const WORLD_DB = raw as unknown as WorldDB;

export function landmark(db: WorldDB, id: string): Landmark {
  const l = db.landmarks.find((m) => m.id === id);
  if (!l) throw new Error(`unknown landmark ${id}`);
  return l;
}

/** Structural checks; returns a list of problems (empty = valid). */
export function validateWorldDB(db: WorldDB): string[] {
  const errs: string[] = [];
  const p = db.playable;
  const inPlay = (x: number, z: number) => x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ;
  if (db.schema !== 'hogwarts-world/1') errs.push(`schema ${db.schema}`);
  const ids = new Set<string>();
  for (const l of db.landmarks) {
    if (ids.has(l.id)) errs.push(`duplicate landmark ${l.id}`);
    ids.add(l.id);
    if (!inPlay(l.x, l.z)) errs.push(`landmark ${l.id} outside the playable area`);
    if (!(l.radius > 0)) errs.push(`landmark ${l.id} radius`);
  }
  if (db.lake.shoreline.length < 8) errs.push('lake shoreline too short');
  for (const z of db.encounterZones) if (!inPlay(z.x, z.z)) errs.push(`encounter zone ${z.id} outside`);
  for (const r of db.rivers) if (r.points.length < 2) errs.push(`river ${r.id}`);
  if (db.railway.points.length < 3) errs.push('railway');
  return errs;
}
