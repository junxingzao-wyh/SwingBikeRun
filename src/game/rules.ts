import {
  CONFIG, FINISH_S, GATES, OBSTACLES, PICKUPS, BIKE_END, SWIM_END, T1_END, T2_END,
  disciplineAt, gateHalfWidth, halfWidthAt, obstacleBand, surfaceHeight, xAt, zAt,
  type DisciplineId, type Gate,
} from '../config';

export type Phase = 'ready' | 'running' | 'paused' | 'finishing' | 'results';
export type EventKind =
  | 'gate' | 'missed' | 'pickup' | 'corner' | 'crash' | 'contact' | 'aid'
  | 'split' | 'burst' | 'bonk' | 'finish' | 'boundary' | 'splash' | 'land';

export type GameEvent = { kind: EventKind; points: number; at: number; strength: number };

export type Splits = Record<DisciplineId, number>;

export type RunState = {
  phase: Phase;
  time: number;
  /** Arc length along the racing line. */
  s: number;
  /** Lateral offset from the racing line, positive toward the rider's right. */
  u: number;
  /** World position of the body; both are derived from (s, u) every step. */
  x: number;
  z: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  discipline: DisciplineId;
  stamina: number;
  effort: number;
  targetSpeed: number;
  gripLoad: number;
  cornerLimit: number;
  grade: number;
  cadence: number;
  strokePhase: number;
  airborne: boolean;
  airTime: number;
  /** 0..1 recovery animation weight after a crash, bump or bonk. */
  wobble: number;
  surgeReadyAt: number;
  surgeUntil: number;
  bonkUntil: number;
  bonks: number;
  braking: boolean;
  easing: boolean;
  splits: Splits;
  splitAt: number;
  gateTotal: number;
  gatesPassed: string[];
  gatesMissed: string[];
  pickupsTaken: string[];
  cornerPeak: number;
  cornerId: string;
  cornerDirty: boolean;
  cornersClean: number;
  crashes: number;
  contacts: number;
  mistakes: number;
  boundary: number;
  score: number;
  combo: number;
  bestCombo: number;
  topSpeed: number;
  protectionUntil: number;
  notice: string;
  noticeUntil: number;
  events: GameEvent[];
  eventKeys: string[];
  finishTime: number;
  seed: number;
};

const emptySplits = (): Splits => ({ swim: 0, t1: 0, bike: 0, t2: 0, run: 0 });

export function createRun(seed = 20261116): RunState {
  return {
    phase: 'ready', time: 0, s: 0, u: 0, x: xAt(0, 0), z: zAt(0, 0), y: surfaceHeight(0, 0), vx: 0, vy: 0,
    speed: CONFIG.drive.swim.startSpeed, discipline: 'swim',
    stamina: CONFIG.stamina.start, effort: 1, targetSpeed: CONFIG.drive.swim.speed,
    gripLoad: 0, cornerLimit: 0, grade: 0, cadence: 36, strokePhase: 0,
    airborne: false, airTime: 0, wobble: 0,
    surgeReadyAt: 0, surgeUntil: 0, bonkUntil: 0, bonks: 0,
    braking: false, easing: false,
    splits: emptySplits(), splitAt: 0,
    gateTotal: GATES.length, gatesPassed: [], gatesMissed: [], pickupsTaken: [],
    cornerPeak: 0, cornerId: '', cornerDirty: false, cornersClean: 0,
    crashes: 0, contacts: 0, mistakes: 0, boundary: 0,
    score: 0, combo: 0, bestCombo: 0, topSpeed: 0,
    protectionUntil: 0, notice: '', noticeUntil: 0,
    events: [], eventKeys: [], finishTime: 0, seed,
  };
}

const round = (value: number) => Math.round(value);

export function multiplierFor(state: RunState) {
  if (state.combo >= CONFIG.combo.secondTier) return CONFIG.combo.secondMultiplier;
  if (state.combo >= CONFIG.combo.firstTier) return CONFIG.combo.firstMultiplier;
  return 1;
}

export function pointsText(raw: number, state: RunState) {
  const value = round(raw * multiplierFor(state));
  return value > 0 ? `+${value}` : `${value}`;
}

export function notice(state: RunState, message: string, seconds = 2.1) {
  state.notice = message;
  state.noticeUntil = state.time + seconds;
}

export function pushEvent(state: RunState, kind: EventKind, points: number, strength = 1) {
  state.events.push({ kind, points, at: state.time, strength });
  state.eventKeys.push(`${state.events.length}:${kind}`);
  if (state.events.length > 160) {
    state.events.splice(0, state.events.length - 160);
  }
}

export function award(state: RunState, raw: number, kind: EventKind, message?: string, strength = 1) {
  const points = round(raw * multiplierFor(state));
  state.score = Math.max(0, state.score + points);
  if (raw > 0) {
    state.combo += 1;
    state.bestCombo = Math.max(state.bestCombo, state.combo);
  }
  pushEvent(state, kind, points, strength);
  if (message) notice(state, `${message} · ${points > 0 ? '+' : ''}${points}`);
  return points;
}

export function breakCombo(state: RunState, points: number, kind: EventKind, message: string, strength = 1) {
  state.combo = 0;
  state.score = Math.max(0, state.score + points);
  state.mistakes += 1;
  pushEvent(state, kind, points, strength);
  notice(state, `${message} · ${points}`);
}

/** A crash or contact costs control for a beat so the penalty is felt, not just scored. */
export function beginIncident(state: RunState, kind: 'crash' | 'contact', points: number, speedKeep: number,
  message: string = CONFIG.text.crash) {
  const duration = kind === 'crash' ? 1.55 : 0.75;
  state.speed *= speedKeep;
  state.vx *= 0.25;
  state.protectionUntil = state.time + CONFIG.mistake.protection + duration;
  if (kind === 'crash') {
    state.crashes += 1;
    breakCombo(state, points, kind, message, 1.6);
  } else {
    // A bump in the pack costs rhythm, not the whole streak.
    state.contacts += 1;
    state.mistakes += 1;
    state.combo = Math.max(0, state.combo - 1);
    state.score = Math.max(0, state.score + points);
    pushEvent(state, kind, points, 0.9);
    notice(state, `${CONFIG.text.contact} · ${points}`, 1.6);
  }
  return duration;
}

export function checkGates(state: RunState, previousS: number) {
  const passed: Gate[] = [];
  for (const gate of GATES) {
    if (gate.s <= previousS || gate.s > state.s) continue;
    if (state.gatesPassed.includes(gate.id) || state.gatesMissed.includes(gate.id)) continue;
    const u = state.u;
    const offset = u - gate.u;
    if (Math.abs(offset) <= gateHalfWidth(gate)) {
      state.gatesPassed.push(gate.id);
      passed.push(gate);
      const label = gate.kind === 'buoy' ? '绕标成功' : gate.kind === 'aid' ? '通过补给站' : '通过计时门';
      award(state, CONFIG.scoring.gate, 'gate', `${label}`, gate.kind === 'aid' ? 0.8 : 1);
      if (gate.kind === 'aid') {
        state.stamina = Math.min(CONFIG.stamina.max, state.stamina + CONFIG.stamina.aidRefill);
        pushEvent(state, 'aid', 0, 1.2);
      }
    } else {
      state.gatesMissed.push(gate.id);
      state.combo = 0;
      pushEvent(state, 'missed', 0, 0.4);
      notice(state, CONFIG.text.gateOutside);
    }
  }
  return passed;
}

export function checkPickups(state: RunState) {
  for (const pickup of PICKUPS) {
    if (state.pickupsTaken.includes(pickup.id)) continue;
    if (Math.abs(pickup.s - state.s) > 1.6) continue;
    if (Math.abs(state.u - pickup.u) > CONFIG.pickup.radius + 0.9) continue;
    state.pickupsTaken.push(pickup.id);
    award(state, CONFIG.scoring.pickup, 'pickup', CONFIG.text.pickup, 0.5);
    state.stamina = Math.min(CONFIG.stamina.max, state.stamina + 7);
  }
}

export function scanObstacles(state: RunState, previousS = state.s) {
  if (state.time < state.protectionUntil) return null;
  for (const obstacle of OBSTACLES) {
    if (obstacle.discipline !== state.discipline) continue;
    const band = obstacleBand(obstacle);
    if (state.s < band.start || previousS > band.end) continue;
    const u = state.u;
    if (Math.abs(u - obstacle.u) > obstacle.width / 2 + CONFIG.physics.radius * 0.85) continue;
    if (obstacle.discipline === 'bike') {
      // A barrier is not a corner: say what was hit, so a crash in the middle of the
      // road is never mistaken for the grip model firing on its own.
      beginIncident(state, 'crash', CONFIG.mistake.crashDelta, 0.32, CONFIG.text.barrier);
    } else if (obstacle.discipline === 'swim') {
      beginIncident(state, 'contact', CONFIG.mistake.contactDelta, 0.6);
    } else {
      beginIncident(state, 'contact', CONFIG.mistake.contactDelta, 0.72);
    }
    return obstacle;
  }
  return null;
}

export function applyBoundary(state: RunState) {
  // The painted edge is drawn at `halfWidth`, so the body may occupy its own radius up
  // to that line: the penalty then fires exactly when the silhouette would overlap it.
  const half = halfWidthAt(state.s) - CONFIG.physics.radius;
  const u = state.u;
  // Sitting exactly on the painted line still counts as pressure on it: the clamp runs,
  // the penalty does not fire twice.
  if (Math.abs(u) < half) {
    state.boundary = 0;
    return false;
  }
  const sign = u < 0 ? -1 : 1;
  state.u = sign * half;
  state.x = xAt(state.s, state.u);
  state.z = zAt(state.s, state.u);
  state.vx = -Math.abs(state.vx) * 0.25 * sign;
  const channel = state.discipline === 'swim';
  state.speed = Math.max(state.discipline === 'bike' ? CONFIG.drive.bike.speed * 0.45 : 1.6,
    state.speed * (1 - CONFIG.mistake.boundarySpeed * 0.02));
  if (!state.boundary) {
    state.boundary = 1;
    state.combo = 0;
    state.score = Math.max(0, state.score + CONFIG.mistake.boundaryDelta);
    state.mistakes += 1;
    pushEvent(state, 'boundary', CONFIG.mistake.boundaryDelta, 0.7);
    notice(state, `${channel ? CONFIG.text.boundary : '别压线'} · ${CONFIG.mistake.boundaryDelta}`);
  }
  return true;
}

/** Race clock bookkeeping: the splits are the story of a triathlon. */
export function closeSplit(state: RunState) {
  state.splits[state.discipline] += state.time - state.splitAt;
  state.splitAt = state.time;
}

export function recordSplit(state: RunState) {
  const elapsed = state.time - state.splitAt;
  const next = disciplineAt(state.s);
  if (next === state.discipline) return false;
  state.splits[state.discipline] += elapsed;
  state.splitAt = state.time;
  const from = state.discipline;
  state.discipline = next;
  pushEvent(state, 'split', 0, 1);
  const copy = CONFIG.text;
  if (next === 't1') notice(state, `游泳 ${(state.splits.swim).toFixed(1)}s · ${copy.t1Hint}`, 3);
  else if (next === 'bike') notice(state, `换项 ${(state.splits.t1).toFixed(1)}s · 出发`, 2.4);
  else if (next === 't2') notice(state, `骑行 ${(state.splits.bike).toFixed(1)}s · ${copy.t2Hint}`, 3);
  else if (next === 'run') notice(state, `换项 ${(state.splits.t2).toFixed(1)}s · 最后一段`, 2.4);
  if (from === 'swim') state.speed = Math.min(state.speed, CONFIG.drive.t1.speed);
  if (from === 'bike') state.speed = Math.min(state.speed, CONFIG.drive.t2.speed);
  return true;
}

export function reachedFinish(state: RunState) {
  return state.s >= FINISH_S;
}

export function gradeFor(state: RunState) {
  const perfect = SWIM_END / CONFIG.drive.swim.speed + (T1_END - SWIM_END) / 5.4
    + (BIKE_END - T1_END) / CONFIG.drive.bike.speed + (T2_END - BIKE_END) / 5.4
    + (FINISH_S - T2_END) / CONFIG.drive.run.speed;
  const pace = state.finishTime / perfect;
  const penalty = state.crashes * 0.06 + state.mistakes * 0.02;
  const gateRate = state.gatesPassed.length / Math.max(1, state.gateTotal);
  const value = gateRate * 0.55 + Math.max(0, 1 - pace) * 0.45 - penalty;
  if (value > 0.62) return 'S';
  if (value > 0.48) return 'A';
  if (value > 0.34) return 'B';
  return 'C';
}
