import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CONFIG, COURSE_LENGTH, GATES, MARKS, PICKUPS, buildDisciplines, disciplineAt, markAt, setTrack,
} from '../config';
import type { DisciplineId } from '../config';
import { BINDABLE, DEFAULT_BINDINGS, Input, bindKeyboard, keyLabel, type Action, type Bindings } from '../game/input';
import { createRun, gradeFor, multiplierFor, type RunState } from '../game/rules';
import type { Simulation } from '../game/simulation';
import type { RaceScene } from '../scene/scene';
import { MAP_STYLES, loadMapStyle, nextMapStyle, storeMapStyle, type MapStyleId } from '../scene/mapstyle';
import { GameAudio } from '../game/audio';

const t = CONFIG.text;
const isMain = (id: DisciplineId) => id === 'swim' || id === 'bike' || id === 'run';

const ACTION_LABEL: Record<Action, string> = {
  left: '左转', right: '右转', burst: '冲刺 / 摇车 / 换项确认', brake: '刹车 / 放松',
};
const KEY_STORE = 'lakeline:bindings';
const VOLUME_STORE = 'lakeline:volume';

function loadBindings(): Bindings {
  const merged: Bindings = {
    left: [...DEFAULT_BINDINGS.left], right: [...DEFAULT_BINDINGS.right],
    burst: [...DEFAULT_BINDINGS.burst], brake: [...DEFAULT_BINDINGS.brake],
  };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY_STORE) ?? 'null') as Record<string, unknown> | null;
    if (!raw) return merged;
    for (const action of BINDABLE) {
      const codes = raw[action];
      if (!Array.isArray(codes)) continue;
      const clean = codes.filter((code): code is string => typeof code === 'string' && code.length > 0);
      if (clean.length) merged[action] = clean;
    }
  } catch { /* storage is optional */ }
  return merged;
}

function loadVolume() {
  const raw = localStorage.getItem(VOLUME_STORE);
  const value = raw === null ? 1 : Number(raw);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

/** Race clock, to the tenth: a triathlon split is decided there. */
export const clock = (seconds: number) => {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${(safe % 60).toFixed(1).padStart(4, '0')}`;
};
const pace = (speed: number) => speed < 0.5 ? '--:--'
  : `${Math.floor(1000 / speed / 60)}:${Math.floor(1000 / speed % 60).toString().padStart(2, '0')}`;

function RaceMark() {
  return (
    <svg viewBox="0 0 52 44" fill="none" aria-hidden="true">
      <path d="M3 30c6-7 12-7 18 0s12 7 18 0" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M3 38c6-7 12-7 18 0s12 7 18 0" stroke="var(--teal)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="17" cy="12" r="4.4" fill="currentColor" />
      <path d="M24 17c5-5 11-6 16-3" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M39 14.6 44 9m-5 5.6L38 9.4" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function Icon({ name }: { name: 'sound' | 'mute' | 'pause' | 'motion' | 'settings' | 'map' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {name === 'pause' ? <><path d="M8 5v14M16 5v14" /></>
        : name === 'motion' ? <><path d="M3 8h13a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h6" /></>
          : name === 'map' ? <><path d="m9 4 6 2 6-2v14l-6 2-6-2-6 2V6l6-2Z" /><path d="M9 4v14M15 6v14" /></>
            : name === 'settings' ? <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2.2" /><circle cx="7" cy="17" r="2.2" /></>
              : <><path d="m11 4-6 5H2v6h3l6 5V4Z" />{name === 'sound' ? <><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" /></> : <path d="m16 9 6 6m0-6-6 6" />}</>}
    </svg>
  );
}

type Runtime = { sim: Simulation; scene: RaceScene };
type Diagnostics = {
  read: () => unknown; state: () => RunState; scene: () => unknown; audio: () => unknown;
  warp: (s: number, u: number, speed?: number) => void;
  objects: () => RaceScene;
};
declare global { interface Window { __lakeline?: Diagnostics } }

const SEGMENT_NOTE: Record<DisciplineId, string> = {
  swim: t.swimHint, t1: t.t1Hint, bike: t.bikeHint, t2: t.t2Hint, run: t.runHint,
};

/** What the athlete is doing right now, in the words the commentary would use. */
function modeLabel(run: RunState) {
  const surging = run.time < run.surgeUntil;
  if (run.discipline === 'swim') {
    if (run.easing) return t.glide;
    if (run.effort > 1.05) return t.burst;
    return '自由划';
  }
  if (run.discipline === 'bike') {
    if (run.braking) return '重刹';
    if (surging) return t.surge;
    return '巡航';
  }
  if (run.discipline === 'run') {
    if (run.time < run.bonkUntil) return '撞墙';
    if (run.easing) return '放松';
    if (run.effort > 1.05) return t.sprint;
    return '节奏跑';
  }
  return t.transition;
}

const liveClass = (notice: string) => {
  if (/失控|摔车|偏出|撞墙|出界|别压线|接触/.test(notice)) return 'bad';
  if (/漂亮|通过|补给|过弯|冲线|出发|成功/.test(notice)) return 'good';
  return '';
};

type Status = 'loading' | 'ready' | 'error';

export function App() {
  const host = useRef<HTMLDivElement>(null);
  const pauseCard = useRef<HTMLElement>(null);
  const runtime = useRef<Runtime | null>(null);
  const input = useRef<Input | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [run, setRun] = useState<RunState>(createRun);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(muted); mutedRef.current = muted;
  const audio = useRef<GameAudio | null>(null);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const reducedRef = useRef(reduced); reducedRef.current = reduced;
  const [attempt, setAttempt] = useState(0);
  const [coarse, setCoarse] = useState(() => matchMedia('(pointer: coarse)').matches);
  const [hints, setHints] = useState(() => localStorage.getItem('lakeline:hints') !== '0');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mapStyle] = useState<MapStyleId>(() => {
    const style = loadMapStyle();
    setTrack(style);
    return style;
  });
  // SEGMENTS rebuilds whenever mapStyle changes; above we already seeded the
  // module-level breakpoints (SWIM_END, BIKE_END …) so buildDisciplines() sees
  // the right numbers for this track from the very first render.
  const SEGMENTS = useMemo(() => buildDisciplines(), [mapStyle]);
  const [bindings, setBindings] = useState<Bindings>(loadBindings);
  const [volume, setVolume] = useState(loadVolume);
  const [capture, setCapture] = useState<Action | null>(null);
  const bindingsRef = useRef(bindings); bindingsRef.current = bindings;
  const volumeRef = useRef(volume); volumeRef.current = volume;
  const settingsOpenRef = useRef(settingsOpen); settingsOpenRef.current = settingsOpen;
  const runRef = useRef(run); runRef.current = run;

  useEffect(() => {
    localStorage.setItem('lakeline:hints', hints ? '1' : '0');
  }, [hints]);

  useEffect(() => {
    localStorage.setItem(KEY_STORE, JSON.stringify(bindings));
  }, [bindings]);

  useEffect(() => {
    localStorage.setItem(VOLUME_STORE, String(volume));
    audio.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (capture) setCapture(null);
        else setSettingsOpen(false);
        return;
      }
      if (!capture) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (event.code === 'Tab') { setCapture(null); return; }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const code = event.code;
      setBindings(previous => {
        const next: Bindings = {
          left: [...previous.left], right: [...previous.right],
          burst: [...previous.burst], brake: [...previous.brake],
        };
        for (const action of BINDABLE) next[action] = next[action].filter(item => item !== code);
        next[capture] = [code];
        return next;
      });
      setCapture(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [settingsOpen, capture]);

  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if (event.code !== 'KeyH' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      setHints(value => !value);
    };
    window.addEventListener('keydown', toggle);
    return () => window.removeEventListener('keydown', toggle);
  }, []);

  const pauseToggle = () => {
    const sim = runtime.current?.sim;
    if (!sim) return;
    if (sim.state.phase === 'running') {
      sim.pause();
      audio.current?.silence();
    } else if (sim.state.phase === 'paused') {
      void audio.current?.unlock();
      sim.resume();
    }
    setRun({ ...sim.state });
  };

  /**
   * Each map is a separate build, so switching means reloading the page: the new
   * map is constructed from scratch and nothing from the old course can survive.
   */
  const switchMap = () => {
    storeMapStyle(nextMapStyle(mapStyle));
    window.location.reload();
  };

  useEffect(() => {
    if (run.phase !== 'paused' || status !== 'ready') return;
    const previous = document.activeElement;
    const resume = pauseCard.current?.querySelector('button');
    resume?.focus();
    const keepFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      event.preventDefault();
      resume?.focus();
    };
    document.addEventListener('keydown', keepFocus);
    return () => {
      document.removeEventListener('keydown', keepFocus);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [run.phase, status]);

  useEffect(() => {
    let cancelled = false;
    let failed = false;
    let frame = 0;
    let last = performance.now();
    let lastUI = 0;
    const sound = new GameAudio();
    sound.setVolume(volumeRef.current);
    audio.current = sound;
    let created: Runtime | null = null;
    let unbind: (() => void) | null = null;

    const fail = (message: string) => {
      if (cancelled || failed) return;
      failed = true;
      runtime.current?.sim.pause();
      input.current?.clear();
      sound.silence();
      cancelAnimationFrame(frame);
      created?.scene.dispose();
      runtime.current = null;
      delete window.__lakeline;
      setError(message);
      setStatus('error');
    };

    setStatus('loading');
    setError('');
    const background = () => {
      if (document.hidden || !document.hasFocus()) {
        runtime.current?.sim.pause();
        input.current?.clear();
        sound.silence();
        if (runtime.current) setRun({ ...runtime.current.sim.state });
      }
    };
    const clearInput = () => input.current?.clear();
    const onResize = () => { setCoarse(matchMedia('(pointer: coarse)').matches); clearInput(); };
    document.addEventListener('visibilitychange', background);
    window.addEventListener('blur', background);
    window.addEventListener('resize', onResize);
    const loadTimeout = window.setTimeout(() => fail(t.loadError), 30000);

    const coarseStart = matchMedia('(pointer: coarse)').matches || innerWidth < 760;
    Promise.all([import('../game/simulation'), import('../scene/scene')]).then(([physics, graphics]) => {
      if (cancelled || failed) return;
      // The saved map decides the racing line before the first state is created.
      setTrack(loadMapStyle());
      const sim = new physics.Simulation(coarseStart);
      const scene = new graphics.RaceScene(host.current!, fail);
      if (cancelled) { scene.dispose(); return; }
      created = { sim, scene };
      runtime.current = created;
      // The simulation owns the input, so every control writes straight into it.
      input.current = sim.input;
      unbind = bindKeyboard(sim.input, pauseToggle, () => sim.state.phase === 'running' && !settingsOpenRef.current,
        () => bindingsRef.current);
      scene.reset(sim);
      scene.render(sim, 1 / 60);
      clearTimeout(loadTimeout);
      setRun({ ...sim.state });
      setStatus('ready');

      const loop = (now: number) => {
        const dt = Math.max(0, (now - last) / 1000);
        last = now;
        sim.advance(dt);
        sound.update(sim.state, mutedRef.current);
        scene.reducedMotion = reducedRef.current;
        scene.render(sim, Math.min(dt, 0.1));
        if (now - lastUI > 80) {
          setRun({ ...sim.state });
          lastUI = now;
        }
        frame = requestAnimationFrame(loop);
      };
      last = performance.now();
      frame = requestAnimationFrame(loop);

      if (import.meta.env.DEV || new URLSearchParams(location.search).has('diagnostics')) {
        window.__lakeline = {
          read: () => ({
            state: structuredClone(sim.state),
            physics: sim.diagnostics(),
            graphics: scene.diagnostics(),
            audio: sound.diagnostics(),
            input: sim.input.snapshot(),
          }),
          state: () => structuredClone(sim.state),
          scene: () => scene.diagnostics(),
          audio: () => sound.diagnostics(),
          objects: () => scene,
          warp: (s: number, u: number, speed?: number) => {
            sim.warp(s, u, speed);
            scene.reset(sim);
            setRun({ ...sim.state });
          },
        };
      }
    }).catch(e => {
      clearTimeout(loadTimeout);
      fail(e instanceof Error ? `${t.loadError} ${e.message}` : t.loadError);
    });

    return () => {
      cancelled = true;
      clearTimeout(loadTimeout);
      cancelAnimationFrame(frame);
      unbind?.();
      sound.dispose();
      document.removeEventListener('visibilitychange', background);
      window.removeEventListener('blur', background);
      window.removeEventListener('resize', onResize);
      created?.scene.dispose();
      runtime.current = null;
      audio.current = null;
      delete window.__lakeline;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const start = () => {
    const current = runtime.current;
    if (!current || status !== 'ready' || document.hidden) return;
    void audio.current?.unlock();
    input.current?.clear();
    current.sim.start();
    setRun({ ...current.sim.state });
  };

  const replay = () => {
    const current = runtime.current;
    if (!current) return;
    audio.current?.reset();
    void audio.current?.unlock();
    current.sim.configure(current.scene.mobile);
    current.scene.reset(current.sim);
    current.sim.start();
    setRun({ ...current.sim.state });
  };

  const touch = (action: Action) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (runRef.current.phase !== 'running') return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      input.current?.press(`touch:${event.pointerId}`, action);
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => { input.current?.release(`touch:${event.pointerId}`); },
    onPointerCancel: (event: React.PointerEvent<HTMLButtonElement>) => { input.current?.cancel(`touch:${event.pointerId}`); },
    onLostPointerCapture: (event: React.PointerEvent<HTMLButtonElement>) => { input.current?.cancel(`touch:${event.pointerId}`); },
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
  });

  const ready = run.phase === 'ready';
  const running = run.phase === 'running';
  const progress = Math.min(100, (run.s / COURSE_LENGTH) * 100);
  const discipline = disciplineAt(run.s);
  const segment = SEGMENTS.find(item => item.id === discipline)!;
  const segmentIndex = SEGMENTS.indexOf(segment);
  const mark = markAt(run.s);
  const nextGate = GATES.find(gate => gate.s > run.s && !run.gatesPassed.includes(gate.id)
    && !run.gatesMissed.includes(gate.id));
  const gateDistance = nextGate ? Math.max(0, Math.round(nextGate.s - run.s)) : 0;
  const speedKmh = Math.round(run.speed * 3.6);
  const speedRatio = Math.min(1, run.speed / CONFIG.drive[discipline].speed);
  const cadence = Math.round(discipline === 'swim' ? run.cadence * 2 : run.cadence);
  const airSpeed = run.speed;
  const watts = discipline === 'bike'
    ? Math.round(0.12 * airSpeed ** 3 + 0.4 * airSpeed + 78 * 9.81 * Math.max(0, run.grade) * run.speed)
    : 0;
  const staminaRatio = Math.min(1, run.stamina / CONFIG.stamina.max);
  const grip = Math.min(1.2, run.gripLoad);
  const comboMultiplier = multiplierFor(run);
  const bonking = run.time < run.bonkUntil;
  const surging = run.time < run.surgeUntil;
  const transition = discipline === 't1' || discipline === 't2';
  const transitionWaiting = transition && segment.endS - run.s < 0.05;
  const grade = gradeFor(run);
  const nextPickup = PICKUPS.find(pickup => pickup.s > run.s && !run.pickupsTaken.includes(pickup.id));
  /** The segment being raced has not closed its split yet, so the rail counts live. */
  const splitTime = (id: DisciplineId) => run.splits[id]
    + (id === discipline && running ? run.time - run.splitAt : 0);

  const actionHelp: Record<DisciplineId, { burst: string; brake: string }> = {
    swim: { burst: t.burst, brake: t.glide },
    t1: { burst: '快换 / 确认', brake: '慢走' },
    bike: { burst: t.surge, brake: '刹车' },
    t2: { burst: '快换 / 确认', brake: '慢走' },
    run: { burst: t.sprint, brake: '放松' },
  };

  return (
    <main
      className={`game phase-${run.phase} ${reduced ? 'reduced-motion' : ''} ${coarse ? 'coarse' : ''} disc-${discipline}`}
      style={{
        '--ink': CONFIG.colors.ink,
        '--accent': CONFIG.colors.gate,
        '--paper': CONFIG.colors.paper,
        '--teal': CONFIG.colors.gateAlt,
        '--water': CONFIG.colors.water,
        '--speed': `${speedRatio * 100}`,
      } as React.CSSProperties}
    >
      <div className="scene" ref={host} />
      <div className="vignette" />
      <div className="grain" />

      <header className="header">
        <div className="brand"><RaceMark /><span>{CONFIG.brand.name}<small>{CONFIG.brand.title}</small></span></div>
        <nav className="settings" aria-label="比赛设置">
          <button className="icon-button map-button" onClick={switchMap} aria-pressed={mapStyle !== 'classic'}
            aria-label={`赛道地图 · ${MAP_STYLES[mapStyle].name}`}
            title={`赛道地图 · ${MAP_STYLES[mapStyle].name}（点击切换到${MAP_STYLES[nextMapStyle(mapStyle)].name}赛道）`}>
            <Icon name="map" /><span aria-hidden="true">{MAP_STYLES[mapStyle].name}</span>
          </button>
          <button className="icon-button" onClick={() => { setCapture(null); setSettingsOpen(true); }} aria-label="设置" aria-pressed={settingsOpen} title="设置 · 音量与按键"><Icon name="settings" /></button>
          <button className="icon-button hint-button" onClick={() => setHints(!hints)} aria-label={hints ? t.hintsOff : t.hintsOn} aria-pressed={hints} title={`${hints ? t.hintsOff : t.hintsOn} · H`}><span aria-hidden="true">?</span></button>
          <button className="icon-button motion-button" onClick={() => setReduced(!reduced)} aria-label={reduced ? t.motionOff : t.motion} aria-pressed={reduced} title={reduced ? t.motionOff : t.motion}><Icon name="motion" /></button>
          <button className="icon-button" onClick={() => { mutedRef.current = !muted; if (!muted) audio.current?.silence(); setMuted(!muted); }} aria-label={muted ? t.unmute : t.mute} aria-pressed={muted} title={muted ? t.unmute : t.mute}><Icon name={muted ? 'mute' : 'sound'} /></button>
          {(running || run.phase === 'paused') && <button className="icon-button" onClick={pauseToggle} aria-label={run.phase === 'paused' ? t.resume : t.pause} title={t.pause}><Icon name="pause" /></button>}
        </nav>
      </header>

      {status === 'loading' && (
        <div className="modal-layer"><section className="small-card"><span className="loader" /><p>{t.loading}</p><small>{t.preparing}</small></section></div>
      )}
      {status === 'error' && (
        <div className="modal-layer"><section className="small-card" role="alert"><h2>{t.error}</h2><p>{error}</p><button className="primary" onClick={() => setAttempt(n => n + 1)}>{t.retry}<span>↗</span></button></section></div>
      )}

      {settingsOpen && (
        <div className="modal-layer" onPointerDown={event => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
          <section className="small-card settings-card" role="dialog" aria-modal="true" aria-label="设置">
            <div className="settings-head">
              <span className="tiny-label">SETTINGS · 设置</span>
              <button className="settings-close" onClick={() => setSettingsOpen(false)} aria-label="关闭设置">×</button>
            </div>
            <h2>声音与按键</h2>
            <label className="volume-row">
              <span>总音量</span>
              <input type="range" min={0} max={100} value={Math.round(volume * 100)}
                onChange={event => setVolume(Number(event.target.value) / 100)} />
              <b>{Math.round(volume * 100)}%</b>
            </label>
            <div className="bind-list">
              {BINDABLE.map(action => (
                <div className="bind-row" key={action}>
                  <span>{ACTION_LABEL[action]}</span>
                  <div className="bind-keys">
                    {bindings[action].map(code => <kbd key={code}>{keyLabel(code)}</kbd>)}
                  </div>
                  <button className={`bind-button${capture === action ? ' on' : ''}`}
                    onClick={() => setCapture(capture === action ? null : action)}>
                    {capture === action ? '按新键…' : '改键'}
                  </button>
                </div>
              ))}
            </div>
            <div className="settings-actions">
              <button className="text-button" onClick={() => {
                setBindings({
                  left: [...DEFAULT_BINDINGS.left], right: [...DEFAULT_BINDINGS.right],
                  burst: [...DEFAULT_BINDINGS.burst], brake: [...DEFAULT_BINDINGS.brake],
                });
                setCapture(null);
              }}>恢复默认</button>
              <button className="primary" onClick={() => setSettingsOpen(false)}>完成<span>OK</span></button>
            </div>
            <small>点击“改键”后按下任意键即可替换，Esc 取消。音量与静音互不影响。</small>
          </section>
        </div>
      )}

      {status === 'ready' && ready && (
        <>
          <section className="intro">
            <h1 className="intro-display" aria-label={CONFIG.brand.headline.join(' ')}>
              {CONFIG.brand.headline.map(word => <span key={word}>{word}</span>)}
            </h1>
            <p className="intro-subtitle">{CONFIG.brand.subtitle}</p>
            <button className="primary start-button" onClick={start}>
              {t.start}<span className="start-sticker" aria-hidden="true">{t.start}</span>
            </button>
          </section>

          <aside className="intro-details" aria-label="赛段与操作">
            <div className="race-segments">
              {SEGMENTS.map(item => (
                <div key={item.id} className={`segment-row segment-${item.id}`}>
                  <b>{item.english}</b>
                  <span>{item.note}</span>
                  <i>{item.endS - item.startS} M</i>
                </div>
              ))}
            </div>
            <div className="trail-stats">
              <span><strong>{(COURSE_LENGTH / 1000).toFixed(2)}</strong> km 全程</span>
              <span><strong>{GATES.length}</strong> 标志门</span>
              <span><strong>{PICKUPS.length}</strong> 补给点</span>
            </div>
            <div className="desktop-help">
              <div><span className="help-keys">{bindings.left.map(code => <kbd key={code}>{keyLabel(code)}</kbd>)}{bindings.right.map(code => <kbd key={code}>{keyLabel(code)}</kbd>)}</span><span>转向 · 压线扣分</span></div>
              <div><span className="help-keys">{[...new Set(bindings.burst.map(keyLabel))].map(label => <kbd key={label} className="space-key">{label}</kbd>)}</span><span>游泳冲刺 · 骑行摇车 · 跑步冲刺</span></div>
              <div><span className="help-keys">{[...new Set(bindings.brake.map(keyLabel))].slice(0, 2).map(label => <kbd key={label} className="space-key">{label}</kbd>)}</span><span>游泳放松 · 骑行刹车 · 跑步放松</span></div>
            </div>
            <p className="mobile-help">{t.mobileHelp}</p>
          </aside>

          <footer className="intro-footer">
            <span className="footer-edition"><i /> {MAP_STYLES[mapStyle].venue}<b>{MAP_STYLES[mapStyle].eventName}</b></span>
          </footer>
        </>
      )}

      {status === 'ready' && !ready && (
        <>
          <section className="hud-left">
            <div className="hud-time"><span className="tiny-label">{t.time}</span><strong>{clock(run.time)}</strong></div>
            <div className="stage-strip">
              <span className="stage-id">{String(segmentIndex + 1).padStart(2, '0')}</span>
              <div className="stage-meta">
                <b>{segment.name} · {mark.zh}</b>
                <small>{segment.english} · {mark.en}</small>
              </div>
              <div className="stage-bars">
                {SEGMENTS.map((item, index) => (
                  <i key={item.id} className={index < segmentIndex ? 'done' : index === segmentIndex ? 'now' : ''} />
                ))}
              </div>
            </div>
            <div className="stamina" aria-label={`${t.staminaLabel} ${Math.round(run.stamina)}`}>
              <span className="tiny-label">{t.staminaLabel}</span>
              <div className={`meter${staminaRatio < 0.28 ? ' low' : ''}${bonking ? ' bonk' : ''}`}><i style={{ width: `${staminaRatio * 100}%` }} /></div>
            </div>
            <div className="splits" aria-label="分段成绩">
              {SEGMENTS.map(item => (
                <div key={item.id} className={`${item.id === discipline ? 'now' : ''}${isMain(item.id) ? '' : ' minor'}`}>
                  <span>{item.english}</span>
                  <strong>{run.s >= item.startS || item.id === discipline ? clock(splitTime(item.id)) : '--:--'}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="hud-right">
            <div className="hud-score"><span className="tiny-label">{t.score}</span><strong>{Math.round(run.score).toString().padStart(4, '0')}</strong></div>
            {run.combo >= CONFIG.combo.firstTier && (
              <div className={`combo-chip ${comboMultiplier > 1.5 ? 'hot' : ''}`}><b>×{comboMultiplier}</b><span>{run.combo} 连击</span></div>
            )}
            <div className="run-counters">
              <span><b>{run.gatesPassed.length}</b>/{run.gateTotal} 门</span>
              <span><b>{run.pickupsTaken.length}</b>/{PICKUPS.length} 补给</span>
              <span><b>{run.cornersClean}</b> 干净弯</span>
              <span className={run.mistakes ? 'bad' : ''}><b>{run.mistakes}</b> 失误</span>
            </div>
            {discipline === 'bike' && (
              <div className="grip" aria-label={`${t.gripLabel} ${Math.round(grip * 100)}%`}>
                <span className="tiny-label">{t.gripLabel}</span>
                <div className={`meter${grip > 1 ? ' over' : grip > CONFIG.drive.bike.slideWarn ? ' warn' : ''}`}>
                  <i style={{ width: `${Math.min(100, grip * 100 / 1.2)}%` }} />
                  <em />
                </div>
              </div>
            )}
          </section>

          <div className={`live-feedback ${liveClass(run.notice)}`} aria-live="polite">
            {run.noticeUntil > run.time && <span key={run.notice + run.noticeUntil}>{run.notice}</span>}
          </div>

          <div className="progress-wrap">
            <div className="progress-labels">
              <span>{t.startMarker}</span>
              <span className="progress-distance">{Math.max(0, Math.round(COURSE_LENGTH - run.s))} M 到终点</span>
              <span>{t.finishMarker}</span>
            </div>
            <div className="course-progress">
              <div className="stage-bands">
                {SEGMENTS.map(item => (
                  <i key={item.id} className={item.endS <= run.s ? 'lit' : item.startS <= run.s ? 'now' : ''}
                    style={{ width: `${(item.endS - item.startS) / COURSE_LENGTH * 100}%` }} />
                ))}
              </div>
              <div className="gate-ticks">
                {GATES.map(gate => (
                  <b key={gate.id}
                    className={run.gatesPassed.includes(gate.id) ? 'passed' : run.gatesMissed.includes(gate.id) ? 'missed' : gate.kind}
                    style={{ left: `${(gate.s / COURSE_LENGTH) * 100}%` }} />
                ))}
              </div>
              <span className="athlete-marker" style={{ left: `${progress}%` }} />
            </div>
            <div className="next-gate">
              {nextGate
                ? <>下一个 {nextGate.kind === 'buoy' ? '绕标' : nextGate.kind === 'aid' ? '补给站' : '计时门'}
                  <b>{nextGate.id.slice(1).padStart(2, '0')}</b><i />{gateDistance} M</>
                : <>终点前 <b>{Math.max(0, Math.round(COURSE_LENGTH - run.s))}</b> M</>}
            </div>
          </div>

          <div className={`speedometer ${isMain(discipline) ? '' : 'parking'}`}>
            <svg viewBox="0 0 120 72" aria-hidden="true">
              <path className="gauge-track" d="M12 62 A48 48 0 0 1 108 62" pathLength={100} />
              <path className="gauge-fill" d="M12 62 A48 48 0 0 1 108 62" pathLength={100} strokeDasharray={`${speedRatio * 100} 100`} />
            </svg>
            <strong>{discipline === 'run' ? pace(run.speed) : discipline === 'swim' ? cadence : speedKmh}</strong>
            <span>{discipline === 'run' ? 'MIN/KM 配速' : discipline === 'swim' ? 'SPM 划频' : discipline === 'bike' ? 'KM/H' : '换项'}</span>
            <small>{modeLabel(run)}</small>
            {discipline === 'bike' && <em>{watts} W</em>}
            {discipline === 'run' && <em>{cadence} SPM</em>}
            {discipline === 'swim' && <em>{speedKmh} KM/H</em>}
          </div>

          {!coarse && (
            <div className="run-help">
              <span><kbd>←</kbd><kbd>→</kbd> 转向</span>
              <span><kbd>SPACE</kbd> {actionHelp[discipline].burst}</span>
              <span><kbd>SHIFT</kbd> {actionHelp[discipline].brake}</span>
              {discipline === 'bike' && <span className="hold">进弯前松油门 · 越线会失控</span>}
              {discipline === 'run' && !bonking && <span className="hold">体力见底会撞墙 · 找补给站</span>}
            </div>
          )}

          {coarse && running && (
            <div className="touch-controls" aria-label="触控操作">
              <div className="steering">
                <button {...touch('left')} aria-label="向左">←</button>
                <button {...touch('right')} aria-label="向右">→</button>
              </div>
              <div className="effort-buttons">
                <button className="brake-button" {...touch('brake')} aria-label={actionHelp[discipline].brake}>
                  <span>·</span>{actionHelp[discipline].brake}<small>按住</small>
                </button>
                <button className="action-button" {...touch('burst')} aria-label={actionHelp[discipline].burst}>
                  <span>↑</span>{actionHelp[discipline].burst}<small>按住 / 点按</small>
                </button>
              </div>
            </div>
          )}

          {transition && (
            <aside className="transition-card">
              <div className="transition-head">
                <span className="tiny-label">{discipline === 't1' ? 'T1 / 一号换项' : 'T2 / 二号换项'}</span>
                <strong>{clock(splitTime(discipline))}</strong>
              </div>
              <div className="transition-meter"><i style={{ width: `${Math.min(100, (run.s - segment.startS) / (segment.endS - segment.startS) * 100)}%` }} /></div>
              <div className="transition-foot">
                <span>{transitionWaiting
                  ? coarse
                    ? `点按右侧按钮${discipline === 't1' ? '上车' : '开跑'}`
                    : `按空格确认${discipline === 't1' ? '上车，进入骑行' : '换鞋，进入跑步'}`
                  : discipline === 't1' ? t.t1Hint : t.t2Hint}</span>
                <b>{transitionWaiting ? '待确认' : `${Math.max(0, Math.round(segment.endS - run.s))} M`}</b>
              </div>
            </aside>
          )}

          {hints && isMain(discipline) && run.s - segment.startS < 220 && running && (
            <aside className="tech-card">
              <span className="tiny-label">{segment.english} / {segment.name}</span>
              <strong>{SEGMENT_NOTE[discipline]}</strong>
              <ol>
                {discipline === 'swim' && <>
                  <li><i>01</i>沿浮标线前进</li>
                  <li className={run.effort > 1.05 ? 'on' : ''}><i>02</i>按住空格冲刺划水</li>
                  <li className={run.easing ? 'on' : ''}><i>03</i>按住 Shift 漂游回体力</li>
                </>}
                {discipline === 'bike' && <>
                  <li className={surging ? 'on' : ''}><i>01</i>点按空格起身摇车</li>
                  <li className={run.braking ? 'on' : ''}><i>02</i>急弯前按住 Shift 减速</li>
                  <li className={run.cornerDirty ? 'bad on' : ''}><i>03</i>贴内线过弯</li>
                </>}
                {discipline === 'run' && <>
                  <li className={nextPickup ? '' : 'on'}><i>01</i>过补给站回体力</li>
                  <li className={run.effort > 1.05 ? 'on' : ''}><i>02</i>按住空格冲刺</li>
                  <li className={bonking ? 'bad on' : ''}><i>03</i>留体力，别撞墙</li>
                </>}
              </ol>
            </aside>
          )}

          {run.phase === 'finishing' && <div className="finish-toast">{t.finish}<small>{t.resultSubtitle}</small></div>}

          {run.phase === 'paused' && (
            <div className="modal-layer">
              <section ref={pauseCard} className="small-card pause-card" role="dialog" aria-modal="true" aria-labelledby="pause-title">
                <span className="tiny-label">{t.pauseLabel} / 换项区</span>
                <div className="card-display" aria-hidden="true">PAUSED.</div>
                <h2 id="pause-title">{t.paused}</h2>
                <p>{t.pausedHint}</p>
                <button className="primary" onClick={pauseToggle}>{t.resume}<span aria-hidden="true">↗</span></button>
                <small>{coarse ? t.mobileHelp : t.desktopHelp}</small>
              </section>
            </div>
          )}

          {run.phase === 'results' && (
            <div className="results-layer">
              <section className="result-card">
                <div className="result-top">
                  <div className="result-brand"><RaceMark /><span>{t.resultLabel}</span></div>
                  <span className={`grade grade-${grade.toLowerCase()}`}>{grade}</span>
                </div>
                <div className="card-display" aria-hidden="true">FINISHED.</div>
                <h2>{t.result}</h2>
                <p>{MAP_STYLES[mapStyle].venue} · 三项完赛。</p>
                <div className="result-main">
                  <div><span>{t.time}</span><strong>{clock(run.finishTime || run.time)}</strong></div>
                  <div><span>{t.score}</span><strong>{Math.round(run.score)}</strong></div>
                </div>
                <table className="split-table">
                  <thead><tr><th>赛段</th><th>用时</th><th>均速</th></tr></thead>
                  <tbody>
                    {SEGMENTS.map(item => {
                      const metres = item.endS - item.startS;
                      const time = run.splits[item.id];
                      return (
                        <tr key={item.id} className={item.id === 't1' || item.id === 't2' ? 'minor' : ''}>
                          <td>{item.name}<small>{item.english}</small></td>
                          <td>{time > 0 ? clock(time) : '--:--'}</td>
                          <td>{time > 0.5 ? `${(metres / 1000 / (time / 3600)).toFixed(1)} km/h` : '--'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="result-stats">
                  <div><strong>{run.gatesPassed.length}<small>/{run.gateTotal}</small></strong><span>{t.gates}</span></div>
                  <div><strong>{run.pickupsTaken.length}<small>/{PICKUPS.length}</small></strong><span>{t.pickups}</span></div>
                  <div><strong>{run.cornersClean}</strong><span>{t.corners}</span></div>
                  <div><strong>{Math.round(run.topSpeed * 3.6)}<small>km/h</small></strong><span>{t.topSpeed}</span></div>
                  <div><strong>{run.mistakes}</strong><span>{t.collisions}</span></div>
                </div>
                <button className="primary" onClick={replay}>{t.replay}<span>↗</span></button>
                <small className="result-foot">{MARKS.length} 个路标 · {COURSE_LENGTH} M · {MAP_STYLES[mapStyle].eventName}</small>
              </section>
            </div>
          )}
        </>
      )}
    </main>
  );
}
