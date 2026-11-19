import {
  CONFIG, COURSE_LENGTH, T1_END, T2_END, WATER_LEVEL,
  centerSlope, cornerAt, disciplineAt, halfWidthAt, isFoldedTrack, lateralAccel, routeCurvature, slopeAt,
  surfaceHeight, xAt, zAt,
} from '../config';
import { Input } from './input';
import {
  applyBoundary, award, beginIncident, breakCombo, checkGates, checkPickups, closeSplit, createRun,
  notice, pushEvent, reachedFinish, recordSplit, scanObstacles, type RunState,
} from './rules';

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

/**
 * One arc-length course, five discipline models. The forward axis is always `s`;
 * only what the athlete can push with, and what grabs the surface, changes.
 */
export class Simulation {
  state: RunState = createRun();
  input = new Input();
  alpha = 1;
  mobile = false;
  prev = { s: 0, x: 0, z: 0, y: 0 };
  private accumulator = 0;
  private transitionPrompt: RunState['discipline'] | null = null;

  constructor(mobile: boolean) { this.configure(mobile); }

  configure(mobile: boolean) {
    this.mobile = mobile;
    this.state = createRun();
    this.prev = { s: this.state.s, x: this.state.x, z: this.state.z, y: this.state.y };
    this.accumulator = 0;
    this.alpha = 1;
    this.transitionPrompt = null;
  }

  start() {
    if (this.state.phase !== 'ready') return;
    this.state.phase = 'running';
    this.state.splitAt = 0;
    notice(this.state, '出发！', 1.6);
    pushEvent(this.state, 'split', 0, 1);
  }

  pause() { if (this.state.phase === 'running') this.state.phase = 'paused'; }

  resume() { if (this.state.phase === 'paused') this.state.phase = 'running'; }

  advance(delta: number) {
    const dt = CONFIG.physics.step;
    this.accumulator = Math.min(this.accumulator + clamp(delta, 0, CONFIG.physics.maxFrameDelta), dt * 8);
    let steps = 0;
    while (this.accumulator >= dt && steps < 8) {
      this.step(dt);
      this.accumulator -= dt;
      steps += 1;
    }
    this.alpha = this.accumulator / dt;
  }

  private step(dt: number) {
    const state = this.state;
    if (state.phase !== 'running' && state.phase !== 'finishing') {
      this.input.takeTap();
      return;
    }
    this.prev = { s: state.s, x: state.x, z: state.z, y: state.y };
    state.time += dt;
    if (state.phase === 'running') recordSplit(state);
    const sBefore = state.s;
    const turn = this.input.turn;

    if (state.discipline === 'swim') this.stepSwim(dt, turn);
    else if (state.discipline === 'bike') this.stepBike(dt, turn);
    else if (state.discipline === 'run') this.stepRun(dt, turn);
    else this.stepTransition(dt, turn);

    state.s += state.speed * dt;
    if (state.discipline === 't1' || state.discipline === 't2') {
      const end = state.discipline === 't1' ? T1_END : T2_END;
      if (state.s >= end) {
        state.s = end - 0.001;
        state.speed = 0;
        state.targetSpeed = 0;
        if (this.transitionPrompt !== state.discipline) {
          notice(this.state, state.discipline === 't1' ? '按空格上车，进入骑行' : '按空格换跑鞋，进入跑步', 4);
          this.transitionPrompt = state.discipline;
        }
      }
    } else {
      this.transitionPrompt = null;
    }
    state.u += state.vx * dt;
    state.topSpeed = Math.max(state.topSpeed, state.speed);
    applyBoundary(state);
    state.x = xAt(state.s, state.u);
    state.z = zAt(state.s, state.u);
    this.vertical(dt, surfaceHeight(state.s, state.u));
    state.wobble = Math.max(0, state.wobble - dt * 1.35);

    if (state.phase === 'running') {
      checkGates(state, sBefore);
      checkPickups(state);
      scanObstacles(state, sBefore);
    }

    if (state.phase === 'running' && reachedFinish(state)) {
      state.phase = 'finishing';
      closeSplit(state);
      state.finishTime = state.time;
      award(state, CONFIG.scoring.finish, 'finish', CONFIG.text.finish, 1.5);
      notice(state, `冲线 ${(state.time / 60 | 0)}:${(state.time % 60).toFixed(1)}`, 4);
    } else if (state.phase === 'finishing' && (state.s >= COURSE_LENGTH || state.time > state.finishTime + 6)) {
      state.phase = 'results';
    }
  }

  /**
   * Lateral velocity is a rate in the route's own frame: `u` is already measured from
   * the centre line, so the road's drift is baked into the coordinate and does not have
   * to be cancelled here. That leaves the keys to move the athlete across the road and
   * the centrifugal term — the part that has to be answered — as the only pressure;
   * releasing the keys eases the athlete back toward the centre at `lineReturn`.
   */
  private steer(dt: number, turn: number, maxLateral: number, response: number) {
    const state = this.state;
    const blend = 1 - Math.exp(-response * dt);
    const settle = -state.u * CONFIG.physics.lineReturn * (1 - Math.abs(turn));
    const delta = (turn * maxLateral + settle - state.vx) * blend;
    state.vx += clamp(delta, -110 * dt, 110 * dt);
  }

  private approach(target: number, accel: number, dt: number) {
    const state = this.state;
    const diff = target - state.speed;
    state.speed += Math.sign(diff) * Math.min(Math.abs(diff), accel * dt);
  }

  /** Space is effort, Shift is relief. Which one is active sets the stamina rate. */
  private spend(d: { drain: number; surgeDrain: number; easeDrain: number }, dt: number) {
    const state = this.state;
    const finishing = state.phase === 'finishing';
    const raw = finishing ? -22 : state.easing ? d.easeDrain : state.effort > 1.05 ? d.surgeDrain : d.drain;
    const rate = raw;
    const before = state.stamina;
    state.stamina = clamp(state.stamina - rate * dt, 0, CONFIG.stamina.max);
    return { empty: before < 1 && state.stamina < 1, drained: state.stamina <= 0.4 };
  }

  private stepSwim(dt: number, turn: number) {
    const state = this.state;
    const d = CONFIG.drive.swim;
    this.input.takeTap();
    state.easing = state.phase === 'running' && this.input.holding('brake');
    const powerful = state.phase === 'running' && !state.easing && this.input.holding('burst') && state.stamina > 0.5;
    state.effort = powerful ? 1.3 : state.easing ? 0.55 : 1;
    this.spend(d, dt);
    const strokeRate = state.phase === 'finishing' ? 2.6 : state.easing ? 3.4 : powerful ? 6.2 : 4.6;
    state.strokePhase += strokeRate * dt;
    state.cadence = strokeRate * 60 / (Math.PI * 2);
    let cap = d.speed * (powerful ? d.surgeCap : state.easing ? d.glideCap : 1);
    if (state.stamina < 1) cap *= CONFIG.stamina.emptyCap;
    state.targetSpeed = cap;
    const maxLateral = d.turnSpeed * (state.easing ? 0.75 : powerful ? 0.85 : 1);
    const dragLoss = 1 - d.turnDrag * Math.min(1, Math.abs(state.vx) / maxLateral);
    this.approach(cap * dragLoss, d.acceleration, dt);
    this.steer(dt, turn, maxLateral, turn !== 0 ? d.turnResponse : d.turnRelease);
    state.vx -= routeCurvature(state.s) * state.speed * state.speed * d.centrifugal * dt;
  }

  private stepBike(dt: number, turn: number) {
    const state = this.state;
    const d = CONFIG.drive.bike;
    const running = state.phase === 'running';
    if (this.input.takeTap() && running && state.time >= state.surgeReadyAt) {
      state.surgeUntil = state.time + d.surgeTime;
      state.surgeReadyAt = state.time + d.surgeCooldown;
      award(state, CONFIG.scoring.burst, 'burst', CONFIG.text.surge, 0.8);
    }
    const surging = state.time < state.surgeUntil;
    state.braking = running && this.input.holding('brake');
    state.easing = false;
    state.effort = surging ? 1.35 : state.braking ? 0.6 : clamp(state.speed / d.speed + 0.25, 0.5, 1.1);
    this.spend(d, dt);
    const grade = slopeAt(state.s);
    state.grade = grade;
    const cap = clamp(d.speed * (surging ? d.surgeCap : 1) * (1 - grade * d.gradeGain),
      d.speed * 0.34, d.speed * 1.32);
    const maxLateral = d.turnSpeed * (surging ? 0.72 : 1);
    const dragLoss = 1 - d.turnDrag * Math.min(1, Math.abs(state.vx) / maxLateral);
    state.targetSpeed = cap * dragLoss;
    if (state.braking) state.speed = Math.max(4, state.speed - d.brake * dt);
    else this.approach(state.targetSpeed, d.acceleration * (grade < -0.02 ? 1.6 : 1), dt);
    const lateral = lateralAccel(state.s, state.speed);
    // Braking is the rescue, so it must not steal the tyre it is relying on; out of the
    // saddle is the unstable one. The time cost of a early squeeze is what hurts.
    const grip = d.grip * (state.braking ? 0.94 : surging ? 0.82 : 1);
    const ratio = Math.abs(lateral) / grip;
    state.gripLoad = ratio;
    const corner = cornerAt(state.s);
    state.cornerLimit = corner ? corner.limit : 0;
    if (corner) {
      if (state.cornerId !== corner.id) {
        this.settleCorner();
        state.cornerId = corner.id;
        state.cornerPeak = 0;
      }
      state.cornerPeak = Math.max(state.cornerPeak, ratio);
      if (ratio > d.slideWarn && !state.cornerDirty && state.time > state.protectionUntil + 0.4) {
        notice(state, `${CONFIG.text.cornerWarn} · 建议 ${Math.round(corner.limit * 3.6)} km/h`, 1.1);
      }
      if (ratio > 1 && state.time > state.protectionUntil) this.slideOut(lateral);
    } else {
      this.settleCorner();
    }
    state.vx -= lateral * d.centrifugal * dt;
    this.steer(dt, turn, maxLateral, turn !== 0 ? d.turnResponse : d.turnRelease);
    state.cadence = 64 + state.speed * 2.1;
  }

  private stepRun(dt: number, turn: number) {
    const state = this.state;
    const d = CONFIG.drive.run;
    this.input.takeTap();
    const bonking = state.time < state.bonkUntil;
    state.easing = state.phase === 'running' && !bonking && this.input.holding('brake');
    const sprinting = state.phase === 'running' && !bonking && !state.easing
      && this.input.holding('burst') && state.stamina > 0.5;
    state.effort = bonking ? 0.4 : sprinting ? 1.3 : state.easing ? 0.6 : 1;
    const { drained } = this.spend(d, dt);
    if (drained && state.phase === 'running' && !bonking) this.bonk();
    const grade = slopeAt(state.s);
    state.grade = grade;
    let cap = d.speed * (sprinting ? d.surgeCap : state.easing ? d.glideCap : 1)
      * (1 - grade * d.gradeGain);
    if (bonking) cap *= CONFIG.stamina.bonkCap;
    if (state.stamina < 1) cap *= CONFIG.stamina.emptyCap;
    state.targetSpeed = cap;
    state.cadence = bonking ? 152 : 166 + (sprinting ? 26 : state.easing ? -8 : 8) + Math.sin(state.time * 2) * 2;
    state.strokePhase += dt * state.cadence * Math.PI / 30;
    const maxLateral = d.turnSpeed * (bonking ? 0.6 : 1);
    const dragLoss = 1 - d.turnDrag * Math.min(1, Math.abs(state.vx) / maxLateral);
    this.approach(cap * dragLoss, d.acceleration, dt);
    this.steer(dt, turn, maxLateral, turn !== 0 ? d.turnResponse : d.turnRelease);
    state.vx -= routeCurvature(state.s) * state.speed * state.speed * d.centrifugal * dt;
  }

  /**
   * The racks are raced like everything else: Space shortens the changeover and pays
   * the stamina the zone would hand back, Shift slows down and breathes deeper.
   */
  private stepTransition(dt: number, turn: number) {
    const state = this.state;
    const d = CONFIG.drive[state.discipline];
    const running = state.phase === 'running';
    const tapped = this.input.takeTap();
    state.braking = false;
    state.easing = running && this.input.holding('brake');
    const quick = running && !state.easing && this.input.holding('burst');
    state.effort = quick ? 1.25 : state.easing ? 0.6 : 0.8;
    this.spend(d, dt);
    const end = state.discipline === 't1' ? T1_END : T2_END;
    const waiting = state.s >= end - 0.001;
    const cap = waiting ? 0 : d.speed * (quick ? d.surgeCap : state.easing ? d.glideCap : 1);
    state.targetSpeed = cap;
    state.cadence = state.discipline === 't1' ? 0 : 172;
    state.strokePhase += dt * (quick ? 9 : 6);
    this.approach(cap, d.acceleration, dt);
    this.steer(dt, turn, d.turnSpeed * (quick ? 0.85 : state.easing ? 0.75 : 1),
      turn !== 0 ? d.turnResponse : d.turnRelease);
    if (running && state.s >= end - 0.35 && (tapped || this.input.holding('burst'))) {
      state.s = end;
      recordSplit(state);
      state.speed = Math.max(state.speed, CONFIG.drive[state.discipline].startSpeed);
      this.transitionPrompt = null;
    }
  }

  private settleCorner() {
    const state = this.state;
    if (!state.cornerId) return;
    const peak = state.cornerPeak;
    if (!state.cornerDirty && peak > 0.45 && peak <= 1 && state.phase === 'running') {
      state.cornersClean += 1;
      award(state, CONFIG.scoring.corner, 'corner', CONFIG.text.cornerClean, 0.7);
    }
    state.cornerId = '';
    state.cornerPeak = 0;
    state.cornerDirty = false;
  }

  private slideOut(lateral: number) {
    const state = this.state;
    state.cornerDirty = true;
    state.wobble = 1;
    beginIncident(state, 'crash', CONFIG.mistake.crashDelta, 0.36);
    state.vx -= Math.sign(lateral) * 2.6;
  }

  private bonk() {
    const state = this.state;
    state.bonkUntil = state.time + CONFIG.stamina.bonkTime;
    state.stamina = CONFIG.stamina.bonkRestore;
    state.bonks += 1;
    state.wobble = 0.8;
    state.effort = 0.4;
    breakCombo(state, -40, 'bonk', CONFIG.text.bonk, 1.2);
  }

  private vertical(dt: number, ground: number) {
    const state = this.state;
    const swim = state.discipline === 'swim';
    const float = swim ? WATER_LEVEL + 0.16 + 0.07 * Math.sin(state.strokePhase) : 0;
    const target = swim ? float : ground;
    const gravity = CONFIG.drive[state.discipline].gravity;
    if (gravity > 0 && state.y - target > 0.06) {
      state.airborne = true;
      state.airTime += dt;
      state.vy -= gravity * dt;
      state.y += state.vy * dt;
      return;
    }
    if (state.airborne) {
      const impact = Math.max(0, -state.vy);
      state.airborne = false;
      state.airTime = 0;
      state.vy = 0;
      state.y = target;
      if (impact > 2.4) pushEvent(state, 'land', 0, clamp(impact / 9, 0.3, 1.5));
      return;
    }
    state.vy = 0;
    state.y += (target - state.y) * Math.min(1, (swim ? 6 : 18) * dt);
  }

  /** Test and preview hook: jump the athlete anywhere on the course. */
  warp(s: number, u = 0, speed?: number) {
    const state = this.state;
    const from = state.discipline;
    state.s = clamp(s, 0, COURSE_LENGTH);
    state.u = clamp(u, -halfWidthAt(state.s) + 1, halfWidthAt(state.s) - 1);
    state.x = xAt(state.s, state.u);
    state.z = zAt(state.s, state.u);
    state.y = surfaceHeight(state.s, state.u);
    state.vx = 0;
    state.vy = 0;
    state.speed = speed ?? CONFIG.drive[disciplineAt(state.s)].speed * 0.8;
    state.discipline = disciplineAt(state.s);
    // A jump is not raced, so the clock must not charge the skipped ground to the new segment.
    if (state.discipline !== from) state.splitAt = state.time;
    this.transitionPrompt = null;
    this.prev = { s: state.s, x: state.x, z: state.z, y: state.y };
  }

  diagnostics() {
    const state = this.state;
    return {
      phase: state.phase, discipline: state.discipline, s: state.s, u: state.u,
      speed: state.speed, stamina: state.stamina, grip: state.gripLoad, wobble: state.wobble,
      score: state.score, combo: state.combo, gates: state.gatesPassed.length,
      missed: state.gatesMissed.length, crashes: state.crashes, contacts: state.contacts,
      bonks: state.bonks, alpha: this.alpha,
    };
  }
}
