export type Action = 'left' | 'right' | 'burst' | 'brake';

export const BINDABLE: Action[] = ['left', 'right', 'burst', 'brake'];

export type Bindings = Record<Action, string[]>;

export const DEFAULT_BINDINGS: Bindings = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  burst: ['Space'],
  brake: ['ShiftLeft', 'ShiftRight', 'ArrowDown', 'KeyS'],
};

/** Human-readable cap for a KeyboardEvent.code, used by the settings panel. */
export function keyLabel(code: string) {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `NUM ${code.slice(6)}`;
  if (code.startsWith('Arrow')) {
    return ({ ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' } as Record<string, string>)[code] ?? code;
  }
  if (code === 'Space') return 'SPACE';
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'SHIFT';
  if (code === 'ControlLeft' || code === 'ControlRight') return 'CTRL';
  if (code === 'AltLeft' || code === 'AltRight') return 'ALT';
  return code.replace(/(Left|Right)$/, '').toUpperCase();
}

/** Input only records held axes and press edges. What each edge means is a per-discipline rule. */
export class Input {
  private held = new Map<string, Action>();
  private taps = 0;

  press(source: string, action: Action) {
    if (this.held.has(source)) return;
    const burstWasDown = this.holding('burst');
    this.held.set(source, action);
    if (action === 'burst' && !burstWasDown) this.taps += 1;
  }

  release(source: string) { this.held.delete(source); }

  cancel(source: string) { this.held.delete(source); }

  clear() { this.held.clear(); this.taps = 0; }

  /** Presses that have not been consumed by a simulation step yet. */
  takeTap() {
    if (!this.taps) return false;
    this.taps -= 1;
    return true;
  }

  get turn() {
    const values = [...this.held.values()];
    return Number(values.includes('right')) - Number(values.includes('left'));
  }

  holding(action: Action) { return [...this.held.values()].includes(action); }

  snapshot() {
    return {
      turn: this.turn, burst: this.holding('burst'), brake: this.holding('brake'),
      held: [...this.held.values()], taps: this.taps,
    };
  }
}

export function bindKeyboard(input: Input, pause: () => void, isRunning: () => boolean,
  bindings: () => Bindings = () => DEFAULT_BINDINGS) {
  const down = (event: KeyboardEvent) => {
    if (event.code === 'Escape' && !event.repeat) { pause(); return; }
    if (!isRunning()) return;
    const map = bindings();
    const action = BINDABLE.find(key => map[key].includes(event.code));
    if (!action) return;
    event.preventDefault();
    if (!event.repeat) input.press(`key:${event.code}`, action);
  };
  const up = (event: KeyboardEvent) => { input.release(`key:${event.code}`); };
  const clear = () => input.clear();
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', clear);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('blur', clear);
    clear();
  };
}
