import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connect } from './cdp.mjs';
import {
  BIKE_END, CONFIG, CORNERS, COURSE_LENGTH, FINISH_S, GATES, OBSTACLES, PICKUPS, SWIM_END, T1_END, T2_END, centerAt,
} from '../src/config.ts';

const port = Number(process.env.CDP_PORT || 9230);
const url = process.env.TEST_URL || 'http://127.0.0.1:5193/?diagnostics';
const output = resolve(process.env.TEST_OUTPUT || 'screenshots');
const mode = process.argv[2] || 'desktop';

const c = await connect(port);
const wait = ms => new Promise(done => setTimeout(done, ms));
const reports = { mode, url, capturedAt: new Date().toISOString(), checks: [], runs: [] };
const check = (name, condition = true, detail) => {
  assert.ok(condition, `${name}${detail ? ` — ${detail}` : ''}`);
  reports.checks.push(name);
  console.log('PASS', name);
};
const shot = name => c.screenshot(resolve(output, `${mode}-${name}.png`));
const state = () => c.evaluate('window.__lakeline.state()');
const read = () => c.evaluate('window.__lakeline.read()');
const warp = (s, u = 0, speed) =>
  c.evaluate(`window.__lakeline.warp(${s}, ${u}${speed === undefined ? '' : `, ${speed}`})`);
/** Sample the same physics functions the live race uses, without loading another module copy. */
const press = (code, down = true) => c.key(code, down);

/** Floating panels must stay on screen and out of each other's way. */
async function checkLayout(name, selectors) {
  const layout = await c.evaluate(`(() => {
    const boxes = [...document.querySelectorAll(${JSON.stringify(selectors)})].map(e => {
      const r = e.getBoundingClientRect();
      return { name: e.className || e.getAttribute('aria-label'), left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    }).filter(r => r.width && r.height);
    return { width: innerWidth, height: innerHeight, boxes };
  })()`);
  (reports.layouts ??= []).push({ name, ...layout });
  for (const r of layout.boxes) {
    assert.ok(r.left >= -1 && r.top >= -1 && r.right <= layout.width + 1 && r.bottom <= layout.height + 1,
      `${name}: ${r.name} escapes viewport ${JSON.stringify(r)}`);
  }
  for (let i = 0; i < layout.boxes.length; i += 1) {
    for (const b of layout.boxes.slice(i + 1)) {
      const a = layout.boxes[i];
      const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      assert.ok(width <= 1 || height <= 1,
        `${name}: ${a.name} overlaps ${b.name} ${JSON.stringify({ a, b })}`);
    }
  }
  check(`${name} panels fit without overlapping`);
}

const runningLayout = name => checkLayout(name,
  '.brand, .settings, .hud-left, .hud-right, .progress-wrap, .speedometer, .run-help, .tech-card, .transition-card, .touch-controls button');

async function ready() {
  await c.send('Page.navigate', { url });
  await c.until('!!window.__lakeline', 30000);
  await c.until('window.__lakeline.state().phase==="ready"', 30000);
  await c.evaluate('document.fonts.ready');
}

async function cover() {
  const info = await c.evaluate(`(() => {
    const brand = document.querySelector('.brand');
    return {
      headline: [...document.querySelectorAll('.intro-display > span')].map(e => e.textContent),
      start: [...document.querySelector('.start-button').childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim(),
      decorativeSticker: document.querySelectorAll('.start-button > .start-sticker[aria-hidden="true"]').length === 1,
      segments: [...document.querySelectorAll('.segment-row b')].map(e => e.textContent),
      stats: [...document.querySelectorAll('.trail-stats strong')].map(e => e.textContent),
      help: !!document.querySelector(matchMedia('(pointer: coarse)').matches ? '.mobile-help' : '.desktop-help'),
      brandText: brand.querySelector('small').textContent,
      overflow: document.documentElement.scrollWidth === innerWidth && document.documentElement.scrollHeight === innerHeight,
    };
  })()`);
  check('cover shows the three-word headline', JSON.stringify(info.headline) === JSON.stringify(CONFIG.brand.headline));
  check('start button reads the Chinese label', info.start === CONFIG.text.start, info.start);
  check('the repeating sticker is decorative only', info.decorativeSticker);
  check('all five course rows are listed on the cover', info.segments.length === CONFIG.disciplines.length, info.segments.join(','));
  check('cover stats are distance, gates and aid points',
    JSON.stringify(info.stats) === JSON.stringify([(COURSE_LENGTH / 1000).toFixed(2), `${GATES.length}`, `${PICKUPS.length}`]));
  check('brand keeps the Chinese title', info.brandText === CONFIG.brand.title);
  check('control help is visible', info.help);
  check('cover has no page overflow', info.overflow);
  await checkLayout('cover', '.brand, .settings, .intro, .intro-details');
  await shot('cover');
}

/**
 * Drive the racing line through a corner the way the help text tells the player to:
 * hold the centre, squeeze the brake whenever the grip meter climbs.
 */
async function throughCorner(corner) {
  let held = null;
  let braking = false;
  const setSteer = async (key) => {
    if (held === key) return;
    if (held) await c.key(held, false);
    if (key) await c.key(key);
    held = key;
  };
  const setBrake = async (on) => {
    if (on === braking) return;
    await c.key('ShiftLeft', on);
    braking = on;
  };
  try {
    for (;;) {
      const s = await state();
      if (s.s >= corner.to || s.phase !== 'running') return s;
      const error = -s.x + centerAt(s.s);
      await setSteer(error > 0.4 ? 'ArrowRight' : error < -0.4 ? 'ArrowLeft' : null);
      await setBrake(s.gripLoad > 0.7);
      await wait(70);
    }
  } finally {
    await setSteer(null);
    await setBrake(false);
  }
}

/** Sit at the start of a discipline, then let the clock run so the camera settles. */
async function at(s, speed) {
  await warp(s, 0, speed);
  await wait(420);
  return state();
}

async function startRun() {
  if (mode === 'desktop') await c.click('.start-button');
  else {
    const point = await c.evaluate(`(()=>{const r=document.querySelector('.start-button').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,id:1,radiusX:8,radiusY:8,force:1}})()`);
    await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [point] });
  }
  await c.until('window.__lakeline.state().phase==="running"', 15000);
  await c.until('window.__lakeline.state().s>2', 15000);
}

/**
 * Race the whole course without teleports: aim at the next gate, squeeze the brake when
 * the grip meter climbs, and press on the effort key only while there is stamina for it.
 */
async function follow({ capture = false, timeout = 420000 } = {}) {
  let steerKey = null;
  let brakeKey = false;
  let effortKey = false;
  let surgedAt = -99;
  const seen = new Set();
  const setSteer = async (key) => {
    if (steerKey === key) return;
    if (steerKey) await press(steerKey, false);
    if (key) await press(key);
    steerKey = key;
  };
  const setBrake = async (on) => {
    if (on === brakeKey) return;
    await press('ShiftLeft', on);
    brakeKey = on;
  };
  const setEffort = async (on) => {
    if (on === effortKey) return;
    await press('Space', on);
    effortKey = on;
  };
  const start = Date.now();
  try {
    for (;;) {
      const s = await state();
      if (s.phase === 'results') return s;
      if (s.phase === 'paused') { await c.click('.pause-card .primary'); continue; }
      const next = GATES.find(gate => gate.s > s.s + 4
        && !s.gatesPassed.includes(gate.id) && !s.gatesMissed.includes(gate.id));
      const target = next && next.s - s.s < 60 ? next.u : 0;
      const error = target - (s.x - centerAt(s.s + 10));
      await setSteer(error > 0.45 ? 'ArrowRight' : error < -0.45 ? 'ArrowLeft' : null);
      if (s.discipline === 't1' || s.discipline === 't2') {
        await setEffort(false);
        await setBrake(false);
        const end = s.discipline === 't1' ? T1_END : T2_END;
        if (end - s.s < 0.35) {
          await press('Space'); await press('Space', false);
        }
      } else if (s.discipline === 'swim' || s.discipline === 'run') {
        // Push only while the tank is half-full; below that the release key buys the stamina back.
        await setEffort(s.stamina > 72);
        await setBrake(s.stamina < 40);
      } else {
        await setEffort(false);
        await setBrake(s.discipline === 'bike' && s.gripLoad > 0.7);
        if (s.discipline === 'bike' && s.time - surgedAt > 10) {
          surgedAt = s.time;
          await press('Space'); await press('Space', false);
        }
      }
      if (capture) {
        for (const [distance, name] of [[150, 'swim'], [420, 'bike-open'], [700, 'bike'], [1120, 'run']]) {
          if (s.s > distance && !seen.has(name)) {
            seen.add(name);
            await shot(`drive-${name}`);
          }
        }
      }
      if (Date.now() - start > timeout) throw Error('the driven race never reached the line');
      await wait(80 + Math.random() * 60);
    }
  } finally {
    await setSteer(null);
    await setBrake(false);
    await setEffort(false);
  }
}

try {
  reports.browser = await c.send('Browser.getVersion');
  await c.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 0, right: 0, bottom: 0 } });
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  if (mode === 'desktop') {
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  } else {
    await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
  await ready();
  if ((await read()).graphics.mapStyle !== 'classic') {
    await c.click('.map-button');
    await ready();
  }
  await wait(900);
  const initial = await read();
  reports.environment = await c.evaluate('({screen:[innerWidth,innerHeight],dpr:devicePixelRatio,cores:navigator.hardwareConcurrency})');
  check('the lake course is built', initial.graphics.triangles > 40000 && initial.graphics.calls > 8,
    JSON.stringify({ triangles: initial.graphics.triangles, calls: initial.graphics.calls }));
  check('every gate and pickup has a scene object',
    initial.graphics.course.gates === GATES.length && initial.graphics.course.pickups === PICKUPS.length,
    JSON.stringify(initial.graphics.course));
  await cover();

  const courseNames = () => c.evaluate(
    'window.__lakeline.objects().scene.children.filter(o => o.name.startsWith("course-")).map(o => o.name)');
  const classicCourses = await courseNames();
  check('the classic map builds exactly one course',
    JSON.stringify(classicCourses) === JSON.stringify(['course-classic']), JSON.stringify(classicCourses));

  await startRun();
  const swim = await at(40, CONFIG.drive.swim.speed * 0.8);
  check('the race opens in the water', swim.discipline === 'swim' && swim.s > 30);
  check('audio unlocks on the first gesture', (await read()).audio.state === 'running');

  // Steering: one axis, two directions, and it must actually move the athlete sideways.
  const before = (await state()).x;
  if (mode === 'desktop') {
    await c.key('ArrowRight'); await wait(700); await c.key('ArrowRight', false);
  } else {
    const point = await c.evaluate(`(()=>{const r=document.querySelector('[aria-label="向右"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,id:1,radiusX:8,radiusY:8,force:1}})()`);
    await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await wait(700);
    await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [point] });
  }
  check('swimming steers across the lake', Math.abs((await state()).x - before) > 0.4,
    `${before} -> ${(await state()).x}`);

  if (mode === 'desktop') {
    await c.key('Space');
    await c.until('window.__lakeline.state().effort > 1.2', 3000);
    await wait(1400);
    check('holding the stroke key lifts the swim effort', true);
    const drained = (await state()).stamina;
    await c.key('Space', false);
    await c.key('ShiftLeft');
    await c.until('window.__lakeline.state().easing === true', 3000);
    await wait(1300);
    check('drifting with the brake key recovers stamina', (await state()).stamina > drained,
      `${drained} -> ${(await state()).stamina}`);
    await c.key('ShiftLeft', false);
  }
  await runningLayout('swim hud');
  await shot('swim');

  // 图三：右侧中部的技术提示卡要能一键收起 / 展开，不能挡住赛道。
  check('the hint card is on screen by default', await c.evaluate('!!document.querySelector(".tech-card")'));
  await c.evaluate('window.dispatchEvent(new KeyboardEvent("keydown", {code: "KeyH"}))');
  await wait(300);
  check('H hides the right-side hint card',
    (await c.evaluate('!!document.querySelector(".tech-card")')) === false);
  await shot('hints-off');
  await c.evaluate('window.dispatchEvent(new KeyboardEvent("keydown", {code: "KeyH"}))');
  await wait(300);
  check('H brings the hint card back', await c.evaluate('!!document.querySelector(".tech-card")'));

  const t1 = await at((SWIM_END + T1_END) / 2, 4);
  check('leaving the water starts the first transition', t1.discipline === 't1');
  check('the transition card runs the T1 clock', await c.evaluate('!!document.querySelector(".transition-card .transition-head strong")'));
  await runningLayout('transition hud');
  await shot('t1');

  // 换装发生在换项区内：走到出口前头盔已经戴好，泳帽泳镜已经收掉。
  await at(T1_END - 6, 3);
  await wait(240);
  await shot('t1-helmet');

  const t1Waiting = await at(T1_END - 0.8, 4);
  check('T1 waits at the exit for player confirmation',
    t1Waiting.discipline === 't1' && t1Waiting.s < T1_END && t1Waiting.speed === 0,
    JSON.stringify({ discipline: t1Waiting.discipline, s: t1Waiting.s, speed: t1Waiting.speed }));
  check('T1 shows the confirmation prompt',
    (await c.evaluate('document.querySelector(".transition-foot")?.textContent')).includes('待确认'));
  await shot('t1-confirm');
  await press('Space'); await press('Space', false);
  await c.until('window.__lakeline.state().discipline==="bike"', 3000);
  check('Space confirms the bike changeover', true);

  const bike = await at(520, CONFIG.drive.bike.speed);
  check('the highway segment is the bike leg', bike.discipline === 'bike');
  check('the grip meter is live on the bike', await c.evaluate('!!document.querySelector(".grip .meter em")'));
  if (mode === 'desktop') {
    await c.key('Space'); await c.key('Space', false);
    await c.until('window.__lakeline.state().surgeUntil > window.__lakeline.state().time', 4000);
    check('a tap out of the saddle opens a surge', true);
  }
  await wait(900);
  await runningLayout('bike hud');
  await shot('bike');

  const barrier = OBSTACLES.find(obstacle => obstacle.discipline === 'bike');
  await warp(360, 0, 0);
  // Long enough for any earlier crash's protection window (1.2s + 1.55s) to expire.
  await wait(3200);
  const beforeBarrier = await state();
  await warp(barrier.s - 2, barrier.u, 10);
  await c.until(`window.__lakeline.state().crashes > ${beforeBarrier.crashes}`, 5000);
  check('a cycling barrier triggers a crash', (await state()).mistakes > beforeBarrier.mistakes);

  // Braking must survive a corner: hold the line and squeeze through the tightest turn.
  const tight = CORNERS.filter(corner => corner.discipline === 'bike').sort((a, b) => a.limit - b.limit)[0];
  const beforeCorner = (await state()).crashes;
  await warp(tight.from + 4, 0, Math.min(tight.limit * 1.05, CONFIG.drive.bike.speed));
  const cornered = mode === 'desktop'
    ? await throughCorner(tight)
    : await at(tight.to - 6, tight.limit);
  check(`held the line through ${tight.id} without a new crash`,
    cornered.crashes === beforeCorner && cornered.discipline === 'bike' && cornered.s >= tight.to,
    JSON.stringify({ beforeCorner, crashes: cornered.crashes, discipline: cornered.discipline, s: Math.round(cornered.s) }));

  const t2 = await at((BIKE_END + T2_END) / 2, 4);
  check('the second transition opens after the bike', t2.discipline === 't2');
  const t2Waiting = await at(T2_END - 0.8, 4);
  check('T2 waits at the exit for player confirmation',
    t2Waiting.discipline === 't2' && t2Waiting.s < T2_END && t2Waiting.speed === 0,
    JSON.stringify({ discipline: t2Waiting.discipline, s: t2Waiting.s, speed: t2Waiting.speed }));
  check('T2 shows the confirmation prompt',
    (await c.evaluate('document.querySelector(".transition-foot")?.textContent')).includes('待确认'));
  await shot('t2-confirm');
  await press('Space'); await press('Space', false);
  await c.until('window.__lakeline.state().discipline==="run"', 3000);
  check('Space confirms the run changeover', true);

  // The T2 exit used to hand over to a timber boardwalk; the whole leg is track now.
  await at(1024, CONFIG.drive.run.speed);
  await wait(600);
  await shot('run-track');

  const run = await at(FINISH_S - 120, CONFIG.drive.run.speed);
  check('the greenway is the run leg', run.discipline === 'run');
  await wait(700);
  await runningLayout('run hud');
  await shot('run');

  const camp = OBSTACLES.find(obstacle => obstacle.discipline === 'run');
  await warp(1000, 0, 0);
  await wait(3200);
  const beforeCamp = await state();
  await warp(camp.s - 2, camp.u, 6);
  await c.until(`window.__lakeline.state().contacts > ${beforeCamp.contacts}`, 5000);
  check('a running course obstacle triggers contact', (await state()).mistakes > beforeCamp.mistakes);
  await shot('run-contact');

  // The last pass is a real race: no teleports, so every split has to be earned.
  await ready();
  await startRun();
  const finished = await follow({ capture: true });
  check('one driven race covers the whole course',
    finished.phase === 'results' && finished.splits.swim > 0 && finished.splits.t1 > 0
    && finished.splits.bike > 0 && finished.splits.t2 > 0 && finished.splits.run > 0,
    JSON.stringify({ phase: finished.phase, splits: finished.splits }));
  check('the driven race takes gates', finished.gatesPassed.length + finished.gatesMissed.length === GATES.length,
    JSON.stringify({ passed: finished.gatesPassed.length, missed: finished.gatesMissed.length, total: GATES.length }));
  reports.runs.push({ kind: 'driven', time: finished.time, score: finished.score, splits: finished.splits,
    gatesPassed: finished.gatesPassed.length, gatesMissed: finished.gatesMissed.length,
    crashes: finished.crashes, contacts: finished.contacts, bonks: finished.bonks });
  check('the clock stops charging at the line',
    finished.finishTime > 0 && finished.time >= finished.finishTime && finished.time - finished.finishTime < 6.5,
    JSON.stringify({ finishTime: finished.finishTime, time: finished.time }));
  check('the finish awards a rank and a grade', finished.finishTime > 0 && finished.score >= 0);
  // The phase flips a tick before React commits the card, so wait for the table itself.
  await c.until('!!document.querySelector(".split-table tbody tr")', 10000);
  const cards = await c.evaluate(`(() => ({
    rows: document.querySelectorAll('.split-table tbody tr').length,
    grade: document.querySelector('.grade')?.textContent,
    time: document.querySelector('.result-main strong')?.textContent,
  }))()`);
  check('the results card lists all five splits', cards.rows === CONFIG.disciplines.length, JSON.stringify(cards));
  check('the results card shows time and grade', !!cards.time && !!cards.grade, JSON.stringify(cards));
  await checkLayout('results', '.brand, .settings, .result-card');
  await shot('results');

  await c.click('.result-card .primary');
  await c.until('window.__lakeline.state().phase==="running"', 10000);
  const replay = await state();
  check('replay restarts from the water with a clean slate',
    replay.time < 1 && replay.score === 0 && replay.discipline === 'swim'
    && replay.crashes === 0 && replay.gatesPassed.length === 0
    && replay.events.every(event => event.kind === 'split'),
    JSON.stringify({ time: replay.time, score: replay.score, events: replay.events.map(event => event.kind) }));

  await c.key('Escape'); await c.key('Escape', false);
  await c.until('window.__lakeline.state().phase==="paused"', 5000);
  const frozen = await state();
  await wait(500);
  check('pause freezes the race clock', JSON.stringify(frozen) === JSON.stringify(await state()));
  check('pause clears held keys', (await read()).input.held.length === 0);
  await checkLayout('pause', '.pause-card');
  await shot('paused');
  await c.click('.pause-card .primary');
  await c.until('window.__lakeline.state().phase==="running"', 5000);

  if (mode === 'desktop') {
    await c.click('.motion-button');
    check('the motion toggle is applied to the shell',
      await c.evaluate('document.querySelector("main").classList.contains("reduced-motion")'));
    await c.click('.motion-button');
  }
  check('the scene is still drawing after the full run', (await read()).graphics.triangles > 0
    && (await read()).graphics.calls > 8, JSON.stringify((await read()).graphics));
  check('no gate is counted twice', (await state()).gatesPassed.length === new Set((await state()).gatesPassed).size);
} catch (error) {
  reports.error = String(error?.stack || error);
  try {
    reports.lastState = await state();
    await shot('failure');
  } catch {}
  console.error(error);
  process.exitCode = 1;
} finally {
  reports.exceptions = c.events.filter(e => e.method === 'Runtime.exceptionThrown');
  reports.networkFailures = c.events.filter(e => e.method === 'Network.loadingFailed'
    || (e.method === 'Network.responseReceived' && e.params.response.status >= 400));
  reports.console = c.events.filter(e => e.method === 'Runtime.consoleAPICalled')
    .map(e => ({ type: e.params.type, args: e.params.args.map(a => a.value ?? a.description) }));
  const noisy = reports.console.filter(line => line.type === 'error');
  reports.passed = process.exitCode !== 1 && reports.exceptions.length === 0
    && reports.networkFailures.length === 0 && noisy.length === 0;
  check('no uncaught exceptions', reports.exceptions.length === 0, JSON.stringify(reports.exceptions).slice(0, 600));
  check('every resource loaded', reports.networkFailures.length === 0, JSON.stringify(reports.networkFailures).slice(0, 600));
  check('no console errors', noisy.length === 0, JSON.stringify(noisy).slice(0, 600));
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, `${mode}-verification.json`), JSON.stringify(reports, null, 2));
  console.log(reports.passed ? `VERIFIED ${mode}` : `FAILED ${mode}`);
  c.close();
}
