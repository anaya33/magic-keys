/**
 * Computer keyboard → piano, using the classic "tracker" layout:
 *
 *   upper row   2 3   5 6 7   9 0   =        (black keys)
 *              Q W E R T Y U I O P [ ]       (white keys, starting one octave up)
 *   lower row   S D   G H J   L ;            (black keys)
 *              Z X C V B N M , . /           (white keys, starting at the base C)
 *
 * We match on `KeyboardEvent.code` (the physical key position), so the layout
 * works the same on QWERTY, AZERTY, Dvorak, etc.
 * Space = sustain pedal. ↑/↓ = move the whole mapping up or down an octave.
 */

/** Physical key → semitones above the base C. */
const KEY_TO_SEMITONE: Record<string, number> = {
  // Lower row: base octave
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7,
  KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
  // Upper row: one octave higher
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19,
  Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23, KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27,
  KeyP: 28, BracketLeft: 29, Equal: 30, BracketRight: 31,
};

/** The bottom row of letters (Z …): Duet mode gives it to the left-hand player. */
const LOWER_ROW = new Set(['KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM', 'Comma', 'KeyL', 'Period', 'Semicolon', 'Slash']);

/** What to print on a key cap for each physical key code. */
const CODE_LABEL: Record<string, string> = {
  Comma: ',', Period: '.', Semicolon: ';', Slash: '/', BracketLeft: '[', BracketRight: ']', Equal: '=',
};

function labelFor(code: string): string {
  return CODE_LABEL[code] ?? code.replace(/^Key|^Digit/, '');
}

export interface ComputerKeysHandlers {
  /** `row`: which row of the computer keyboard it came from (Duet splits players by row). */
  onPress: (midi: number, velocity: number, row?: 'lower' | 'upper') => void;
  onRelease: (midi: number) => void;
  onSustain: (down: boolean) => void;
  onOctave: (baseMidi: number) => void;
  /** Any non-piano key (Magic mode lets *every* key play). Return true if handled. */
  onOtherKey?: (code: string, down: boolean) => boolean;
}

export class ComputerKeys {
  /** MIDI note played by the Z key. 48 = C3. */
  baseMidi = 48;
  /** Which note each held key started, so octave shifts never leave notes stuck. */
  private held = new Map<string, number>();

  constructor(private handlers: ComputerKeysHandlers) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.releaseAll);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.releaseAll);
  }

  /** The computer key that plays `midi` at the current octave, if any (for Learn-mode labels). */
  shortcutFor(midi: number): string | null {
    const offset = midi - this.baseMidi;
    // Prefer the lower row for the base octave and the upper row above it.
    const codes = Object.keys(KEY_TO_SEMITONE).filter((c) => KEY_TO_SEMITONE[c] === offset);
    if (!codes.length) return null;
    const preferred = offset >= 12 ? codes.find((c) => !LOWER_ROW.has(c)) ?? codes[0] : codes[0];
    return labelFor(preferred);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) this.handlers.onSustain(true);
      return;
    }
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      e.preventDefault();
      const next = this.baseMidi + (e.code === 'ArrowUp' ? 12 : -12);
      if (next >= 24 && next <= 84) {
        this.baseMidi = next;
        this.handlers.onOctave(next);
      }
      return;
    }
    if (e.repeat) return; // holding a key down should not re-strike it
    const semitone = KEY_TO_SEMITONE[e.code];
    if (semitone === undefined) {
      if (this.handlers.onOtherKey?.(e.code, true)) e.preventDefault();
      return;
    }
    e.preventDefault();
    if (this.held.has(e.code)) return;
    const midi = this.baseMidi + semitone;
    this.held.set(e.code, midi);
    this.handlers.onPress(midi, 0.72, LOWER_ROW.has(e.code) ? 'lower' : 'upper');
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      this.handlers.onSustain(false);
      return;
    }
    const midi = this.held.get(e.code);
    if (midi === undefined) {
      this.handlers.onOtherKey?.(e.code, false);
      return;
    }
    this.held.delete(e.code);
    this.handlers.onRelease(midi);
  };

  /** If the window loses focus mid-press, let go of everything so nothing hangs. */
  private releaseAll = (): void => {
    for (const midi of this.held.values()) this.handlers.onRelease(midi);
    this.held.clear();
    this.handlers.onSustain(false);
  };
}


function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
