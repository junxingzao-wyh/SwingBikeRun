// Modelling atlas: parks the simulation, then frames every segment and prop from the side,
// the front and above so each mesh can be judged on its own. Requires the dev server and a
// Chrome with remote debugging:
//   npm run dev
//   chrome.exe --headless=new --remote-debugging-port=9230 --user-data-dir=%TEMP%/chrome-shots
//   npm run shots
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from './cdp.mjs';

const PORT = Number(process.env.CDP_PORT || 9230);
const ORIGIN = process.env.SHOT_URL || 'http://127.0.0.1:5193/';
const WIDTH = Number(process.env.SHOT_WIDTH || 1280);
const HEIGHT = Number(process.env.SHOT_HEIGHT || 800);
const ONLY = process.env.SHOT_FILTER ? new RegExp(process.env.SHOT_FILTER) : null;
const OUT_DIR = process.env.SHOT_DIR || 'docs/modeling';

/** Installed once: turns a shot spec into a world-space inspection camera. */
const KIT = `
window.__shotKit = async (spec) => {
  const cfg = await import('/src/config.ts');
  const race = window.__lakeline.objects();
  const three = race.scene;
  three.updateMatrixWorld(true);
  const vec = () => race.camera.position.clone();
  const mat4 = () => race.camera.matrixWorld.clone();
  const basis = (s) => {
    const slope = cfg.centerSlope(s);
    const length = Math.hypot(slope, 1);
    return { fx: slope / length, fz: -1 / length, rx: 1 / length, rz: slope / length };
  };
  const named = (want) => {
    let hit = null;
    three.traverse(object => {
      if (hit || object.name !== want) return;
      const point = vec();
      object.getWorldPosition(point);
      hit = { x: point.x, y: point.y, z: point.z };
    });
    return hit;
  };
  const prop = (kind, at, minS, maxS) => {
    let best = null;
    three.traverse(object => {
      if (!object.isInstancedMesh || !object.name.includes('-' + kind + '-v')) return;
      const matrix = mat4();
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, matrix);
        const point = vec().set(matrix.elements[12], matrix.elements[13], matrix.elements[14]);
        object.localToWorld(point);
        const s = -point.z;
        if (minS !== undefined && s < minS) continue;
        if (maxS !== undefined && s > maxS) continue;
        const distance = Math.abs(s - at);
        if (!best || distance < best.distance) {
          best = { distance, x: point.x, y: point.y, z: point.z, name: object.name, index: i };
        }
      }
    });
    return best;
  };

  let anchor;
  if (spec.prop) anchor = prop(spec.prop.kind, spec.prop.near ?? spec.s, spec.prop.minS, spec.prop.maxS);
  else if (spec.named) anchor = named(spec.named);
  else {
    const x = cfg.xAt(spec.s, spec.u ?? 0);
    anchor = { x, y: cfg.surfaceHeight(spec.s, x), z: -spec.s };
  }
  if (!anchor) return { ok: false, reason: 'anchor missing: ' + (spec.prop?.kind ?? spec.named) };

  const target = [anchor.x, anchor.y + (spec.targetY ?? 1), anchor.z];
  if (spec.view === 'chase') {
    race.inspectView = null;
    return { ok: true, view: 'chase', target };
  }
  const back = spec.back ?? 7, side = spec.side ?? 0, up = spec.up ?? 3;
  const frame = basis(spec.s);
  const position = [
    target[0] - frame.fx * back + frame.rx * side,
    target[1] + up,
    target[2] - frame.fz * back + frame.rz * side,
  ];
  race.inspectView = { position, target, fov: spec.fov ?? 42 };
  return { ok: true, view: 'orbit', position, target, anchor: anchor.name };
};
`;

const game = (file, s, extra = {}) => ({ file, s, view: 'chase', ...extra });
const cam = (file, s, extra) => ({ file, s, view: 'orbit', ...extra });

const SHOTS = [
  // ---------------------------------------------------------------- whole-course plans
  cam('00-plan-swim', 150, { up: 150, back: 26, fov: 46, targetY: 0 }),
  cam('00-plan-bike', 600, { up: 165, back: 30, fov: 46, targetY: 4 }),
  cam('00-plan-run', 1150, { up: 130, back: 24, fov: 46, targetY: 2 }),
  cam('00-horizon-hills', 720, { side: -240, back: 150, up: 55, fov: 58, targetY: 6 }),

  // ---------------------------------------------------------------- swim 0 → 300
  game('10-swim-start', 8),
  cam('11-swim-start-plan', 12, { up: 34, back: 6, fov: 44, targetY: 0 }),
  cam('12-swim-pontoon', 3, { side: -9, back: 5, up: 2.1, fov: 34, targetY: 0.5 }),
  cam('13-swim-arch-face', -16, { back: -13, up: 3.2, fov: 44, targetY: 3.4, named: 'arch-SWIM START' }),
  game('14-swim-buoy-gate', 62),
  cam('15-swim-buoy-close', 62, { side: -7, back: 4, up: 1.6, fov: 30, u: 3, targetY: 1.1 }),
  cam('16-swim-lane-rope', 150, { side: -6.5, back: 7, up: 1.3, fov: 38, u: 8.4, targetY: 0.4 }),
  cam('17-swim-kayak', 172, { side: -7, back: 5, up: 1.4, fov: 32, u: -6, targetY: 0.5 }),
  cam('18-swim-athlete', 120, { side: -6.5, back: 2, up: 1.3, fov: 30, targetY: 0.4, live: true }),
  cam('19-swim-islands', 196, { side: 110, back: 46, up: 16, fov: 52, targetY: 0 }),
  game('20-swim-water-exit', 282),
  cam('21-swim-shore-waterline', 292, { side: -11, back: 6, up: 2.4, fov: 44, u: 16, targetY: 0.4 }),

  // ---------------------------------------------------------------- T1 300 → 330
  game('22-t1-entry', 306),
  cam('23-t1-arch-face', 306, { back: -11, up: 2.8, fov: 42, targetY: 2.8, named: 'arch-T1 换项' }),
  cam('24-t1-plan', 315, { up: 30, back: 5, fov: 42, targetY: 5 }),
  cam('25-t1-racks', 316, { side: -13, back: 4, up: 2.2, fov: 40, targetY: 5 }),
  cam('26-t1-rack-close', 325, { side: -6, back: 4, up: 1.4, fov: 28, targetY: 0.6, prop: { kind: 'rack', near: 325 } }),
  cam('27-t1-athlete', 318, { side: -6, back: 2, up: 1.5, fov: 30, targetY: 0.95, live: true }),

  // ---------------------------------------------------------------- bike 330 → 950
  game('30-bike-causeway', 360),
  cam('31-bike-mark-board', 359, { side: -11, back: 3, up: 2.4, fov: 34, targetY: 2.2, named: 'mark-causeway' }),
  game('32-bike-gate-arch', 445),
  cam('33-bike-gate-face', 452, { back: -13, up: 3.4, fov: 40, targetY: 3.2, named: 'course-gate-g6' }),
  game('34-bike-hairpin', 540),
  cam('35-bike-hairpin-plan', 560, { up: 68, back: 12, fov: 46, targetY: 5 }),
  cam('36-bike-hairpin-arch', 545, { back: -15, up: 4, fov: 44, targetY: 3, named: 'arch-HAIRPIN' }),
  cam('37-bike-cone-close', 574, { side: -6, back: 4, up: 1.1, fov: 26, targetY: 0.4, prop: { kind: 'cone', near: 574 } }),
  cam('38-bike-barrier', 574, { side: -8, back: 5, up: 1.6, fov: 32, u: -4, targetY: 0.9 }),
  cam('39-bike-hazard-sign', 650, { side: 7, back: -2, up: 1.8, fov: 32, u: 10.9, targetY: 1.6 }),
  game('40-bike-ridge', 720),
  cam('41-bike-forest', 692, { side: -58, back: 30, up: 12, fov: 50, targetY: 6 }),
  cam('42-bike-athlete', 700, { side: -6.5, back: 2, up: 1.4, fov: 30, targetY: 0.9, live: true }),
  cam('43-bike-frame-close', 700, { side: -3.4, back: 1.6, up: 1, fov: 24, targetY: 0.75, live: true }),
  cam('44-bike-camp-tent', 826, { side: -9, back: 5, up: 1.8, fov: 34, u: 4, targetY: 1.1 }),
  cam('45-bike-descent-plan', 880, { up: 62, back: 11, fov: 46, targetY: 6 }),
  game('46-bike-aid', 915),
  cam('47-bike-asphalt', 610, { side: -1.6, back: 3.4, up: 0.75, fov: 55, targetY: 0.1 }),
  cam('48-bike-gel', 776, { side: -3.2, back: 2, up: 1.2, fov: 24, u: 0, targetY: 1.75 }),

  // ---------------------------------------------------------------- T2 950 → 980
  game('50-t2-entry', 956),
  cam('51-t2-plan', 966, { up: 30, back: 5, fov: 42, targetY: 3 }),
  cam('52-t2-rack-close', 956, { side: -6, back: 4, up: 1.4, fov: 28, targetY: 0.6, prop: { kind: 'rack', near: 956 } }),
  cam('53-t2-athlete', 968, { side: -6, back: 2, up: 1.5, fov: 30, targetY: 0.95, live: true }),
  cam('54-t2-arch-face', 956, { back: -11, up: 2.8, fov: 42, targetY: 2.8, named: 'arch-T2 换项' }),

  // ---------------------------------------------------------------- run 980 → 1340
  game('60-run-greenway', 1000),
  cam('61-run-track-close', 1040, { side: -1.5, back: 3.2, up: 0.7, fov: 55, targetY: 0.1 }),
  game('62-run-aid-gate', 1012),
  cam('63-run-aid-tent', 1018, { side: -8, back: 5, up: 1.6, fov: 32, u: 6.6, targetY: 1.1 }),
  cam('64-run-furniture-line', 1080, { side: -15, back: 9, up: 3, fov: 46, targetY: 2 }),
  cam('65-run-lamp-close', 1060, { side: -7, back: 4, up: 2.6, fov: 30, targetY: 2.2, prop: { kind: 'lamp', near: 1060, minS: 985 } }),
  cam('66-run-reed-close', 1100, { side: -6, back: 4, up: 1.1, fov: 28, targetY: 0.7, prop: { kind: 'reed', near: 1100, minS: 985 } }),
  cam('67-run-stand-close', 1128, { side: -12, back: 6, up: 2.4, fov: 34, targetY: 1.4, prop: { kind: 'stand', near: 1128, minS: 985 } }),
  cam('68-run-athlete', 1150, { side: -6, back: 2, up: 1.5, fov: 30, targetY: 0.95, live: true }),
  game('69-run-beach', 1150),
  cam('70-run-flag-close', 1210, { side: -6, back: 4, up: 1.6, fov: 28, targetY: 1.3, prop: { kind: 'flag', near: 1210, minS: 1190 } }),
  game('71-run-promenade', 1240),
  cam('72-run-arena-plan', 1270, { up: 58, back: 10, fov: 46, targetY: 2 }),
  cam('73-run-finish-arch', 1300, { back: -20, up: 4.5, fov: 48, targetY: 3.2, named: 'arch-FINISH' }),
  cam('74-run-finish-line', 1300, { side: -2.5, back: 4, up: 1, fov: 50, targetY: 0.15 }),
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  let version;
  try {
    version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  } catch {
    throw new Error(`Chrome is not reachable on 127.0.0.1:${PORT}. Start it with `
      + `--headless=new --remote-debugging-port=${PORT} --user-data-dir=<fresh dir>`);
  }
  const shots = ONLY ? SHOTS.filter(shot => ONLY.test(shot.file)) : SHOTS;
  const out = new URL(`../${OUT_DIR}/`, import.meta.url);
  await mkdir(out, { recursive: true });

  const c = await connect(PORT);
  await c.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await c.send('Page.navigate', { url: ORIGIN });
  await c.until('window.__lakeline?.state().phase==="ready"', 45000);
  // Clicked through the DOM: the HUD is hidden below, so a coordinate click would miss.
  await c.evaluate('document.querySelector(".start-button").click()');
  await c.until('window.__lakeline.state().phase==="running"', 20000);
  await c.evaluate(`(()=>{const s=document.createElement('style');`
    + `s.textContent='main > :not(.scene){display:none !important}body{background:#000}';`
    + `document.head.appendChild(s);return true})()`);
  await c.evaluate(`(()=>{${KIT}return true})()`);
  const graphics = await c.evaluate('window.__lakeline.scene().course');
  console.log(`atlas · ${shots.length} shots · ${WIDTH}x${HEIGHT} · props ${JSON.stringify(graphics)}`);

  const manifest = [];
  for (const spec of shots) {
    const anchor = await aim(c, spec);
    await c.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await sleep(anchor.view === 'chase' ? 760 : 130);
    const file = `${spec.file}.png`;
    await c.screenshot(new URL(file, out));
    const stats = await c.evaluate('(()=>{const d=window.__lakeline.scene();'
      + 'return {calls:d.calls,triangles:d.triangles,geometries:d.geometries,textures:d.textures,camera:d.camera}})()');
    manifest.push({ ...spec, ...anchor, ...stats });
    console.log(`${file.padEnd(30)} ${String(stats.triangles).padStart(8)} tris ${String(stats.calls).padStart(4)} calls`
      + ` ${anchor.ok ? '' : `!! ${anchor.reason}`}`);
  }

  await c.evaluate('window.__lakeline.objects().inspectView = null');
  await writeFile(new URL('manifest.json', out), `${JSON.stringify({
    generated: new Date().toISOString(), browser: version.Browser,
    viewport: { width: WIDTH, height: HEIGHT }, course: graphics, shots: manifest,
  }, null, 2)}\n`);
  const missing = manifest.filter(item => !item.ok);
  c.close();
  console.log(`\n${OUT_DIR}: ${manifest.length} images, ${missing.length} anchors missing`);
  if (missing.length) console.log(missing.map(item => `  ${item.file}: ${item.reason}`).join('\n'));
}

/** Park the camera anchor where the shot wants it, running the gait first when asked. */
async function aim(c, spec) {
  const state = await c.evaluate('window.__lakeline.state()');
  if (state.phase !== 'paused') await togglePause(c, 'paused');
  let placed = spec;
  if (spec.live) {
    // Freeze mid-stride: run a beat, stop, then frame wherever the athlete actually got to.
    await c.evaluate(`window.__lakeline.warp(${spec.s},${spec.u ?? 0})`);
    await togglePause(c, 'running');
    await sleep(900);
    await togglePause(c, 'paused');
    placed = { ...spec, ...(await c.evaluate(`(async()=>{`
      + `const cfg=await import('/src/config.ts');const s=window.__lakeline.state();`
      + `return {s:s.s,u:s.x-cfg.centerAt(s.s)}})()`)) };
  } else {
    await c.evaluate(`window.__lakeline.warp(${spec.s},${spec.u ?? 0})`);
  }
  const anchor = await c.evaluate(`window.__shotKit(${JSON.stringify(placed)})`);
  return { ...anchor, at: placed.s, u: placed.u ?? 0 };
}

async function togglePause(c, want) {
  await c.key('Escape');
  await c.key('Escape', false);
  await c.until(`window.__lakeline.state().phase==="${want}"`, 6000);
}

await main();
