import { CONFIG, type DisciplineId } from '../config';

/** Which independent race map and its visual treatment the scene draws. */
export type MapStyleId = 'classic' | 'canyon';

/** Every palette entry kept as a hex string, so one build can recolor the whole set. */
export type CourseColors = { [K in keyof typeof CONFIG.colors]: string };

/** Raw GLSL colours for the lake shader: linear-ish vec3 triples. */
export type WaterTone = {
  deep: [number, number, number];
  mid: [number, number, number];
  light: [number, number, number];
  shore: [number, number, number];
  foam: [number, number, number];
  glitter: [number, number, number];
};

export type MapStyle = {
  id: MapStyleId;
  name: string;
  en: string;
  note: string;
  /** Venue copy printed on the arches, barriers and the HUD footer. */
  venue: string;
  eventName: string;
  colors: CourseColors;
  tint: Record<DisciplineId, { color: string; amount: number }>;
  water: WaterTone;
};

const CLASSIC: MapStyle = {
  id: 'classic',
  name: '经典',
  en: 'CLASSIC',
  note: '低模湖线 · 轻量',
  venue: CONFIG.brand.venue,
  eventName: CONFIG.brand.eventName,
  colors: { ...CONFIG.colors },
  tint: {
    swim: { color: CONFIG.colors.waterShallow, amount: 0.05 },
    t1: { color: CONFIG.colors.sand, amount: 0.05 },
    bike: { color: CONFIG.colors.hill, amount: 0.09 },
    t2: { color: CONFIG.colors.rock, amount: 0.05 },
    run: { color: CONFIG.colors.canopy, amount: 0.08 },
  },
  water: {
    deep: [0.035, 0.235, 0.345],
    mid: [0.09, 0.45, 0.54],
    light: [0.32, 0.7, 0.73],
    shore: [0.42, 0.76, 0.76],
    foam: [0.93, 0.99, 1.0],
    glitter: [0.42, 0.6, 0.62],
  },
};

/**
 * Canyon build: the reference frame's red sandstone gorge — emerald river, west rim
 * road, east climbing trail and a white finish arch on the high east shelf. The line
 * folds back on itself here, so the terrain is an absolute height field, not a ribbon.
 */
const CANYON: MapStyle = {
  id: 'canyon',
  name: '峡谷',
  en: 'CANYON',
  note: '赤岩峡谷 · 折返爬升',
  venue: '赤岩峡谷 · 翡翠河道',
  eventName: '峡谷 · 折返铁三',
  colors: {
    ...CONFIG.colors,
    skyTop: '#27679f', skyMid: '#9dbfca', skyBottom: '#efd9ba', fog: '#d9bb98',
    sunGlow: '#ffe6bc', cloud: '#fdf4e6', cloudShade: '#bd9e86',
    water: '#12574e', waterShallow: '#3f9c86', waterDeep: '#08302c', waterFoam: '#eafaf3',
    lakeBed: '#4a3a2c', sand: '#c08a5a', wetSand: '#8f6647',
    grass: '#6f6b39', grassLight: '#8d8a4c', hill: '#7a3320', rock: '#9a3f22',
    bark: '#4a3627', pine: '#3f4a28', pineLight: '#5c6835',
    canopy: '#56632f', canopyLight: '#7b8642',
    asphalt: '#43403a', asphaltLine: '#f7ecd6', curb: '#d9c6a8',
    track: '#8a4128', trackLine: '#f7ecd6', boardwalk: '#96693f',
    t1Paving: '#d2b389', t2Gravel: '#9c9080',
    bikeShoulder: '#e2571f', runVerge: '#7d7231',
    gate: '#ff6a2b', gateAlt: '#12857b', gatePassed: '#7fc9ab', gateMissed: '#9b8f86',
    pole: '#fbf3e4', accent: '#ff6a2b',
    pickup: '#ffd166', pickupCore: '#d97a12',
    ink: '#301b12', inkSoft: '#6a4a35', paper: '#fdf4e6',
  },
  tint: {
    swim: { color: '#2f7f70', amount: 0.07 },
    t1: { color: '#c9a87c', amount: 0.09 },
    bike: { color: '#8c4128', amount: 0.12 },
    t2: { color: '#b19a7d', amount: 0.08 },
    run: { color: '#8a7f42', amount: 0.1 },
  },
  water: {
    deep: [0.02, 0.14, 0.12],
    mid: [0.06, 0.34, 0.28],
    light: [0.22, 0.56, 0.46],
    shore: [0.3, 0.62, 0.5],
    foam: [0.88, 0.98, 0.93],
    glitter: [0.4, 0.56, 0.47],
  },
};

export const MAP_STYLES: Record<MapStyleId, MapStyle> = { classic: CLASSIC, canyon: CANYON };

const MAP_STORE = 'lakeline:map';
const MAP_ORDER: MapStyleId[] = ['classic', 'canyon'];

/** Persisted map choice; storage is optional and defaults to the classic build. */
export function loadMapStyle(): MapStyleId {
  try {
    const saved = localStorage.getItem(MAP_STORE);
    return MAP_ORDER.find(id => id === saved) ?? 'classic';
  } catch {
    return 'classic';
  }
}

/** The map the button cycles to next. */
export function nextMapStyle(id: MapStyleId): MapStyleId {
  return MAP_ORDER[(MAP_ORDER.indexOf(id) + 1) % MAP_ORDER.length];
}

export function storeMapStyle(id: MapStyleId) {
  try {
    localStorage.setItem(MAP_STORE, id);
  } catch { /* storage is optional */ }
}
