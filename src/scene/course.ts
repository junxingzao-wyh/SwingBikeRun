import * as THREE from 'three';
import {
  BIKE_END, CANYON, CONFIG, COURSE_LENGTH, FINISH_S, GATES, MARKS, OBSTACLES, PICKUPS, SWIM_END, T1_END,
  T2_END, WATER_LEVEL, canyonHeight, canyonRoadHeight, canyonTrailHeight,
  courseYaw, disciplineAt, groundHeight, halfWidthAt, isFoldedTrack,
  lakeDir, setTrack, surfaceHeight, xAt, zAt, type DisciplineId, type Gate,
} from '../config';
import type { RunState } from '../game/rules';
import { seeded, smoothstep } from './util';
import {
  PROP_HEIGHTS, createPropGeometry, createSceneryMaterial, setSceneryPalette,
  type PropKind, type SceneryDetail,
} from './scenery-models';
import {
  asphaltTexture, bannerTexture, checkerTexture, chevronTexture, cloudShadowTexture, gatePlateTexture,
  hazardTexture, ropeTexture, setTexturePalette, trackTexture,
} from './textures';
import { MAP_STYLES, type MapStyle, type MapStyleId, type WaterTone } from './mapstyle';

/**
 * The active palette. One course exists at a time, so a build can swap these in
 * place; `CONFIG.colors` stays untouched for the athlete and the UI.
 */
let c: MapStyle['colors'] = CONFIG.colors;
let WATER_TONE: WaterTone = MAP_STYLES.classic.water;
/** Venue copy for the printed boards; each map names its own water. */
let VENUE: string = CONFIG.brand.venue;
let EVENT_NAME: string = CONFIG.brand.eventName;
const SUN = new THREE.Vector3(...CONFIG.lighting.sunDirection).normalize();
let COURSE_END = COURSE_LENGTH + 60;
const LAKE_REACH = 620;
/** Sponsor boards belong to the finish arena, not to every metre of the promenade. */
let ARENA_FROM = FINISH_S - 110;

/** A whisper of per-discipline colour on the terrain, so the shoulders join the surface. */
let SEGMENT_TINT: Record<DisciplineId, { color: THREE.Color; amount: number }> = tintOf(MAP_STYLES.classic);

function tintOf(style: MapStyle) {
  const tint = {} as Record<DisciplineId, { color: THREE.Color; amount: number }>;
  for (const id of ['swim', 't1', 'bike', 't2', 'run'] as const) {
    tint[id] = { color: new THREE.Color(style.tint[id].color), amount: style.tint[id].amount };
  }
  return tint;
}

function material(color: string, options: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...options });
}

function mesh(geometry: THREE.BufferGeometry, mat: THREE.Material, cast = true, receive = true) {
  const object = new THREE.Mesh(geometry, mat);
  object.castShadow = cast;
  object.receiveShadow = receive;
  return object;
}

/** Text boards need a real front and back, otherwise the reverse side reads mirrored. */
function bannerPlane(width: number, height: number, texture: THREE.Texture) {
  const group = new THREE.Group();
  const front = mesh(new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture }), false, false);
  const back = mesh(new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture }), false, false);
  back.rotation.y = Math.PI;
  back.position.z = -0.03;
  group.add(front, back);
  return group;
}

/** Triangle grid through an ordered list of cross-course rows. */
function strip(rows: THREE.Vector3[][], vInMetres = false) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const cols = rows[0].length;
  let travelled = 0;
  rows.forEach((row, r) => {
    if (r > 0) travelled += row[0].distanceTo(rows[r - 1][0]);
    row.forEach((point, i) => {
      positions.push(point.x, point.y, point.z);
      uvs.push(i / (cols - 1), vInMetres ? travelled : r / Math.max(1, rows.length - 1));
    });
  });
  for (let r = 0; r < rows.length - 1; r++) for (let i = 0; i < cols - 1; i++) {
    const a = r * cols + i;
    indices.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function groundPoint(s: number, u: number, lift = 0) {
  return new THREE.Vector3(xAt(s, u), surfaceHeight(s, u) + lift, zAt(s, u));
}

/** Yaw that turns a local course-frame prop into world space at s. */
const yawAt = (s: number) => courseYaw(s);

// ------------------------------------------------------------------ terrain

function terrainColumns() {
  const set = new Set<number>();
  for (let u = 0; u <= 24.01; u += 1.5) set.add(Number(u.toFixed(3)));
  for (let u = 26; u <= 60.01; u += 4) set.add(Number(u.toFixed(3)));
  for (let u = 66; u <= 150.01; u += 12) set.add(Number(u.toFixed(3)));
  for (let u = 170; u <= 340.01; u += 32) set.add(Number(u.toFixed(3)));
  for (let u = 400; u <= LAKE_REACH + 60; u += 70) set.add(Number(u.toFixed(3)));
  const positive = [...set].sort((a, b) => a - b);
  return [...positive.map(u => -u).reverse(), ...positive.slice(1)];
}

function terrainRows() {
  const set = new Set<number>();
  for (let s = -130; s < -20; s += 12) set.add(s);
  for (let s = -20; s <= COURSE_END; s += 4) set.add(Number(s.toFixed(2)));
  for (let s = COURSE_END + 22; s <= COURSE_END + 260; s += 26) set.add(s);
  return [...set].sort((a, b) => a - b);
}

let SAND = new THREE.Color(c.sand);
let WET_SAND = new THREE.Color(c.wetSand);
let GRASS = new THREE.Color(c.grass);
let GRASS_LIGHT = new THREE.Color(c.grassLight);
let HILL = new THREE.Color(c.hill);
let ROCK = new THREE.Color(c.rock);
/** Canyon faces get strata: a darker and a lighter cut of the same rock. */
let ROCK_DARK = new THREE.Color(c.rock).multiplyScalar(0.62);
let ROCK_LIGHT = new THREE.Color(c.rock).multiplyScalar(1.18);
let DEEP = new THREE.Color(c.waterDeep);
let SHALLOW = new THREE.Color(c.waterShallow);
let BED = new THREE.Color(c.lakeBed);
const RUBBER = new THREE.Color('#6a6f73');
let HAZE = new THREE.Color(c.fog);

/** Swap the palette used by every builder below, including the canvas textures. */
function applyStyle(style: MapStyle) {
  c = style.colors;
  WATER_TONE = style.water;
  VENUE = style.venue;
  EVENT_NAME = style.eventName;
  setTexturePalette(style.colors);
  setSceneryPalette(style.colors);
  SEGMENT_TINT = tintOf(style);
  SAND = new THREE.Color(c.sand);
  WET_SAND = new THREE.Color(c.wetSand);
  GRASS = new THREE.Color(c.grass);
  GRASS_LIGHT = new THREE.Color(c.grassLight);
  HILL = new THREE.Color(c.hill);
  ROCK = new THREE.Color(c.rock);
  ROCK_DARK = new THREE.Color(c.rock).multiplyScalar(0.62);
  ROCK_LIGHT = new THREE.Color(c.rock).multiplyScalar(1.18);
  DEEP = new THREE.Color(c.waterDeep);
  SHALLOW = new THREE.Color(c.waterShallow);
  BED = new THREE.Color(c.lakeBed);
  HAZE = new THREE.Color(c.fog);
}

// ------------------------------------------------------------- canyon terrain

const CANYON_SCRUB = new THREE.Color();
const CANYON_TONE = new THREE.Color();

function canyonColor(target: THREE.Color, x: number, z: number, h: number,
  nx: number, ny: number, nz: number) {
  if (h < WATER_LEVEL - 0.05) {
    target.copy(BED).lerp(SHALLOW, 0.22);
    return;
  }
  const flat = Math.hypot(nx, nz) / Math.max(0.2, ny);
  const onRoadBench = x > -74 && x < -28 && Math.abs(h - canyonRoadHeight(z)) < 1.6;
  const onTrailBench = x > 28 && x < 68 && Math.abs(h - canyonTrailHeight(z)) < 1.6;
  if (onRoadBench || onTrailBench) {
    target.copy(SAND).lerp(WET_SAND, 0.2 + 0.12 * Math.sin(z * 0.11 + x * 0.07));
    target.multiplyScalar(0.94 + 0.08 * Math.sin(x * 0.6 + z * 0.5));
    return;
  }
  // Layered sandstone: the bands follow the same 3.4 m strata phase that carves the
  // geometry, so a lit ledge and its colour band always line up.
  const strata = Math.sin((h / 3.4) * Math.PI * 2 + Math.sin(z * 0.013) * 0.4 + Math.sin(x * 0.021) * 0.3);
  target.copy(ROCK).lerp(strata > 0 ? ROCK_LIGHT : ROCK_DARK, Math.abs(strata) * 0.3);
  // Erosion gullies read as damp, shadowed vertical channels.
  const gully = Math.abs(Math.sin(z * 0.28 + Math.sin(x * 0.021) * 2.4)) ** 3;
  target.multiplyScalar(1 - gully * 0.26);
  // Grain at a few metres' scale, so a 40 m face is not one flat gradient.
  const grain = Math.sin(x * 1.7 + z * 2.3) * Math.sin(x * 0.83 - z * 1.27);
  target.multiplyScalar(0.91 + 0.17 * grain);
  // Ledges and rims collect pale dust.
  target.lerp(SAND, smoothstep(1.1, 0.25, flat) * 0.38);
  // Sparse dry scrub on the high plateau and just above the water line.
  CANYON_SCRUB.copy(GRASS).lerp(GRASS_LIGHT, 0.35);
  const scrub = smoothstep(74, 96, h) * 0.55 + (h > 1 && h < 7 ? 0.3 : 0);
  if (scrub > 0.01) target.lerp(CANYON_SCRUB, Math.min(0.55, scrub));
  // Hard desert light: faces turned away from the sun go deep and warm.
  const light = nx * SUN.x + ny * SUN.y + nz * SUN.z;
  target.multiplyScalar(0.58 + 0.36 * smoothstep(-0.35, 0.6, light));
  target.lerp(HAZE, smoothstep(70, 190, Math.abs(z + 140)) * 0.1);
}

/** Absolute grid: the folded route doubles back, so the terrain cannot be a ribbon. */
function addCanyonTerrain(scene: THREE.Object3D, mobile: boolean) {
  // 1.6 m cells resolve the strata ledges and gullies carved in canyonHeight();
  // coarser on phones so the vertex count stays in budget.
  const X0 = -204, X1 = 204, Z0 = -500, Z1 = 176, STEP = mobile ? 2.4 : 1.6;
  const cols = Math.round((X1 - X0) / STEP);
  const rows = Math.round((Z1 - Z0) / STEP);
  const positions = new Float32Array((cols + 1) * (rows + 1) * 3);
  const indices: number[] = [];
  let k = 0;
  for (let j = 0; j <= rows; j++) {
    const z = Z0 + j * STEP;
    for (let i = 0; i <= cols; i++) {
      const x = X0 + i * STEP;
      positions[k++] = x;
      positions[k++] = canyonHeight(x, z);
      positions[k++] = z;
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i;
    indices.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normals = geometry.attributes.normal.array as Float32Array;
  const colors = new Float32Array((cols + 1) * (rows + 1) * 3);
  for (let v = 0, p = 0; v < positions.length; v += 3, p += 3) {
    canyonColor(CANYON_TONE, positions[v], positions[v + 2], positions[v + 1],
      normals[v], normals[v + 1], normals[v + 2]);
    colors[p] = CANYON_TONE.r;
    colors[p + 1] = CANYON_TONE.g;
    colors[p + 2] = CANYON_TONE.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const surface = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.97, metalness: 0,
  }));
  surface.name = 'canyon-terrain';
  surface.receiveShadow = true;
  scene.add(surface);
  return { geometry, columns: cols + 1, rows: rows + 1 };
}

function addTerrain(scene: THREE.Object3D, mobile = false) {
  if (isFoldedTrack()) return addCanyonTerrain(scene, mobile);
  const U = terrainColumns();
  const S = terrainRows();
  const positions = new Float32Array(U.length * S.length * 3);
  const colors = new Float32Array(U.length * S.length * 3);
  const indices: number[] = [];
  for (let j = 0; j < S.length; j++) {
    for (let i = 0; i < U.length; i++) {
      const k = (j * U.length + i) * 3;
      const u = U[i];
      const x = xAt(S[j], u);
      positions[k] = x;
      positions[k + 1] = groundHeight(S[j], u);
      positions[k + 2] = zAt(S[j], u);
    }
  }
  for (let j = 0; j < S.length - 1; j++) for (let i = 0; i < U.length - 1; i++) {
    const a = j * U.length + i;
    indices.push(a, a + 1, a + U.length, a + 1, a + U.length + 1, a + U.length);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal') as THREE.BufferAttribute;

  const tone = new THREE.Color();
  for (let j = 0; j < S.length; j++) {
    const s = S[j];
    const hw = halfWidthAt(s);
    for (let i = 0; i < U.length; i++) {
      const k = j * U.length + i;
      const u = U[i];
      const height = positions[k * 3 + 1];
      const au = Math.abs(u);
      if (height < WATER_LEVEL) {
        tone.copy(BED).lerp(SHALLOW, 0.4).lerp(DEEP, smoothstep(WATER_LEVEL, WATER_LEVEL - 3.6, height));
      } else {
        const above = height - WATER_LEVEL;
        tone.copy(WET_SAND).lerp(SAND, smoothstep(0.02, 0.6, above));
        tone.lerp(GRASS, smoothstep(0.45, 2.1, above));
        tone.lerp(GRASS_LIGHT, smoothstep(1, 3.6, above) * 0.28);
        tone.lerp(HILL, smoothstep(6, 26, height) * 0.5);
        tone.lerp(ROCK, smoothstep(17, 42, height) * 0.45);
        const nx = normals.getX(k);
        const ny = normals.getY(k);
        const nz = normals.getZ(k);
        const slope = Math.hypot(nx, nz) / Math.max(0.05, ny);
        const facing = nx * SUN.x + ny * SUN.y + nz * SUN.z;
        tone.lerp(ROCK, smoothstep(0.95, 2.2, slope) * 0.55);
        tone.lerp(GRASS_LIGHT, smoothstep(0.2, 0.95, facing) * 0.1);
        tone.multiplyScalar(0.84 + 0.16 * smoothstep(-0.5, 0.5, facing));
        tone.lerp(HAZE, smoothstep(180, 560, au) * 0.38);
        if (au < hw + 5) tone.lerp(RUBBER, (1 - smoothstep(hw - 1, hw + 5, au)) * 0.22);
        tone.multiplyScalar(1 + Math.sin(s * 0.031 + u * 0.021) * Math.cos(s * 0.017 - u * 0.031) * 0.03);
        const cast = SEGMENT_TINT[disciplineAt(s)];
        tone.lerp(cast.color, cast.amount);
      }
      tone.toArray(colors, k * 3);
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const ground = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0,
  }));
  ground.name = 'lake-terrain';
  ground.receiveShadow = true;
  scene.add(ground);
  return { geometry, columns: U.length, rows: S.length };
}

// ------------------------------------------------------------------ water

type Run = { from: number; to: number };

function waterRuns(s: number) {
  const sample = (u: number) => groundHeight(s, u);
  const bisect = (lo: number, hi: number) => {
    let a = lo;
    let b = hi;
    for (let i = 0; i < 10; i++) {
      const mid = (a + b) / 2;
      if (sample(mid) < WATER_LEVEL) a = mid; else b = mid;
    }
    return (a + b) / 2;
  };
  const scan = (sign: number) => {
    const found: Run[] = [];
    let below = sample(0) < WATER_LEVEL;
    let start = below ? 0 : null;
    let previous = 0;
    for (let u = 9; u <= LAKE_REACH; u += 9) {
      const probe = sign * u;
      const state = sample(probe) < WATER_LEVEL;
      if (state !== below) {
        const crossing = bisect(sign * previous, probe);
        if (state) start = crossing;
        else if (start !== null) found.push({ from: Math.min(start, crossing), to: Math.max(start, crossing) });
        below = state;
        start = state ? crossing : null;
      }
      previous = u;
    }
    if (below && start !== null) {
      found.push({ from: Math.min(start, sign * LAKE_REACH), to: Math.max(start, sign * LAKE_REACH) });
    }
    return found;
  };
  return [...scan(-1), ...scan(1)].sort((a, b) => a.from - b.from);
}

function addWater(scene: THREE.Object3D) {
  if (isFoldedTrack()) return addCanyonWater(scene);
  const positions: number[] = [];
  const uvs: number[] = [];
  const edgeData: number[] = [];
  const indices: number[] = [];
  const columns = 22;
  let runs = 0;
  for (let s = -120; s < COURSE_END + 240; s += 6) {
    for (const run of waterRuns(s)) {
      const span = run.to - run.from;
      if (span < 7) continue;
      runs++;
      const rowStart = positions.length / 3;
      for (let i = 0; i <= columns; i++) {
        const t = i / columns;
        positions.push(xAt(s, run.from + span * t), WATER_LEVEL - 0.04, zAt(s, run.from + span * t));
        uvs.push(t, s / 24);
        edgeData.push(smoothstep(0.3, 0.68, Math.min(t, 1 - t) * 2));
      }
      for (let i = 0; i < columns; i++) {
        const a = rowStart + i;
        indices.push(a, a + 1, a + columns + 1, a + 1, a + columns + 2, a + columns + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('aEdge', new THREE.Float32BufferAttribute(edgeData, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const { uniforms } = addWaterMesh(geometry, scene);
  return { uniforms, vertices: positions.length / 3, runs };
}

/** Emerald river for the folded canyon: a straight reach between the two walls. */
function addCanyonWater(scene: THREE.Object3D) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const edgeData: number[] = [];
  const indices: number[] = [];
  const columns = 20;
  const rows = 44;
  const half = CANYON.riverHalf - 1.5;
  const xs: number[] = [];
  const zNorth: number[] = [];
  const zSouth: number[] = [];
  // The surface has to die into the beach at both ends, so each column starts and
  // stops where its own terrain crosses the waterline, two metres past it. A single
  // constant z would slice a straight edge across the shoreline.
  for (let i = 0; i <= columns; i++) {
    const x = -half + 2 * half * (i / columns);
    xs.push(x);
    let north = -240;
    while (north > -420 && canyonHeight(x, north - 0.5) < WATER_LEVEL) north -= 0.5;
    let south = 0;
    while (south < 60 && canyonHeight(x, south + 0.5) < WATER_LEVEL) south += 0.5;
    zNorth.push(north - 2);
    zSouth.push(south + 2);
  }
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    for (let i = 0; i <= columns; i++) {
      const k = i / columns;
      const x = xs[i];
      const z = zNorth[i] + (zSouth[i] - zNorth[i]) * t;
      positions.push(x, WATER_LEVEL - 0.04, z);
      uvs.push(k, z / 24);
      edgeData.push(smoothstep(0.24, 0.62, Math.min(k, 1 - k) * 2));
    }
  }
  for (let r = 0; r < rows; r++) for (let i = 0; i < columns; i++) {
    const a = r * (columns + 1) + i;
    indices.push(a, a + 1, a + columns + 1, a + 1, a + columns + 2, a + columns + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('aEdge', new THREE.Float32BufferAttribute(edgeData, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const { uniforms } = addWaterMesh(geometry, scene);
  return { uniforms, vertices: positions.length / 3, runs: 1 };
}

function addWaterMesh(geometry: THREE.BufferGeometry, scene: THREE.Object3D) {
  const tone = WATER_TONE;
  const uniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Vector3(...tone.deep) },
    uMid: { value: new THREE.Vector3(...tone.mid) },
    uLight: { value: new THREE.Vector3(...tone.light) },
    uShore: { value: new THREE.Vector3(...tone.shore) },
    uFoam: { value: new THREE.Vector3(...tone.foam) },
    uGlitter: { value: new THREE.Vector3(...tone.glitter) },
  };
  const shader = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: `
      attribute float aEdge;
      varying float vEdge;
      varying vec3 vWorld;
      void main() {
        vEdge = aEdge;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uMid;
      uniform vec3 uLight;
      uniform vec3 uShore;
      uniform vec3 uFoam;
      uniform vec3 uGlitter;
      varying float vEdge;
      varying vec3 vWorld;
      void main() {
        vec2 p = vWorld.xz * 0.085;
        float t = uTime;
        // Four crossing trains on different headings: the crests travel diagonally
        // instead of reading as flat horizontal scan lines.
        float w1 = sin(dot(p, vec2(3.1, 1.4)) + t * 0.9);
        float w2 = sin(dot(p, vec2(-1.7, 2.6)) - t * 0.72);
        float w3 = sin(dot(p, vec2(5.3, -4.1)) + t * 1.55);
        float w4 = sin(dot(p, vec2(-7.1, -2.3)) - t * 2.1);
        float ripple = w1 * 0.42 + w2 * 0.3 + w3 * 0.18 + w4 * 0.1;
        float crest = smoothstep(0.35, 0.9, ripple);
        float shore = 1.0 - smoothstep(0.0, 0.45, vEdge);
        vec3 color = mix(uDeep, uMid, 0.36 + 0.34 * ripple);
        color = mix(color, uLight, crest * 0.42);
        color = mix(color, uShore, shore * 0.7);
        float glitter = smoothstep(0.86, 1.0, ripple) * (0.35 + 0.35 * sin(t * 2.2 + vWorld.x * 0.7));
        color += uGlitter * glitter;
        color = mix(color, uFoam, shore * shore * 0.55);
        gl_FragColor = vec4(color, mix(0.8, 0.97, shore));
      }
    `,
  });
  const water = new THREE.Mesh(geometry, shader);
  water.name = 'lake-water';
  water.renderOrder = 2;
  water.frustumCulled = false;
  scene.add(water);
  return { uniforms };
}

/**
 * Cloud shadows ride just above the lake surface. The sheet is flat at `WATER_LEVEL`,
 * so the terrain depth-tests it away on land and it only ever darkens open water.
 */
function addCloudShadows(scene: THREE.Object3D) {
  const texture = cloudShadowTexture();
  texture.repeat.set(4, 4);
  const sheet = new THREE.Mesh(
    new THREE.PlaneGeometry(1700, 1900),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  sheet.name = 'cloud-shadows';
  sheet.rotation.x = -Math.PI / 2;
  sheet.position.set(0, WATER_LEVEL + 0.07, isFoldedTrack() ? -150 : -(COURSE_END + 240) / 2);
  sheet.renderOrder = 3;
  scene.add(sheet);
  return texture;
}

// ------------------------------------------------------------------ riding surfaces

function ribbon(scene: THREE.Object3D, from: number, to: number, halfWidth: number, step: number,
  mat: THREE.Material, lift = 0.035, name?: string) {
  const rows: THREE.Vector3[][] = [];
  const steps = Math.max(2, Math.round((to - from) / step));
  for (let i = 0; i <= steps; i++) {
    const s = from + ((to - from) * i) / steps;
    const row: THREE.Vector3[] = [];
    for (let k = 0; k <= 8; k++) row.push(groundPoint(s, -halfWidth + (2 * halfWidth * k) / 8, lift));
    rows.push(row);
  }
  const surface = mesh(strip(rows, true), mat, false, true);
  if (name) surface.name = name;
  scene.add(surface);
  return surface;
}

function edgeLine(scene: THREE.Object3D, from: number, to: number, u: number, step: number,
  mat: THREE.Material, rise = 0.16, base = 0.02) {
  const rows: THREE.Vector3[][] = [];
  for (let s = from; s <= to + 0.001; s += step) {
    rows.push([groundPoint(s, u, base), groundPoint(s, u + Math.sign(u) * 0.4, base + rise)]);
  }
  scene.add(mesh(strip(rows), mat, false, true));
}

/** Trade paint laid flat on the surface: a painted edge, not a raised curb. */
function paintLine(scene: THREE.Object3D, from: number, to: number, u: number, width: number,
  mat: THREE.Material, lift = 0.055) {
  const rows: THREE.Vector3[][] = [];
  for (let s = from; s <= to + 0.001; s += 2) {
    rows.push([groundPoint(s, u - width / 2, lift), groundPoint(s, u + width / 2, lift)]);
  }
  scene.add(mesh(strip(rows), mat, false, true));
}

/**
 * Lane ropes with floating markers down both sides of the swim channel. Works on
 * both maps: `xAt`/`zAt` resolve the folded canyon river just as they do the lake.
 */
function addLaneRopes(scene: THREE.Object3D) {
  const rope = ropeTexture();
  rope.repeat.set(1, 1 / 2.6);
  const ropeMat = new THREE.MeshBasicMaterial({ map: rope, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  const floatPositions: THREE.Vector3[] = [];
  for (const side of [-1, 1] as const) {
    const u = side * 8.4;
    const rows: THREE.Vector3[][] = [];
    for (let s = 2; s < SWIM_END - 4; s += 5) {
      rows.push([
        new THREE.Vector3(xAt(s, u - 0.24), WATER_LEVEL + 0.05, zAt(s, u - 0.24)),
        new THREE.Vector3(xAt(s, u + 0.24), WATER_LEVEL + 0.05, zAt(s, u + 0.24)),
      ]);
      if (Math.round(s) % 15 < 5) floatPositions.push(new THREE.Vector3(xAt(s, u), WATER_LEVEL + 0.1, zAt(s, u)));
    }
    if (rows.length) scene.add(mesh(strip(rows), ropeMat, false, false));
  }
  const dummy = new THREE.Object3D();
  const floats = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 8, 6),
    material(c.paper, { roughness: 0.7 }), floatPositions.length);
  floatPositions.forEach((point, index) => {
    dummy.position.copy(point);
    dummy.scale.set(1, 0.5, 1);
    dummy.updateMatrix();
    floats.setMatrixAt(index, dummy.matrix);
  });
  floats.name = 'lane-rope-floats';
  scene.add(floats);
}

/**
 * Course-side rail: two horizontal beams on upright posts, drawn in the course
 * frame so it hugs a folded ribbon as tightly as a straight one. Used for the
 * canyon bike road where the drop off the rim needs a visible barrier.
 */
function addRail(scene: THREE.Object3D, from: number, to: number, u: number, step = 4) {
  const beamMat = material(c.pole, { roughness: 0.62, side: THREE.DoubleSide });
  const postMat = material(c.ink, { roughness: 0.8 });
  // Each beam is a strip of rows; every row is the beam's top and bottom edge so
  // the rail reads as a solid horizontal face from the rider's eye height.
  const upper: THREE.Vector3[][] = [];
  const lower: THREE.Vector3[][] = [];
  const posts: THREE.Vector3[] = [];
  for (let s = from; s <= to + 0.001; s += step) {
    const foot = groundPoint(s, u, 0);
    upper.push([foot.clone().setY(foot.y + 0.88), foot.clone().setY(foot.y + 0.76)]);
    lower.push([foot.clone().setY(foot.y + 0.56), foot.clone().setY(foot.y + 0.44)]);
    posts.push(foot);
  }
  if (upper.length > 1) {
    scene.add(mesh(strip(upper), beamMat, false, false));
    scene.add(mesh(strip(lower), beamMat, false, false));
  }
  const dummy = new THREE.Object3D();
  const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 0.86, 0.09), postMat, posts.length);
  posts.forEach((point, index) => {
    dummy.position.set(point.x, point.y + 0.43, point.z);
    dummy.rotation.set(0, yawAt(from + index * step), 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    instanced.setMatrixAt(index, dummy.matrix);
  });
  instanced.name = `rail-posts-${u < 0 ? 'left' : 'right'}`;
  instanced.castShadow = true;
  instanced.computeBoundingSphere();
  scene.add(instanced);
}

/**
 * A run of pennant flags on short poles, one every `step` metres. This is the
 * canyon run's "flag guardrail": it marks the trail edge without a solid wall.
 */
function addFlagLine(scene: THREE.Object3D, from: number, to: number, u: number, step = 8) {
  const mat = createSceneryMaterial();
  const dummy = new THREE.Object3D();
  const points: number[] = [];
  for (let s = from; s <= to + 0.001; s += step) points.push(s);
  const flags = new THREE.InstancedMesh(createPropGeometry('flag', 0, 'near'), mat, points.length);
  points.forEach((s, index) => {
    const foot = groundPoint(s, u, 0);
    dummy.position.copy(foot);
    dummy.rotation.set(0, yawAt(s), 0);
    dummy.scale.setScalar(0.72);
    dummy.updateMatrix();
    flags.setMatrixAt(index, dummy.matrix);
  });
  flags.name = `flag-line-${u < 0 ? 'left' : 'right'}`;
  flags.castShadow = true;
  flags.computeBoundingSphere();
  scene.add(flags);
}

const HW = CONFIG.course.halfWidth;

function addSurfaces(scene: THREE.Object3D) {
  if (isFoldedTrack()) {
    // Canyon surface: dirt road on the west rim, packed-earth trail on the east
    // plateau, and two sand transition pads. The route folds through a river and
    // two wall benches, so every marker below is laid in the course frame (xAt/zAt)
    // and follows the ribbon exactly instead of sitting in world-space lines.
    // These ribbons are decals over an absolute terrain grid; their depth is biased
    // to keep the coarse triangles from flickering through a surface at distance.
    const decal = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 };
    const roadMat = material(c.track, { roughness: 0.96, ...decal });
    roadMat.name = 'canyon-road';
    const trailMat = material(c.track, { roughness: 0.94, ...decal });
    trailMat.name = 'canyon-trail';
    // Bike leg (330 → 950): dirt road on the west rim.
    ribbon(scene, T1_END, BIKE_END, HW.bike, 3, roadMat, 0.04, 'canyon-bike');
    // Run leg (980 → finish): packed-earth trail on the east plateau. Continue past
    // the arch to COURSE_END: the athlete keeps running after crossing the line
    // (simulation holds 'finishing' until COURSE_LENGTH), and the arena banners
    // already line the whole run-out, so the surface must reach them too.
    ribbon(scene, T2_END, COURSE_END, HW.run, 2.2, trailMat, 0.04, 'canyon-run');
    // T1 & T2 transition pads: packed earth and cool gravel, both clearly off the
    // sand tone, with painted edges so the walk between swim and bike reads as course.
    const padMat = material(c.t1Paving, { roughness: 0.98, ...decal });
    padMat.name = 'canyon-pad';
    ribbon(scene, SWIM_END - 3, T1_END, HW.t1, 2, padMat, 0.042, 'canyon-t1');
    const gravelMat = material(c.t2Gravel, { roughness: 0.98, ...decal });
    gravelMat.name = 'canyon-pad-t2';
    ribbon(scene, BIKE_END, T2_END, HW.t2, 2, gravelMat, 0.042, 'canyon-t2');
    const paint = material(c.trackLine, { roughness: 0.86, ...decal });
    for (const side of [-1, 1] as const) {
      paintLine(scene, SWIM_END - 2, T1_END - 0.6, side * (HW.t1 - 0.35), 0.34, paint);
      paintLine(scene, BIKE_END + 0.6, T2_END - 0.6, side * (HW.t2 - 0.35), 0.34, paint);
      // Road/trail edge lines give the earth ribbons a constructed, race-course edge.
      paintLine(scene, T1_END + 2, BIKE_END - 2, side * (HW.bike - 0.3), 0.26, paint, 0.055);
      paintLine(scene, T2_END + 2, FINISH_S - 8, side * (HW.run - 0.3), 0.24, paint, 0.055);
      paintLine(scene, FINISH_S + 4, COURSE_END - 2, side * (HW.run - 0.3), 0.24, paint, 0.055);
    }
    // Dashed centre line reads as a road rather than a strip of bare desert.
    for (let s = T1_END + 8; s < BIKE_END - 8; s += 20) {
      paintLine(scene, s, Math.min(s + 9, BIKE_END - 8), 0, 0.2, paint, 0.055);
    }
    // Guardrails hug both edges of the rim road; flags mark the run trail edges.
    for (const side of [-1, 1] as const) {
      addRail(scene, T1_END + 5, BIKE_END - 5, side * (HW.bike + 0.35));
      addFlagLine(scene, T2_END + 4, COURSE_END - 4, side * (HW.run + 0.7));
    }
    // Swim lane ropes turn the open river into a readable two-sided channel.
    addLaneRopes(scene);
    // Finish mat + checker line — same as classic.
    const mat = material(c.ink, { roughness: 0.94 });
    mat.name = 'finish-mat';
    ribbon(scene, FINISH_S - 6, FINISH_S + 2.4, HW.run, 2, mat, 0.05, 'finish-mat');
    const finishRows = [FINISH_S - 1.3, FINISH_S + 1.3].map(s => {
      const row: THREE.Vector3[] = [];
      for (let i = 0; i <= 10; i++) row.push(groundPoint(s, -HW.run + (2 * HW.run * i) / 10, 0.075));
      return row;
    });
    const checker = checkerTexture();
    checker.repeat.set(6, 1);
    const finishLine = mesh(strip(finishRows, true), new THREE.MeshBasicMaterial({ map: checker }), false, false);
    finishLine.name = 'finish-line';
    scene.add(finishLine);
    return;
  }
  // --- lake map (classic) follows below ---
  const asphalt = asphaltTexture();
  asphalt.repeat.set(1, 1 / 24);
  const roadMat = material('#ffffff', { map: asphalt, roughness: 0.82 });
  roadMat.name = 'asphalt';
  const road = ribbon(scene, T1_END, BIKE_END, HW.bike, 3, roadMat, 0.035, 'road-bike');
  road.visible = true;
  const curbMat = material(c.curb, { roughness: 0.86 });
  for (const side of [-1, 1] as const) {
    edgeLine(scene, T1_END + 4, BIKE_END - 4, side * (HW.bike + 0.2), 6, curbMat);
  }
  // Painted orange shoulder just inside the asphalt edge: it reads as a race course
  // line without moving the physical boundary the grip model uses.
  const shoulderMat = material(c.bikeShoulder, { roughness: 0.72 });
  shoulderMat.name = 'bike-shoulder';
  for (const side of [-1, 1] as const) {
    edgeLine(scene, T1_END + 4, BIKE_END - 4, side * (HW.bike - 0.42), 6, shoulderMat, 0.008, 0.045);
  }

  // T1 is cream sand, T2 is cooler gravel: the two transitions must not read alike.
  const t1Mat = material(c.t1Paving, { roughness: 0.95 });
  t1Mat.name = 't1-paving';
  ribbon(scene, SWIM_END - 3, T1_END, HW.t1, 2, t1Mat, 0.042, 't1-paving');
  const t2Mat = material(c.t2Gravel, { roughness: 0.97 });
  t2Mat.name = 't2-gravel';
  ribbon(scene, BIKE_END, T2_END, HW.t2, 2, t2Mat, 0.042, 't2-gravel');

  const track = trackTexture();
  track.repeat.set(1, 1 / 9);
  const trackMat = material('#ffffff', { map: track, roughness: 0.9 });
  trackMat.name = 'running-track';
  // One continuous red track from the T2 exit to the finish. The old 88 m timber
  // boardwalk in the middle changed the surface under the athlete for no reason.
  ribbon(scene, T2_END, COURSE_END, HW.run, 2.2, trackMat, 0.04, 'track-run');
  const vergeMat = material(c.runVerge, { roughness: 0.95 });
  vergeMat.name = 'run-verge';
  for (const side of [-1, 1] as const) {
    edgeLine(scene, T2_END, COURSE_END, side * (HW.run + 0.16), 4, vergeMat, 0.1);
  }

  const mat = material(c.ink, { roughness: 0.94 });
  mat.name = 'finish-mat';
  ribbon(scene, FINISH_S - 6, FINISH_S + 2.4, HW.run, 2, mat, 0.05, 'finish-mat');
  const finishRows = [FINISH_S - 1.3, FINISH_S + 1.3].map(s => {
    const row: THREE.Vector3[] = [];
    for (let i = 0; i <= 10; i++) row.push(groundPoint(s, -HW.run + (2 * HW.run * i) / 10, 0.075));
    return row;
  });
  const checker = checkerTexture();
  checker.repeat.set(6, 1);
  const finishLine = mesh(strip(finishRows, true), new THREE.MeshBasicMaterial({ map: checker }), false, false);
  finishLine.name = 'finish-line';
  scene.add(finishLine);

  // Lane ropes turn the open lake into a readable channel.
  const rope = ropeTexture();
  rope.repeat.set(1, 1 / 2.6);
  const ropeMat = new THREE.MeshBasicMaterial({ map: rope, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  const floatPositions: THREE.Vector3[] = [];
  for (const side of [-1, 1] as const) {
    const u = side * 8.4;
    const rows: THREE.Vector3[][] = [];
    for (let s = 2; s < SWIM_END - 4; s += 5) {
      rows.push([
        new THREE.Vector3(xAt(s, u - 0.24), WATER_LEVEL + 0.05, zAt(s, u - 0.24)),
        new THREE.Vector3(xAt(s, u + 0.24), WATER_LEVEL + 0.05, zAt(s, u + 0.24)),
      ]);
      if (Math.round(s) % 15 < 5) floatPositions.push(new THREE.Vector3(xAt(s, u), WATER_LEVEL + 0.1, zAt(s, u)));
    }
    scene.add(mesh(strip(rows), ropeMat, false, false));
  }
  const dummy = new THREE.Object3D();
  const floats = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 8, 6),
    material(c.paper, { roughness: 0.7 }), floatPositions.length);
  floatPositions.forEach((point, index) => {
    dummy.position.copy(point);
    dummy.scale.set(1, 0.5, 1);
    dummy.updateMatrix();
    floats.setMatrixAt(index, dummy.matrix);
  });
  floats.name = 'lane-rope-floats';
  scene.add(floats);

  const pontoons = new THREE.InstancedMesh(createPropGeometry('pontoon', 0, 'near'),
    createSceneryMaterial(), 3);
  for (let i = 0; i < 3; i++) {
    const u = (i - 1) * 6;
    dummy.position.set(xAt(3, u), WATER_LEVEL + 0.08, -3);
    dummy.rotation.set(0, yawAt(3), 0);
    dummy.scale.setScalar(1.5);
    dummy.updateMatrix();
    pontoons.setMatrixAt(i, dummy.matrix);
  }
  pontoons.name = 'start-pontoon';
  scene.add(pontoons);
}

// ------------------------------------------------------------------ gates

/** Vertical post the chase camera has to steer around: gate pylons and arch legs. */
export type CameraCollider = { x: number; z: number; s: number; radius: number };

const baseYAt = (gate: Gate) => (gate.discipline === 'swim'
  ? WATER_LEVEL : surfaceHeight(gate.s, gate.u));

function addGates(scene: THREE.Object3D, colliders: CameraCollider[]) {
  const materials = new Map<string, { cloth: THREE.MeshStandardMaterial; line: THREE.MeshBasicMaterial }>();
  const buoys: { object: THREE.Object3D; base: number; phase: number }[] = [];
  /** Hanging cloth: gentle sway, never enough to blur the printed text. */
  const flutter = {
    banners: [] as { object: THREE.Object3D; phase: number }[],
    pennants: [] as { object: THREE.Object3D; phase: number }[],
    flags: [] as { object: THREE.Object3D; phase: number }[],
  };
  const plateGeo = new THREE.PlaneGeometry(0.9, 0.57);
  const sceneryMat = createSceneryMaterial();
  const poleMat = material(c.pole, { roughness: 0.55 });
  const footMat = material(c.ink);
  for (const [index, gate] of GATES.entries()) {
    const cloth = new THREE.MeshStandardMaterial({ color: c.gate, roughness: 0.82, side: THREE.DoubleSide });
    cloth.name = `gate-${gate.id}-cloth`;
    const line = new THREE.MeshBasicMaterial({
      color: c.gate, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false,
    });
    materials.set(gate.id, { cloth, line });
    const group = new THREE.Group();
    group.name = `course-gate-${gate.id}`;
    const centerX = xAt(gate.s, gate.u);
    const baseY = baseYAt(gate);
    group.position.set(centerX, baseY, zAt(gate.s, gate.u));
    group.rotation.y = yawAt(gate.s);
    scene.add(group);
    const disciplineLabel = CONFIG.disciplines.find(item => item.id === gate.discipline)?.english ?? '';
    const plate = mesh(plateGeo, new THREE.MeshBasicMaterial({
      map: gatePlateTexture(index + 1, disciplineLabel), side: THREE.DoubleSide, transparent: true,
    }), false, false);
    // Water sheets are built in world space, so they live directly on the scene.
    const sheetRows = (worldY: (s: number, u: number) => number, lift: number) => {
      const rows: THREE.Vector3[][] = [];
      for (const offset of [-0.3, 0.3]) {
        const row: THREE.Vector3[] = [];
        for (let i = 0; i <= 8; i++) {
          const u = gate.u - gate.width / 2 + (gate.width * i) / 8;
          const s = gate.s + offset;
          row.push(new THREE.Vector3(xAt(s, u), worldY(s, u) + lift, zAt(s, u)));
        }
        rows.push(row);
      }
      const sheet = mesh(strip(rows), line, false, false);
      scene.add(sheet);
    };

    if (gate.kind === 'buoy') {
      for (const side of [-1, 1] as const) {
        const u = side * gate.width / 2;
        const buoy = mesh(createPropGeometry('buoy', side < 0 ? 0 : 1, 'near'), sceneryMat);
        buoy.position.set(u, 0.06, 0);
        buoy.rotation.y = 0;
        group.add(buoy);
        buoys.push({ object: buoy, base: 0.06, phase: gate.s * 0.07 + side });
      }
      const sheet = new THREE.PlaneGeometry(gate.width, 0.5);
      const flag = mesh(sheet, cloth, false, false);
      flag.position.set(0, 1.62, 0);
      group.add(flag);
      flutter.flags.push({ object: flag, phase: gate.s * 0.05 });
      for (const side of [-1, 1] as const) {
        const mast = mesh(new THREE.CylinderGeometry(0.032, 0.038, 1.55, 5), poleMat);
        mast.position.set(side * gate.width / 2, 0.8, 0);
        group.add(mast);
      }
      plate.position.set(-gate.width / 2 - 0.8, 1.05, 0.05);
      group.add(plate);
      sheetRows(() => WATER_LEVEL, 0.05);
      continue;
    }

    const span = gate.width + 4.4;
    const height = gate.kind === 'aid' ? 4.6 : 6.1;
    for (const side of [-1, 1] as const) {
      const u = side * span / 2;
      const groundY = surfaceHeight(gate.s, gate.u + u) - baseY;
      colliders.push({ x: xAt(gate.s, gate.u + u), z: zAt(gate.s, gate.u + u), s: gate.s, radius: 0.85 });
      const pylon = mesh(new THREE.CylinderGeometry(0.13, 0.19, height, 7), poleMat);
      pylon.position.set(u, groundY + height / 2, 0);
      group.add(pylon);
      const foot = mesh(new THREE.CylinderGeometry(0.5, 0.62, 0.34, 8), footMat);
      foot.position.set(u, groundY + 0.17, 0);
      group.add(foot);
    }
    const beam = mesh(new THREE.BoxGeometry(span, 0.14, 0.14), poleMat);
    beam.position.set(0, height + 0.52, 0);
    group.add(beam);
    const aid = gate.kind === 'aid';
    const banner = bannerPlane(span - 0.8, aid ? 1.1 : 1.4, bannerTexture(
      aid ? '补给站 AID' : `GATE ${String(index + 1).padStart(2, '0')}`,
      aid ? '取水杯 · 别掉带' : `${disciplineLabel} · 穿门过`,
      { background: c.ink, ink: c.paper, accent: aid ? c.gateAlt : c.gate, aspect: (span - 0.8) / (aid ? 1.1 : 1.4) },
    ));
    banner.position.set(0, height - 0.36, 0);
    group.add(banner);
    flutter.banners.push({ object: banner, phase: index * 1.7 });
    const pennant = mesh(new THREE.PlaneGeometry(span - 0.8, 0.26), cloth, false, false);
    pennant.position.set(0, height + 0.82, 0);
    group.add(pennant);
    flutter.pennants.push({ object: pennant, phase: index * 1.1 });
    plate.position.set(-span / 2 - 0.55, 2, 0.05);
    group.add(plate);
    if (aid) {
      const tent = mesh(createPropGeometry('tent', index % 2, 'near'), sceneryMat);
      tent.position.set(span / 2 + 2.4, -0.02, 0.4);
      tent.rotation.y = -0.5;
      group.add(tent);
    }
    sheetRows((s, u) => surfaceHeight(s, u), 0.055);
  }
  return { materials, buoys, flutter };
}

// ------------------------------------------------------------------ obstacles

function addObstacles(scene: THREE.Object3D) {
  const sceneryMat = createSceneryMaterial();
  const random = seeded(517);
  const grouped = new Map<PropKind, { position: THREE.Vector3; yaw: number; scale: number }[]>();
  const put = (kind: PropKind, position: THREE.Vector3, yaw: number, scale = 1) => {
    const list = grouped.get(kind) ?? [];
    list.push({ position, yaw, scale });
    grouped.set(kind, list);
  };
  const planks: { at: THREE.Vector3; yaw: number }[] = [];
  for (const obstacle of OBSTACLES) {
    const x = xAt(obstacle.s, obstacle.u);
    const inWater = obstacle.discipline === 'swim';
    const y = inWater ? WATER_LEVEL + 0.03 : surfaceHeight(obstacle.s, obstacle.u);
    // Keep the prop square to the course: the collision box in `config.ts` is axis
    // aligned, so a boat swung 26° across the lane would visibly stick out of its hit box.
    const yaw = yawAt(obstacle.s) + (random() - 0.5) * 0.2;
    const position = new THREE.Vector3(x, y, zAt(obstacle.s, obstacle.u));
    const across = (distance: number) => new THREE.Vector3(
      position.x + Math.cos(yaw) * distance, position.y, position.z + Math.sin(yaw) * distance,
    );
    if (obstacle.kind === 'kayak') put('kayak', position, yaw, 1);
    else if (obstacle.kind === 'barrier') {
      for (let i = -1; i <= 1; i++) put('cone', across(i * 1.2), yaw, 1);
      planks.push({ at: position.clone().setY(y + 0.74), yaw });
    } else {
      put('tent', position, yaw + 0.15, 0.82);
      // Decorative boats stay beyond the racing ribbon on the lake map; only the
      // tent is a course obstacle. The canyon run climbs a dry plateau, so boats
      // parked on its shoulder would read as props floating on the trail.
      if (!isFoldedTrack()) {
        for (const side of [-1, 1] as const) {
          const boat = groundPoint(obstacle.s, side * (halfWidthAt(obstacle.s) + 4));
          put('kayak', boat, yawAt(obstacle.s) + side * 1.4, 0.8);
        }
      }
    }
  }
  const dummy = new THREE.Object3D();
  for (const [kind, items] of grouped) {
    const instanced = new THREE.InstancedMesh(createPropGeometry(kind, 0, 'near'), sceneryMat, items.length);
    items.forEach((item, index) => {
      dummy.position.copy(item.position);
      dummy.rotation.set(0, item.yaw, 0);
      dummy.scale.setScalar(item.scale);
      dummy.updateMatrix();
      instanced.setMatrixAt(index, dummy.matrix);
    });
    instanced.name = `obstacle-${kind}`;
    instanced.castShadow = true;
    instanced.receiveShadow = true;
    instanced.computeBoundingSphere();
    scene.add(instanced);
  }
  if (planks.length) {
    const chevron = chevronTexture();
    chevron.repeat.set(1.6, 1);
    const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 0.44, 0.08),
      new THREE.MeshStandardMaterial({ map: chevron, roughness: 0.6, side: THREE.DoubleSide }), planks.length);
    planks.forEach((plank, index) => {
      dummy.position.copy(plank.at);
      dummy.rotation.set(0, plank.yaw, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      instanced.setMatrixAt(index, dummy.matrix);
    });
    instanced.name = 'obstacle-barriers';
    instanced.castShadow = true;
    scene.add(instanced);
  }
  for (const obstacle of OBSTACLES) {
    if (obstacle.discipline === 'swim') continue;
    const side = obstacle.u > 0 ? 1 : -1;
    const s = obstacle.s - 8;
    const u = side * (halfWidthAt(s) + 2.4);
    const x = xAt(s, u);
    const sign = bannerPlane(1.9, 0.95, hazardTexture(
      obstacle.discipline === 'bike' ? '减速' : '注意',
      obstacle.discipline === 'bike' ? 'BARRIER AHEAD' : 'CAMP ON COURSE',
    ));
    sign.position.set(x, surfaceHeight(s, u) + 1.4, zAt(s, u));
    sign.rotation.y = yawAt(s) + side * 0.3;
    scene.add(sign);
    const pole = mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.45, 5), material(c.pole));
    pole.position.set(x, surfaceHeight(s, u) + 0.72, zAt(s, u));
    scene.add(pole);
  }
}

// ------------------------------------------------------------------ pickups

function addPickups(scene: THREE.Object3D) {
  const coreMat = new THREE.MeshStandardMaterial({
    color: c.pickup, emissive: c.pickupCore, emissiveIntensity: 0.7, roughness: 0.34, metalness: 0.1,
  });
  const ringMat = new THREE.MeshBasicMaterial({ color: c.pickup, transparent: true, opacity: 0.5 });
  const cores = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.16, 0.2, 3, 8), coreMat, PICKUPS.length);
  const rings = new THREE.InstancedMesh(new THREE.TorusGeometry(0.42, 0.03, 4, 18), ringMat, PICKUPS.length);
  cores.name = 'gel-cores';
  rings.name = 'gel-rings';
  cores.castShadow = true;
  cores.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(cores, rings);
  const dummy = new THREE.Object3D();
  const items = PICKUPS.map(pickup => {
    const x = xAt(pickup.s, pickup.u);
    const ground = pickup.discipline === 'swim' ? WATER_LEVEL : surfaceHeight(pickup.s, pickup.u);
    return {
      id: pickup.id, x, z: zAt(pickup.s, pickup.u), y: ground + CONFIG.pickup.height,
      s: pickup.s, phase: pickup.s * 0.03,
    };
  });
  const write = (taken: string[], elapsed: number) => {
    items.forEach((item, index) => {
      const alive = !taken.includes(item.id);
      const bob = alive ? Math.sin(elapsed * 2.1 + item.phase) * 0.12 : 0;
      dummy.position.set(item.x, item.y + bob, item.z);
      dummy.rotation.set(Math.PI / 2, 0, alive ? elapsed * 1.5 + item.phase : 0);
      dummy.scale.setScalar(alive ? 1 : 0.0001);
      dummy.updateMatrix();
      cores.setMatrixAt(index, dummy.matrix);
      dummy.rotation.set(Math.PI / 2 + Math.sin(elapsed + item.phase) * 0.35, 0, elapsed * 0.9 + item.phase);
      dummy.updateMatrix();
      rings.setMatrixAt(index, dummy.matrix);
    });
    cores.instanceMatrix.needsUpdate = true;
    rings.instanceMatrix.needsUpdate = true;
  };
  write([], 0);
  return { write };
}

// ------------------------------------------------------------------ scenery chunks

type Placement = { position: THREE.Vector3; scale: THREE.Vector3; yaw: number; model: number };
type Model = {
  kind: PropKind;
  variant: number;
  near: THREE.BufferGeometry;
  far?: THREE.BufferGeometry;
  distant?: THREE.BufferGeometry;
  material: THREE.Material;
};

const geometryCache = new Map<string, THREE.BufferGeometry>();
function cached(kind: PropKind, variant: number, detail: SceneryDetail) {
  const key = `${kind}:${variant}:${detail}`;
  let geometry = geometryCache.get(key);
  if (!geometry) {
    geometry = createPropGeometry(kind, variant, detail);
    geometryCache.set(key, geometry);
  }
  return geometry;
}

function model(kind: PropKind, variant: number, mat: THREE.Material, lod = true): Model {
  return {
    kind, variant, material: mat,
    near: cached(kind, variant, 'near'),
    far: lod ? cached(kind, variant, 'far') : undefined,
    distant: lod ? cached(kind, variant, 'distant') : undefined,
  };
}

/** Shared clock for the GPU tree sway; only foliage uses it. */
const swayClock = { value: 0 };

/**
 * Vegetation sways in the vertex shader instead of rewriting instance matrices:
 * the forest keeps one draw call per cell and the wind costs nothing on the CPU.
 */
function swayMaterial(amount: number) {
  const material = createSceneryMaterial();
  material.onBeforeCompile = shader => {
    shader.uniforms.uSwayTime = swayClock;
    shader.vertexShader = `uniform float uSwayTime;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 swayOrigin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float swayScale = length(instanceMatrix[1].xyz);
      #else
        vec3 swayOrigin = vec3(0.0);
        float swayScale = 1.0;
      #endif
      float swayPhase = swayOrigin.x * 0.21 + swayOrigin.z * 0.17;
      float swayWeight = max(position.y - 0.35, 0.0) * ${amount.toFixed(3)} * swayScale;
      transformed.x += sin(uSwayTime * 0.85 + swayPhase) * swayWeight;
      transformed.z += cos(uSwayTime * 0.63 + swayPhase * 1.4) * swayWeight * 0.75;`,
    );
  };
  material.customProgramCacheKey = () => `scenery-sway-${amount}`;
  return material;
}

/** Instanced props batched into cells so the frustum culls whole groves. */
function addChunks(scene: THREE.Object3D, name: string, placements: Placement[], models: Model[], lodDistance?: number) {
  const cellSize = 128;
  const cells = new Map<string, Placement[]>();
  for (const item of placements) {
    const key = `${Math.floor(item.position.x / cellSize)}:${Math.floor(item.position.z / cellSize)}`;
    const list = cells.get(key);
    if (list) list.push(item);
    else cells.set(key, [item]);
  }
  const root = new THREE.Group();
  root.name = `${name}-batches`;
  const dummy = new THREE.Object3D();
  for (const [key, items] of cells) {
    const bounds = new THREE.Box3().setFromPoints(items.map(item => item.position));
    const origin = bounds.getCenter(new THREE.Vector3());
    const chunk: THREE.Group | THREE.LOD = lodDistance === undefined ? new THREE.Group() : new THREE.LOD();
    chunk.name = `${name}-cell-${key}`;
    chunk.position.copy(origin);
    const levels: SceneryDetail[] = lodDistance === undefined ? ['near']
      : models.some(item => item.distant) ? ['near', 'far', 'distant'] : ['near', 'far'];
    for (const detail of levels) {
      const level = new THREE.Group();
      level.name = `${chunk.name}-${detail}`;
      for (const [index, part] of models.entries()) {
        const instances = items.filter(item => item.model === index);
        if (!instances.length) continue;
        const geometry = detail === 'distant' ? (part.distant ?? part.far ?? part.near)
          : detail === 'far' ? (part.far ?? part.near) : part.near;
        const batch = new THREE.InstancedMesh(geometry, part.material, instances.length);
        batch.name = `${level.name}-${part.kind}-v${part.variant}`;
        instances.forEach((item, position) => {
          dummy.position.copy(item.position).sub(origin);
          dummy.rotation.set(0, item.yaw, 0);
          dummy.scale.copy(item.scale);
          dummy.updateMatrix();
          batch.setMatrixAt(position, dummy.matrix);
        });
        batch.instanceMatrix.needsUpdate = true;
        batch.castShadow = detail === 'near';
        batch.receiveShadow = detail !== 'distant';
        batch.computeBoundingBox();
        batch.computeBoundingSphere();
        level.add(batch);
      }
      if (chunk instanceof THREE.LOD) {
        chunk.addLevel(level, detail === 'near' ? 0 : detail === 'far' ? lodDistance! : 420, 0.12);
      } else chunk.add(level);
    }
    root.add(chunk);
  }
  scene.add(root);
  return placements.length;
}

function slopeAtPoint(s: number, u: number) {
  const dx = (groundHeight(s, u + 1.6) - groundHeight(s, u - 1.6)) / 3.2;
  const ds = (groundHeight(s + 1.6, u) - groundHeight(s - 1.6, u)) / 3.2;
  return Math.hypot(dx, ds);
}

/** Desert dressing: boulders at the river edge, dry scrub where the walls ease off. */
function addCanyonProps(scene: THREE.Object3D, mobile: boolean) {
  const mat = createSceneryMaterial();
  const models = [
    model('rock', 0, mat), model('rock', 1, mat), model('rock', 2, mat),
    model('canopy', 0, mat), model('canopy', 1, mat),
  ];
  const random = seeded(66013);
  // Keep the racing line readable: the folded route is sampled once and any prop
  // that would stand on a pad, the road or the trail (plus a shoulder) is dropped.
  const corridor: { x: number; z: number; r: number }[] = [];
  for (let s = 0; s <= COURSE_LENGTH + 24; s += 3) {
    corridor.push({ x: xAt(s, 0), z: zAt(s, 0), r: halfWidthAt(s) + 4.5 });
  }
  const onCourse = (x: number, z: number) => corridor.some(p => {
    const dx = p.x - x, dz = p.z - z;
    return dx * dx + dz * dz < p.r * p.r;
  });
  const rocks: Placement[] = [];
  const scrub: Placement[] = [];
  const count = mobile ? 260 : 460;
  for (let i = 0; i < count; i++) {
    const z = -486 + random() * 650;
    const x = -196 + random() * 392;
    const h = canyonHeight(x, z);
    if (h < WATER_LEVEL + 0.6) continue;
    if (onCourse(x, z)) continue;
    const slope = Math.abs(canyonHeight(x + 1.8, z) - canyonHeight(x - 1.8, z)) / 3.6
      + Math.abs(canyonHeight(x, z + 1.8) - canyonHeight(x, z - 1.8)) / 3.6;
    if (slope > 0.85) continue;
    const size = 0.55 + random() * 1.9;
    if (slope > 0.55 || random() < 0.18) {
      rocks.push({
        position: new THREE.Vector3(x, h - 0.18, z),
        scale: new THREE.Vector3(size, size * (0.55 + random() * 0.5), size * (0.8 + random() * 0.4)),
        yaw: random() * Math.PI * 2,
        model: Math.floor(random() * 3),
      });
    } else if (random() < 0.55) {
      // A desert shrub, not a wetland reed: the canopy model reads as a dry
      // saltbush at roughly a third of its 5.2 m nominal height.
      const tuft = 0.26 + random() * 0.4;
      scrub.push({
        position: new THREE.Vector3(x, h - 0.1, z),
        scale: new THREE.Vector3(tuft, tuft * (0.7 + random() * 0.7), tuft),
        yaw: random() * Math.PI * 2,
        model: 3 + Math.floor(random() * 2),
      });
    }
  }
  return addChunks(scene, 'canyon-rocks', rocks, models, mobile ? 96 : 140)
    + addChunks(scene, 'canyon-scrub', scrub, models, mobile ? 84 : 120);
}

function addForest(scene: THREE.Object3D, mobile: boolean) {
  if (isFoldedTrack()) return addCanyonProps(scene, mobile);
  const green = swayMaterial(0.018);
  const models = [
    model('pine', 0, green), model('pine', 1, green), model('pine', 2, green),
    model('canopy', 0, green), model('canopy', 1, green), model('canopy', 2, green),
  ];
  const random = seeded(40217);
  const placements: Placement[] = [];
  for (let s = -120; s < COURSE_END + 240; s += 4.4) {
    for (const side of [-1, 1] as const) {
      if (random() < 0.22) continue;
      const layers = random() < 0.5 ? 1 : 2;
      for (let layer = 0; layer < layers; layer++) {
        const hw = halfWidthAt(s);
        const au = side * (hw + 12 + layer * 34 + random() * 42 + (random() < 0.24 ? random() * 300 : 0));
        if (mobile && random() < 0.42) continue;
        const at = s + random() * 4.4;
        const ground = groundHeight(at, au);
        if (ground < WATER_LEVEL + 1 || slopeAtPoint(at, au) > 1.05) continue;
        // Broadleaf hugs the park and the shore, pines take the climbs.
        const parkish = at > T2_END - 40 || ground < 9;
        const index = (parkish ? 3 : 0) + Math.floor(random() * 3);
        const height = parkish ? 4 + random() * 3.4 : 5.2 + random() * 5.4;
        const girth = 0.72 + random() * 0.5;
        placements.push({
          position: new THREE.Vector3(xAt(at, au), ground - 0.15, zAt(at, au)),
          scale: new THREE.Vector3(girth, height / PROP_HEIGHTS[models[index].kind], girth),
          yaw: random() * Math.PI * 2,
          model: index,
        });
      }
    }
  }
  return addChunks(scene, 'lake-forest', placements, models, mobile ? 86 : 124);
}

function addShoreProps(scene: THREE.Object3D, mobile: boolean) {
  if (isFoldedTrack()) return 0;
  const green = createSceneryMaterial();
  const models = [
    model('reed', 0, green, false), model('reed', 1, green, false), model('reed', 2, green, false),
    model('rock', 0, green), model('rock', 1, green), model('rock', 2, green),
  ];
  const random = seeded(9241);
  const reeds: Placement[] = [];
  const rocks: Placement[] = [];
  for (let s = -110; s < COURSE_END + 230; s += 3.6) {
    for (const side of [-1, 1] as const) {
      if (random() < 0.5) continue;
      const hw = halfWidthAt(s);
      const au = side * (hw + 2.5 + random() * 280);
      const x = xAt(s, au);
      const ground = groundHeight(s, au);
      if (ground > WATER_LEVEL - 0.55 && ground < WATER_LEVEL + 0.75) {
        const size = 0.7 + random() * 0.9;
        reeds.push({
          position: new THREE.Vector3(x, ground - 0.12, zAt(s, au)),
          scale: new THREE.Vector3(size, size * (0.8 + random() * 0.6), size),
          yaw: random() * Math.PI * 2,
          model: Math.floor(random() * 3),
        });
      } else if (ground > WATER_LEVEL + 0.8 && random() < 0.3) {
        if (mobile && random() < 0.4) continue;
        const size = 0.6 + random() * 2;
        rocks.push({
          position: new THREE.Vector3(x, ground - 0.08, zAt(s, au)),
          scale: new THREE.Vector3(size, size * (0.5 + random() * 0.4), size * (0.8 + random() * 0.4)),
          yaw: random() * Math.PI * 2,
          model: 3 + Math.floor(random() * 3),
        });
      }
    }
  }
  return addChunks(scene, 'shore-reeds', reeds, models)
    + addChunks(scene, 'shore-rocks', rocks, models, 112);
}

function addIslands(scene: THREE.Object3D, mobile: boolean) {
  if (isFoldedTrack()) return 0;
  const green = createSceneryMaterial();
  const models = [model('island', 0, green), model('island', 1, green), model('island', 2, green)];
  const random = seeded(771233);
  const placements: Placement[] = [];
  const count = mobile ? 15 : 26;
  for (let i = 0; i < count; i++) {
    const s = -100 + (i / count) * (COURSE_END + 280) + random() * 40;
    const side = (-lakeDir(s) || 1) * (random() < 0.72 ? 1 : -1);
    const au = side * (95 + random() * 380);
    const x = xAt(s, au);
    const ground = groundHeight(s, au);
    if (ground > WATER_LEVEL - 0.5) continue;
    const size = 0.75 + random() * 1.4;
    placements.push({
      position: new THREE.Vector3(x, Math.max(ground, -3.4), zAt(s, au)),
      scale: new THREE.Vector3(size, size * (0.7 + random() * 0.7), size),
      yaw: random() * Math.PI * 2,
      model: Math.floor(random() * 3),
    });
  }
  return addChunks(scene, 'lake-islands', placements, models);
}

/** Crowds, lighting, barriers and the transition furniture that frames the race. */
function addRaceInfrastructure(scene: THREE.Object3D) {
  const green = createSceneryMaterial();
  const random = seeded(3011);
  const models = [
    model('flag', 0, green, false), model('flag', 1, green, false), model('flag', 2, green, false),
    model('lamp', 0, green, false), model('stand', 0, green, false), model('stand', 1, green, false),
    model('rack', 0, green, false), model('rack', 1, green, false),
    model('cone', 0, green, false), model('tent', 0, green, false), model('reed', 0, green, false),
  ];
  const placements: Placement[] = [];
  const bannerMap = bannerTexture(CONFIG.brand.title, `${VENUE} · LAKELINE TRIATHLON`, {
    background: c.ink, ink: c.paper, accent: c.gate, aspect: 3.4,
  });
  bannerMap.wrapS = THREE.RepeatWrapping;
  bannerMap.repeat.set((COURSE_END - ARENA_FROM) / 3.4, 1);
  const bannerMat = new THREE.MeshBasicMaterial({ map: bannerMap, side: THREE.DoubleSide });
  // Each side gets its own row list, and the two rows are a board's foot and top:
  // `strip` maps columns onto the texture's u, so the banner reads along the course
  // instead of weaving across it or stretching one logo down the whole lake.
  for (const side of [-1, 1] as const) {
    const foot: THREE.Vector3[] = [];
    const crown: THREE.Vector3[] = [];
    for (let s = ARENA_FROM; s <= COURSE_END; s += 2.4) {
      const u = side * (halfWidthAt(s) + 1.1);
      foot.push(groundPoint(s, u, 0.05));
      crown.push(groundPoint(s, u, 0.98));
    }
    const barrier = mesh(strip([foot, crown]), bannerMat, false, false);
    barrier.name = `arena-barrier-${side < 0 ? 'left' : 'right'}`;
    scene.add(barrier);
    for (let s = ARENA_FROM; s < COURSE_END; s += 8) {
      placements.push({
        position: groundPoint(s, side * (halfWidthAt(s) + 2.2), 0),
        scale: new THREE.Vector3(1, 1, 1),
        yaw: yawAt(s) + (side > 0 ? Math.PI : 0),
        model: Math.floor(random() * 3),
      });
    }
  }

  // Out on the promenade the roadside keeps changing shape instead of repeating one board.
  const variety = [8, 9, 4, 10, 8, 5, 0, 9, 4, 10];
  for (let s = T2_END + 7; s < ARENA_FROM; s += 13) {
    for (const side of [-1, 1] as const) {
      const u = side * (halfWidthAt(s) + 2.6 + random() * 1.8);
      placements.push({
        position: groundPoint(s, u, 0),
        scale: new THREE.Vector3(1, 1, 1),
        yaw: yawAt(s) + (side > 0 ? 0 : Math.PI),
        model: variety[Math.floor(random() * variety.length)],
      });
    }
  }

  for (let s = T2_END + 8; s < COURSE_END - 20; s += 36) {
    for (const side of [-1, 1] as const) {
      placements.push({
        position: groundPoint(s, side * (halfWidthAt(s) + 3.6), 0),
        scale: new THREE.Vector3(1, 1, 1),
        yaw: yawAt(s) + (side > 0 ? 0 : Math.PI),
        model: 3,
      });
    }
  }
  for (const [s, side] of [[1128, 1], [1214, -1], [FINISH_S - 52, 1]] as const) {
    const u = side * (halfWidthAt(s) + 9.5);
    const x = xAt(s, u);
    placements.push({
      position: new THREE.Vector3(x, groundHeight(s, u), zAt(s, u)),
      scale: new THREE.Vector3(1.2, 1, 1),
      yaw: yawAt(s) + (side > 0 ? -Math.PI / 2 : Math.PI / 2),
      model: 4 + (s % 2),
    });
  }
  for (const s of [SWIM_END + 8, T1_END - 5, BIKE_END + 6, T2_END - 4]) {
    for (const side of [-1, 1] as const) {
      const u = side * (halfWidthAt(s) + 4.8);
      const x = xAt(s, u);
      placements.push({
        position: new THREE.Vector3(x, groundHeight(s, u), zAt(s, u)),
        scale: new THREE.Vector3(1, 1, 1),
        yaw: yawAt(s),
        model: 6 + (side > 0 ? 1 : 0),
      });
    }
  }
  return addChunks(scene, 'race-furniture', placements, models);
}

// ------------------------------------------------------------------ signs & arches

function addArch(scene: THREE.Object3D, s: number, title: string, subtitle: string, options: {
  span?: number; height?: number; accent?: string; stamp?: string;
} = {}, colliders: CameraCollider[] = []) {
  const span = options.span ?? 22;
  const height = options.height ?? 6.4;
  const centerX = xAt(s, 0);
  const centerY = surfaceHeight(s, 0);
  const group = new THREE.Group();
  group.name = `arch-${title}`;
  group.position.set(centerX, centerY, zAt(s, 0));
  group.rotation.y = yawAt(s);
  const poleMat = material(c.pole, { roughness: 0.5 });
  for (const side of [-1, 1] as const) {
    const u = side * span / 2;
    const groundY = surfaceHeight(s, u) - centerY;
    colliders.push({ x: xAt(s, u), z: zAt(s, u), s, radius: 0.95 });
    const pylon = mesh(new THREE.CylinderGeometry(0.16, 0.24, height, 8), poleMat);
    pylon.position.set(u, groundY + height / 2, 0);
    group.add(pylon);
    const foot = mesh(new THREE.CylinderGeometry(0.6, 0.8, 0.4, 10), material(c.ink));
    foot.position.set(u, groundY + 0.2, 0);
    group.add(foot);
    for (let i = 0; i < 5; i++) {
      const flag = mesh(new THREE.PlaneGeometry(0.54, 0.32), new THREE.MeshStandardMaterial({
        color: i % 2 ? c.paper : (options.accent ?? c.gate), side: THREE.DoubleSide,
      }), false, false);
      flag.position.set(u + side * 0.42, groundY + 1.3 + i * 0.6, 0.02);
      group.add(flag);
    }
  }
  const banner = bannerPlane(span - 1, 2, bannerTexture(title, subtitle, {
    background: c.ink, ink: c.paper, accent: options.accent ?? c.gate, stamp: options.stamp,
    aspect: (span - 1) / 2,
  }));
  banner.position.set(0, height - 0.22, 0);
  group.add(banner);
  const beam = mesh(new THREE.BoxGeometry(span, 0.16, 0.16), poleMat);
  beam.position.set(0, height + 0.82, 0);
  group.add(beam);
  scene.add(group);
  return group;
}

function addMarks(scene: THREE.Object3D) {
  for (const [index, mark] of MARKS.entries()) {
    const s = mark.s + 7;
    const u = mark.side * (halfWidthAt(s) + 3.8);
    const x = xAt(s, u);
    const group = new THREE.Group();
    group.name = `mark-${mark.id}`;
    group.position.set(x, surfaceHeight(s, u), zAt(s, u));
    group.rotation.y = yawAt(s) - mark.side * 0.28;
    for (const offset of [-1.6, 1.6]) {
      const pole = mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.4, 6), material(c.pole));
      pole.position.set(offset, 1.2, 0);
      group.add(pole);
    }
    const board = bannerPlane(3.8, 1.02, bannerTexture(mark.en, `${mark.zh} · ${mark.note}`, {
      background: c.ink, ink: c.paper, accent: c.gate,
      stamp: `KM ${(mark.s / 1000).toFixed(1)}`, aspect: 3.8 / 1.02,
    }));
    board.position.set(0, 2.2, 0);
    group.add(board);
    if (index % 2 === 0) {
      const foot = mesh(new THREE.BoxGeometry(3.6, 0.14, 0.4), material(c.ink), false, true);
      foot.position.set(0, 0.07, 0);
      group.add(foot);
    }
    scene.add(group);
  }
}

// ------------------------------------------------------------------ build

export function createCourse(scene: THREE.Scene, mobile: boolean, styleId: MapStyleId = 'classic') {
  const style = MAP_STYLES[styleId];
  applyStyle(style);
  setTrack(styleId);
  // These are module-level because a dozen helpers read them, but they are keyed to
  // the active course length — refresh them before any geometry is built.
  COURSE_END = COURSE_LENGTH + 60;
  ARENA_FROM = FINISH_S - 110;
  // One root per build: swapping map styles only has to dispose this subtree.
  const root = new THREE.Group();
  root.name = `course-${styleId}`;
  scene.add(root);

  const terrain = addTerrain(root, mobile);
  const water = addWater(root);
  const clouds = addCloudShadows(root);
  addSurfaces(root);
  const cameraColliders: CameraCollider[] = [];
  const gates = addGates(root, cameraColliders);
  // Obstacles collide on every track (see rules.ts::scanObstacles), so they must be
  // drawn on every track too — otherwise the canyon hits invisible barriers.
  addObstacles(root);
  const pickups = addPickups(root);
  const trees = addForest(root, mobile);
  const shore = addShoreProps(root, mobile);
  const islands = addIslands(root, mobile);
  // Spectator furniture (stands, tents, barrier banners, lamp posts, racks) — keep it
  // only on the open lake map; the canyon shows just the race geometry and aid stations.
  if (!isFoldedTrack()) addRaceInfrastructure(root);
  addMarks(root);

  const folded = isFoldedTrack();
  const startArch = addArch(root, -16, 'SWIM START', `${VENUE} · 0.3 KM 公开水域`, {
    span: 21, height: 5.4, accent: c.gateAlt, stamp: folded ? 'CANYON LINE 01' : 'LAKELINE LINE 01',
  }, cameraColliders);
  addArch(root, SWIM_END + 6, 'T1 换项', '出水 · 挂车 · 上车', { span: 15, height: 4.8, accent: c.gate }, cameraColliders);
  // On the canyon line the bend worth marking is the rim hairpin, not the open descent.
  if (folded) {
    addArch(root, 430, 'HAIRPIN', '崖顶发夹弯 · 重刹贴内线', {
      span: 19, height: 5.4, accent: c.gate, stamp: 'BIKE 0.1KM',
    }, cameraColliders);
  } else {
    addArch(root, 600, 'HAIRPIN', '发夹弯 · 重刹贴内线', {
      span: 19, height: 5.4, accent: c.gate, stamp: 'BIKE 0.3KM',
    }, cameraColliders);
  }
  addArch(root, BIKE_END + 6, 'T2 换项', '挂车 · 跑鞋 · 出发', { span: 15, height: 4.8, accent: c.gateAlt }, cameraColliders);
  const finishArch = addArch(root, FINISH_S, 'FINISH', `${EVENT_NAME} · 冲线`, {
    span: 21, height: 6.6, accent: c.gate, stamp: folded ? 'CANYON 05' : 'LAKELINE 05',
  }, cameraColliders);

  const gateColor = new THREE.Color(c.gate);
  const gatePassed = new THREE.Color(c.gatePassed);
  const gateMissed = new THREE.Color(c.gateMissed);

  return {
    root,
    style: styleId,
    startArch,
    finishArch,
    gates,
    cameraColliders,
    /** Drop this whole build (geometry, materials, canvas textures) before a swap. */
    dispose() {
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      const textures = new Set<THREE.Texture>();
      root.traverse(object => {
        const drawn = object as THREE.Mesh;
        if (drawn.geometry) geometries.add(drawn.geometry);
        if (drawn.material) {
          for (const mat of Array.isArray(drawn.material) ? drawn.material : [drawn.material]) materials.add(mat);
        }
      });
      materials.forEach(mat => {
        for (const value of Object.values(mat)) if (value instanceof THREE.Texture) textures.add(value);
        mat.dispose();
      });
      geometries.forEach(geometry => geometry.dispose());
      textures.forEach(texture => texture.dispose());
      geometryCache.clear();
      scene.remove(root);
    },
    update(state: RunState, elapsed: number) {
      for (const [id, mats] of gates.materials) {
        const color = state.gatesPassed.includes(id) ? gatePassed
          : state.gatesMissed.includes(id) ? gateMissed : gateColor;
        mats.cloth.color.copy(color);
        mats.line.color.copy(color);
      }
      for (const buoy of gates.buoys) {
        buoy.object.position.y = buoy.base + Math.sin(elapsed * 1.7 + buoy.phase) * 0.09;
        buoy.object.rotation.z = Math.sin(elapsed * 1.25 + buoy.phase) * 0.13;
      }
      for (const banner of gates.flutter.banners) {
        // A degree or two of sway keeps the printed gate number legible.
        banner.object.rotation.x = Math.sin(elapsed * 1.05 + banner.phase) * 0.014;
        banner.object.rotation.y = Math.sin(elapsed * 0.73 + banner.phase) * 0.007;
      }
      for (const pennant of gates.flutter.pennants) {
        pennant.object.rotation.x = Math.sin(elapsed * 2.2 + pennant.phase) * 0.14;
        pennant.object.rotation.z = Math.sin(elapsed * 1.6 + pennant.phase) * 0.05;
      }
      for (const flag of gates.flutter.flags) {
        flag.object.rotation.y = Math.sin(elapsed * 2.6 + flag.phase) * 0.12;
      }
      swayClock.value = elapsed;
      clouds.offset.x = elapsed * 0.0045;
      clouds.offset.y = elapsed * 0.0016;
      pickups.write(state.pickupsTaken, elapsed);
      water.uniforms.uTime.value = elapsed;
    },
    diagnostics() {
      return {
        mobile,
        style: styleId,
        terrain: { columns: terrain.columns, rows: terrain.rows, vertices: terrain.columns * terrain.rows },
        water: { vertices: water.vertices, rows: water.runs },
        trees, shore, islands, furniture: isFoldedTrack() ? 0 : addRaceInfrastructure.length > 0 ? 120 : 0,
        gates: gates.materials.size,
        pickups: PICKUPS.length,
        obstacles: OBSTACLES.length,
        marks: MARKS.length,
        boundaries: [SWIM_END, T1_END, BIKE_END, T2_END, FINISH_S].join('/'),
      };
    },
  };
}
