// Lighting presets of the forest POC. Directions point towards the sun (x east, y up, z north).

const dir = (azDeg: number, elDeg: number): [number, number, number] => {
  const a = azDeg * Math.PI / 180, e = elDeg * Math.PI / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
};

export interface LightPreset {
  id: string; name: string;
  sun: [number, number, number];
  /** sun illuminance in scene units (the world default is 9.0) */
  illuminance: number;
  /** 0 clear .. 1 fully overcast: sky goes grey, sun diffuses, shadows soften */
  overcast: number;
  /** haze multiplier for the atmosphere */
  haze: number;
  /** forest mist density (1/m at the floor) and its scale height (m) */
  mist: number; mistHeight: number;
  /** light-shaft strength */
  shafts: number;
  exposure: number;
  wind: number;
}

export const FOREST_SUN_DAY = dir(222, 36);

export const LIGHT_PRESETS: Record<string, LightPreset> = {
  day: { id: 'day', name: 'Summer afternoon', sun: FOREST_SUN_DAY, illuminance: 9.0, overcast: 0, haze: 2.2, mist: 0.0016, mistHeight: 8, shafts: 1.0, exposure: 1.0, wind: 0.55 },
  overcast: { id: 'overcast', name: 'Overcast, damp', sun: dir(200, 52), illuminance: 9.0, overcast: 0.9, haze: 4.0, mist: 0.0035, mistHeight: 7, shafts: 0.0, exposure: 1.75, wind: 0.8 },
};
