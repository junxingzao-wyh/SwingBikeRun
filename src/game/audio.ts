import { CONFIG, SWIM_END } from '../config';
import type { RunState } from './rules';

type Burst = 'gate' | 'missed' | 'pickup' | 'corner' | 'crash' | 'contact' | 'aid'
  | 'split' | 'burst' | 'bonk' | 'finish' | 'boundary' | 'splash' | 'land';

const EVENTS: Burst[] = ['gate', 'missed', 'pickup', 'corner', 'crash', 'contact', 'aid',
  'split', 'burst', 'bonk', 'finish', 'boundary', 'splash', 'land'];

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Dm7 – B♭maj7 – F – C: a warmer, more open loop than the first sketch. */
const PROGRESSION = [
  [50, 53, 57, 60],
  [46, 50, 53, 57],
  [53, 57, 60, 65],
  [48, 52, 55, 60],
];

type MusicMode = 'swim' | 'bike' | 'run' | 'transition';

/**
 * Synthesised race sound: a water bed while swimming, tyre hiss on the road, footfalls
 * on the track and one short gesture per rules event. No samples, no assets.
 */
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private bed: GainNode | null = null;
  private bedFilter: BiquadFilterNode | null = null;
  private hiss: GainNode | null = null;
  private hissFilter: BiquadFilterNode | null = null;
  private music: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private bursts = new Set<AudioScheduledSourceNode>();
  private eventCursor = 0;
  private strokeLatch = 0;
  private stepLatch = 0;
  private clickTimer = 0;
  private nextNote = 0;
  private musicStep = 0;
  private active = false;
  private volume = 1;

  setVolume(value: number) {
    this.volume = Math.min(1, Math.max(0, value));
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(CONFIG.audio.volume * this.volume, this.context.currentTime, 0.05);
    }
  }
  private failed = false;
  private disposed = false;

  async unlock() {
    if (this.disposed || this.failed) return;
    try {
      if (!this.context) {
        if (!window.AudioContext) { this.failed = true; return; }
        const ctx = new AudioContext();
        this.context = ctx;
        this.master = ctx.createGain();
        this.master.gain.value = 0;
        this.master.connect(ctx.destination);
        this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        let seed = 1729;
        let last = 0;
        for (let i = 0; i < data.length; i++) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          last = (last + ((seed / 4294967296) * 2 - 1) * 0.09) / 1.04;
          data[i] = last * 3;
        }
        const chain = (type: BiquadFilterType, frequency: number) => {
          const gain = ctx.createGain();
          gain.gain.value = 0;
          const filter = ctx.createBiquadFilter();
          filter.type = type;
          filter.frequency.value = frequency;
          filter.connect(gain);
          gain.connect(this.master!);
          const source = ctx.createBufferSource();
          source.buffer = this.noise;
          source.loop = true;
          source.connect(filter);
          source.start();
          this.sources.push(source);
          return { gain, filter };
        };
        // Low, sloshing bed: open water under the athlete.
        const water = chain('lowpass', 480);
        this.bed = water.gain;
        this.bedFilter = water.filter;
        // Bright hiss: airflow on the bike, scuffed rubber on the track.
        const air = chain('highpass', 1400);
        this.hiss = air.gain;
        this.hissFilter = air.filter;
        // The soundtrack sits on its own bus so the race sounds can breathe around it.
        const musicFilter = ctx.createBiquadFilter();
        musicFilter.type = 'lowpass';
        musicFilter.frequency.value = 1200;
        musicFilter.Q.value = 0.3;
        const music = ctx.createGain();
        music.gain.value = 0;
        musicFilter.connect(music);
        music.connect(this.master);
        this.musicFilter = musicFilter;
        this.music = music;
      }
      if (this.context.state === 'suspended') await this.context.resume();
    } catch {
      this.failed = true;
      this.silence();
    }
  }

  /** One-shot noise through a swept band. */
  private swish(duration: number, from: number, to: number, volume: number, type: BiquadFilterType) {
    const ctx = this.context;
    if (!ctx || !this.master || !this.noise) return;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = 0.9;
    filter.frequency.setValueAtTime(from, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, to), now + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    this.bursts.add(source);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); this.bursts.delete(source); };
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  private tone(base: number, peak: number, duration: number, volume: number, type: OscillatorType = 'sine', delay = 0) {
    const ctx = this.context;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(base, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, peak), now + duration * 0.7);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    this.bursts.add(oscillator);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); this.bursts.delete(oscillator); };
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  /** A slow triangle stack: the pad that carries the whole soundtrack. */
  private pad(notes: number[], at: number, duration: number, volume: number) {
    const ctx = this.context;
    if (!ctx || !this.musicFilter) return;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(volume, at + 0.5);
    gain.gain.linearRampToValueAtTime(0.0001, at + duration);
    gain.connect(this.musicFilter);
    let left = notes.length * 2;
    for (const midi of notes) {
      for (const detune of [-7, 7]) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = hz(midi);
        osc.detune.value = detune;
        osc.connect(gain);
        this.bursts.add(osc);
        osc.onended = () => {
          osc.disconnect();
          this.bursts.delete(osc);
          if (--left === 0) gain.disconnect();
        };
        osc.start(at);
        osc.stop(at + duration + 0.05);
      }
    }
  }

  /** Short plucked note: bass pulse and arpeggio share it. */
  private pluck(midi: number, at: number, volume: number, duration = 0.24) {
    const ctx = this.context;
    if (!ctx || !this.music) return;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = hz(midi);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(volume, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0006, at + duration);
    osc.connect(gain);
    gain.connect(this.music);
    this.bursts.add(osc);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); this.bursts.delete(osc); };
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  private kick(at: number, volume: number) {
    const ctx = this.context;
    if (!ctx || !this.music) return;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(126, at);
    osc.frequency.exponentialRampToValueAtTime(42, at + 0.16);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0008, at + 0.2);
    osc.connect(gain);
    gain.connect(this.music);
    this.bursts.add(osc);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); this.bursts.delete(osc); };
    osc.start(at);
    osc.stop(at + 0.22);
  }

  private hat(at: number, volume: number) {
    const ctx = this.context;
    if (!ctx || !this.music || !this.noise) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 6800;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0006, at + 0.05);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.music);
    this.bursts.add(source);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); this.bursts.delete(source); };
    source.start(at, 0.35);
    source.stop(at + 0.07);
  }

  /** One sixteenth-note of the loop, arranged differently per discipline. */
  private playStep(step: number, at: number, mode: MusicMode, energy: number) {
    const chord = PROGRESSION[Math.floor(step / 16) % PROGRESSION.length];
    const beat = step % 16;
    const soft = mode === 'swim' || mode === 'transition';
    if (beat === 0) this.pad(chord, at, 2.1 + energy * 0.6, soft ? 0.055 : 0.038);

    if (mode === 'swim') {
      // Underwater breathing: no drums, just a long bass note and two slow plucks.
      if (beat === 0) this.pluck(chord[0] - 12, at, 0.045, 0.9);
      if (beat === 6) this.pluck(chord[2] + 12, at, 0.024, 0.75);
      if (beat === 10) this.pluck(chord[3] + 12, at, 0.02, 0.6);
      return;
    }

    // The low pulse is the metronome: a heartbeat in the water, a beat on land.
    if (beat === 0 || beat === 8) this.pluck(chord[0] - 12, at, soft ? 0.05 : 0.065, soft ? 0.6 : 0.34);

    const arp = [chord[1], chord[3], chord[2], chord[1] + 12];
    if (soft) {
      if (beat % 4 === 0) this.pluck(arp[(step / 4 | 0) % arp.length] + 12, at, 0.026, 1.1);
      return;
    }
    if (beat % 2 === 0) {
      this.pluck(arp[(step / 2 | 0) % arp.length] + 12, at, 0.024 + energy * 0.016, 0.2);
    }
    if (mode === 'run') {
      if (beat % 4 === 0) this.kick(at, 0.15);
      if (beat % 4 === 2) this.hat(at, 0.018);
    } else {
      if (beat === 0 || beat === 8) this.kick(at, 0.12);
      if (beat % 4 === 2) this.hat(at, 0.013);
    }
  }

  /** Look-ahead sequencer: browser timers are too coarse to play music directly. */
  private musicTick(mode: MusicMode, energy: number) {
    const ctx = this.context;
    if (!ctx) return;
    const tempo = mode === 'swim' ? 88 : mode === 'bike' ? 116 : mode === 'run' ? 124 : 102;
    const stepDur = 60 / tempo / 4;
    if (this.nextNote < ctx.currentTime - 0.4) this.nextNote = ctx.currentTime + 0.05;
    let guard = 0;
    while (this.nextNote < ctx.currentTime + 0.18 && guard++ < 24) {
      this.playStep(this.musicStep, this.nextNote, mode, energy);
      this.musicStep = (this.musicStep + 1) % 64;
      this.nextNote += stepDur;
    }
  }

  private burst(kind: Burst) {
    switch (kind) {
      case 'gate':
        this.tone(700, 1180, 0.22, 0.05);
        this.swish(0.2, 1600, 520, 0.05, 'bandpass');
        break;
      case 'missed':
        this.tone(240, 120, 0.3, 0.06, 'sawtooth');
        break;
      case 'pickup':
      case 'aid':
        this.tone(1180, 1560, 0.18, 0.045, 'triangle');
        this.tone(1760, 2340, 0.22, 0.03, 'triangle', 0.07);
        break;
      case 'corner':
        this.tone(880, 1320, 0.16, 0.035, 'sine');
        break;
      case 'burst':
        this.swish(0.34, 420, 2200, 0.07, 'bandpass');
        break;
      case 'crash':
        this.swish(0.42, 900, 90, CONFIG.audio.impact, 'lowpass');
        this.tone(170, 52, 0.34, 0.07, 'square');
        break;
      case 'contact':
      case 'boundary':
        this.swish(0.3, 700, 140, CONFIG.audio.impact * 0.7, 'lowpass');
        break;
      case 'bonk':
        this.tone(320, 96, 0.5, 0.06, 'triangle');
        break;
      case 'splash':
        this.swish(0.26, 1800, 380, 0.055, 'bandpass');
        break;
      case 'land':
        this.swish(0.16, 520, 120, 0.075, 'lowpass');
        break;
      case 'split':
        this.tone(560, 840, 0.2, 0.04, 'sine');
        this.tone(840, 1120, 0.26, 0.032, 'sine', 0.1);
        break;
      case 'finish':
        this.tone(660, 660, 0.24, 0.055, 'triangle');
        this.tone(880, 880, 0.24, 0.05, 'triangle', 0.16);
        this.tone(1320, 1320, 0.5, 0.05, 'triangle', 0.32);
        this.swish(0.7, 2400, 500, 0.09, 'bandpass');
        break;
    }
  }

  update(state: RunState, muted: boolean) {
    if (state.events.length < this.eventCursor) this.eventCursor = 0;
    const fresh = state.events.slice(this.eventCursor);
    this.eventCursor = state.events.length;
    if (!this.context || !this.master || !this.bed || !this.hiss || !this.bedFilter || !this.hissFilter
      || !this.music || !this.musicFilter) return;
    const running = (state.phase === 'running' || state.phase === 'finishing') && !muted;
    if (!running) { this.silence(); return; }
    this.active = true;
    const now = this.context.currentTime;
    const swimming = state.discipline === 'swim' && state.s < SWIM_END;
    const speed = Math.min(1, state.speed / CONFIG.drive.bike.speed);
    const mode: MusicMode = swimming ? 'swim'
      : state.discipline === 'bike' ? 'bike'
        : state.discipline === 'run' ? 'run' : 'transition';
    const energy = Math.min(1, state.speed / CONFIG.drive[state.discipline].speed);
    this.master.gain.setTargetAtTime(CONFIG.audio.volume * this.volume, now, 0.05);
    this.music.gain.setTargetAtTime(CONFIG.audio.music * (0.8 + energy * 0.4), now, 0.4);
    this.musicFilter.frequency.setTargetAtTime(700 + energy * 1500, now, 0.5);
    this.musicTick(mode, energy);

    if (swimming) {
      // Just a hint of open water; the stroke splashes carry the motion.
      this.bed.gain.setTargetAtTime(CONFIG.audio.wind * 0.16, now, 0.2);
      this.bedFilter.frequency.setTargetAtTime(200 + state.effort * 160, now, 0.3);
      this.hiss.gain.setTargetAtTime(0.003, now, 0.2);
      // One stroke = one catch. A soft low-passed splash, never a ringing band-pass.
      const stroke = Math.floor(state.strokePhase / Math.PI);
      if (stroke !== this.strokeLatch) {
        this.strokeLatch = stroke;
        this.swish(0.24, 880 + state.effort * 240, 230, 0.02 + state.effort * 0.01, 'lowpass');
      }
    } else {
      // Barely there: enough air to feel motion, not enough to sound like wind.
      this.bed.gain.setTargetAtTime(CONFIG.audio.wind * 0.03, now, 0.25);
      this.hiss.gain.setTargetAtTime(CONFIG.audio.turn * (0.015 + speed * speed * 0.1), now, 0.15);
      this.hissFilter.frequency.setTargetAtTime(480 + speed * 820, now, 0.2);
      if (state.discipline === 'bike') {
        this.clickTimer -= 1 / 60;
        if (this.clickTimer <= 0 && state.speed > 3) {
          this.clickTimer = Math.min(0.4, 3.2 / state.speed);
          this.swish(0.05, 1200, 700, 0.003 + speed * 0.004, 'bandpass');
        }
        if (state.braking) this.swish(0.2, 1500, 600, 0.012, 'bandpass');
      } else if (state.discipline === 'run') {
        // Track running is a crisp tap, not a dull wooden thud.
        const step = Math.floor(state.strokePhase / Math.PI);
        if (step !== this.stepLatch) {
          this.stepLatch = step;
          const tap = 0.012 + state.effort * 0.006;
          this.swish(0.06, 2400, 1200, tap, 'bandpass');
          this.swish(0.08, 520, 220, tap * 0.35, 'lowpass');
        }
      }
    }

    for (const event of fresh) {
      if (EVENTS.includes(event.kind as Burst)) this.burst(event.kind as Burst);
    }
  }

  silence() {
    this.active = false;
    if (this.context && this.master) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setValueAtTime(0, this.context.currentTime);
    }
    if (this.bed) this.bed.gain.setTargetAtTime(0, this.context?.currentTime ?? 0, 0.05);
    if (this.hiss) this.hiss.gain.setTargetAtTime(0, this.context?.currentTime ?? 0, 0.05);
    if (this.music) this.music.gain.setTargetAtTime(0, this.context?.currentTime ?? 0, 0.05);
    for (const source of this.bursts) { try { source.stop(); } catch { /* already stopped */ } }
    this.bursts.clear();
  }

  reset() {
    this.silence();
    this.eventCursor = 0;
    this.strokeLatch = 0;
    this.stepLatch = 0;
    this.clickTimer = 0;
    this.nextNote = 0;
    this.musicStep = 0;
  }

  diagnostics() {
    return {
      state: this.context?.state ?? 'not-created',
      active: this.active,
      failed: this.failed,
      master: this.master?.gain.value ?? 0,
      bursts: this.bursts.size,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.silence();
    for (const source of this.sources) { source.stop(); source.disconnect(); }
    this.sources = [];
    void this.context?.close().catch(() => {});
    this.context = null;
    this.noise = null;
  }
}
