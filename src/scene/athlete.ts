import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config';
import { BIKE_END, SWIM_END, T1_END, T2_END, type DisciplineId } from '../config';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const X_AXIS = V(1, 0, 0);
const UP = V(0, 1, 0);
const c = CONFIG.colors;

/** Standing skeleton, feet on the local ground plane. Forward is -Z. */
const HIP = 0.9;
const ANKLE = 0.07;
const THIGH = 0.42;
const SHIN = 0.42;
const UPPER_ARM = 0.3;
const FOREARM = 0.28;
const CHEST = 0.44;

/**
 * `phase` drives limbs in radians, `roll` the bike wheels, `turn` is the normalized
 * steer input and `wobble` the post-crash recovery weight.
 */
export type Pose = {
  discipline: DisciplineId;
  effort: number;
  phase: number;
  roll: number;
  turn: number;
  wobble: number;
  time: number;
  onGround: boolean;
};

/**
 * CapsuleGeometry's `length` is the cylinder between the two caps, so a segment that
 * must read as `length` long has to give back both radii up front.
 */
function capsule(radius: number, length: number, segments = 8) {
  return new THREE.CapsuleGeometry(radius, Math.max(0.02, length - radius * 2), 3, segments);
}

function material(name: string, color: string, roughness = 0.82, metalness = 0) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness });
  mat.name = name;
  return mat;
}

const MATS = {
  skin: material('skin', c.skin, 0.9),
  /** Navy one-piece trisuit: the swim and both transitions are raced in it. */
  suit: material('tri-suit', c.suit, 0.86),
  jersey: material('tri-jersey', c.jersey, 0.88),
  short: material('bib-short', c.shorts, 0.9),
  cap: material('swim-cap', c.cap, 0.75),
  runCap: material('run-cap', c.bib, 0.82),
  helmet: material('aero-helmet', c.helmet, 0.34),
  visor: material('visor', c.visor, 0.16, 0.5),
  bib: material('race-bib', c.bib, 0.9),
  belt: material('race-belt', c.ink, 0.7),
  shoe: material('run-shoe', c.helmet, 0.8),
  frame: material('bike-frame', c.bikeMetal, 0.36, 0.32),
  carbon: material('bike-carbon', c.bikeFrame, 0.44, 0.24),
  tyre: material('tyre', c.tire, 0.92),
  rim: material('rim', c.rim, 0.3, 0.7),
  chain: material('drivetrain', c.chain, 0.35, 0.65),
  bottle: material('bottle', c.pickup, 0.4),
};

/** Merge the rigid parts of one material so the bike costs a handful of draws. */
function packRigidParts(group: THREE.Group) {
  const buckets = new Map<THREE.Material, THREE.Mesh[]>();
  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh) || Array.isArray(child.material)) continue;
    const bucket = buckets.get(child.material) ?? [];
    bucket.push(child);
    buckets.set(child.material, bucket);
  }
  for (const [mat, meshes] of buckets) {
    if (meshes.length < 2) continue;
    const sources = meshes.map(mesh => {
      mesh.updateMatrix();
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      return geometry.applyMatrix4(mesh.matrix);
    });
    const merged = mergeGeometries(sources);
    sources.forEach(source => source.dispose());
    if (!merged) continue;
    const combined = new THREE.Mesh(merged, mat);
    combined.castShadow = true;
    combined.receiveShadow = true;
    combined.name = `${group.name || 'rig'}-${mat.name}`;
    meshes.forEach(mesh => { group.remove(mesh); mesh.geometry.dispose(); });
    group.add(combined);
  }
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

function placeBetween(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, unitLength: number) {
  const length = to.distanceTo(from);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  if (length > 1e-5) {
    tmpA.subVectors(to, from).divideScalar(length);
    mesh.quaternion.setFromUnitVectors(UP, tmpA);
  }
  mesh.scale.set(1, length / unitLength, 1);
}

type Limb = {
  upper: THREE.Mesh;
  lower: THREE.Mesh;
  end: THREE.Mesh;
  upperLength: number;
  lowerLength: number;
  bend: THREE.Vector3;
};

function makeLimb(parent: THREE.Object3D, radii: [number, number], lengths: [number, number],
  mats: [THREE.Material, THREE.Material], end: THREE.Mesh, bend: THREE.Vector3): Limb {
  const upper = new THREE.Mesh(capsule(radii[0], lengths[0]), mats[0]);
  const lower = new THREE.Mesh(capsule(radii[1], lengths[1]), mats[1]);
  upper.castShadow = lower.castShadow = end.castShadow = true;
  upper.receiveShadow = lower.receiveShadow = true;
  parent.add(upper, lower, end);
  return { upper, lower, end, upperLength: lengths[0], lowerLength: lengths[1], bend };
}

/**
 * Two-bone inverse kinematics. Every discipline only has to say where the hand
 * and the foot should be; the joints solve themselves and the silhouette follows.
 */
function solveLimb(limb: Limb, root: THREE.Vector3, target: THREE.Vector3) {
  tmpA.subVectors(target, root);
  const raw = tmpA.length();
  const reach = limb.upperLength + limb.lowerLength - 0.005;
  const distance = Math.min(raw, reach);
  if (raw > 1e-5) tmpA.divideScalar(raw); else tmpA.set(0, -1, 0);
  const along = (limb.upperLength ** 2 - limb.lowerLength ** 2 + distance ** 2) / (2 * distance);
  const height = Math.sqrt(Math.max(0, limb.upperLength ** 2 - along ** 2));
  tmpB.copy(limb.bend).addScaledVector(tmpA, -limb.bend.dot(tmpA));
  if (tmpB.lengthSq() < 1e-6) tmpB.set(0, 0, -1); else tmpB.normalize();
  joint.copy(root).addScaledVector(tmpA, along).addScaledVector(tmpB, height);
  // A target past full extension is pulled onto the reach circle: the joint straightens
  // instead of the bone stretching into a spear.
  if (raw > reach) resolved.copy(root).addScaledVector(tmpA, distance); else resolved.copy(target);
  placeBetween(limb.upper, root, joint, limb.upperLength);
  placeBetween(limb.lower, joint, resolved, limb.lowerLength);
  limb.end.position.copy(resolved);
}

const joint = new THREE.Vector3();
const root = new THREE.Vector3();
const foot = new THREE.Vector3();
const resolved = new THREE.Vector3();

const WHEEL_R = 0.33;
const CRANK = 0.16;
const BB = V(0, 0.29, 0);
const PAD = V(0, 0.7, -0.6);

type Bike = {
  group: THREE.Group;
  wheels: THREE.Group[];
  cranks: THREE.Group[];
  bars: THREE.Group;
};

function makeBike(): Bike {
  const group = new THREE.Group();
  group.name = 'tri-bike';
  const wheels: THREE.Group[] = [];
  for (const axle of [-0.55, 0.55]) {
    const spinner = new THREE.Group();
    spinner.position.set(0, WHEEL_R, axle);
    const disc = new THREE.Group();
    disc.name = 'wheel-disc';
    // Torus geometry faces +Z, so a quarter turn lays the wheel into the rolling plane.
    disc.rotation.y = Math.PI / 2;
    disc.add(new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.01, 0.028, 7, 26), MATS.tyre));
    disc.add(new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.04, 0.016, 6, 24), MATS.rim));
    // Rear wheel is a solid aero disc, like the race wheels in the reference sheet.
    if (axle > 0) {
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R - 0.055, WHEEL_R - 0.055, 0.008, 26), MATS.carbon);
      plate.rotation.x = Math.PI / 2;
      disc.add(plate);
    }
    for (let i = 0; i < 5; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.012, (WHEEL_R - 0.05) * 2, 0.014), MATS.rim);
      spoke.rotation.z = (i / 5) * Math.PI;
      disc.add(spoke);
    }
    packRigidParts(disc);
    spinner.add(disc);
    group.add(spinner);
    wheels.push(spinner);
  }
  const tube = (from: THREE.Vector3, to: THREE.Vector3, radius: number, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(capsule(radius, 1, 7), mat);
    placeBetween(mesh, from, to, 1);
    mesh.castShadow = true;
    group.add(mesh);
  };
  const saddle = V(0, 0.72, 0.3);
  const headTop = V(0, 0.62, -0.42);
  const headBottom = V(0, 0.44, -0.4);
  tube(BB, saddle, 0.022, MATS.frame);
  tube(BB, V(0, 0.33, 0.55), 0.017, MATS.carbon);
  tube(saddle, V(0, 0.33, 0.55), 0.015, MATS.carbon);
  tube(BB, headBottom, 0.026, MATS.frame);
  tube(saddle, headTop, 0.02, MATS.frame);
  tube(headTop, headBottom, 0.028, MATS.carbon);
  tube(headBottom, V(0, WHEEL_R, -0.55), 0.019, MATS.carbon);
  const seat = new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.06, 0.25, 2, 0.025), MATS.carbon);
  seat.position.set(0, 0.76, 0.32);
  seat.castShadow = true;
  group.add(seat);

  const bars = new THREE.Group();
  bars.name = 'handlebars';
  const extension = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.2), MATS.carbon);
  extension.position.set(0, 0.68, -0.52);
  const pad = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.05, 0.1, 2, 0.02), MATS.visor);
  pad.position.copy(PAD);
  for (const side of [-1, 1] as const) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.026, 0.22), MATS.carbon);
    arm.position.set(side * 0.1, 0.66, -0.62);
    arm.rotation.x = 0.24;
    bars.add(arm);
  }
  const horn = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 5, 12, Math.PI), MATS.carbon);
  horn.rotation.set(Math.PI / 2, 0, 0);
  horn.position.set(0, 0.63, -0.44);
  bars.add(extension, pad, horn);
  bars.children.forEach(child => { (child as THREE.Mesh).castShadow = true; });
  group.add(bars);

  const cranks: THREE.Group[] = [];
  for (const side of [-1, 1] as const) {
    const holder = new THREE.Group();
    holder.position.copy(BB);
    holder.name = `crank-${side}`;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.022, CRANK, 0.026), MATS.chain);
    arm.position.set(side * 0.07, CRANK / 2, 0);
    const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.024, 0.065), MATS.carbon);
    pedal.position.set(side * 0.095, CRANK, 0);
    arm.castShadow = pedal.castShadow = true;
    holder.add(arm, pedal);
    group.add(holder);
    cranks.push(holder);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.013, 5, 18), MATS.chain);
  ring.rotation.y = Math.PI / 2;
  ring.position.set(0.05, BB.y, 0);
  const cassette = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 4, 14), MATS.chain);
  cassette.rotation.y = Math.PI / 2;
  cassette.position.set(0.045, WHEEL_R, 0.55);
  const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.17, 10), MATS.bottle);
  bottle.position.set(0, 0.5, 0.16);
  bottle.rotation.x = 0.2;
  bottle.castShadow = true;
  group.add(ring, cassette, bottle);
  return { group, wheels, cranks, bars };
}

type Kit = {
  torso: 'suit' | 'jersey';
  shorts: 'suit' | 'short';
  sleeves: boolean;
  swimCap: boolean;
  goggles: boolean;
  buoy: boolean;
  helmet: boolean;
  runCap: boolean;
  bib: boolean;
  belt: boolean;
  shoes: boolean;
  bike: boolean;
};

/**
 * One kit per leg of the race, straight off the reference sheet: the navy trisuit is
 * worn for the swim and both changeovers, the orange jersey and dark shorts for the
 * bike and run, an orange cap + goggles + tow float in the water, an aero helmet with
 * a smoked visor on the bike, a white cap + bib + hydration belt on the run.
 */
const KIT: Record<DisciplineId, Kit> = {
  swim: { torso: 'suit', shorts: 'suit', sleeves: false, swimCap: true, goggles: true, buoy: true, helmet: false, runCap: false, bib: false, belt: false, shoes: false, bike: false },
  t1: { torso: 'suit', shorts: 'suit', sleeves: false, swimCap: true, goggles: true, buoy: true, helmet: false, runCap: false, bib: false, belt: false, shoes: true, bike: false },
  bike: { torso: 'jersey', shorts: 'short', sleeves: true, swimCap: false, goggles: false, buoy: false, helmet: true, runCap: false, bib: false, belt: false, shoes: true, bike: true },
  t2: { torso: 'suit', shorts: 'suit', sleeves: false, swimCap: false, goggles: false, buoy: false, helmet: true, runCap: false, bib: false, belt: false, shoes: true, bike: false },
  run: { torso: 'jersey', shorts: 'short', sleeves: true, swimCap: false, goggles: false, buoy: false, helmet: false, runCap: true, bib: true, belt: true, shoes: true, bike: false },
};

export type Athlete = {
  group: THREE.Group;
  body: THREE.Group;
  bike: Bike;
  mode(discipline: DisciplineId): void;
  dress(discipline: DisciplineId, s: number): void;
  animate(pose: Pose): void;
  dispose(): void;
};

export function createAthlete(): Athlete {
  const group = new THREE.Group();
  group.name = 'triathlete';
  // The body pivot sits on the hip joint so a pitch reads as a real forward lean.
  const body = new THREE.Group();
  body.name = 'body-pivot';
  body.position.set(0, HIP, 0);
  group.add(body);

  const torso = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.5, 0.22, 3, 0.07), MATS.suit);
  torso.position.set(0, CHEST / 2, 0.01);
  const hips = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.22, 0.22, 3, 0.07), MATS.suit);
  hips.position.set(0, -0.06, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), MATS.skin);
  head.position.set(0, 0.71, 0.02);
  head.scale.set(0.94, 1.06, 1);

  // Swim kit (ref 01 / 06): orange cap, goggle lenses on a strap, orange tow float
  // clipped to a waist tether.
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.125, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), MATS.cap);
  cap.position.copy(head.position);
  const goggles = new THREE.Group();
  goggles.name = 'goggles';
  for (const side of [-1, 1] as const) {
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.036, 10, 8), MATS.visor);
    lens.scale.set(1.3, 0.92, 0.62);
    lens.position.set(side * 0.048, 0.02, -0.104);
    goggles.add(lens);
  }
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.119, 0.011, 5, 20), MATS.visor);
  strap.rotation.x = Math.PI / 2;
  strap.position.y = -0.004;
  goggles.add(strap);
  goggles.position.copy(head.position);
  const buoy = new THREE.Group();
  buoy.name = 'swim-buoy';
  const float = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.13, 4, 10), MATS.cap);
  float.position.set(0, -0.04, 0.16);
  float.rotation.x = 0.2;
  const tether = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.009, 4, 18), MATS.cap);
  tether.rotation.x = Math.PI / 2;
  tether.position.set(0, 0.02, 0.02);
  buoy.add(float, tether);

  // Bike kit (ref 02b): aero shell with a long tail and a smoked visor.
  const helmet = new THREE.Group();
  helmet.name = 'aero-helmet';
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.74), MATS.helmet);
  shell.position.copy(head.position);
  shell.scale.set(0.98, 0.94, 1.5);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.19), MATS.helmet);
  tail.position.set(0, head.position.y + 0.02, head.position.z + 0.18);
  const visor = new THREE.Mesh(new RoundedBoxGeometry(0.21, 0.08, 0.022, 2, 0.012), MATS.visor);
  visor.position.set(0, head.position.y + 0.005, head.position.z - 0.216);
  visor.rotation.x = 0.12;
  helmet.add(shell, tail, visor);

  // Run kit (ref 03): white cap with a bill, bib on the chest, hydration belt.
  const runCap = new THREE.Group();
  runCap.name = 'run-cap';
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.126, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), MATS.runCap);
  crown.position.copy(head.position);
  const bill = new THREE.Mesh(new RoundedBoxGeometry(0.175, 0.018, 0.1, 2, 0.012), MATS.runCap);
  bill.position.set(0, head.position.y + 0.004, head.position.z - 0.135);
  bill.rotation.x = -0.14;
  runCap.add(crown, bill);
  const bib = new THREE.Group();
  bib.name = 'race-bib';
  const plate = new THREE.Mesh(new RoundedBoxGeometry(0.125, 0.15, 0.012, 2, 0.008), MATS.bib);
  plate.position.set(0, CHEST / 2 + 0.03, -0.102);
  bib.add(plate);
  for (const [row, width] of [0.07, 0.045, 0.06].entries()) {
    const digit = new THREE.Mesh(new RoundedBoxGeometry(width, 0.011, 0.004, 1, 0.002), MATS.belt);
    digit.position.set(0, CHEST / 2 + 0.075 - row * 0.032, -0.11);
    bib.add(digit);
  }
  const belt = new THREE.Group();
  belt.name = 'race-belt';
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.152, 0.014, 5, 20), MATS.belt);
  band.rotation.x = Math.PI / 2;
  band.position.set(0, 0.04, 0);
  belt.add(band);
  for (const side of [-1, 1] as const) {
    const flask = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.07, 8), MATS.belt);
    flask.position.set(side * 0.07, 0, 0.115);
    belt.add(flask);
  }

  for (const piece of [torso, hips, head, cap, goggles, buoy, helmet, runCap, bib, belt]) {
    piece.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    body.add(piece);
  }

  const shoe = () => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.07, 0.26, 2, 0.03), MATS.shoe);
    mesh.name = 'shoe';
    mesh.castShadow = true;
    return mesh;
  };
  // Limbs hang off the group, not the pitched body, so IK targets stay in race space.
  const legs = [-1, 1].map(side => makeLimb(group, [0.078, 0.058], [THIGH, SHIN],
    [MATS.short, MATS.skin], shoe(), V(0, 0.1, -1))) as [Limb, Limb];
  const hands = [-1, 1].map(() => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.056, 8, 6), MATS.skin);
    mesh.castShadow = true;
    return mesh;
  });
  const arms = [-1, 1].map(side => makeLimb(group, [0.052, 0.045], [UPPER_ARM, FOREARM],
    [MATS.skin, MATS.skin], hands[side === -1 ? 0 : 1], V(side * 0.7, -0.5, 0.5))) as [Limb, Limb];

  const bike = makeBike();
  bike.group.visible = false;
  group.add(bike.group);

  /** A point written in body space, resolved into the group after the current lean. */
  const at = (x: number, y: number, z: number, pitch: number) =>
    root.set(x, y, z).applyAxisAngle(X_AXIS, pitch).add(body.position);
  const to = (x: number, y: number, z: number) => foot.set(x, y, z);

  /**
   * Gear is swapped *inside* the transition zone, not at its exit: passing the racks
   * strips the swim kit, then the helmet goes on before the mount line (and the reverse
   * in T2). The exit itself stays a single Space press to mount / start running.
   */
  const applyKit = (discipline: DisciplineId, s: number) => {
    let kit = KIT[discipline];
    if (discipline === 't1') {
      const p = (s - SWIM_END) / (T1_END - SWIM_END);
      kit = p < 0.24 ? kit
        : { ...kit, swimCap: false, goggles: false, buoy: false, helmet: p >= 0.62 };
    } else if (discipline === 't2') {
      const p = (s - BIKE_END) / (T2_END - BIKE_END);
      kit = p < 0.3 ? kit
        : { ...kit, helmet: false, bib: true, runCap: p >= 0.68, belt: p >= 0.68 };
    }
    torso.material = kit.torso === 'suit' ? MATS.suit : MATS.jersey;
    hips.material = kit.shorts === 'suit' ? MATS.suit : MATS.short;
    for (const leg of legs) {
      leg.upper.material = hips.material;
      leg.end.visible = kit.shoes;
    }
    for (const arm of arms) arm.upper.material = kit.sleeves ? MATS.jersey : MATS.skin;
    cap.visible = kit.swimCap;
    goggles.visible = kit.goggles;
    buoy.visible = kit.buoy;
    helmet.visible = kit.helmet;
    runCap.visible = kit.runCap;
    bib.visible = kit.bib;
    belt.visible = kit.belt;
    bike.group.visible = kit.bike;
  };

  const athlete: Athlete = {
    group,
    body,
    bike,
    mode(discipline: DisciplineId) {
      applyKit(discipline, 0);
    },
    dress(discipline: DisciplineId, s: number) {
      applyKit(discipline, s);
    },
    animate(pose: Pose) {
      const { discipline, effort, phase } = pose;
      const shake = pose.wobble * Math.sin(pose.time * 19);
      const air = pose.onGround ? 0 : 1;
      group.rotation.x = 0;

      if (discipline === 'swim') {
        const pitch = -1.44 + shake * 0.03;
        body.position.set(0, 0.34, 0.04);
        body.rotation.set(pitch, 0, Math.sin(phase) * 0.28 + shake * 0.08);
        for (const [i, leg] of legs.entries()) {
          const side = i === 0 ? -1 : 1;
          solveLimb(leg, at(side * 0.09, -0.02, 0, pitch),
            to(side * 0.13, 0.3 + Math.sin(phase * 2 + side) * 0.13, 0.78));
        }
        for (const [i, arm] of arms.entries()) {
          const side = i === 0 ? -1 : 1;
          const swing = phase + (i === 0 ? 0 : Math.PI);
          // Recovery swings the hand clear of the water; the catch reaches long.
          const lift = (Math.sin(swing) + 1) / 2;
          solveLimb(arm, at(side * 0.17, CHEST, 0, pitch),
            to(side * (0.3 - lift * 0.12), 0.12 + lift * 0.34, -0.86 + (1 - lift) * 0.9));
        }
        return;
      }

      if (discipline === 'bike') {
        const pitch = -1.02 - effort * 0.16 + shake * 0.02;
        body.position.set(0, 0.8, 0.3);
        body.rotation.set(pitch, 0, pose.turn * -0.05 + shake * 0.04);
        group.rotation.x = air * -0.12;
        for (const wheel of bike.wheels) wheel.rotation.x = pose.roll;
        for (const [i, crank] of bike.cranks.entries()) crank.rotation.x = phase + (i === 0 ? 0 : Math.PI);
        for (const [i, leg] of legs.entries()) {
          const side = i === 0 ? -1 : 1;
          const angle = phase + (i === 0 ? 0 : Math.PI);
          solveLimb(leg, at(side * 0.09, -0.04, 0, pitch),
            to(side * 0.095, BB.y + CRANK * Math.cos(angle), CRANK * Math.sin(angle)));
        }
        for (const [i, arm] of arms.entries()) {
          const side = i === 0 ? -1 : 1;
          solveLimb(arm, at(side * 0.17, CHEST, 0, pitch),
            to(side * 0.11, PAD.y + 0.03, PAD.z - 0.04));
        }
        return;
      }

      const jog = discipline === 't1' || discipline === 't2';
      const pitch = -0.08 - effort * 0.12 + shake * 0.06;
      body.position.set(0, HIP, 0);
      body.rotation.set(pitch, 0, Math.sin(phase) * 0.05 + pose.turn * 0.12 + shake * 0.05);
      group.rotation.x = air * -0.08;
      const stride = (jog ? 0.28 : 0.4) * (0.6 + effort * 0.34);
      const lift = (jog ? 0.12 : 0.25) * (0.6 + effort * 0.34);
      for (const [i, leg] of legs.entries()) {
        const side = i === 0 ? -1 : 1;
        const swing = Math.sin(phase + (i === 0 ? 0 : Math.PI));
        const tuck = air * 0.18;
        // Both extremes of the stride lift, so the plant happens mid-swing and no
        // target asks for more than the leg can span.
        solveLimb(leg, at(side * 0.09, -0.04, 0, pitch),
          to(side * 0.14, ANKLE + Math.abs(swing) * lift + tuck, -swing * stride - 0.03));
      }
      const reach = jog ? 0.2 : 0.32 + effort * 0.12;
      for (const [i, arm] of arms.entries()) {
        const side = i === 0 ? -1 : 1;
        const swing = Math.sin(phase + (i === 0 ? Math.PI : 0));
        solveLimb(arm, at(side * 0.17, CHEST, 0, pitch),
          to(side * 0.23, HIP + 0.14 + Math.abs(swing) * 0.12, -swing * reach - 0.06));
      }
    },
    dispose() {
      group.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
    },
  };
  athlete.mode('run');
  return athlete;
}
