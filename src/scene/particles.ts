import * as THREE from 'three';
import { CONFIG, SWIM_END, WATER_LEVEL, halfWidthAt, isFoldedTrack, lakeDir, surfaceHeight, uAt, xAt, zAt } from '../config';
import type { RunState } from '../game/rules';
import { seeded } from './util';

const FOAM = new THREE.Color(CONFIG.colors.waterFoam);
const DUST = new THREE.Color('#d8c39a');
const DEBRIS = new THREE.Color(CONFIG.colors.gate);
/** 26 samples at the 0.6 m stride reads as a foam streak, not a road laid on the lake. */
const WAKE_SAMPLES = 26;
type Vec3 = { x: number; y: number; z: number };

const overWater = (s: number, u: number) => surfaceHeight(s, u) <= WATER_LEVEL - 0.05;

function pointMaterial(size: number, opacity: number, additive = false) {
  const material = new THREE.PointsMaterial({
    color: '#ffffff', size, transparent: true, opacity, depthWrite: false,
    sizeAttenuation: true, vertexColors: true, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      diffuseColor.a *= 1.0 - smoothstep(0.12, 0.5, length(gl_PointCoord - vec2(0.5)));
      #include <opaque_fragment>
    `);
  };
  return material;
}

/**
 * Everything wet or loose the athlete throws up: stroke splashes, the foam wake behind
 * the swim, wheel spray, track dust and the debris of a crash.
 */
export class RaceParticles {
  private spray: THREE.Points;
  private positions: Float32Array;
  private velocities: Float32Array;
  private tints: Float32Array;
  private colors: Float32Array;
  private lives: Float32Array;
  private maxLives: Float32Array;
  private glints: THREE.Points;
  private glintPositions: Float32Array;
  private glintColors: Float32Array;
  private glintSeeds: Float32Array;
  private glintTimer = 0;
  private wake: THREE.Mesh;
  private wakeGeometry: THREE.BufferGeometry;
  private wakeTrail: Vec3[] = [];
  private wakeStride: Vec3[] = [];
  private random = seeded(885);
  private cursor = 0;
  private budget = 0;
  private eventCursor = 0;
  private strokeLatch = 0;
  private stepLatch = 0;
  private time = 0;

  constructor(scene: THREE.Scene, mobile: boolean) {
    const quality = mobile ? CONFIG.quality.mobile : CONFIG.quality.desktop;
    const count = quality.spray * 3;
    this.positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    this.tints = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 4);
    this.lives = new Float32Array(count);
    this.maxLives = new Float32Array(count);
    const geometry = new THREE.BufferGeometry();
    // A vec4 color attribute gives every particle its own alpha without a second shader.
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4));
    this.spray = new THREE.Points(geometry, pointMaterial(0.17, 0.9));
    this.spray.frustumCulled = false;
    this.spray.renderOrder = 3;
    scene.add(this.spray);

    // Sunlit chop scattered over the lake: the glint that sells open water.
    const glintCount = mobile ? 70 : 150;
    this.glintSeeds = new Float32Array(glintCount * 3);
    for (let i = 0; i < this.glintSeeds.length; i++) this.glintSeeds[i] = this.random();
    this.glintPositions = new Float32Array(glintCount * 3).fill(-10000);
    this.glintColors = new Float32Array(glintCount * 3);
    const glintGeometry = new THREE.BufferGeometry();
    glintGeometry.setAttribute('position', new THREE.BufferAttribute(this.glintPositions, 3));
    glintGeometry.setAttribute('color', new THREE.BufferAttribute(this.glintColors, 3));
    this.glints = new THREE.Points(glintGeometry, pointMaterial(0.34, 0.75, true));
    this.glints.frustumCulled = false;
    this.glints.renderOrder = 3;
    scene.add(this.glints);

    this.wakeGeometry = new THREE.BufferGeometry();
    // Parked far outside the world until the first stroke fills it: a zeroed buffer
    // would otherwise leave an empty mesh with a bounding box at the origin.
    this.wakeGeometry.setAttribute('position',
      new THREE.BufferAttribute(new Float32Array(WAKE_SAMPLES * 2 * 3).fill(-10000), 3));
    this.wakeGeometry.setAttribute('color',
      new THREE.BufferAttribute(new Float32Array(WAKE_SAMPLES * 2 * 4), 4));
    const indices: number[] = [];
    for (let i = 0; i < WAKE_SAMPLES - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.wakeGeometry.setIndex(indices);
    this.wake = new THREE.Mesh(this.wakeGeometry, new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide,
      vertexColors: true, fog: false,
    }));
    this.wake.frustumCulled = false;
    this.wake.renderOrder = 3;
    this.wake.visible = false;
    scene.add(this.wake);
    this.reset();
  }

  reset() {
    this.positions.fill(-10000);
    this.velocities.fill(0);
    this.lives.fill(0);
    this.colors.fill(0);
    this.cursor = 0;
    this.budget = 0;
    this.time = 0;
    this.strokeLatch = 0;
    this.stepLatch = 0;
    this.eventCursor = 0;
    this.glintTimer = 0;
    this.glintPositions.fill(-10000);
    (this.glints.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.wakeTrail.length = 0;
    this.wakeStride.length = 0;
    this.wake.visible = false;
    this.wakeGeometry.setDrawRange(0, 0);
  }

  private emit(x: number, y: number, z: number, velocity: Vec3, colour: THREE.Color, life: number) {
    const i = this.cursor++ % this.lives.length;
    const j = i * 3;
    this.positions[j] = x;
    this.positions[j + 1] = y;
    this.positions[j + 2] = z;
    this.velocities[j] = velocity.x;
    this.velocities[j + 1] = velocity.y;
    this.velocities[j + 2] = velocity.z;
    colour.toArray(this.tints, j);
    this.colors[i * 4] = colour.r;
    this.colors[i * 4 + 1] = colour.g;
    this.colors[i * 4 + 2] = colour.b;
    this.colors[i * 4 + 3] = 1;
    this.lives[i] = life;
    this.maxLives[i] = life;
  }

  /** A ring of droplets kicked up around the athlete. */
  private burst(state: RunState, count: number, power: number, colour: THREE.Color, upward = 1) {
    for (let n = 0; n < count; n++) {
      const angle = this.random() * Math.PI * 2;
      const spread = (0.4 + this.random()) * power;
      this.emit(
        state.x + Math.cos(angle) * 0.34, state.y + 0.12 + this.random() * 0.18, state.z + Math.sin(angle) * 0.34,
        {
          x: Math.cos(angle) * spread * 0.8 - state.vx * 0.22,
          y: (0.7 + this.random() * 1.5) * power * upward,
          z: Math.sin(angle) * spread * 0.5 + 0.7,
        },
        colour, 0.4 + this.random() * 0.5,
      );
    }
  }

  private dust(state: RunState, count: number) {
    for (let n = 0; n < count; n++) {
      const side = this.random() < 0.5 ? -1 : 1;
      this.emit(
        state.x + side * (0.12 + this.random() * 0.22), state.y + 0.06, state.z + 0.12,
        {
          x: side * (0.25 + this.random() * 0.6) - state.vx * 0.18,
          y: 0.4 + this.random() * 1.1,
          z: 1.1 + this.random() * 2.2,
        },
        DUST, 0.5 + this.random() * 0.55,
      );
    }
  }

  private updateGlints(state: RunState) {
    const positions = this.glints.geometry.attributes.position as THREE.BufferAttribute;
    const colors = this.glints.geometry.attributes.color as THREE.BufferAttribute;
    const swimming = state.discipline === 'swim';
    const side = -Math.sign(lakeDir(state.s)) || 1;
    const u = state.u;
    const folded = isFoldedTrack();
    for (let i = 0; i < this.glintSeeds.length / 3; i++) {
      const a = this.glintSeeds[i * 3];
      const b = this.glintSeeds[i * 3 + 1];
      const offset = this.glintSeeds[i * 3 + 2];
      const s = Math.min(CONFIG.course.length + 40, Math.max(0, state.s + 6 + offset * 110));
      const lane = folded
        ? (a - 0.5) * 38
        : swimming
          ? u * 0.4 + (a - 0.5) * 20
          : side * (halfWidthAt(s) + 6 + a * (a < 0.5 ? 60 : 200));
      const glintS = folded ? Math.min(SWIM_END - 6, Math.max(2, (a + offset) * 0.5 * SWIM_END)) : s;
      const x = xAt(glintS, lane);
      if (!overWater(glintS, lane)) { positions.setXYZ(i, 0, -10000, 0); continue; }
      positions.setXYZ(i, x, WATER_LEVEL + 0.07, zAt(glintS, lane));
      const twinkle = Math.pow(Math.max(0, Math.sin(this.time * (1.4 + b * 1.8) + a * 42)), 8);
      const light = 0.04 + twinkle * 0.9;
      colors.setXYZ(i, light, light * 0.98, light * 0.92);
    }
    positions.needsUpdate = true;
    colors.needsUpdate = true;
  }

  /** The foam ribbon left in the swim: a ring buffer along the recent racing line. */
  private updateWake(state: RunState, dt: number) {
    const swimming = state.discipline === 'swim' && state.phase !== 'results' && state.s < SWIM_END;
    this.wake.visible = swimming;
    if (!swimming) {
      this.wakeTrail.length = 0;
      this.wakeStride.length = 0;
      this.wakeGeometry.setDrawRange(0, 0);
      return;
    }
    const point = { x: state.x, y: state.y, z: state.z };
    const last = this.wakeStride[0];
    if (!last || Math.hypot(point.x - last.x, point.z - last.z) > 0.6) {
      this.wakeStride.unshift(point);
      if (this.wakeStride.length > WAKE_SAMPLES) this.wakeStride.length = WAKE_SAMPLES;
    }
    // Hold the newest sample so the head of the wake tracks the athlete between strides.
    this.wakeTrail[0] = point;
    for (let i = 1; i < this.wakeStride.length; i++) this.wakeTrail[i] = this.wakeStride[i - 1];
    if (!this.wakeTrail.length) return;
    const positions = this.wakeGeometry.attributes.position as THREE.BufferAttribute;
    const colors = this.wakeGeometry.attributes.color as THREE.BufferAttribute;
    // The buffer fills from the head, so the tail repeats the oldest sample until it has one.
    const filled = Math.max(0, this.wakeTrail.length - 1);
    for (let i = 0; i < WAKE_SAMPLES; i++) {
      const k = Math.min(i, filled);
      const sample = this.wakeTrail[k];
      const ahead = this.wakeTrail[Math.max(0, k - 1)];
      const dx = ahead.x - sample.x;
      const dz = ahead.z - sample.z;
      const length = Math.hypot(dx, dz) || 1;
      const nx = -dz / length;
      const nz = dx / length;
      // V-shaped wake: it fans out and drops in opacity with age.
      const age = k / WAKE_SAMPLES;
      const flare = 0.42 + age * 1.5;
      const y = WATER_LEVEL + 0.06;
      positions.setXYZ(i * 2, sample.x - nx * flare, y, sample.z - nz * flare);
      positions.setXYZ(i * 2 + 1, sample.x + nx * flare, y, sample.z + nz * flare);
      const alpha = (1 - age) ** 2;
      colors.setXYZW(i * 2, FOAM.r, FOAM.g, FOAM.b, alpha);
      colors.setXYZW(i * 2 + 1, FOAM.r, FOAM.g, FOAM.b, alpha);
    }
    positions.needsUpdate = true;
    colors.needsUpdate = true;
    // Only the segments between real samples are drawn: the empty tail of the ring
    // buffer must never be rasterised.
    this.wakeGeometry.setDrawRange(0, filled * 6);
    const material = this.wake.material as THREE.MeshBasicMaterial;
    material.opacity = THREE.MathUtils.lerp(material.opacity, 0.42 + state.effort * 0.2, 1 - Math.exp(-4 * dt));
  }

  update(state: RunState, dt: number, reduced: boolean) {
    if (state.phase === 'paused') return;
    this.time += dt;
    const scale = reduced ? 0.4 : 1;
    const inWater = state.discipline === 'swim' && state.s > 1 && state.s < SWIM_END - 5;

    if (inWater) {
      // One splash per hand entry: the stroke phase, not a timer, drives it.
      const stroke = Math.floor(state.strokePhase / Math.PI);
      if (stroke !== this.strokeLatch) {
        this.strokeLatch = stroke;
        this.burst(state, Math.round((state.effort > 1.05 ? 9 : 5) * scale), 0.8 * state.effort, FOAM);
      }
      this.budget += dt * 14 * scale * state.effort;
    } else if (state.discipline === 'run' || state.discipline === 't2') {
      const step = Math.floor(state.strokePhase / Math.PI);
      if (step !== this.stepLatch) {
        this.stepLatch = step;
        if (state.phase === 'running' && state.airborne === false) this.dust(state, Math.round(3 * scale));
      }
      this.budget += dt * (state.braking ? 12 : 2) * scale;
    } else if (state.discipline === 'bike') {
      this.budget += dt * (2 + state.speed * 0.55 + (state.braking ? 24 : 0)) * scale;
    } else {
      this.budget += dt * 3 * scale;
    }

    if (state.events.length < this.eventCursor) this.eventCursor = 0;
    for (const event of state.events.slice(this.eventCursor)) {
      if (event.kind === 'crash' || event.kind === 'contact' || event.kind === 'bonk') {
        this.burst(state, Math.round(24 * scale), 1.7, DEBRIS, 1.4);
        this.burst(state, Math.round(14 * scale), 1.1, DUST, 1.2);
      } else if (event.kind === 'land') {
        this.burst(state, Math.round(9 * scale), 0.9, DUST);
      } else if (event.kind === 'splash' || event.kind === 'boundary') {
        this.burst(state, Math.round(8 * scale), 0.85, FOAM);
      } else if (event.kind === 'gate' || event.kind === 'aid' || event.kind === 'pickup' || event.kind === 'burst') {
        this.burst(state, Math.round(6 * scale), 0.7, FOAM, 1.3);
      } else if (event.kind === 'finish') {
        this.burst(state, Math.round(36 * scale), 1.5, DEBRIS, 1.6);
        this.burst(state, Math.round(22 * scale), 1.2, FOAM, 1.9);
      }
    }
    this.eventCursor = state.events.length;

    const count = Math.floor(this.budget);
    this.budget -= count;
    if (count > 0) {
      if (inWater) this.burst(state, count, 0.5 + state.speed * 0.05, FOAM);
      else if (state.discipline === 'bike') this.dust(state, count);
      else this.dust(state, Math.min(count, 3));
    }

    this.glintTimer += dt;
    if (this.glintTimer > 0.06) {
      this.glintTimer = 0;
      this.updateGlints(state);
    }
    this.updateWake(state, dt);

    for (let i = 0; i < this.lives.length; i++) {
      if (this.lives[i] <= 0) continue;
      this.lives[i] -= dt;
      const j = i * 3;
      const k = i * 4;
      if (this.lives[i] <= 0) {
        this.positions[j + 1] = -10000;
        this.colors[k + 3] = 0;
        continue;
      }
      this.velocities[j + 1] -= 5.6 * dt;
      this.positions[j] += this.velocities[j] * dt;
      this.positions[j + 1] += this.velocities[j + 1] * dt;
      this.positions[j + 2] += this.velocities[j + 2] * dt;
      const age = this.lives[i] / this.maxLives[i];
      this.colors[k] = this.tints[j];
      this.colors[k + 1] = this.tints[j + 1];
      this.colors[k + 2] = this.tints[j + 2];
      this.colors[k + 3] = age * age;
    }
    this.spray.geometry.attributes.position.needsUpdate = true;
    this.spray.geometry.attributes.color.needsUpdate = true;
  }

  diagnostics() {
    return {
      pool: this.lives.length,
      active: [...this.lives].filter(life => life > 0).length,
      glints: this.glintSeeds.length / 3,
      wake: this.wakeStride.length,
    };
  }
}
