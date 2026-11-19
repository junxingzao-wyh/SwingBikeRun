import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BIKE_END, CONFIG, CORNERS, COURSE_LENGTH, FINISH_S, GATES, MARKS, OBSTACLES, PICKUPS, SWIM_END, T1_END, T2_END,
  baseHeight, cornerAt, disciplineAt, halfWidthAt, lateralAccel, setTrack,
  surfaceHeight,
} from '../src/config.ts';
import { Simulation } from '../src/game/simulation.ts';
import { createPropGeometry } from '../src/scene/scenery-models.ts';
import { createAthlete } from '../src/scene/athlete.ts';
import {
  applyBoundary, award, breakCombo, checkGates, checkPickups, createRun, gradeFor,
  multiplierFor, scanObstacles,
} from '../src/game/rules.ts';

/** Seconds of racing from a chosen point on the course. */
function race(seconds: number, at = 0, u = 0, speed?: number) {
  const sim = new Simulation(false);
  sim.start();
  sim.warp(at, u, speed);
  for (let i = 0; i < Math.ceil(seconds * 60); i++) sim.advance(1 / 60);
  return sim;
}

test('里程沿弧长累计，分段之和与比赛时钟对齐', () => {
  const sim = race(8, 400, 0, 19);
  assert.ok(sim.state.s > 480, `8 s of riding should cover ground, got ${sim.state.s}`);
  const tracked = Object.values(sim.state.splits).reduce((total, value) => total + value, 0);
  const open = sim.state.time - sim.state.splitAt;
  assert.ok(Math.abs(tracked + open - sim.state.time) < 1e-6, 'splits must account for the whole clock');
  assert.ok(sim.state.s - 400 <= sim.state.time * CONFIG.drive.bike.speed * 1.2);
});

test('赛程切成 swim / T1 / bike / T2 / run 五段', () => {
  setTrack('classic');
  assert.deepEqual(CONFIG.disciplines.map(item => [item.startS, item.endS]),
    [[0, SWIM_END], [SWIM_END, T1_END], [T1_END, BIKE_END], [BIKE_END, T2_END], [T2_END, COURSE_LENGTH]]);
  assert.deepEqual([10, 310, 600, 960, 1320].map(disciplineAt), ['swim', 't1', 'bike', 't2', 'run']);
  assert.equal(halfWidthAt(100), CONFIG.course.halfWidth.swim);
  assert.equal(halfWidthAt(600), CONFIG.course.halfWidth.bike);
});

test('标志门：压线计分一次，偏出记为 missed', () => {
  for (const gate of GATES) {
    const state = createRun();
    state.s = gate.s + 1;
    state.u = gate.u;
    checkGates(state, gate.s - 1);
    assert.deepEqual(state.gatesPassed, [gate.id], `${gate.id} should be scored`);
    assert.equal(state.score, Math.round(CONFIG.scoring.gate));
  }
  const gate = GATES[1];
  const state = createRun();
  state.s = gate.s + 1;
  state.u = gate.u + gate.width / 2 + 1.5;
  checkGates(state, gate.s - 1);
  assert.deepEqual(state.gatesMissed, [gate.id]);
  assert.equal(state.gatesPassed.length, 0);
  assert.equal(state.score, 0);
});

test('贴着拱门立柱内侧通过仍算过门，不会误判偏出', () => {
  for (const gate of GATES.filter(item => item.kind !== 'buoy')) {
    const opening = (gate.width + 4.4) / 2;
    const inside = createRun();
    inside.s = gate.s + 1;
    inside.u = gate.u + opening - 0.8;
    checkGates(inside, gate.s - 1);
    assert.deepEqual(inside.gatesPassed, [gate.id],
      `${gate.id} 在立柱内侧 ${(opening - 0.8).toFixed(2)}m 应算过门`);

    const outside = createRun();
    outside.s = gate.s + 1;
    outside.u = gate.u + opening + 0.6;
    checkGates(outside, gate.s - 1);
    assert.deepEqual(outside.gatesMissed, [gate.id], `${gate.id} 在立柱外侧应算偏出`);
  }
});

test('补给只能拾取一次，并回补体力', () => {
  const pickup = PICKUPS[6];
  const state = createRun();
  state.stamina = 40;
  state.s = pickup.s;
  state.u = pickup.u;
  checkPickups(state);
  assert.deepEqual(state.pickupsTaken, [pickup.id]);
  assert.ok(state.stamina > 40);
  const before = state.score;
  checkPickups(state);
  assert.equal(state.score, before, 'a second pass must not pay again');
  assert.equal(state.pickupsTaken.length, 1);
});

test('障碍按纪律分级：骑行段按摔车计，游泳段按接触计', () => {
  const barrier = OBSTACLES.find(obstacle => obstacle.discipline === 'bike')!;
  const bike = createRun();
  bike.discipline = 'bike';
  bike.time = 5;
  bike.s = barrier.s;
  bike.u = barrier.u;
  assert.ok(scanObstacles(bike));
  assert.equal(bike.crashes, 1);
  assert.ok(bike.time < bike.protectionUntil, 'a crash buys a moment of protection');

  const kayak = OBSTACLES.find(obstacle => obstacle.discipline === 'swim')!;
  const swim = createRun();
  swim.discipline = 'swim';
  swim.time = 5;
  swim.s = kayak.s;
  swim.u = kayak.u;
  assert.ok(scanObstacles(swim));
  assert.equal(swim.contacts, 1);
  assert.equal(swim.crashes, 0);
});

test('弯道超速会滑出：巡航速度安全，抓地比越过 1 才失控', () => {
  assert.ok(CORNERS.length > 0, 'the lake road needs corners');
  for (const corner of CORNERS) {
    const mid = (corner.from + corner.to) / 2;
    assert.equal(cornerAt(mid)?.id, corner.id);
    const cruising = Math.abs(lateralAccel(mid, CONFIG.drive.bike.speed)) / CONFIG.drive.bike.grip;
    assert.ok(cruising < 0.95, `${corner.id} 巡航抓地比 ${cruising.toFixed(2)} 不该在正常速度摔车`);
  }
  const tightest = CORNERS.reduce((worst, corner) =>
    Math.abs(corner.curvature) > Math.abs(worst.curvature) ? corner : worst);
  assert.ok(tightest.limit < CONFIG.drive.bike.speed * 1.1,
    'the hairpin still asks for a small lift before it is taken flat out');
  const corner = cornerAt(572) ?? CORNERS[0];
  const fast = race(1.2, corner.from + 8, 0, corner.limit * 1.5);
  assert.ok(fast.state.crashes >= 1, 'over the limit the rear wheel should let go');
  assert.equal(fast.state.cornerDirty, true);
  assert.equal(fast.state.discipline, 'bike');
});

test('跟刹车压住抓地：过弯干净可以计分', () => {
  const corner = cornerAt(572) ?? CORNERS[0];
  const sim = new Simulation(false);
  sim.start();
  sim.warp(corner.from - 6, 0, corner.limit);
  // A threshold driver: lift when the grip meter climbs, back on when it falls.
  for (let i = 0; i < 420; i++) {
    if (sim.state.gripLoad > 0.7) sim.input.press('key:ShiftLeft', 'brake');
    else sim.input.release('key:ShiftLeft');
    sim.advance(1 / 60);
  }
  assert.equal(sim.state.crashes, 0, 'modulation should stay on the tyre');
  assert.ok(sim.state.s > corner.to, 'and still carry the athlete out of the corner');
  assert.ok(sim.state.cornersClean >= 1, 'a corner ridden at 45-100% of grip is a clean corner');
  assert.ok(sim.state.score > 0);
});

test('体力见底会撞墙：速度上限掉、连击清零', () => {
  const sim = new Simulation(false);
  sim.start();
  sim.warp(1000, 0, 6);
  sim.state.stamina = 3;
  sim.state.combo = 4;
  let steps = 0;
  while (sim.state.bonks === 0 && steps < 1500) { sim.advance(1 / 60); steps += 1; }
  assert.ok(sim.state.bonks >= 1, 'empty legs should force a bonk');
  assert.equal(sim.state.discipline, 'run');
  assert.equal(sim.state.combo, 0);
  assert.ok(sim.state.time < sim.state.bonkUntil);
  assert.equal(sim.state.stamina, CONFIG.stamina.bonkRestore);
  const cap = CONFIG.drive.run.speed * CONFIG.stamina.bonkCap;
  for (let i = 0; i < 60; i++) sim.advance(1 / 60);
  assert.ok(sim.state.speed <= cap + 0.4, `bonking should cap speed at ${cap.toFixed(1)} m/s`);
});

test('离开赛道被夹回，并且只扣一次', () => {
  const state = createRun();
  state.discipline = 'bike';
  state.s = 600;
  state.u = halfWidthAt(600) + 4;
  assert.equal(applyBoundary(state), true);
  assert.ok(Math.abs(state.u) <= halfWidthAt(600));
  assert.equal(state.mistakes, 1);
  assert.equal(state.combo, 0);
  assert.equal(applyBoundary(state), true);
  assert.equal(state.mistakes, 1, 'one exit is one mistake, not one per frame');
  state.u = 0;
  assert.equal(applyBoundary(state), false);
});

test('冲线：先结算分段、记录成绩，再进入结果页', () => {
  const sim = race(3, FINISH_S - 12, 0, 6.2);
  assert.equal(sim.state.phase, 'finishing');
  assert.ok(sim.state.finishTime > 0);
  assert.ok(sim.state.events.some(event => event.kind === 'finish'));
  const tracked = Object.values(sim.state.splits).reduce((total, value) => total + value, 0);
  assert.ok(Math.abs(tracked + (sim.state.time - sim.state.splitAt) - sim.state.time) < 1e-6);
  const grade = gradeFor(sim.state);
  assert.match(grade, /^[SABC]$/);
  for (let i = 0; i < 480; i++) sim.advance(1 / 60);
  assert.equal(sim.state.phase, 'results');
  assert.ok(sim.state.s < COURSE_LENGTH + 1);
});

test('暂停与恢复冻结时钟，恢复后继续走行', () => {
  const sim = race(2, 600, 0, 18);
  sim.pause();
  const { s, time } = sim.state;
  for (let i = 0; i < 60; i++) sim.advance(1 / 60);
  assert.equal(sim.state.s, s);
  assert.equal(sim.state.time, time);
  sim.resume();
  for (let i = 0; i < 60; i++) sim.advance(1 / 60);
  assert.ok(sim.state.s > s);
});

test('连击倍率随得分累积，失误清零', () => {
  const state = createRun();
  assert.equal(multiplierFor(state), 1);
  award(state, 100, 'gate', '过标');
  award(state, 100, 'gate', '过标');
  award(state, 100, 'gate', '过标');
  assert.equal(state.combo, 3);
  assert.equal(multiplierFor(state), CONFIG.combo.firstMultiplier);
  const scored = state.score;
  breakCombo(state, -40, 'crash', '摔车');
  assert.equal(state.combo, 0);
  assert.equal(state.score, scored - 40);
  assert.equal(state.mistakes, 1);
  assert.ok(state.bestCombo >= 3, 'the best streak of the race survives the crash');
});

test('T1 / T2 到出口后等待玩家按空格确认换项', () => {
  for (const [end, from, next] of [[T1_END, 't1', 'bike'], [T2_END, 't2', 'run']] as const) {
    const sim = new Simulation(false);
    sim.start();
    sim.warp(end - 0.25, 0, 5);
    for (let i = 0; i < 60; i++) sim.advance(1 / 60);
    assert.equal(sim.state.discipline, from);
    assert.ok(sim.state.s < end, 'the exit must not change discipline automatically');
    assert.equal(sim.state.speed, 0);
    for (let i = 0; i < 60; i++) {
      sim.advance(1 / 60);
      assert.equal(sim.state.speed, 0, 'waiting at the exit must not oscillate');
    }
    sim.input.press('key:Space', 'burst');
    sim.advance(1 / 60);
    sim.input.release('key:Space');
    assert.equal(sim.state.discipline, next);
    assert.ok(sim.state.s >= end);
    assert.ok(sim.state.speed > 0);
  }
});

test('换项边界地形高度连续，不再生成遮挡相机的竖墙', () => {
  for (const edge of [SWIM_END, T1_END, BIKE_END, T2_END]) {
    const delta = Math.abs(baseHeight(edge + 0.001) - baseHeight(edge - 0.001));
    assert.ok(delta < 0.01, `height seam at ${edge}m is ${delta}`);
  }
});

test('障碍判定使用同一赛段，并覆盖高速跨过碰撞带的一帧', () => {
  const barrier = OBSTACLES.find(obstacle => obstacle.discipline === 'bike')!;
  const state = createRun();
  state.discipline = 'run';
  state.time = 5;
  state.s = barrier.s;
  state.u = barrier.u;
  assert.equal(scanObstacles(state), null);
  state.discipline = 'bike';
  state.s = barrier.s + 2;
  assert.ok(scanObstacles(state, barrier.s - 2));
  assert.equal(state.crashes, 1);
  assert.equal(state.mistakes, 1);
});

test('warp 落到真实地形：出水即上岸，骑行即上路', () => {
  const sim = new Simulation(false);
  for (const s of [10, 200, 320, 700, 1250]) {
    sim.warp(s, 2);
    assert.equal(sim.state.discipline, disciplineAt(s));
    assert.ok(Math.abs(sim.state.y - surfaceHeight(s, sim.state.u)) < 1e-6);
    assert.ok(sim.state.speed > 0);
  }
  sim.warp(100, -40, 5);
  assert.ok(Math.abs(sim.state.u) <= halfWidthAt(100), 'warp stays inside the channel');
});

test('障碍碰撞盒贴合实际模型，撞点不再和看到的模型错位', () => {
  const bounds = (kind: 'kayak' | 'cone' | 'tent') => {
    const geometry = createPropGeometry(kind, 0, 'near');
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());
    geometry.dispose();
    return size;
  };
  const kayak = bounds('kayak');
  const swim = OBSTACLES.find(obstacle => obstacle.discipline === 'swim')!;
  assert.ok(Math.abs(swim.thickness - kayak.z) < 0.2, `桨船长 ${kayak.z}，碰撞盒 ${swim.thickness}`);
  assert.ok(Math.abs(swim.width - kayak.x) < 0.2, `桨船宽 ${kayak.x}，碰撞盒 ${swim.width}`);

  const barrier = OBSTACLES.find(obstacle => obstacle.discipline === 'bike')!;
  const cone = bounds('cone');
  const barWidth = 2.4 + cone.x;
  assert.ok(barWidth - barrier.width > 0 && barrier.width > 2.4,
    `路障视觉宽 ${barWidth}，碰撞盒 ${barrier.width}`);

  const tent = bounds('tent');
  const camp = OBSTACLES.find(obstacle => obstacle.discipline === 'run')!;
  assert.ok(Math.abs(camp.width - tent.x * 0.82) < 0.3, `帐篷宽 ${tent.x * 0.82}，碰撞盒 ${camp.width}`);
  assert.ok(Math.abs(camp.thickness - tent.z * 0.82) < 0.3, `帐篷长 ${tent.z * 0.82}，碰撞盒 ${camp.thickness}`);
});

test('撞上骑行路障时提示的是路障，而不是弯道失控', () => {
  const barrier = OBSTACLES.find(obstacle => obstacle.discipline === 'bike')!;
  const state = createRun();
  state.discipline = 'bike';
  state.time = 5;
  state.s = barrier.s;
  state.u = barrier.u;
  assert.ok(scanObstacles(state));
  assert.match(state.notice ?? '', /路障/);
});

test('跑步赛段是一条连续跑道，木栈道已经拿掉', () => {
  const ids: string[] = MARKS.map(mark => mark.id);
  const labels: string[] = MARKS.map(mark => mark.zh);
  assert.equal(ids.includes('boardwalk'), false, '木栈道路标不该还在');
  assert.equal(labels.includes('木栈道'), false, '不该还有木栈道的牌子');
  assert.ok(MARKS.some(mark => mark.id === 'greenway' && mark.s >= T2_END && mark.s < FINISH_S));
});

test('换装发生在换项区内：泳帽泳镜在装备架脱掉，头盔在出口前戴上', () => {
  const athlete = createAthlete();
  const piece = (name: string) => athlete.body.getObjectByName(name)!;
  const shoe = () => athlete.group.getObjectByName('shoe')!;
  athlete.dress('swim', 40);
  assert.equal(piece('goggles').visible, true);
  assert.equal(piece('swim-buoy').visible, true);
  assert.equal(piece('run-cap').visible, false);
  assert.equal(shoe().visible, false, '游泳时应该赤脚');
  assert.equal(athlete.bike.group.visible, false);

  // 刚进 T1 还穿着整套游泳装备，过了装备架才摘掉。
  athlete.dress('t1', SWIM_END + 3);
  assert.equal(piece('goggles').visible, true);
  athlete.dress('t1', SWIM_END + (T1_END - SWIM_END) * 0.4);
  assert.equal(piece('goggles').visible, false, '注册线之后就该摘泳镜');
  assert.equal(piece('swim-buoy').visible, false);
  assert.equal(piece('aero-helmet').visible, false);
  athlete.dress('t1', T1_END - 2);
  assert.equal(piece('aero-helmet').visible, true, '到上车线前头盔已经戴好');

  athlete.dress('bike', 520);
  assert.equal(piece('aero-helmet').visible, true);
  assert.equal(piece('run-cap').visible, false);
  assert.equal(athlete.bike.group.visible, true);

  // T2：先摘头盔，挂好车再戴白帽、别号码布、系补给腰带。
  athlete.dress('t2', BIKE_END + 2);
  assert.equal(piece('aero-helmet').visible, true);
  athlete.dress('t2', T2_END - 2);
  assert.equal(piece('aero-helmet').visible, false);
  assert.equal(piece('race-bib').visible, true);
  assert.equal(piece('run-cap').visible, true);
  assert.equal(piece('race-belt').visible, true);
  assert.equal(athlete.bike.group.visible, false);

  athlete.dress('run', 1120);
  assert.equal(piece('run-cap').visible, true);
  assert.equal(piece('aero-helmet').visible, false);
  assert.equal(shoe().visible, true);
  athlete.dispose();
});
