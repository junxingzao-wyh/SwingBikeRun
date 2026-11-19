import * as THREE from 'three';
import {
  CONFIG, FINISH_S, WATER_LEVEL, courseYaw, disciplineAt, headingAt, surfaceHeight, uAtWorld, xAt, zAt,
} from '../config';
import type { DisciplineId } from '../config';
import type { Simulation } from '../game/simulation';
import { createAthlete } from './athlete';
import { createCourse } from './course';
import { createEnvironment, setEnvironmentColors } from './environment';
import { MAP_STYLES, loadMapStyle, type MapStyleId } from './mapstyle';
import { RaceParticles } from './particles';

const WHEEL_R = 0.33;
/** Seconds the rig takes to dolly back and settle after a discipline change. */
const TRANSITION_SECONDS = 1.5;
const COVER_FOV = 46;
const RESULT_FOV = 52;
/** Mutable copy of one `CONFIG.camera` entry, eased between disciplines. */
type CameraRig = {
  distance: number; height: number; lookAhead: number; fov: number; speedFov: number; follow: number;
};
const wrapLerp = (a: number, b: number, t: number) => {
  let difference = b - a;
  while (difference > Math.PI) difference -= Math.PI * 2;
  while (difference < -Math.PI) difference += Math.PI * 2;
  return a + difference * t;
};

/** How high above the surface the chase camera looks, per discipline. */
const EYE: Record<DisciplineId, number> = { swim: 0.42, t1: 1.05, bike: 0.95, t2: 1.05, run: 1.1 };

export class RaceScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(CONFIG.camera.bike.fov, 1, 0.1, 7600);
  readonly mobile: boolean;
  reducedMotion = false;
  // Inspection camera for `scripts/capture-scenes.mjs`, in world space; null hands the
  // camera back to the chase rig.
  inspectView: {
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
  } | null = null;
  private athlete = createAthlete();
  private course: ReturnType<typeof createCourse>;
  private mapStyle: MapStyleId = loadMapStyle();
  private environment: ReturnType<typeof createEnvironment>;
  private particles: RaceParticles;
  private sun = new THREE.DirectionalLight(CONFIG.lighting.moods.swim.sun, CONFIG.lighting.moods.swim.sunIntensity);
  private fill = new THREE.DirectionalLight(CONFIG.lighting.skyColor, 0.3);
  private hemi: THREE.HemisphereLight;
  private fog: THREE.Fog;
  private gradeTint = new THREE.Color();
  private sunDirection = new THREE.Vector3(...CONFIG.lighting.sunDirection).normalize();
  private reflection: THREE.WebGLRenderTarget;
  private camPosition = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private look = new THREE.Vector3();
  private tangent = new THREE.Vector3();
  private body = new THREE.Vector3();
  private heading = 0;
  private roll = 0;
  private elapsed = 0;
  private shake = 0;
  /** Eased copy of the per-discipline chase rig, so a changeover reads as a dolly. */
  private rig: CameraRig = { ...CONFIG.camera.swim };
  private transition = 0;
  private eventCursor = 0;
  private discipline: DisciplineId = 'swim';
  private observer: ResizeObserver;
  private disposed = false;
  private frame = { speed: 0, discipline: 'swim' as DisciplineId, airborne: false, fov: 52 };

  constructor(private host: HTMLElement, onError: (message: string) => void) {
    this.mobile = matchMedia('(pointer: coarse)').matches || innerWidth < 760;
    const quality = this.mobile ? CONFIG.quality.mobile : CONFIG.quality.desktop;
    const style = MAP_STYLES[this.mapStyle];
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch {
      throw new Error(CONFIG.text.webglError);
    }
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, quality.dpr));
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = CONFIG.lighting.moods.swim.exposure;
    this.renderer.domElement.setAttribute('aria-label',
      this.mapStyle === 'canyon' ? '赤岩峡谷折返铁三三维赛道' : '千岛湖湖线铁三三维赛道');
    this.host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(style.colors.skyBottom);
    // Fog only has to cover the near shore; the ranges carry their own baked haze.
    this.fog = new THREE.Fog(CONFIG.lighting.moods.swim.fog, 90, 1250);
    this.scene.fog = this.fog;
    this.hemi = new THREE.HemisphereLight(
      CONFIG.lighting.moods.swim.sky, CONFIG.lighting.moods.swim.bounce,
      CONFIG.lighting.moods.swim.ambient,
    );
    this.scene.add(this.hemi);
    this.scene.add(this.fill);
    this.fill.position.set(60, 40, -60);
    this.scene.add(this.fill.target);
    this.sun.castShadow = quality.shadows;
    this.sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    Object.assign(this.sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -30, near: 1, far: 220 });
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target);

    this.course = createCourse(this.scene, this.mobile, this.mapStyle);
    // The sky, the distant ranges and the clouds are baked from the map palette, so
    // the build hands it over before the environment is constructed.
    setEnvironmentColors(style.colors);
    this.environment = createEnvironment(this.scene, this.mobile);
    const skyEnvironment = new THREE.Scene();
    skyEnvironment.add(this.environment.sky.clone());
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.reflection = pmrem.fromScene(skyEnvironment, 0.08, 1, 7600);
    this.scene.environment = this.reflection.texture;
    // The lake throws a lot of upward light onto the wetsuit and the carbon frame.
    this.scene.environmentIntensity = 0.34;
    pmrem.dispose();
    this.particles = new RaceParticles(this.scene, this.mobile);
    this.scene.add(this.athlete.group);

    const lost = (event: Event) => { event.preventDefault(); onError(CONFIG.text.contextLost); };
    this.renderer.domElement.addEventListener('webglcontextlost', lost);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }

  private resize() {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  reset(sim: Simulation) {
    const state = sim.state;
    this.particles.reset();
    this.shake = 0;
    this.elapsed = 0;
    this.roll = 0;
    this.eventCursor = state.events.length;
    this.discipline = state.discipline;
    this.athlete.mode(state.discipline);
    this.gradeLighting(1, true);
    // courseYaw is the yaw of the racing line (the same value the trackside boards
    // use); the athlete's own forward axis is -Z, so this points the model down the
    // route on every leg, including the folded canyon's southbound return.
    this.heading = courseYaw(state.s) - Math.atan2(state.vx, Math.max(1, state.speed));
    this.body.set(state.x, state.y, state.z);
    this.rig = { ...CONFIG.camera[state.discipline] };
    this.transition = 0;
    this.heroView();
    this.camPosition.copy(this.desired);
    this.look.copy(this.camLook);
    this.camera.position.copy(this.camPosition);
    this.camera.lookAt(this.look);
    this.camera.fov = COVER_FOV;
    this.camera.updateProjectionMatrix();
    this.athlete.group.position.set(state.x, state.y, state.z);
  }

  private pathTangent(s: number) {
    const h = headingAt(s);
    return this.tangent.set(Math.sin(h), 0, -Math.cos(h));
  }

  /**
   * Each discipline has its own grade: cool open water, warm ridge, golden greenway.
   * Blending instead of snapping means a split reads as the light changing, not a cut.
   */
  private gradeLighting(dt: number, snap = false) {
    const mood = CONFIG.lighting.moods[this.discipline];
    const blend = snap ? 1 : 1 - Math.exp(-0.85 * dt);
    const tint = this.gradeTint;
    this.sun.color.lerp(tint.set(mood.sun), blend);
    this.sun.intensity += (mood.sunIntensity - this.sun.intensity) * blend;
    this.hemi.color.lerp(tint.set(mood.sky), blend);
    this.hemi.groundColor.lerp(tint.set(mood.bounce), blend);
    this.hemi.intensity += (mood.ambient - this.hemi.intensity) * blend;
    this.renderer.toneMappingExposure += (mood.exposure - this.renderer.toneMappingExposure) * blend;
    this.fog.color.lerp(tint.set(mood.fog), blend);
  }

  /** The chase camera follows the racing line, not world north: bends read as bends. */
  render(sim: Simulation, dt: number) {
    if (this.disposed) return;
    const state = sim.state;
    const profile = CONFIG.camera[state.discipline];
    this.elapsed += dt;
    const x = THREE.MathUtils.lerp(sim.prev.x, state.x, sim.alpha);
    const y = THREE.MathUtils.lerp(sim.prev.y, state.y, sim.alpha);
    const travelled = THREE.MathUtils.lerp(sim.prev.s, state.s, sim.alpha);
    const z = THREE.MathUtils.lerp(sim.prev.z, state.z, sim.alpha);
    this.body.set(x, y, z);

    const swimming = state.discipline === 'swim';
    const rollSpeed = swimming ? 0 : (state.speed * dt) / WHEEL_R;
    this.roll = (this.roll + rollSpeed) % (Math.PI * 2);
    // The rider faces the racing line, not world north: the folded canyon route
    // doubles back, so a raw world-space yaw left the bike riding backwards.
    const travelYaw = state.speed > 1.2
      ? courseYaw(state.s) - Math.atan2(state.vx, Math.max(1, state.speed))
      : this.heading;
    this.heading = wrapLerp(this.heading, travelYaw, 1 - Math.exp(-9 * dt));
    if (this.discipline !== state.discipline) {
      this.discipline = state.discipline;
      this.athlete.mode(state.discipline);
      this.transition = TRANSITION_SECONDS;
    }
    this.gradeLighting(dt);
    this.athlete.group.position.set(x, y + (swimming ? -0.05 : 0.02), z);
    this.athlete.group.rotation.y = this.heading;
    this.athlete.dress(state.discipline, travelled);
    this.athlete.animate({
      discipline: state.discipline,
      effort: state.effort,
      phase: state.strokePhase,
      roll: this.roll,
      turn: THREE.MathUtils.clamp(state.vx / CONFIG.drive[state.discipline].turnSpeed, -1, 1),
      wobble: state.wobble,
      time: state.time,
      onGround: !state.airborne,
    });

    const aheadTangent = this.pathTangent(state.s + 18);
    this.sun.target.position.set(x + aheadTangent.x * 18, surfaceHeight(state.s + 18, 0),
      z + aheadTangent.z * 18);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDirection, 130);
    this.sun.target.updateMatrixWorld();
    this.fill.position.set(x + 50, y + 34, z - 50);
    this.fill.target.position.set(x, y, z);
    this.fill.target.updateMatrixWorld();

    this.updateCamera(state, dt, travelled);
    this.course.startArch.visible = state.phase === 'ready' || state.phase === 'running';
    this.course.update(state, this.elapsed);
    this.environment.update(x, y, z);
    this.particles.update(state, dt, this.reducedMotion);

    if (state.events.length < this.eventCursor) this.eventCursor = 0;
    for (const event of state.events.slice(this.eventCursor)) {
      if (event.kind === 'crash' || event.kind === 'contact') this.shake = Math.min(1, this.shake + 0.62);
      else if (event.kind === 'land' || event.kind === 'boundary') this.shake = Math.min(0.6, this.shake + 0.22);
      else if (event.kind === 'bonk') this.shake = Math.min(0.5, this.shake + 0.3);
      else if (event.kind === 'splash') this.shake = Math.min(0.3, this.shake + 0.08);
      else if (event.kind === 'finish') this.shake = Math.min(0.8, this.shake + 0.4);
    }
    this.eventCursor = state.events.length;
    const shake = this.reducedMotion || this.inspectView ? 0 : this.shake;
    if (shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * shake * 0.3;
      this.camera.position.y += (Math.random() - 0.5) * shake * 0.24;
      this.camera.rotateZ((Math.random() - 0.5) * shake * 0.05 - state.vx * 0.0008);
    }
    this.shake = Math.max(0, this.shake - dt * 2.4);

    this.renderer.render(this.scene, this.camera);
    this.frame = {
      speed: state.speed, discipline: state.discipline, airborne: state.airborne, fov: this.camera.fov,
    };
  }

  /**
   * Cover panorama: high over the lake behind the pontoon, so the start deck sits low in
   * frame and the shoreline and ridge recede uphill. Static, because it sits under the
   * title card and should not distract from it.
   */
  private heroView() {
    if (this.mapStyle === 'canyon') {
      this.desired.set(-126, WATER_LEVEL + 148, 142);
      this.camLook.set(14, 18, -170);
      return;
    }
    this.desired.set(xAt(-78, -128), WATER_LEVEL + 132, 78);
    this.camLook.set(xAt(230, 0), WATER_LEVEL + 4, zAt(230, 0));
  }

  /** Results frame: the finish arch and the sprint straight, seen from behind the line. */
  private finishView(drift: number) {
    const arch = this.course.finishArch.position;
    this.desired.set(arch.x + 11 + drift, arch.y + 8.5, arch.z + 18);
    this.camLook.set(arch.x, arch.y + 2.8, arch.z);
  }

  /** Keep the chase camera out of gate pylons and arch posts near a changeover. */
  private avoidPylons(desired: THREE.Vector3) {
    for (const post of this.course.cameraColliders) {
      if (Math.abs(post.z - desired.z) > 3) continue;
      const dx = desired.x - post.x;
      const dz = desired.z - post.z;
      const radius = post.radius + 0.55;
      const gap = Math.hypot(dx, dz);
      if (gap >= radius) continue;
      if (gap < 1e-3) {
        desired.x += radius;
        continue;
      }
      desired.x += (dx / gap) * (radius - gap);
      desired.z += (dz / gap) * (radius - gap);
    }
  }

  /** Passing under a gantry, lift the aim point so the banner clears the top of frame. */
  private archLookUp(look: THREE.Vector3, cameraS: number) {
    let lift = 0;
    for (const post of this.course.cameraColliders) {
      const gap = Math.abs(cameraS - post.s);
      if (gap < 7) lift = Math.max(lift, (1 - gap / 7) * 0.9);
    }
    look.y += lift;
  }

  private updateCamera(state: Simulation['state'], dt: number, travelled: number) {
    const profile = CONFIG.camera[state.discipline];
    // Ease the rig numbers themselves: a change of discipline pulls back over ~1.5s
    // instead of snapping the camera length.
    const ease = 1 - Math.exp(-2 * dt);
    this.rig.distance += (profile.distance - this.rig.distance) * ease;
    this.rig.height += (profile.height - this.rig.height) * ease;
    this.rig.lookAhead += (profile.lookAhead - this.rig.lookAhead) * ease;
    this.rig.follow += (profile.follow - this.rig.follow) * ease;

    const settling = this.transition;
    this.transition = Math.max(0, settling - dt);
    const pull = (settling / TRANSITION_SECONDS) ** 2;

    const swimming = state.discipline === 'swim';
    const ready = state.phase === 'ready';
    const results = state.phase === 'results';
    if (ready || results) {
      const drift = this.reducedMotion ? 0 : Math.sin(this.elapsed * 0.2) * 1.4;
      if (ready) this.heroView();
      else this.finishView(drift);
      this.camPosition.lerp(this.desired, 1 - Math.exp(-2.2 * dt));
      this.look.lerp(this.camLook, 1 - Math.exp(-2.6 * dt));
    } else {
      const speed = Math.min(1, state.speed / CONFIG.drive[state.discipline].speed);
      const wobble = state.wobble * 0.6;
      const distance = this.rig.distance + speed * 1.4 + wobble
        + (state.phase === 'finishing' ? 2.4 : 0) + pull * 2.6;
      const tangent = this.pathTangent(travelled);
      const lean = swimming ? 0.25 : 0;
      this.desired.set(
        this.body.x - tangent.x * distance,
        this.body.y + this.rig.height - lean + (state.airborne ? 0.5 : 0) + pull * 0.6,
        this.body.z - tangent.z * distance,
      );
      const cameraS = THREE.MathUtils.clamp(travelled - distance, -40, CONFIG.course.length + 40);
      const cameraU = uAtWorld(cameraS, this.desired.x, this.desired.z);
      this.desired.y = Math.max(this.desired.y,
        surfaceHeight(cameraS, cameraU) + (swimming ? 0.45 : 1.5));
      if (swimming) this.desired.y = Math.min(this.desired.y, WATER_LEVEL + 2.4);
      this.avoidPylons(this.desired);
      this.camPosition.lerp(this.desired, 1 - Math.exp(-this.rig.follow * dt));

      const ahead = this.rig.lookAhead + speed * (swimming ? 2 : 8);
      const lookS = THREE.MathUtils.clamp(travelled + ahead, 0, CONFIG.course.length + 30);
      const lookX = THREE.MathUtils.lerp(xAt(lookS, 0), this.body.x + tangent.x * ahead, 0.34);
      const lookZ = THREE.MathUtils.lerp(zAt(lookS, 0), this.body.z + tangent.z * ahead, 0.34);
      const forward = surfaceHeight(lookS, 0);
      let lookY = this.body.y + EYE[state.discipline] + (swimming ? 0.2 : 0.35);
      lookY = Math.max(lookY, Math.max(forward, WATER_LEVEL) + 0.5);
      this.camLook.set(lookX, lookY, lookZ);
      this.archLookUp(this.camLook, travelled);
      this.look.lerp(this.camLook, 1 - Math.exp(-this.rig.follow * 1.2 * dt));
    }
    this.camera.position.copy(this.camPosition);
    this.camera.lookAt(this.look);
    if (this.inspectView) {
      const { position, target, fov } = this.inspectView;
      this.camera.position.set(...position);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(...target);
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      return;
    }
    const racing = !ready && !results;
    const ratio = racing ? Math.min(1, state.speed / CONFIG.drive[state.discipline].speed) : 0;
    const fov = ready ? COVER_FOV : results ? RESULT_FOV
      : profile.fov + (this.reducedMotion ? 0 : ratio * profile.speedFov)
        + (state.phase === 'finishing' ? 3 : 0) + state.wobble * 1.5;
    const settled = this.camera.fov + (fov - this.camera.fov) * Math.min(1, dt * 3.4);
    this.camera.fov = settled - (this.reducedMotion ? 0 : pull * 3.5);
    this.camera.updateProjectionMatrix();
  }

  diagnostics() {
    const cameraS = THREE.MathUtils.clamp(-this.camera.position.z, -60, FINISH_S + 200);
    const cameraU = uAtWorld(cameraS, this.camera.position.x, this.camera.position.z);
    return {
      mobile: this.mobile,
      mapStyle: this.mapStyle,
      dpr: this.renderer.getPixelRatio(),
      camera: this.camera.position.toArray(),
      cameraTarget: this.look.toArray(),
      cameraOverGround: this.camera.position.y - surfaceHeight(cameraS, cameraU),
      fov: this.camera.fov,
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      lighting: {
        sunDirection: this.sunDirection.toArray(),
        shadows: this.renderer.shadowMap.enabled,
        shadowMapSize: this.sun.shadow.mapSize.toArray(),
        exposure: this.renderer.toneMappingExposure,
        environment: this.scene.environmentIntensity,
      },
      particles: this.particles.diagnostics(),
      course: this.course.diagnostics(),
      athlete: {
        model: 'triathlete',
        discipline: disciplineAt(-this.athlete.group.position.z),
        heading: this.heading,
        roll: this.roll,
        visible: this.athlete.group.visible,
        head: this.athlete.body.getWorldPosition(new THREE.Vector3()).toArray(),
      },
      frame: this.frame,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.observer.disconnect();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.scene.traverse(object => {
      const m = object as THREE.Mesh;
      if (m.geometry) geometries.add(m.geometry);
      if (m.material) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) materials.add(mat);
    });
    materials.forEach(mat => {
      for (const value of Object.values(mat)) if (value instanceof THREE.Texture) textures.add(value);
      mat.dispose();
    });
    geometries.forEach(geometry => geometry.dispose());
    textures.forEach(texture => texture.dispose());
    this.athlete.dispose();
    this.reflection.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
