import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config';

export type SceneryDetail = 'near' | 'far' | 'distant';
const TAU = Math.PI * 2;
/** Vertex colours are baked per prop, so the palette has to be the active map's one. */
export type SceneryPalette = { [K in keyof typeof CONFIG.colors]: string };
let k: SceneryPalette = CONFIG.colors;

export function setSceneryPalette(colors: SceneryPalette) {
  k = colors;
}

/** Every prop shares this material so a whole chunk of lake costs one draw. */
export function createSceneryMaterial() {
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff', vertexColors: true, roughness: 0.86, metalness: 0,
  });
  material.name = 'scenery-lake-props';
  return material;
}

export type PropKind =
  | 'pine' | 'canopy' | 'reed' | 'rock' | 'island' | 'kayak' | 'buoy' | 'cone'
  | 'tent' | 'rack' | 'stand' | 'flag' | 'lamp' | 'pontoon';

/** Nominal heights let course chunks treat one instance scale as "metres". */
export const PROP_HEIGHTS: Record<PropKind, number> = {
  pine: 6.4, canopy: 5.2, reed: 1.4, rock: 1.8, island: 14, kayak: 0.9, buoy: 1.5,
  cone: 0.7, tent: 2.9, rack: 1.15, stand: 2.6, flag: 2.1, lamp: 4.4, pontoon: 2,
};

function variantOf(variant: number) {
  return Number.isFinite(variant) ? ((Math.floor(variant) % 3) + 3) % 3 : 0;
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paint(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation) {
  const tone = new THREE.Color(color);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) tone.toArray(colors, i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.deleteAttribute('uv');
  return geometry;
}

/** Vertical blend, used for foliage, karst sides and the waterline band. */
function blend(geometry: THREE.BufferGeometry, low: THREE.ColorRepresentation, high: THREE.ColorRepresentation,
  floor: number, ceil: number, gamma = 1) {
  const a = new THREE.Color(low);
  const b = new THREE.Color(high);
  const tone = new THREE.Color();
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    const t = THREE.MathUtils.clamp((positions.getY(i) - floor) / Math.max(1e-4, ceil - floor), 0, 1) ** gamma;
    tone.copy(a).lerp(b, t).toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.deleteAttribute('uv');
  return geometry;
}

function mottle(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, amount: number, seed: number) {
  const base = new THREE.Color(color);
  const tone = new THREE.Color();
  const colors = geometry.getAttribute('color') as THREE.BufferAttribute;
  const array = colors.array as Float32Array;
  const random = mulberry(seed);
  for (let i = 0; i < colors.count; i++) {
    tone.setRGB(array[i * 3], array[i * 3 + 1], array[i * 3 + 2]);
    tone.lerp(base, (i % 3 === 0 ? amount : amount * 0.4) * (0.4 + random() * 0.6));
    tone.toArray(array, i * 3);
  }
  colors.needsUpdate = true;
  return geometry;
}

function combine(parts: THREE.BufferGeometry[], name: string) {
  // Extruded primitives arrive indexed while the faceted foliage does not, and the merge
  // refuses a mixed batch, so every part is flattened to its triangles first.
  const sources = parts.map(part => (part.index ? part.toNonIndexed() : part));
  const geometry = mergeGeometries(sources, false);
  if (!geometry) throw new Error(`Cannot merge scenery geometry: ${name}`);
  sources.forEach(source => source.dispose());
  parts.forEach(part => part.dispose());
  geometry.name = name;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Lathe-like surface from a radius/height profile; keeps normals outward. */
function radialSurface(profile: THREE.Vector3[], segments: number,
  shape: (radius: number, height: number, theta: number) => THREE.Vector3) {
  const positions: number[] = [];
  const indices: number[] = [];
  const rings: number[][] = [];
  for (const p of profile) {
    const ring: number[] = [];
    const count = Math.abs(p.x) < 1e-6 ? 1 : segments;
    for (let i = 0; i < count; i++) {
      const point = shape(Math.max(0, p.x), p.y, (i * TAU) / segments);
      ring.push(positions.length / 3);
      positions.push(point.x, point.y, point.z);
    }
    rings.push(ring);
  }
  for (let j = 0; j < rings.length - 1; j++) {
    const upper = rings[j];
    const lower = rings[j + 1];
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      if (upper.length === 1) indices.push(upper[0], lower[next], lower[i]);
      else if (lower.length === 1) indices.push(upper[i], upper[next], lower[0]);
      else indices.push(upper[i], upper[next], lower[i], upper[next], lower[next], lower[i]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function profileOf(points: [number, number][], steps: number) {
  const curve = new THREE.CatmullRomCurve3(points.map(([r, y]) => new THREE.Vector3(r, y, 0)));
  const parameters = new Set(points.map((_, index) => index / (points.length - 1)));
  for (let i = 0; i <= steps; i++) parameters.add(i / steps);
  return [...parameters].sort((a, b) => a - b).map(t => curve.getPoint(t));
}

function trunkOf(height: number, base: number, top: number, segments: number) {
  const mesh = new THREE.CylinderGeometry(base, top, height, segments, 1);
  mesh.translate(0, height / 2, 0);
  return paint(mesh, k.bark);
}

/** One fir skirt: a drooping cone with a lobed hem and enough thickness to read. */
function firSkirt(radius: number, height: number, base: number, lobes: number, phase: number, segments: number) {
  const profile = profileOf([
    [0, 1.06], [0.34, 0.9], [0.78, 0.42], [1, 0.02], [0.9, -0.06], [0.42, 0.16], [0, 0.34],
  ], 6);
  return radialSurface(profile, segments, (r, y, theta) => {
    const lobe = (1 + Math.cos(theta * lobes + phase)) * 0.5;
    const rr = radius * r * (0.86 + 0.16 * lobe);
    return new THREE.Vector3(Math.cos(theta) * rr, base + height * (y - r * 0.12 * lobe), Math.sin(theta) * rr);
  });
}

function pineGeometry(v: number, detail: SceneryDetail) {
  const segments = detail === 'near' ? 14 : detail === 'far' ? 8 : 6;
  const layers = detail === 'distant' ? 3 : v === 1 ? 4 : 5;
  const parts: THREE.BufferGeometry[] = [trunkOf(1.7, 0.14, 0.24, detail === 'near' ? 8 : 5)];
  const dark = new THREE.Color(k.pine).multiplyScalar(0.72);
  const light = new THREE.Color(k.pine).lerp(new THREE.Color(k.canopyLight), 0.3 + v * 0.08);
  for (let layer = 0; layer < layers; layer++) {
    const t = layer / (layers - 1);
    const radius = (2 - 1.5 * t) * (v === 2 ? 0.9 : 1);
    parts.push(blend(
      firSkirt(radius, 2.1 - 0.8 * t, 0.85 + 4.1 * t, 5 + (v % 2), layer * 1.9 + v, segments),
      dark, light, 0.8, 5.8,
    ));
  }
  const tip = new THREE.ConeGeometry(0.16, 0.9, detail === 'near' ? 7 : 4);
  tip.translate(0, 5.85, 0);
  parts.push(paint(tip, light));
  return combine(parts, `lake-pine-v${v}-${detail}`);
}

function canopyGeometry(v: number, detail: SceneryDetail) {
  const sub = detail === 'near' ? 1 : 0;
  const parts: THREE.BufferGeometry[] = [trunkOf(1.9 + v * 0.2, 0.16, 0.3, detail === 'near' ? 8 : 5)];
  const random = mulberry(971 + v * 33);
  const blobs = detail === 'distant' ? 3 : detail === 'far' ? 4 : 6;
  const base = new THREE.Color(k.canopy).lerp(new THREE.Color(k.canopyLight), 0.15 + v * 0.15);
  for (let i = 0; i < blobs; i++) {
    const radius = 1.05 - i * 0.06 + random() * 0.3;
    const blob = new THREE.IcosahedronGeometry(radius, sub);
    blob.scale(1.15, 0.82, 1.05);
    blob.translate((random() - 0.5) * 1.5, 2.5 + (i / blobs) * 1.5 + random() * 0.3, (random() - 0.5) * 1.4);
    parts.push(blend(blob, base.clone().multiplyScalar(0.62),
      base.clone().lerp(new THREE.Color('#cfe89a'), 0.36), 2.1, 4.5, 0.8));
  }
  return combine(parts, `lake-canopy-v${v}-${detail}`);
}

/** Crossed blades keep the reeds visible from both banks of the channel. */
function reedGeometry(v: number) {
  const parts: THREE.BufferGeometry[] = [];
  const random = mulberry(131 + v * 17);
  const blades = 6 + v * 2;
  for (let i = 0; i < blades; i++) {
    const height = 0.8 + random() * 0.7;
    const lean = (i % 2 ? 1 : -1) * (0.2 + random() * 0.3);
    for (const cross of [0, Math.PI / 2]) {
      const blade = new THREE.PlaneGeometry(0.08, height, 1, 3);
      const position = blade.getAttribute('position') as THREE.BufferAttribute;
      for (let j = 0; j < position.count; j++) {
        const t = (position.getY(j) + height / 2) / height;
        position.setX(j, position.getX(j) + t * t * lean);
        position.setY(j, position.getY(j) + height / 2 - t * t * 0.12);
      }
      blade.computeVertexNormals();
      blade.rotateY((i / blades) * TAU + cross);
      parts.push(paint(blade, i % 3 === 0 ? '#7f9b57' : k.canopy));
    }
  }
  return combine(parts, `lake-reed-v${v}`);
}

function boulderGeometry(v: number, detail: SceneryDetail) {
  const segments = detail === 'near' ? 18 : 10;
  const shape = (r: number, y: number, theta: number) => {
    const uneven = 1 + 0.09 * Math.sin(theta * 3 + v * 1.8) + 0.05 * Math.cos(theta * 5 - y * 2);
    return new THREE.Vector3(r * Math.cos(theta) * uneven, y * (1 + v * 0.12),
      r * Math.sin(theta) * uneven * (0.82 + v * 0.06));
  };
  const stone = radialSurface(profileOf([
    [0, 1.34], [0.3, 1.3], [0.62, 1.06], [0.86, 0.68], [0.98, 0.28], [0.92, 0.02], [0, -0.04],
  ], detail === 'near' ? 10 : 5), segments, shape);
  // Weathering pale at the top: granite on the lake, sun-bleached sandstone in the canyon.
  blend(stone, k.rock, k.sand, 0, 1.4);
  mottle(stone, k.hill, 0.3, 77 + v);
  const cap = radialSurface(profileOf([
    [0, 1.46], [0.34, 1.42], [0.62, 1.26], [0.78, 1.08], [0.46, 1.02], [0, 1.14],
  ], 6), segments, (r, y, theta) => shape(r * 1.02, y - 0.02, theta));
  paint(cap, k.grass);
  return combine([stone, cap], `lake-rock-v${v}-${detail}`);
}

const ISLAND_R = 13;
const ISLAND_H = 14;

/** Karst islet: limestone sides scoured at the waterline, green crown, dwarf pines. */
function islandGeometry(v: number, detail: SceneryDetail) {
  const segments = detail === 'near' ? 24 : detail === 'far' ? 14 : 9;
  const shape = (r: number, y: number, theta: number) => {
    const karst = 1 + 0.13 * Math.sin(theta * 4 + v) + 0.07 * Math.sin(theta * 9 - y * 8);
    return new THREE.Vector3(r * Math.cos(theta) * karst * ISLAND_R, y * ISLAND_H,
      r * Math.sin(theta) * karst * ISLAND_R * 0.86);
  };
  const body = radialSurface(profileOf([
    [0, 1.04], [0.4, 1], [0.7, 0.84], [0.86, 0.58], [0.92, 0.3], [0.86, 0.08], [0.66, -0.1], [0, -0.14],
  ], detail === 'near' ? 12 : 6), segments, shape);
  blend(body, k.waterDeep, '#9aa69c', -1.6, 5.4);
  mottle(body, '#7f8c86', 0.3, 313 + v);
  const parts = [body];
  if (detail !== 'distant') {
    const crown = radialSurface(profileOf([
      [0, 1.12], [0.42, 1.06], [0.66, 0.96], [0.46, 0.9], [0, 0.96],
    ], 6), segments, shape);
    blend(crown, '#39764c', k.canopyLight, 11.4, 15.4);
    parts.push(crown);
    const random = mulberry(53 + v * 11);
    for (let i = 0; i < (detail === 'near' ? 5 : 3); i++) {
      const mini = pineGeometry(i % 3, 'distant');
      const scale = 0.34 + random() * 0.2;
      mini.scale(scale, scale, scale);
      const angle = random() * TAU;
      const reach = random() * ISLAND_R * 0.42;
      mini.translate(Math.cos(angle) * reach, 13.2, Math.sin(angle) * reach);
      parts.push(mini);
    }
  }
  return combine(parts, `lake-island-v${v}-${detail}`);
}

function kayakGeometry(v: number) {
  const hull = new THREE.SphereGeometry(1, 14, 9);
  const position = hull.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const taper = 1 - Math.min(1, Math.abs(z) / 1.05) ** 1.7;
    position.setXYZ(i, x * 0.36 * (0.25 + taper), y * 0.34 * (0.45 + 0.55 * taper), z * 1.9);
  }
  hull.computeVertexNormals();
  hull.translate(0, 0.18, 0);
  blend(hull, '#efe7d6', [k.gate, k.gateAlt, k.pickup][v], 0, 0.46);
  mottle(hull, k.ink, 0.1, 909 + v);
  const rim = new THREE.TorusGeometry(0.26, 0.035, 5, 14);
  rim.rotateX(Math.PI / 2);
  rim.scale(1, 1.9, 1);
  rim.translate(0, 0.42, 0);
  const seat = new THREE.BoxGeometry(0.34, 0.05, 0.46);
  seat.translate(0, 0.38, 0);
  const paddle = new THREE.BoxGeometry(0.05, 0.045, 1.7);
  paddle.rotateY(0.45 + v * 0.2);
  paddle.translate(0.12, 0.5, 0);
  return combine([hull, paint(rim, k.ink), paint(seat, k.ink), paint(paddle, k.boardwalk)], `lake-kayak-v${v}`);
}

function buoyGeometry(v: number) {
  const body = radialSurface(profileOf([
    [0, 0.86], [0.22, 0.8], [0.42, 0.54], [0.48, 0.2], [0.36, 0.02], [0, -0.12],
  ], 6), 12, (r, y, theta) => new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta)));
  paint(body, v === 0 ? k.gate : k.gateAlt);
  const band = new THREE.CylinderGeometry(0.46, 0.43, 0.16, 12);
  band.translate(0, 0.4, 0);
  paint(band, k.paper);
  const mast = new THREE.CylinderGeometry(0.02, 0.026, 0.6, 5);
  mast.translate(0, 1.14, 0);
  const cloth = [k.gate, k.gateAlt, k.pickup][v];
  const front = new THREE.PlaneGeometry(0.32, 0.22);
  front.translate(0.18, 1.3, 0);
  const back = front.clone();
  back.rotateY(Math.PI);
  back.translate(0.36, 0, 0);
  paint(front, cloth);
  paint(back, cloth);
  return combine([body, band, paint(mast, k.pole), front, back], `lake-buoy-v${v}`);
}

function coneGeometry() {
  const body = new THREE.ConeGeometry(0.2, 0.58, 12);
  body.translate(0, 0.35, 0);
  paint(body, k.gate);
  const band = new THREE.CylinderGeometry(0.12, 0.145, 0.12, 12);
  band.translate(0, 0.34, 0);
  paint(band, k.paper);
  const base = new THREE.BoxGeometry(0.42, 0.05, 0.42);
  base.translate(0, 0.03, 0);
  return combine([body, band, paint(base, k.ink)], 'lake-cone');
}

function tentGeometry(v: number) {
  const parts: THREE.BufferGeometry[] = [];
  const tone = v === 0 ? k.gate : k.gateAlt;
  const roof = new THREE.ConeGeometry(1.7, 0.75, 4);
  roof.rotateY(Math.PI / 4);
  roof.scale(1.25, 1, 0.85);
  roof.translate(0, 2.5, 0);
  paint(roof, tone);
  const trim = new THREE.ConeGeometry(1.8, 0.26, 4);
  trim.rotateY(Math.PI / 4);
  trim.scale(1.25, 1, 0.85);
  trim.translate(0, 2.1, 0);
  paint(trim, k.paper);
  parts.push(roof, trim);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const pole = new THREE.CylinderGeometry(0.035, 0.035, 2.1, 5);
    pole.translate(sx * 1.32, 1.05, sz * 0.88);
    parts.push(paint(pole, k.pole));
  }
  const table = new THREE.BoxGeometry(1.6, 0.09, 0.62);
  table.translate(0, 0.8, 0);
  parts.push(paint(table, k.paper));
  for (let i = 0; i < 5; i++) {
    const cup = new THREE.CylinderGeometry(0.07, 0.055, 0.15, 7);
    cup.translate(-0.6 + i * 0.3, 0.92, i % 2 ? 0.12 : -0.12);
    parts.push(paint(cup, k.pickup));
  }
  return combine(parts, `lake-tent-v${v}`);
}

/** Transition-area bike rack: rails, legs and a row of parked silhouettes. */
function rackGeometry(v: number) {
  const parts: THREE.BufferGeometry[] = [];
  for (const z of [-0.4, 0.4]) {
    const rail = new THREE.BoxGeometry(3.4, 0.07, 0.07);
    rail.translate(0, 1.06, z);
    parts.push(paint(rail, k.rim));
    for (const x of [-1.6, 0, 1.6]) {
      const leg = new THREE.BoxGeometry(0.07, 1.06, 0.07);
      leg.translate(x, 0.53, z);
      parts.push(paint(leg, k.ink));
    }
  }
  for (let i = 0; i < 4; i++) {
    const tone = [k.bike, k.gateAlt, k.rival, k.gate][(i + v) % 4];
    const front = new THREE.TorusGeometry(0.32, 0.03, 4, 12);
    const rear = new THREE.TorusGeometry(0.32, 0.03, 4, 12);
    front.translate(-0.76 + i * 0.82, 0.34, 0);
    rear.translate(-0.1 + i * 0.82, 0.34, 0);
    const frame = new THREE.BoxGeometry(0.66, 0.06, 0.05);
    frame.rotateZ(0.32);
    frame.translate(-0.43 + i * 0.82, 0.56, 0);
    const bar = new THREE.BoxGeometry(0.05, 0.3, 0.05);
    bar.translate(0.22 + i * 0.82, 0.66, 0);
    parts.push(paint(front, tone), paint(rear, tone), paint(frame, tone), paint(bar, tone));
  }
  return combine(parts, `lake-rack-v${v}`);
}

function standGeometry(v: number) {
  const parts: THREE.BufferGeometry[] = [];
  for (let row = 0; row < 4; row++) {
    const step = new THREE.BoxGeometry(6, 0.34, 0.5);
    step.translate(0, 0.17 + row * 0.5, -row * 0.46);
    parts.push(paint(step, k.pole));
  }
  const back = new THREE.BoxGeometry(6.2, 1.2, 0.14);
  back.translate(0, 2.3, -1.94);
  parts.push(paint(back, v === 0 ? k.ink : k.gateAlt));
  const random = mulberry(2027 + v * 7);
  const tones = ['#f4f1ea', '#dfe6ee', '#ffd9a8', '#c3d6e0', k.gate, k.gateAlt];
  for (let i = 0; i < 52; i++) {
    const row = Math.floor(random() * 4);
    const x = (random() - 0.5) * 5.6;
    const y = 0.6 + row * 0.5;
    const z = -row * 0.46;
    const head = new THREE.SphereGeometry(0.12, 5, 4);
    head.translate(x, y + 0.26, z);
    const body = new THREE.CapsuleGeometry(0.15, 0.2, 2, 5);
    body.translate(x, y, z);
    parts.push(paint(head, k.skin), paint(body, tones[Math.floor(random() * tones.length)]));
  }
  return combine(parts, `lake-stand-v${v}`);
}

function flagGeometry(v: number) {
  const pole = new THREE.CylinderGeometry(0.03, 0.04, 2.1, 6);
  pole.translate(0, 1.05, 0);
  paint(pole, k.pole);
  const cloth = new THREE.PlaneGeometry(0.68, 0.44, 4, 2);
  const position = cloth.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    position.setZ(i, Math.sin(position.getX(i) * 4 + v) * 0.08 * (position.getX(i) + 0.34));
  }
  cloth.computeVertexNormals();
  cloth.translate(0.36, 1.82, 0);
  const back = cloth.clone();
  back.rotateY(Math.PI);
  back.translate(0.72, 0, 0);
  const tone = [k.gate, k.gateAlt, k.pickup][v];
  paint(cloth, tone);
  paint(back, tone);
  return combine([pole, cloth, back], `lake-flag-v${v}`);
}

function lampGeometry() {
  const post = new THREE.CylinderGeometry(0.07, 0.12, 4.1, 7);
  post.translate(0, 2.05, 0);
  paint(post, k.ink);
  const arm = new THREE.BoxGeometry(0.5, 0.08, 0.08);
  arm.translate(0.24, 4.06, 0);
  paint(arm, k.ink);
  const head = new THREE.SphereGeometry(0.17, 8, 6);
  head.scale(1.3, 0.65, 1);
  head.translate(0.46, 3.98, 0);
  paint(head, k.sunGlow);
  return combine([post, arm, head], 'lake-lamp');
}

function pontoonGeometry(v: number) {
  const parts: THREE.BufferGeometry[] = [];
  const deck = new THREE.BoxGeometry(4.4, 0.22, 2.4);
  deck.translate(0, 0.12, 0);
  parts.push(paint(deck, k.boardwalk));
  const tone = v === 0 ? k.gate : k.gateAlt;
  for (const x of [-1.7, 0, 1.7]) {
    const float = new THREE.CylinderGeometry(0.34, 0.3, 2.2, 8);
    float.rotateX(Math.PI / 2);
    float.translate(x, -0.14, 0);
    parts.push(paint(float, tone));
  }
  const gantry = new THREE.BoxGeometry(4.4, 0.14, 0.14);
  gantry.translate(0, 1.94, 0);
  parts.push(paint(gantry, k.pole));
  for (const x of [-2.1, 2.1]) {
    const upright = new THREE.BoxGeometry(0.11, 1.9, 0.11);
    upright.translate(x, 1.02, 0);
    parts.push(paint(upright, k.pole));
  }
  return combine(parts, `lake-pontoon-v${v}`);
}

/**
 * Ground origin, Y-up, one merged vertex-coloured mesh per kind/variant/detail.
 * Course chunks instance these, so every variant keeps the same nominal height.
 */
export function createPropGeometry(kind: PropKind, variant = 0, detail: SceneryDetail = 'near'): THREE.BufferGeometry {
  const v = variantOf(variant);
  const geometry: THREE.BufferGeometry = (() => {
    switch (kind) {
      case 'pine': return pineGeometry(v, detail);
      case 'canopy': return canopyGeometry(v, detail);
      case 'reed': return reedGeometry(v);
      case 'rock': return boulderGeometry(v, detail);
      case 'island': return islandGeometry(v, detail);
      case 'kayak': return kayakGeometry(v);
      case 'buoy': return buoyGeometry(v);
      case 'cone': return coneGeometry();
      case 'tent': return tentGeometry(v);
      case 'rack': return rackGeometry(v);
      case 'stand': return standGeometry(v);
      case 'flag': return flagGeometry(v);
      case 'lamp': return lampGeometry();
      case 'pontoon': return pontoonGeometry(v);
    }
  })();
  const height = geometry.boundingBox?.max.y ?? 1;
  const nominal = PROP_HEIGHTS[kind];
  if (height > 0.01 && Math.abs(height - nominal) > nominal * 0.12) {
    const scale = nominal / height;
    geometry.scale(scale, scale, scale);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  geometry.userData.kind = kind;
  return geometry;
}

export function createProp(kind: PropKind, variant = 0, detail: SceneryDetail = 'near',
  material = createSceneryMaterial()) {
  const mesh = new THREE.Mesh(createPropGeometry(kind, variant, detail), material);
  mesh.name = `${kind}-v${variantOf(variant)}-${detail}`;
  mesh.castShadow = detail === 'near';
  mesh.receiveShadow = detail === 'near';
  return mesh;
}
