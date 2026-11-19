const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

/** Course breakpoints — swap between classic (lake line) and canyon (folded).
 *  They are module-level so every arithmetic site keeps type `number`; `setTrack` is
 *  the single place that changes them, and every caller must have called setTrack first. */
/** Classic breakpoint values. Each track keeps its own copy; setTrack copies
 *  from the preset into the active module-level exports so every arithmetic site
 *  sees the right numbers after a single switch. */
const CLASSIC_BREAK = { SWIM_END: 300, T1_END: 330, BIKE_END: 950, T2_END: 980, FINISH_S: 1300, COURSE_LENGTH: 1340 };
const CANYON_BREAK = { SWIM_END: 300, T1_END: 330, BIKE_END: 950, T2_END: 980, FINISH_S: 1300, COURSE_LENGTH: 1340 };

export let SWIM_END = CLASSIC_BREAK.SWIM_END;
export let T1_END = CLASSIC_BREAK.T1_END;
export let BIKE_END = CLASSIC_BREAK.BIKE_END;
export let T2_END = CLASSIC_BREAK.T2_END;
export let FINISH_S = CLASSIC_BREAK.FINISH_S;
export let COURSE_LENGTH = CLASSIC_BREAK.COURSE_LENGTH;

/** The lake surface is the height datum for the whole world. */
export const WATER_LEVEL = 0;

export type DisciplineId = 'swim' | 't1' | 'bike' | 't2' | 'run';

/** One colour grade per discipline: cool open water → warm ridge → golden greenway. */
export type LightingMood = {
  sun: string; sunIntensity: number;
  sky: string; bounce: string; ambient: number;
  exposure: number; fog: string;
};

export const CONFIG = {
  brand: {
    name: 'LAKELINE', title: '湖线铁三', category: '3D 铁人三项',
    subtitle: '游过去，骑起来，跑到底。',
    eventName: '千岛湖 · 湖线铁三', headline: ['SWIM', 'BIKE', 'RUN'],
    venue: '千岛湖 · 湖山绿道',
  },
  text: {
    start: '开始比赛', loading: '正在布置赛道',
    pause: '暂停比赛', resume: '继续比赛', paused: '在换项区，喘口气。',
    pausedHint: '计时已经暂停，喝口水再出发。',
    result: '三项都到岸了。', resultSubtitle: '这一场，属于你。', replay: '再赛一次',
    mute: '关闭声音', unmute: '开启声音', motion: '减弱动态', motionOff: '恢复标准动态',
    hintsOff: '隐藏提示', hintsOn: '显示提示',
    time: '总计时', score: '比赛得分', gates: '通过标志门', pickups: '拾取补给',
    collisions: '失误次数', topSpeed: '最高时速', corners: '干净过弯',
    finish: '冲线', boundary: '回到赛道内',
    gateOutside: '偏出标志门 · 不计分',
    pickup: '补给', cornerClean: '贴线过弯',
    crash: '弯道失控摔车', barrier: '撞上路障摔车', contact: '身体接触',
    bonk: '撞墙了 · 速度掉光',
    burst: '冲刺划水', surge: '起身摇车', surgeReady: '摇车就绪',
    sprint: '冲刺', glide: '放松漂游',
    swimHint: '空格冲刺划水 · 按住 Shift 放松漂游回体力',
    bikeHint: '弯道太快要摔车 · 按住 Shift 刹车',
    runHint: '体力见底会撞墙 · 记得过补给站',
    t1Hint: '空格快换 · 到出口再按空格上车 / Shift 慢走回体力',
    t2Hint: '空格快换 · 到出口再按空格开跑 / Shift 慢走回体力',
    desktopHelp: '← → 转向 · 空格 冲刺/摇车 · Shift 刹车 · Esc 暂停',
    mobileHelp: '左侧转向 · 右侧冲刺，骑行段可按住刹车键',
    stageSwim: '游泳 · 公开水域', stageBike: '骑行 · 环湖公路', stageRun: '跑步 · 湖畔绿道',
    transition: '换项计时',
    error: '赛道暂时无法开启', retry: '重新加载',
    webglError: '当前浏览器无法建立 WebGL 2 场景。请启用硬件加速，或换用新版 Chrome / Safari / Edge。',
    contextLost: '图形上下文已中断，比赛已停止。请重新加载赛道。',
    loadError: '3D 引擎未能加载，请检查网络或本地服务后重试。',
    preparing: '布浮标 · 铺赛道', pauseLabel: 'TAKE A BREATH', resultLabel: 'RACE COMPLETE / 03',
    startMarker: 'START', finishMarker: 'FINISH',
    gripLabel: '抓地', staminaLabel: '体力',
    cornerWarn: '急弯 · 减速',
  },
  lighting: {
    sunDirection: [-0.58, 0.62, -0.52],
    sunColor: '#ffe9c8', sunIntensity: 4.6,
    skyColor: '#9fd0e8', bounceColor: '#dfe9d9', ambientIntensity: 1.25,
    exposure: 1.12,
    /** Scene grades, blended over a few seconds when the split changes. */
    moods: {
      swim: { sun: '#e2efff', sunIntensity: 4.1, sky: '#a9d8ee', bounce: '#d6e9ea', ambient: 1.24, exposure: 1.06, fog: '#c6e6ec' },
      t1: { sun: '#ffeacb', sunIntensity: 4.5, sky: '#a9d4e6', bounce: '#e4e2cf', ambient: 1.21, exposure: 1.1, fog: '#cde3e2' },
      bike: { sun: '#ffe2ae', sunIntensity: 4.9, sky: '#a6cfe0', bounce: '#e7e2c3', ambient: 1.16, exposure: 1.14, fog: '#cfe1dc' },
      t2: { sun: '#ffdfa9', sunIntensity: 4.8, sky: '#a4ccdd', bounce: '#e8e1c6', ambient: 1.16, exposure: 1.13, fog: '#d2dfd9' },
      run: { sun: '#ffd79a', sunIntensity: 5.0, sky: '#a8cbd8', bounce: '#eadfbb', ambient: 1.14, exposure: 1.17, fog: '#d7ddcf' },
    } as Record<DisciplineId, LightingMood>,
  },
  colors: {
    skyTop: '#2b9ad4', skyMid: '#8ed2e6', skyBottom: '#dff1ee', fog: '#c3e3e8',
    sunGlow: '#fff3d8', cloud: '#fffaf2', cloudShade: '#a6c3d6',
    water: '#1f7f9c', waterShallow: '#4fc0c4', waterDeep: '#0d4f66', waterFoam: '#f3fbfd',
    lakeBed: '#cbb68a', sand: '#e9d9b0', wetSand: '#c8ac7c',
    grass: '#5d9a62', grassLight: '#82b877', hill: '#3f7d68', rock: '#8b989d',
    bark: '#6b5540', pine: '#2f7a5f', pineLight: '#5da377',
    canopy: '#4a9a4f', canopyLight: '#7cc063',
    asphalt: '#4b5157', asphaltLine: '#f6f2e4', curb: '#e8e2d2',
    track: '#c14a37', trackLine: '#f8f2e4', boardwalk: '#b98a55',
    /** Transition pads read as cream sand at T1 and cool gravel at T2. */
    t1Paving: '#f4e5c2', t2Gravel: '#b6ab98',
    bikeShoulder: '#e94e1b', runVerge: '#6da34d',
    gate: '#ff6a3d', gateAlt: '#0f8f9e', gatePassed: '#7fd0b4', gateMissed: '#8a9aa0',
    pole: '#fbf8ee', accent: '#ff6a3d',
    pickup: '#ffd166', pickupCore: '#e08a18',
    rival: '#3d5a80', rivalAlt: '#c94f7c',
    suit: '#1f3d4d', suitLight: '#2f6b78', jersey: '#ff7a3d', shorts: '#22303a',
    helmet: '#f4f1e6', visor: '#2a3d46', bib: '#fffaf0',
    wetsuit: '#21424f', cap: '#ff6a3d', goggles: '#1d2b33',
    bike: '#e94f37', bikeFrame: '#2a2f36', bikeMetal: '#b9c0c7',
    tire: '#23262a', rim: '#cfd6dd', chain: '#8a929b',
    skin: '#e8b48f', hair: '#3a2b22', shadow: '#2a4550',
    ink: '#12303a', inkSoft: '#3e6470', paper: '#fbf6ec',
  },
  course: {
    length: COURSE_LENGTH, finishS: FINISH_S,
    /** Lateral half-width of the drivable ribbon, per discipline. */
    halfWidth: { swim: 11, t1: 6, bike: 8.5, t2: 6, run: 6.5 },
    roadLift: 0.04,
  },
  disciplines: [
    { id: 'swim' as DisciplineId, name: '游泳', english: 'SWIM', startS: 0, endS: 300, note: '公开水域 · 绕标' },
    { id: 't1' as DisciplineId, name: '换项一', english: 'T1', startS: 300, endS: 330, note: '浮台 · 上车' },
    { id: 'bike' as DisciplineId, name: '骑行', english: 'BIKE', startS: 330, endS: 950, note: '环湖公路 · 弯道' },
    { id: 't2' as DisciplineId, name: '换项二', english: 'T2', startS: 950, endS: 980, note: '挂车 · 换鞋' },
    { id: 'run' as DisciplineId, name: '跑步', english: 'RUN', startS: 980, endS: 1340, note: '湖畔绿道 · 冲线' },
  ],
  physics: {
    step: 1 / 120, maxFrameDelta: 0.25, radius: 0.45,
    /** Per-second pull back toward the centre of the lane while the keys are idle. */
    lineReturn: 0.4,
  },
  /**
   * One control model per discipline; every key exists on every entry so the
   * simulation can read `CONFIG.drive[discipline]` without special cases.
   * `drain` is stamina per second at cruise (negative recovers), `surgeDrain`
   * while Space is used, `easeDrain` while the release key is held.
   */
  drive: {
    swim: {
      speed: 6.4, startSpeed: 3.2, acceleration: 1.9, turnSpeed: 2.9, turnResponse: 4.2,
      turnRelease: 4.6, turnDrag: 0.07, centrifugal: 0.12, glideCap: 0.7, surgeCap: 1.26,
      drain: 1, surgeDrain: 2.6, easeDrain: -14, gradeGain: 0, brake: 0, grip: 0,
      slideWarn: 1, surgeTime: 0, surgeCooldown: 0, gravity: 0,
    },
    t1: {
      speed: 5.4, startSpeed: 5.4, acceleration: 3.2, turnSpeed: 3.4, turnResponse: 5,
      turnRelease: 5, turnDrag: 0.05, centrifugal: 0.1, glideCap: 0.72, surgeCap: 1.3,
      // Space buys a faster changeover out of the stamina the racks would otherwise
      // hand back; Shift is the opposite trade. Neither is free.
      drain: -4, surgeDrain: 6, easeDrain: -14, gradeGain: 0, brake: 0, grip: 0,
      slideWarn: 1, surgeTime: 0, surgeCooldown: 0, gravity: 0,
    },
    bike: {
      speed: 20, startSpeed: 9, acceleration: 5.2, turnSpeed: 8, turnResponse: 6.4,
      turnRelease: 5.6, turnDrag: 0.1, centrifugal: 0.24, glideCap: 0.82, surgeCap: 1.18,
      // 12.5 m/s² keeps a full-speed cruise (20 m/s) inside the tyre budget through every
      // drawn bend — the tightest one peaks at 0.86 — so a crash only happens when the
      // rider adds a surge or carries downhill speed into the hairpin, never on a road
      // that looks straight. `cornerLimit` (grip × 0.8) still asks for a small lift first.
      drain: -6, surgeDrain: -6, easeDrain: -10, gradeGain: 3.4, brake: 18, grip: 12.5,
      slideWarn: 0.82, surgeTime: 2.6, surgeCooldown: 7, gravity: 21,
    },
    t2: {
      speed: 5.4, startSpeed: 5.4, acceleration: 3.2, turnSpeed: 3.4, turnResponse: 5,
      turnRelease: 5, turnDrag: 0.05, centrifugal: 0.1, glideCap: 0.72, surgeCap: 1.3,
      drain: -4, surgeDrain: 6, easeDrain: -14, gradeGain: 0, brake: 0, grip: 0,
      slideWarn: 1, surgeTime: 0, surgeCooldown: 0, gravity: 0,
    },
    run: {
      speed: 6.4, startSpeed: 4.6, acceleration: 2.6, turnSpeed: 3.8, turnResponse: 6,
      turnRelease: 6, turnDrag: 0.06, centrifugal: 0.1, glideCap: 0.86, surgeCap: 1.2,
      drain: 1.7, surgeDrain: 7.7, easeDrain: -8, gradeGain: 0.9, brake: 0, grip: 0,
      slideWarn: 1, surgeTime: 0, surgeCooldown: 0, gravity: 0,
    },
  },
  stamina: { max: 100, start: 100, aidRefill: 42, emptyCap: 0.74, bonkTime: 5.5, bonkCap: 0.58, bonkRestore: 26 },
  mistake: {
    crashDelta: -80, contactDelta: -15, boundaryDelta: -35,
    crashSpeed: 6, boundarySpeed: 2.4, protection: 1.2,
  },
  scoring: {
    gate: 100, pickup: 15, corner: 70, burst: 45, finish: 300,
  },
  combo: { firstTier: 3, secondTier: 6, firstMultiplier: 1.5, secondMultiplier: 2 },
  pickup: { height: 0.7, radius: 1.2 },
  camera: {
    swim: { height: 2.4, distance: 7.0, lookAhead: 10, fov: 58, follow: 5.4, speedFov: 4 },
    t1: { height: 3.6, distance: 6.8, lookAhead: 11, fov: 52, follow: 5, speedFov: 0 },
    bike: { height: 3.4, distance: 7.8, lookAhead: 17, fov: 60, follow: 6.4, speedFov: 8 },
    t2: { height: 3.6, distance: 6.8, lookAhead: 11, fov: 52, follow: 5, speedFov: 0 },
    run: { height: 3.3, distance: 6.4, lookAhead: 12, fov: 52, follow: 6, speedFov: 3 },
  },
  audio: { volume: 0.3, wind: 0.12, turn: 0.08, impact: 0.2, music: 0.2 },
  quality: {
    desktop: { dpr: 1.6, spray: 150, shadowSize: 2048, shadows: true, treeStep: 1 },
    mobile: { dpr: 1.2, spray: 70, shadowSize: 1024, shadows: true, treeStep: 2 },
  },
} as const;

export type Corner = { id: string; from: number; to: number; curvature: number; limit: number; discipline: DisciplineId };

/** Two separate race maps share one ruleset but have their own racing line. */
export type TrackId = 'classic' | 'canyon';
type Turn = { from: number; to: number; angle: number; blend: number };
type HeightCurve = { base: number; a1: number; f1: number; a2: number; f2: number; p2: number };

type TrackGeometry = {
  turns: readonly Turn[];
  lake: { freq: number; phase: number };
  road: HeightCurve;
  park: HeightCurve;
  /**
   * A folded route: the racing line turns back on itself, so the world position is a
   * real 2D curve (x and z both integrated) instead of the one-way ribbon the lake
   * maps use. Heights then come from an absolute canyon field, not from `baseHeight`.
   */
  folded?: boolean;
  /** Constant-curvature arcs for a folded route, in metres^-1, by station. */
  arcs?: readonly { from: number; to: number; curvature: number }[];
};

/** The original LAKELINE lake loop: a 1340 m course, so these turns are all the
 *  curvature the lake line ever needs. */
const CLASSIC_TRACK: TrackGeometry = {
  turns: [
    // Gentle S-curves from the swim mouth along the lake road (0 – 940 m).
    { from: 40, to: 120, angle: 0.42, blend: 26 },
    { from: 145, to: 225, angle: -0.5, blend: 26 },
    { from: 245, to: 295, angle: 0.3, blend: 20 },
    { from: 345, to: 420, angle: -0.5, blend: 26 },
    { from: 445, to: 520, angle: 0.62, blend: 24 },
    { from: 545, to: 600, angle: -0.95, blend: 20 },
    { from: 625, to: 700, angle: 0.55, blend: 26 },
    { from: 720, to: 790, angle: -0.6, blend: 24 },
    { from: 810, to: 880, angle: 0.85, blend: 22 },
    { from: 900, to: 940, angle: -0.4, blend: 18 },
    // Nothing after 940: the finish straight runs to the arch.
  ],
  lake: { freq: 0.0016, phase: 0.85 },
  road: { base: 5.4, a1: 3.1, f1: 118, a2: 1.5, f2: 47, p2: 1.2 },
  park: { base: 2.1, a1: 0.55, f1: 120, a2: 0.3, f2: 43, p2: 0.7 },
};

/**
 * Canyon map from the reference frame: swim north up the river, hairpin out onto the
 * west rim, descend south, hairpin again at the canyon mouth, then climb the east
 * trail north to the arch. The two -180° arcs are what fold the line back on itself.
 */
const CANYON_TRACK: TrackGeometry = {
  turns: [],
  folded: true,
  arcs: [
    // 330 → 405.4: leave T1 and swing west onto the rim (net -48 m in x).
    { from: 330, to: 330 + Math.PI * 24, curvature: -1 / 24 },
    // 765.4 → 916.2: canyon-mouth hairpin from the west rim to the east trail.
    { from: 330 + Math.PI * 24 + 360, to: 330 + Math.PI * 24 + 360 + Math.PI * 48, curvature: -1 / 48 },
  ],
  lake: { freq: 0, phase: 0 },
  road: { base: 0, a1: 0, f1: 1, a2: 0, f2: 1, p2: 0 },
  park: { base: 0, a1: 0, f1: 1, a2: 0, f2: 1, p2: 0 },
};

export const TRACKS: Record<TrackId, TrackGeometry> = {
  classic: CLASSIC_TRACK, canyon: CANYON_TRACK,
};
let activeTrack: TrackId = 'classic';
export function setTrack(id: TrackId) {
  activeTrack = id;
  const preset = id === 'canyon' ? CANYON_BREAK : CLASSIC_BREAK;
  SWIM_END = preset.SWIM_END; T1_END = preset.T1_END; BIKE_END = preset.BIKE_END;
  T2_END = preset.T2_END; FINISH_S = preset.FINISH_S; COURSE_LENGTH = preset.COURSE_LENGTH;
  rebuildDerived();
}
export function getTrack(): TrackId { return activeTrack; }

/** Build a fresh segment list for the active track. The intro HUD and progress strip
 *  both have to show live distances, not whatever numbers were baked into CONFIG at
 *  module-load time. */
export function buildDisciplines() {
  return [
    { id: 'swim' as DisciplineId, name: '游泳', english: 'SWIM', startS: 0, endS: SWIM_END, note: '公开水域 · 绕标' },
    { id: 't1' as DisciplineId, name: '换项一', english: 'T1', startS: SWIM_END, endS: T1_END, note: '浮台 · 上车' },
    { id: 'bike' as DisciplineId, name: '骑行', english: 'BIKE', startS: T1_END, endS: BIKE_END, note: activeTrack === 'canyon' ? '崖壁公路 · 发夹' : '环湖公路 · 弯道' },
    { id: 't2' as DisciplineId, name: '换项二', english: 'T2', startS: BIKE_END, endS: T2_END, note: '挂车 · 换鞋' },
    { id: 'run' as DisciplineId, name: '跑步', english: 'RUN', startS: T2_END, endS: COURSE_LENGTH, note: activeTrack === 'canyon' ? '高原台阶 · 冲线' : '湖畔绿道 · 冲线' },
  ];
}

function curvatureOf(turns: readonly Turn[], s: number) {
  let curvature = 0;
  for (const turn of turns) {
    if (s <= turn.from || s >= turn.to) continue;
    const easeIn = smoothstep(turn.from, turn.from + turn.blend, s);
    const easeOut = 1 - smoothstep(turn.to - turn.blend, turn.to, s);
    curvature += turn.angle * easeIn * easeOut / (turn.to - turn.from - turn.blend);
  }
  return curvature;
}

export function routeCurvature(s: number) {
  const track = TRACKS[activeTrack];
  if (track.arcs) {
    for (const arc of track.arcs) {
      if (s > arc.from && s < arc.to) return arc.curvature;
    }
    return 0;
  }
  return curvatureOf(track.turns, s);
}

const ROUTE_STEP = 0.5;
const ROUTE_COUNT = Math.round(COURSE_LENGTH / ROUTE_STEP) + 1;

function buildRoute(turns: readonly Turn[], arcs?: readonly { from: number; to: number; curvature: number }[]) {
  const xs = new Float64Array(ROUTE_COUNT);
  const zs = new Float64Array(ROUTE_COUNT);
  const headings = new Float64Array(ROUTE_COUNT);
  let x = 0, z = 0, heading = 0;
  for (let i = 0; i < ROUTE_COUNT; i++) {
    xs[i] = x;
    zs[i] = arcs ? z : -i * ROUTE_STEP;
    headings[i] = heading;
    const before = heading;
    const s = (i + 0.5) * ROUTE_STEP;
    heading += (arcs ? arcCurvature(arcs, s) : curvatureOf(turns, s)) * ROUTE_STEP;
    const mid = (before + heading) / 2;
    x += Math.sin(mid) * ROUTE_STEP;
    z -= Math.cos(mid) * ROUTE_STEP;
  }
  return { xs, zs, headings, folded: Boolean(arcs) };
}

function arcCurvature(arcs: readonly { from: number; to: number; curvature: number }[], s: number) {
  for (const arc of arcs) if (s > arc.from && s < arc.to) return arc.curvature;
  return 0;
}

const ROUTES: Record<TrackId, ReturnType<typeof buildRoute>> = {
  classic: buildRoute(CLASSIC_TRACK.turns),
  canyon: buildRoute([], CANYON_TRACK.arcs),
};

/** Racing line sampled from the curvature profile, cubic-Hermite between samples. */
export const centerAt = (s: number) => {
  const route = ROUTES[activeTrack];
  if (s <= 0) return route.xs[0] + Math.sin(route.headings[0]) * s;
  if (s >= COURSE_LENGTH) {
    // Continue past the finish along the final heading so the post-finish ribbon,
    // arena props and scenery do not collapse onto a single world point.
    if (!route.folded) return route.xs[ROUTE_COUNT - 1];
    const last = ROUTE_COUNT - 1;
    return route.xs[last] + Math.sin(route.headings[last]) * (s - COURSE_LENGTH);
  }
  const f = s / ROUTE_STEP;
  const i = Math.floor(f);
  const t = f - i;
  const t2 = t * t, t3 = t2 * t;
  const p0 = route.xs[i], p1 = route.xs[i + 1];
  const m0 = Math.sin(route.headings[i]) * ROUTE_STEP;
  const m1 = Math.sin(route.headings[i + 1]) * ROUTE_STEP;
  return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0
    + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1;
};

export const centerZAt = (s: number) => {
  const route = ROUTES[activeTrack];
  if (!route.folded) return -s;
  if (s <= 0) return -Math.cos(route.headings[0]) * s;
  if (s >= COURSE_LENGTH) {
    if (!route.folded) return route.zs[ROUTE_COUNT - 1];
    const last = ROUTE_COUNT - 1;
    return route.zs[last] - Math.cos(route.headings[last]) * (s - COURSE_LENGTH);
  }
  const f = s / ROUTE_STEP;
  const i = Math.floor(f);
  const t = f - i;
  const t2 = t * t, t3 = t2 * t;
  const p0 = route.zs[i], p1 = route.zs[i + 1];
  const m0 = -Math.cos(route.headings[i]) * ROUTE_STEP;
  const m1 = -Math.cos(route.headings[i + 1]) * ROUTE_STEP;
  return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0
    + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1;
};

/** Tangent heading at s: 0 points north (-z), +pi/2 points east (+x). */
export const headingAt = (s: number) => {
  const route = ROUTES[activeTrack];
  const f = Math.min(ROUTE_COUNT - 1, Math.max(0, s / ROUTE_STEP));
  const i = Math.floor(f);
  const j = Math.min(ROUTE_COUNT - 1, i + 1);
  const t = f - i;
  return route.headings[i] + (route.headings[j] - route.headings[i]) * t;
};

export const centerSlope = (s: number) => (centerAt(s + 0.5) - centerAt(s - 0.5));

/** Lateral coordinate: positive is the rider's right-hand side of the racing line. */
export const uAtWorld = (s: number, x: number, z: number) => {
  if (!ROUTES[activeTrack].folded) return x - centerAt(s);
  const h = headingAt(s);
  return (x - centerAt(s)) * Math.cos(h) + (z - centerZAt(s)) * Math.sin(h);
};
export const uAt = (s: number, x: number) => x - centerAt(s);
export const xAt = (s: number, u: number) => {
  if (!ROUTES[activeTrack].folded) return centerAt(s) + u;
  const h = headingAt(s);
  return centerAt(s) + u * Math.cos(h);
};
export const zAt = (s: number, u: number) => {
  if (!ROUTES[activeTrack].folded) return -s;
  const h = headingAt(s);
  return centerZAt(s) + u * Math.sin(h);
};
/** World yaw for props built in the course frame. */
export const courseYaw = (s: number) => -headingAt(s);

export function disciplineAt(s: number): DisciplineId {
  if (s < SWIM_END) return 'swim';
  if (s < T1_END) return 't1';
  if (s < BIKE_END) return 'bike';
  if (s < T2_END) return 't2';
  return 'run';
}
export const disciplineIndex = (s: number) => CONFIG.disciplines.findIndex(d => d.id === disciplineAt(s));
export const halfWidthAt = (s: number) => CONFIG.course.halfWidth[disciplineAt(s)];

/** The lake is on whichever side the sine points; each map has its own shoreline. */
export const lakeDir = (s: number) => {
  const lake = TRACKS[activeTrack].lake;
  return Math.sin(s * lake.freq + lake.phase);
};

function fbm2(x: number, y: number) {
  const noise = (a: number, b: number) => {
    const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return value - Math.floor(value);
  };
  const cell = (fx: number, fy: number) => {
    const xi = Math.floor(fx), yi = Math.floor(fy);
    const xf = fx - xi, yf = fy - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = noise(xi, yi), b = noise(xi + 1, yi), c = noise(xi, yi + 1), d = noise(xi + 1, yi + 1);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  };
  return cell(x, y) * 0.62 + cell(x * 2.03, y * 2.03) * 0.26 + cell(x * 4.1, y * 4.1) * 0.12;
}

/** Rolling lake road: climbs and descents feed straight into the speed model. */
function roadHeight(s: number) {
  const k = TRACKS[activeTrack].road;
  const t = s - T1_END;
  return k.base + k.a1 * Math.sin(t / k.f1) + k.a2 * Math.sin(t / k.f2 + k.p2);
}
function parkHeight(s: number) {
  const k = TRACKS[activeTrack].park;
  const t = s - T2_END;
  return k.base + k.a1 * Math.sin(t / k.f1) + k.a2 * Math.sin(t / k.f2 + k.p2);
}

export function baseHeight(s: number) {
  if (s <= SWIM_END) return 0;
  if (s <= T1_END) return roadHeight(T1_END) * smoothstep(SWIM_END, T1_END, s);
  if (s <= BIKE_END) return roadHeight(s);
  if (s <= T2_END) {
    const top = roadHeight(BIKE_END);
    const bottom = parkHeight(T2_END);
    return top + (bottom - top) * smoothstep(BIKE_END, T2_END, s);
  }
  return parkHeight(s);
}

/** Open-water basin floor, then the islands that make 千岛湖 read as 千岛湖. */
function reliefSwim(s: number, u: number) {
  const au = Math.abs(u);
  const sign = u < 0 ? -1 : 1;
  let h = -2.4 - 1.8 * fbm2(s * 0.011, au * 0.01);
  h += smoothstep(96, 190, au) * (10 + 26 * fbm2(s * 0.0055 + 2.2, sign * 3.1 + au * 0.004));
  h += smoothstep(210, 420, au) * (16 + 40 * Math.abs(Math.sin(s * 0.006 + sign * 1.7)));
  h -= smoothstep(700, 1050, au) * 40;
  return h;
}

/** Coast ribbon: land narrows to the waterline on the lake side, climbs on the hill side. */
function reliefCoast(s: number, u: number) {
  const hw = halfWidthAt(s);
  const base = baseHeight(s);
  const t = u * lakeDir(s);
  const au = Math.abs(u);
  const sign = u < 0 ? -1 : 1;
  let h = base;
  if (t < 0) {
    const away = -t;
    h -= smoothstep(hw + 2, hw + 30, away) * (base + 2.6);
    h -= smoothstep(hw + 30, hw + 90, away) * 1.6;
    h += smoothstep(hw + 150, hw + 300, away) * (14 + 34 * fbm2(s * 0.004 + 5.5, away * 0.004));
    h += smoothstep(360, 620, away) * (10 + 26 * Math.abs(Math.sin(s * 0.005 + away * 0.002)));
    h -= smoothstep(900, 1200, away) * 46;
  } else {
    h += smoothstep(hw + 2, hw + 34, t) * (5 + 20 * fbm2(s * 0.0065, t * 0.006));
    h += smoothstep(hw + 60, hw + 210, t) * (12 + 26 * fbm2(s * 0.0035 + 1.4, t * 0.003));
    h -= smoothstep(560, 880, t) * 30;
  }
  h += smoothstep(hw + 8, hw + 40, au) * (1.4 * Math.sin(s * 0.021 + sign * 1.4) + 0.9 * Math.sin(s * 0.047 - au * 0.05));
  return h;
}

/** Velodrome bank on the road so a fast corner reads as a tilted surface. */
function turnBank(s: number, u: number) {
  if (disciplineAt(s) !== 'bike') return 0;
  const au = Math.abs(u);
  if (au < 1) return 0;
  return clamp(-routeCurvature(s) * u * 9, -1.9, 1.9) * smoothstep(1, halfWidthAt(s), au);
}

// ------------------------------------------------------------------ canyon field

/** Cross-section constants shared by the terrain mesh and the physics. */
export const CANYON = {
  riverHalf: 24,
  roadX: -48,
  trailX: 48,
  northShelf: -300,
  southMouth: 16,
};

/** Smooth deterministic wave used for rock detail; stateless, so the physics can
 *  sample canyonHeight as often as it likes without drift. */
const rockWave = (x: number, z: number, fx: number, fz: number, phase = 0) =>
  Math.sin(x * fx + z * fz + phase);

/** West rim road: high at the T1 end, a long descent south to the mouth. The climb is
 *  spread over 230 m of z so the grade peaks near 14% instead of 30%. */
export function canyonRoadHeight(z: number) {
  if (z <= -336) return 2;
  if (z <= -105) return 2 + 22 * smoothstep(-336, -105, z);
  if (z <= 40) return 24 - 15 * smoothstep(-105, 40, z);
  return 9;
}

/** East trail: starts at the mouth and climbs north to the finish plateau. Its base
 *  matches the road where the two benches meet, so the pad at T2 stays level. */
export function canyonTrailHeight(z: number) {
  if (z >= -30) return canyonRoadHeight(z);
  if (z <= -340) return 46;
  return 16.1 + 29.9 * smoothstep(-30, -340, z);
}

/**
 * Absolute canyon field: river bed in the middle, a bench cut into each wall for the
 * road and the run trail, sandstone walls above. Everything the player can touch is
 * evaluated here, so the mesh and the physics can never disagree.
 */
export function canyonHeight(x: number, z: number) {
  const d = Math.abs(x) - CANYON.riverHalf;
  const bench = x < 0 ? canyonRoadHeight(z) : canyonTrailHeight(z);
  let h = -3.4 + (bench + 3.4) * smoothstep(-3, 13, d);
  if (x < 0) {
    // A short, steep face right off the bench, then the long upper wall.
    h += 40 * smoothstep(38, 52, d);
    h += 46 * smoothstep(58, 108, d);
  } else {
    // The east bench carries the finish arena, so its wall stands further back.
    h += 34 * smoothstep(44, 60, d);
    h += 40 * smoothstep(66, 118, d);
  }
  // North shelf: the river ends in a dry terrace where T1 sits. The blend keys on
  // |x| so the whole channel closes on one shoreline; keying on x alone left the
  // east half of the river running wet off the top of the map.
  if (z < -288) {
    // The dry shelf closes the river only. Its falloff must vanish before the east
    // trail bench (inner edge x ~43): a wider falloff dragged the trail ribbon's
    // left edge ~1.5 m below the bench while its centre stayed flat, which read as
    // a collapsed/undercut road in the run-in to the finish.
    const blend = smoothstep(-288, -304, z) * (1 - smoothstep(24, 40, Math.abs(x)));
    h = h * (1 - blend) + 2 * blend;
  }
  // South mouth: the canyon opens into the flat terrace under the bottom hairpin.
  if (z > 14) {
    const blend = smoothstep(16, 34, z) * (1 - smoothstep(74, 106, Math.abs(x)));
    h = h * (1 - blend) + 9 * blend;
  }
  // Layered sandstone: strata ripple the walls, but the benches have to stay rideable.
  const wall = smoothstep(40, 56, d);
  if (wall > 0.01) {
    h += wall * (Math.sin(h * 0.45 + Math.sin(z * 0.02) * 1.7) * 1.1
      + Math.sin(h * 1.9 + z * 0.05) * 0.35);
  }
  // Rock detail — keyed to the wall face only, so the road bench (x=-48) and the
  // trail bench (x=+48) keep exactly the height the physics already expects.
  const face = smoothstep(42, 60, d);
  if (face > 0.001) {
    // (a) horizontal strata: step the face every ~3.4 m of height, with the amplitude
    //     drifting so the bands do not read as contour lines wrapped round the wall.
    const phase = h / 3.4 + Math.sin(z * 0.013) * 0.4 + Math.sin(x * 0.021) * 0.3;
    const ledge = (phase - Math.floor(phase)) - 0.5;
    const ledgeAmp = 0.9 + 0.5 * Math.sin(z * 0.031 + x * 0.017);
    // (b) vertical erosion gullies running down the face.
    const gully = Math.abs(Math.sin(z * 0.28 + Math.sin(x * 0.021) * 2.4)) ** 3;
    // (c) broken rock blocks at three scales.
    const blocks = rockWave(x, z, 0.21, 0.17) * 0.55
      + rockWave(x, z, 0.47, -0.33, 1.7) * 0.3
      + rockWave(x, z, 0.93, 0.61, 2.6) * 0.15;
    // The rim itself stays comparatively level: fade the detailed carving out with
    // height above the bench so the plateau edge does not turn into a comb.
    const upper = 1 - smoothstep(56, 80, h - bench);
    h += face * upper * (ledge * -1.7 * ledgeAmp - gully * 1.5 + blocks * 1.3);
  }
  return h;
}

export function isFoldedTrack() {
  return Boolean(TRACKS[activeTrack].folded);
}

export function sideRelief(s: number, u: number) {
  const swimBlend = 1 - smoothstep(SWIM_END - 34, SWIM_END + 26, s);
  const coast = reliefCoast(s, u);
  if (swimBlend <= 0) return coast - baseHeight(s);
  const swim = reliefSwim(s, u);
  return (swimBlend * swim + (1 - swimBlend) * coast) - baseHeight(s);
}

export function groundHeight(s: number, u: number) {
  if (TRACKS[activeTrack].folded) {
    const micro = disciplineAt(s) === 'swim' ? 0 : 0.05 * Math.sin(s * 0.07 + u * 0.13);
    return canyonHeight(xAt(s, u), zAt(s, u)) + micro;
  }
  const discipline = disciplineAt(s);
  const micro = discipline === 'swim'
    ? 0
    : 0.16 * Math.sin(s * 0.07 + u * 0.13) + 0.09 * Math.sin(s * 0.17 - u * 0.21);
  return baseHeight(s) + micro + turnBank(s, u) + sideRelief(s, u);
}

/** What the athlete actually stands, floats or rolls on. */
export function surfaceHeight(s: number, u: number) {
  const ground = groundHeight(s, u);
  return disciplineAt(s) === 'swim' ? Math.max(ground, WATER_LEVEL) : ground;
}
export const terrainHeight = surfaceHeight;

export function slopeAt(s: number) {
  if (TRACKS[activeTrack].folded) return groundHeight(s + 0.5, 0) - groundHeight(s - 0.5, 0);
  return (baseHeight(s + 0.05) - baseHeight(s - 0.05)) / 0.1;
}

export type Gate = {
  id: string; s: number; u: number; width: number; discipline: DisciplineId; group: number;
  kind: 'buoy' | 'arch' | 'aid';
};

/** Gate specs shared by every track. Entries beyond a track's COURSE_LENGTH are
 *  filtered out during rebuildDerived, so one list can serve both 1340 m lines. */
const GATE_SPECS: [number, number][] = [
  [62, 3], [128, -4], [196, 5], [258, -3],
  [372, -2], [452, 3], [532, -3], [612, 2], [692, -3], [772, 3], [852, -2], [922, 2],
  [1018, -2], [1092, 3], [1168, -3], [1242, 2], [1292, 0],
];

export let GATES: Gate[] = [];

/**
 * Half-width of the opening the scene actually draws. The arch posts stand at
 * `±(width + 4.4) / 2`, so scoring must use that opening rather than `width`: an
 * athlete brushing the posts was being called "outside" while visibly under the gate.
 */
export function gateHalfWidth(gate: Gate) {
  if (gate.kind === 'buoy') return gate.width / 2 + 0.4;
  return (gate.width + 4.4) / 2 - 0.4;
}

export type Obstacle = {
  id: string; s: number; u: number; width: number; height: number; thickness: number;
  discipline: DisciplineId; kind: 'kayak' | 'barrier' | 'camp';
};

const OBSTACLE_SPECS: [number, number][] = [
  [96, 5], [172, -6], [226, 4], [282, -5],
  [408, -3], [488, 4], [574, -4], [658, 3], [742, -4], [826, 4], [902, -3],
  [1046, 3], [1132, -3], [1206, 4], [1268, -2],
];

export let OBSTACLES: Obstacle[] = [];

export function obstacleBand(o: Obstacle) {
  const half = o.thickness / 2 + CONFIG.physics.radius;
  return { start: o.s - half, end: o.s + half };
}

export type Pickup = { id: string; s: number; u: number; y: number; discipline: DisciplineId };

const PICKUP_SPECS = [
  22, 84, 152, 214, 272,
  352, 392, 430, 470, 512, 556, 600, 644, 688, 730, 776, 818, 864, 908, 940,
  1004, 1032, 1060, 1088, 1116, 1148, 1180, 1212, 1252, 1278,
];

export let PICKUPS: Pickup[] = [];

/** Named stretches of the course, shown on the section boards and the HUD. */
const CLASSIC_MARKS = [
  { id: 'mass-start', s: 0, en: 'MASS START', zh: '出发浮台', note: '水线 · 集体出发', side: 1 },
  { id: 'channel', s: 150, en: 'THE CHANNEL', zh: '水道窄口', note: '跟滑 · 借人流', side: -1 },
  { id: 'water-exit', s: 285, en: 'WATER EXIT', zh: '出水口', note: '爬梯 · 上浮台', side: 1 },
  { id: 't1', s: 315, en: 'T1 ZONE', zh: '一号换项', note: '脱泳镜 · 戴头盔', side: -1 },
  { id: 'causeway', s: 380, en: 'THE CAUSEWAY', zh: '长堤直道', note: '全速 · 侧风', side: 1 },
  { id: 'hairpin', s: 600, en: 'HAIRPIN', zh: '发夹弯', note: '重刹 · 贴内线', side: -1 },
  { id: 'ridge', s: 720, en: 'RIDGE ROAD', zh: '山脊公路', note: '起伏 · 望远岛', side: 1 },
  { id: 'descent', s: 880, en: 'THE DESCENT', zh: '下坡段', note: '低趴 · 破风', side: -1 },
  { id: 't2', s: 965, en: 'T2 ZONE', zh: '二号换项', note: '挂车 · 换跑鞋', side: 1 },
  { id: 'greenway', s: 1000, en: 'GREENWAY', zh: '林荫绿道', note: '树影 · 找节奏', side: -1 },
  { id: 'beach', s: 1140, en: 'SILVER BEACH', zh: '银滩直道', note: '逆光 · 撞墙区', side: 1 },
  { id: 'promenade', s: 1250, en: 'PROMENADE', zh: '滨江步道', note: '观众 · 最后冲刺', side: -1 },
] as const;

const CANYON_MARKS = [
  { id: 'mass-start', s: 0, en: 'MASS START', zh: '起点浮台', note: '水面 · 北漂', side: 1 },
  { id: 'narrows', s: 150, en: 'NARROWS', zh: '峡谷窄口', note: '贴流 · 借浪', side: -1 },
  { id: 'water-exit', s: 280, en: 'WATER EXIT', zh: '岸边出水', note: '爬石滩 · 换项', side: 1 },
  { id: 't1', s: 302, en: 'T1 ZONE', zh: '一号换项', note: '戴头盔 · 上岩路', side: -1 },
  { id: 'west-rim', s: 452, en: 'WEST RIM', zh: '西岸崖顶', note: '长爬 · 稳踏', side: 1 },
  { id: 'descent', s: 560, en: 'THE DESCENT', zh: '长下坡', note: '重力 · 控速', side: -1 },
  { id: 'mouth-hairpin', s: 770, en: 'MOUTH HAIRPIN', zh: '谷口发夹', note: '重刹 · 转东岸', side: 1 },
  { id: 'east-trail', s: 930, en: 'EAST TRAIL', zh: '东岸步道', note: '爬坡 · 稳住', side: -1 },
  { id: 't2', s: 962, en: 'T2 ZONE', zh: '二号换项', note: '挂车 · 戴白帽', side: 1 },
  { id: 'plateau', s: 1010, en: 'PLATEAU', zh: '高原台阶', note: '踏步 · 稳节奏', side: -1 },
  { id: 'sprint', s: 1200, en: 'THE SPRINT', zh: '冲线直道', note: '沉肩 · 摆臂', side: 1 },
  { id: 'arena', s: 1290, en: 'FINISH ARENA', zh: '终点高台', note: '观众 · 冲线', side: -1 },
] as const;

export type Mark = { id: string; s: number; en: string; zh: string; note: string; side: number };

export let MARKS: readonly Mark[] = CLASSIC_MARKS;

export function markAt(s: number) {
  let index = 0;
  for (let i = 0; i < MARKS.length; i++) if (s >= MARKS[i].s) index = i;
  return MARKS[index];
}

/** Corners are derived from each map's own arcs, so the grip limit the HUD shows
 *  is the limit the terrain actually has. The 0.8 keeps the posted number below
 *  the budget: a rider who holds the line at the sign still has the last twenty
 *  percent for the drift, the entry and one mistake. */
function buildCorners(turns: readonly Turn[]): Corner[] {
  return turns.map((turn, index) => {
    const span = turn.to - turn.from - turn.blend;
    const curvature = Math.abs(turn.angle) / Math.max(1, span);
    const discipline = disciplineAt((turn.from + turn.to) / 2);
    return {
      id: `c${index + 1}`, from: turn.from, to: turn.to, discipline,
      curvature: turn.angle / span,
      limit: Math.sqrt(CONFIG.drive.bike.grip * 0.8 / Math.max(0.004, curvature)),
    };
  }).filter(corner => corner.discipline === 'bike');
}

const TRACK_CORNERS: Record<TrackId, Corner[]> = { classic: [], canyon: [] };
export let CORNERS: Corner[] = [];

export function cornerAt(s: number) {
  return TRACK_CORNERS[activeTrack].find(corner => s >= corner.from && s <= corner.to) ?? null;
}

export const lateralAccel = (s: number, speed: number) => routeCurvature(s) * speed * speed;

/** Rebuild every array that depends on SWIM_END / T1_END / BIKE_END  etc.
 *  Must run after setTrack writes the new breakpoints. */
function rebuildDerived() {
  GATES = GATE_SPECS
    .filter(([s]) => s <= COURSE_LENGTH)
    .map(([s, u], index) => {
      const discipline = disciplineAt(s);
      return {
        id: `g${index + 1}`, s, u, discipline,
        width: discipline === 'swim' ? 9 : discipline === 'bike' ? 8 : 6.4,
        kind: discipline === 'swim' ? 'buoy' : discipline === 'run' ? 'aid' : 'arch',
        group: Math.floor(index / 4),
      };
    });

  OBSTACLES = OBSTACLE_SPECS
    .filter(([s]) => s <= COURSE_LENGTH)
    .map(([s, u], index) => {
      const discipline = disciplineAt(s);
      return {
        id: `o${index + 1}`, s, u, discipline,
        width: discipline === 'swim' ? 1.7 : discipline === 'bike' ? 2.6 : 2.6,
        height: discipline === 'swim' ? 0.75 : discipline === 'bike' ? 1.05 : 1.25,
        thickness: discipline === 'swim' ? 6.3 : discipline === 'bike' ? 0.5 : 1.8,
        kind: discipline === 'swim' ? 'kayak' : discipline === 'bike' ? 'barrier' : 'camp',
      };
    });

  PICKUPS = PICKUP_SPECS
    .filter(s => s <= COURSE_LENGTH)
    .map((s, index) => {
      const discipline = disciplineAt(s);
      const offset = Math.sin(s * 0.05 + index) * (halfWidthAt(s) - 3.2);
      const u = discipline === 'bike' && index % 3 === 0 ? offset * 0.45 : offset;
      return { id: `p${index + 1}`, s, u, discipline, y: surfaceHeight(s, u) + 1.05 };
    });

  MARKS = activeTrack === 'canyon' ? CANYON_MARKS : CLASSIC_MARKS;

  TRACK_CORNERS.classic = buildCorners(CLASSIC_TRACK.turns);
  TRACK_CORNERS.canyon = (CANYON_TRACK.arcs ?? [])
    .filter(arc => Math.abs(arc.curvature) > 0.008 && disciplineAt((arc.from + arc.to) / 2) === 'bike')
    .map((arc, index) => ({
      id: `c${index + 1}`, from: arc.from, to: arc.to, discipline: 'bike' as const,
      curvature: arc.curvature,
      limit: Math.sqrt(CONFIG.drive.bike.grip * 0.8 / Math.max(0.004, Math.abs(arc.curvature))),
    }));
  CORNERS = TRACK_CORNERS[activeTrack];
}

/** Initialize for the default classic track at module load. */
rebuildDerived();

export const ROUTE: { s: number; u: number }[] = [
  { s: 0, u: 0 },
  ...GATES.map(gate => ({ s: gate.s, u: gate.u })),
  { s: COURSE_LENGTH, u: 0 },
];

export { clamp, smoothstep };
