import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config';
import { fbm, ridgedNoise, seeded, smoothstep } from './util';
import { glowTexture } from './textures';
import type { CourseColors } from './mapstyle';

/**
 * The palette the sky, ranges and clouds are baked from. A map build injects its own
 * colours before `createEnvironment` runs; the classic palette is the default.
 */
let c: CourseColors = CONFIG.colors;
const SUN_DIR = new THREE.Vector3(...CONFIG.lighting.sunDirection).normalize();
/**
 * The ranges sit on an ellipse rather than a circle: the course is ~1.5 km long but
 * the terrain apron only reaches 680 m sideways, so a round ring would either cut the
 * greenway or float over the basin.
 */
const CENTRE = { x: 0, z: -750 };
/**
 * Fitted around the terrain grid (x ±753 m, z +140…-1640 m) with room to spare, so the
 * ranges can never punch through the fairway at either end of the course.
 */
const INNER = { a: 1180, b: 1720 };
const OUTER = { a: 3400, b: 4200 };
const WALL = { a: 900, b: 1120, height: 250, exponent: 4 };
const SKY_RADIUS = 6400;

type Summit = { theta: number; t: number; height: number; spread: number; thickness: number };

const SUMMITS: Summit[] = Array.from({ length: 26 }, (_, i) => {
  const random = seeded(919 + i * 3571);
  const theta = (i + (random() - 0.5) * 0.55) / 26 * Math.PI * 2;
  return {
    theta,
    t: 0.16 + random() * 0.62,
    height: 78 + random() * 250,
    spread: 0.16 + random() * 0.3,
    thickness: 0.2 + random() * 0.34,
  };
});

const angularGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
};

/** Height of the ring at azimuth `theta` and radial position `t` (0 = inner edge). */
function ridgeHeight(theta: number, t: number) {
  // Sampling noise on the unit circle keeps the seam at theta 0/2PI continuous.
  const nx = Math.sin(theta) * 2.1;
  const nz = Math.cos(theta) * 2.1;
  let crest = 0;
  for (const summit of SUMMITS) {
    const along = angularGap(theta, summit.theta) * (INNER.a + (OUTER.a - INNER.a) * t) / summit.spread / 620;
    const across = (t - summit.t) / summit.thickness;
    const radius = Math.hypot(along, across);
    if (radius > 1) continue;
    crest = Math.max(crest, summit.height * Math.pow(1 - radius, 1.15));
  }
  const folds = (ridgedNoise(nx + t * 2.4, nz - t * 1.9, 4) - 0.45) * 90;
  const roll = (fbm(nx * 1.7 + 8.2, nz * 1.7 - 3.4, 3) - 0.45) * 70;
  const h = crest * (0.72 + 0.5 * smoothstep(0.1, 0.75, t)) + (folds + roll) * smoothstep(0.12, 0.6, t);
  // Sink the inner apron below the lake floor so the ring never shows a shelf.
  return h * smoothstep(0.05, 0.42, t) - 46 * (1 - smoothstep(0, 0.3, t));
}

const NEAR_GREEN = new THREE.Color(c.hill);
const PINE = new THREE.Color(c.pine);
const SHADE = new THREE.Color('#2c5c66');
const ROCK = new THREE.Color(c.rock);
const HAZE = new THREE.Color(c.fog);
const SKY = new THREE.Color(c.skyMid);
const WARM = new THREE.Color(c.sunGlow);

/** Recolour the distant ranges, haze and clouds for the active map. */
export function setEnvironmentColors(colors: CourseColors) {
  c = colors;
  NEAR_GREEN.set(c.hill);
  PINE.set(c.pine);
  ROCK.set(c.rock);
  HAZE.set(c.fog);
  SKY.set(c.skyMid);
  WARM.set(c.sunGlow);
}

/** Local-origin hill ring in metres; position at CENTRE when added to the course. */
export function createHillRingModel(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const angular = 200;
  const radial = 44;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const point = (theta: number, t: number, out: THREE.Vector3) => {
    const a = INNER.a + (OUTER.a - INNER.a) * t;
    const b = INNER.b + (OUTER.b - INNER.b) * t;
    return out.set(Math.sin(theta) * a, ridgeHeight(theta, t), -Math.cos(theta) * b);
  };
  const pa = new THREE.Vector3();
  const alongTheta = new THREE.Vector3();
  const alongRadius = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const tone = new THREE.Color();
  const dTheta = 0.004;
  const dT = 0.008;
  for (let j = 0; j <= radial; j++) {
    const t = Math.pow(j / radial, 1.35);
    for (let i = 0; i <= angular; i++) {
      // Identical seam samples give both the vertex colors and normals a clean join.
      const theta = (i % angular) / angular * Math.PI * 2;
      const vertex = point(theta, t, pa);
      positions.push(vertex.x, vertex.y, vertex.z);
      point(theta + dTheta, t, alongTheta).sub(point(theta - dTheta, t, scratch));
      point(theta, Math.min(1, t + dT), alongRadius).sub(point(theta, Math.max(0, t - dT), scratch));
      normal.crossVectors(alongRadius, alongTheta);
      if (normal.y < 0) normal.negate();
      normal.normalize();
      normals.push(normal.x, normal.y, normal.z);
      const light = smoothstep(-0.15, 0.8, normal.dot(SUN_DIR));
      const height = smoothstep(0, 210, vertex.y);
      tone.copy(PINE).lerp(NEAR_GREEN, 0.2 + height * 0.5);
      tone.lerp(SHADE, (1 - light) * 0.55);
      tone.lerp(ROCK, smoothstep(120, 300, vertex.y) * (0.2 + light * 0.25));
      tone.lerp(WARM, light * 0.1);
      // Distance haze does the work three fog would do at this scale.
      tone.lerp(HAZE, smoothstep(0.06, 0.42, t) * 0.55);
      tone.lerp(SKY, smoothstep(0.45, 1, t) * 0.4);
      colors.push(tone.r, tone.g, tone.b);
    }
  }
  for (let j = 0; j < radial; j++) for (let i = 0; i < angular; i++) {
    const a = j * (angular + 1) + i;
    const b = a + 1;
    const d = a + angular + 1;
    const e = d + 1;
    indices.push(a, b, d, b, e, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false });
  material.name = 'hill-ring-baked';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'hill-ring';
  mesh.renderOrder = -6;
  return mesh;
}

/**
 * Vertical gradient band that fuses the far shore into the haze. It follows a
 * superellipse rather than a circle so it stays outside the 1.5 km fairway everywhere.
 */
function hazeWall() {
  const steps = 84;
  const rows = 6;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const tone = new THREE.Color();
  const skyTint = new THREE.Color(c.skyBottom);
  const power = 2 / WALL.exponent;
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    for (let i = 0; i <= steps; i++) {
      const theta = (i % steps) / steps * Math.PI * 2;
      const s = Math.sin(theta);
      const z = Math.cos(theta);
      const wobble = 1 + 0.05 * Math.sin(theta * 3.1) + 0.03 * Math.sin(theta * 7.3 + 1.4);
      positions.push(WALL.a * Math.sign(s) * Math.abs(s) ** power * wobble,
        WALL.height * Math.pow(v, 1.5) - 16,
        -WALL.b * Math.sign(z) * Math.abs(z) ** power * wobble);
      const alpha = (1 - v) * (1 - v) * (0.92 - 0.24 * v);
      tone.copy(HAZE).lerp(skyTint, v * 0.55);
      colors.push(tone.r, tone.g, tone.b, alpha);
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < steps; i++) {
    const a = j * (steps + 1) + i;
    indices.push(a, a + 1, a + steps + 1, a + 1, a + steps + 2, a + steps + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  const wall = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
  }));
  wall.name = 'lake-haze';
  wall.renderOrder = -4;
  wall.frustumCulled = false;
  return wall;
}

function skyDome() {
  const geometry = new THREE.SphereGeometry(SKY_RADIUS, 44, 26);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      top: { value: new THREE.Color(c.skyTop) },
      mid: { value: new THREE.Color(c.skyMid) },
      bottom: { value: new THREE.Color(c.skyBottom) },
      sunColor: { value: new THREE.Color(c.sunGlow) },
      sunDir: { value: SUN_DIR.clone() },
    },
    vertexShader: `
      varying vec3 vPosition;
      void main() { vPosition = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform vec3 sunColor; uniform vec3 sunDir;
      varying vec3 vPosition;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 dir = normalize(vPosition);
        float h = dir.y;
        vec3 color = mix(bottom, mid, smoothstep(-0.16, -0.01, h));
        color = mix(color, top, smoothstep(-0.01, 0.34, h));
        // Humid lake air: a pale band that hugs the horizon on every bearing.
        color = mix(color, bottom, (1.0 - smoothstep(0.0, 0.12, h)) * 0.5);
        float sun = max(dot(dir, sunDir), 0.0);
        float sideLight = pow(max(dot(normalize(dir.xz), normalize(sunDir.xz)), 0.0), 3.2)
          * (1.0 - smoothstep(-0.05, 0.6, h));
        color = mix(color, sunColor, sideLight * 0.4 + pow(sun, 42.0) * 0.16);
        color += (hash(gl_FragCoord.xy) - 0.5) * 0.0035;
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const sky = new THREE.Mesh(geometry, material);
  sky.renderOrder = -20;
  sky.frustumCulled = false;
  return sky;
}

/** A centered, closed cloud mesh, roughly 6 × 3 × 3 local units. No DOM or textures. */
export function createCloudModel(seed = 1, resolution = 34): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const random = seeded((seed * 2654435761) >>> 0);
  const phase = random() * Math.PI * 2;
  const lobes: { x: number; y: number; z: number; ix: number; iy: number; iz: number; r: number }[] = [];
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const addLobe = (x: number, y: number, z: number, rx: number, ry: number, rz: number) => {
    lobes.push({ x, y, z, ix: 1 / rx, iy: 1 / ry, iz: 1 / rz, r: Math.min(rx, ry, rz) });
    min.min(new THREE.Vector3(x - rx, y - ry, z - rz));
    max.max(new THREE.Vector3(x + rx, y + ry, z + rz));
  };
  addLobe(0, -0.38, 0, 2.35, 0.65, 1.04);
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.96 + (random() - 0.5) * 0.24;
    const y = 0.2 + random() * 0.35 + (1 - Math.abs(i - 1.4) / 3) * 0.3;
    const z = (random() - 0.5) * 0.46;
    const ry = 0.72 + random() * 0.48 + (i === 1 ? 0.2 : 0);
    addLobe(x, y, z, 0.85 + random() * 0.3, ry, 0.8 + random() * 0.25);
    for (const side of [-1, 1]) {
      const r = 0.46 + random() * 0.24;
      addLobe(x + (random() - 0.5) * 0.85, y + (random() - 0.25) * ry * 0.7,
        z + side * (0.76 + random() * 0.2), r * 1.1, r, r * 0.92);
    }
  }
  for (const x of [-0.95, 0.75]) {
    addLobe(x + (random() - 0.5) * 0.4, 1.15 + random() * 0.45, -0.05,
      0.7 + random() * 0.22, 0.72 + random() * 0.18, 0.72 + random() * 0.16);
  }

  const distance = (x: number, y: number, z: number) => {
    const wx = x + 0.12 * Math.sin(y * 1.75 + phase) * Math.sin(z * 1.9 + phase);
    const wy = y + 0.1 * Math.sin(x * 1.6 - phase) * Math.cos(z * 2.1 + phase);
    const wz = z + 0.11 * Math.sin(x * 1.8 + y * 0.9 + phase);
    let field = 100;
    for (const lobe of lobes) {
      const dx = (wx - lobe.x) * lobe.ix;
      const dy = (wy - lobe.y) * lobe.iy;
      const dz = (wz - lobe.z) * lobe.iz;
      const d = (Math.sqrt(dx * dx + dy * dy + dz * dz) - 1) * lobe.r;
      const blend = Math.max(0, 1 - Math.abs(field - d) / 0.32);
      field = Math.min(field, d) - blend * blend * 0.08;
    }
    return field + 0.038 * Math.sin(wx * 6 + phase) * Math.sin(wy * 5 + wz * 2)
      * Math.sin(wz * 6 - wx * 2) + 0.018 * Math.sin(wx * 9 - wy * 7 + phase);
  };

  min.addScalar(-0.7);
  max.addScalar(0.7);
  const size = max.clone().sub(min);
  const center = min.clone().add(max).multiplyScalar(0.5);
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false });
  material.name = 'cloud-baked-warm-blue';
  // Only used as a CPU isosurface builder; no animated MarchingCubes object survives.
  const surface = new MarchingCubes(resolution, material, false, false, 12000);
  surface.isolation = 0;
  const res = surface.resolution;
  for (let z = 0; z < res; z++) for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    surface.field[x + y * res + z * res * res] = -distance(
      min.x + x / res * size.x,
      min.y + y / res * size.y,
      min.z + z / res * size.z,
    );
  }
  surface.update();
  const raw = new THREE.BufferGeometry();
  raw.setAttribute('position', new THREE.BufferAttribute(surface.positionArray.slice(0, surface.count * 3), 3));
  raw.setAttribute('normal', new THREE.BufferAttribute(surface.normalArray.slice(0, surface.count * 3), 3));
  surface.geometry.dispose();
  raw.scale(size.x / 2, size.y / 2, size.z / 2);
  raw.translate(center.x, center.y, center.z);
  const geometry = mergeVertices(raw, 0.0001);
  raw.dispose();
  geometry.computeBoundingBox();

  const bounds = geometry.boundingBox!;
  const position = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const colors = new Float32Array(position.count * 3);
  const white = new THREE.Color(c.cloud);
  const warm = new THREE.Color(c.sunGlow);
  const blue = new THREE.Color(c.cloudShade);
  const haze = new THREE.Color(c.fog);
  const vector = new THREE.Vector3();
  const tone = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    vector.fromBufferAttribute(normals, i).normalize();
    const crown = smoothstep(bounds.min.y, bounds.max.y, y);
    // A short baked sun probe gives the billow creases gentle self-occlusion.
    const cover = smoothstep(0, 0.22, -distance(x + SUN_DIR.x * 0.6, y + SUN_DIR.y * 0.6, z + SUN_DIR.z * 0.6));
    const light = smoothstep(-0.55, 0.88, vector.dot(SUN_DIR)) * (1 - cover * 0.45);
    tone.copy(blue).lerp(white, 0.2 + crown * 0.16 + light * 0.62);
    tone.lerp(warm, light * (0.5 + crown * 0.5) * 0.16);
    tone.lerp(haze, 0.05 + (1 - crown) * 0.1);
    colors.set([tone.r, tone.g, tone.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.center();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `cumulus-volume-${seed}`;
  return mesh;
}

export function createEnvironment(scene: THREE.Scene, mobile = false) {
  const sky = skyDome();
  const hills = createHillRingModel();
  hills.position.set(CENTRE.x, 0, CENTRE.z);
  const wall = hazeWall();
  wall.position.set(CENTRE.x, 0, CENTRE.z);
  scene.add(sky, hills, wall);

  const cloudModels = [3.7, 9.1, 19.7].map(seed => createCloudModel(seed, mobile ? 26 : 34));
  const random = seeded(2281);
  const banks: { x: number; z: number; top: number; scale: number; model: number }[] = [];
  for (let i = 0; i < (mobile ? 9 : 16); i++) {
    // Hugging the ring keeps the clouds reading as weather over the ranges, not props.
    const theta = (i / 16) * Math.PI * 2 + random() * 0.4;
    const t = 0.34 + random() * 0.5;
    const a = INNER.a + (OUTER.a - INNER.a) * t;
    const b = INNER.b + (OUTER.b - INNER.b) * t;
    const scale = 90 + random() * 120;
    banks.push({
      x: Math.sin(theta) * a,
      z: -Math.cos(theta) * b,
      top: 240 + random() * 260,
      scale,
      model: i % cloudModels.length,
    });
  }
  banks.forEach((bank, index) => {
    const cloud = cloudModels[bank.model].clone();
    cloud.name = `cumulus-bank-${index + 1}`;
    // The billows carry baked vertex colors, so they only ever need placement and scale.
    cloud.scale.set(bank.scale, bank.scale * 0.72, bank.scale);
    cloud.position.set(bank.x + CENTRE.x, bank.top, bank.z + CENTRE.z);
    scene.add(cloud);
  });

  const sun = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: c.sunGlow, transparent: true, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending, opacity: 0.3, toneMapped: false,
  }));
  sun.scale.set(1100, 1100, 1);
  sun.renderOrder = -8;
  scene.add(sun);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(70, 40),
    new THREE.MeshBasicMaterial({
      color: c.sunGlow, fog: false, depthWrite: false, transparent: true, opacity: 0.85, toneMapped: false,
    }),
  );
  disc.renderOrder = -9;
  scene.add(disc);

  const direction = SUN_DIR.clone();
  return {
    sky,
    hills,
    sun,
    disc,
    direction,
    update(x: number, y: number, z: number) {
      sky.position.set(x, y, z);
      sun.position.set(x + direction.x * 5200, y + direction.y * 5200, z + direction.z * 5200);
      disc.position.copy(sun.position);
      disc.lookAt(x, y, z);
      // The ranges, the haze wall and the cloud banks stay put as the race moves on.
    },
  };
}
