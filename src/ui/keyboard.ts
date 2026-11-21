/**
 * KeyboardView — the flat, toy-like piano keyboard.
 *
 * Two parts:
 *  1. The overview: all 88 keys of the full piano in one thin strip. A frame on it
 *     shows which part of the piano is on screen; click or drag it to move.
 *     Notes that play anywhere on the piano light up here too.
 *  2. The playing keys: big, chunky keys. All 88 sit on one long track that slides
 *     sideways behind a window, so moving along the piano is a smooth glide
 *     (one GPU transform), never a jump or a rebuild.
 *
 * Design rules (matching the reference art):
 *  - Cream white keys (#F3EEE3) separated by thin lines, never by big coloured gaps.
 *  - Soft charcoal black keys (#33322D) with rounded bottom corners.
 *  - No gradients or gloss. Depth is a flat, darker strip at the front of each key.
 *    A pressed key slides down onto that strip.
 *
 * Proportions never squish. Everything is sized from one number, the white-key
 * width (--kw): key height, black-key size and corner radii all scale with it.
 * When the screen changes size we show more or fewer keys instead of stretching them.
 *
 * The view only draws and reports presses. It never makes sound itself.
 */
import { isBlackKey, noteName, PIANO_HIGHEST, PIANO_LOWEST } from '../music/notes';

export type KeyHighlight = 'you' | 'magic' | 'target';

/** All 52 white keys of an 88-key piano, low to high. */
const ALL_WHITES: number[] = [];
for (let m = PIANO_LOWEST; m <= PIANO_HIGHEST; m++) if (!isBlackKey(m)) ALL_WHITES.push(m);

/** Where a black key sits relative to the line between its two white neighbours (fraction of a white key). */
const BLACK_KEY_OFFSET: Record<number, number> = { 1: -0.1, 3: 0.1, 6: -0.12, 8: 0, 10: 0.12 };

/** Height ÷ width of a white key. Real pianos are about 6; we stay a little chunkier. */
const IDEAL_ASPECT = 5;
/** Shortest a key may get before we shrink the keys instead (prevents stubby, squished keys). */
const MIN_ASPECT = 3.4;

export interface KeyboardOptions {
  /** Comfortable white-key width in CSS pixels; actual width stays close to this. */
  targetKeyWidth: number;
  /** Note the visible section is centred on at first. */
  centerMidi: number;
  onPress: (midi: number, velocity: number) => void;
  onRelease: (midi: number) => void;
}

export class KeyboardView {
  readonly el: HTMLDivElement;
  private overviewEl: HTMLDivElement;
  private windowEl: HTMLDivElement;
  /** The visible window onto the keys. */
  private keysEl: HTMLDivElement;
  /** All 88 keys, side by side; slides left/right inside keysEl. */
  private trackEl: HTMLDivElement;
  private keyEls = new Map<number, HTMLDivElement>();
  private overviewKeys = new Map<number, HTMLDivElement>();

  /** Visible section: index of the leftmost white key, and how many white keys fit. */
  private startWhite = 0;
  private whiteCount = 15;
  private keyWidth = 60;
  private maxHeight = 400;

  private pointerNotes = new Map<number, number>();
  private highlights = new Map<number, Set<KeyHighlight>>();
  private labels = new Map<number, string>();
  private resizeObserver: ResizeObserver;
  private layoutQueued = false;
  private markLaidOut!: () => void;
  /** Resolves once the keys have been measured and drawn for the first time. */
  readonly laidOut = new Promise<void>((resolve) => (this.markLaidOut = resolve));

  constructor(private options: KeyboardOptions) {
    this.el = document.createElement('div');
    this.el.className = 'keyboard';
    this.overviewEl = document.createElement('div');
    this.overviewEl.className = 'overview';
    this.overviewEl.setAttribute('aria-label', 'Full piano. Click or drag to choose which keys are shown.');
    this.windowEl = document.createElement('div');
    this.windowEl.className = 'overview-window';
    this.keysEl = document.createElement('div');
    this.keysEl.className = 'keyboard-keys';
    this.trackEl = document.createElement('div');
    this.trackEl.className = 'keyboard-track';
    this.keysEl.append(this.trackEl);
    this.el.append(this.overviewEl, this.keysEl);

    this.buildOverview();
    this.buildKeys();
    this.startWhite = ALL_WHITES.indexOf(nearestWhite(options.centerMidi)) - 7;
    this.bindPointerEvents();
    this.bindOverviewEvents();

    // Re-measure when the space changes, at most once per frame.
    this.resizeObserver = new ResizeObserver(() => this.queueLayout());
    this.resizeObserver.observe(this.el);
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    this.el.remove();
  }

  setTargetKeyWidth(px: number): void {
    this.options.targetKeyWidth = px;
    this.queueLayout();
  }

  /** The tallest the playing keys may be (the rest of the screen is decided by the page). */
  /** Phone held sideways: the keys fill all the height they're given (taller keys). */
  fillHeight = false;

  setMaxHeight(px: number): void {
    this.maxHeight = px;
    this.queueLayout();
  }

  /** Measure and draw right now (used once on start-up so nothing pops in a frame later). */
  layoutNow(): void {
    this.layout();
  }

  centerOn(midi: number): void {
    const index = ALL_WHITES.indexOf(nearestWhite(midi));
    this.scrollTo(index - Math.floor(this.whiteCount / 2));
  }

  /**
   * Keep the music in view while a song plays. `groups` are the next few steps in
   * order (each is one step's notes).
   *  - The step being played always wins. If it is wider than the screen (a low bass
   *    note under a high melody), the melody, its highest notes, is kept in view.
   *  - Later steps are included only while everything still fits, so the view moves
   *    early and in one smooth slide rather than a little on every note.
   */
  follow(groups: number[][]): void {
    if (groups.length === 0) return;
    let shown = this.melodyFirst(groups[0]);
    for (const group of groups.slice(1)) {
      const candidate = [...shown, ...group];
      if (this.whiteSpan(candidate) > this.whiteCount - 1) break;
      shown = candidate;
    }
    if (this.isVisible(shown)) return;
    // Centre on the notes so the next move is as far away as possible.
    const lo = whiteIndex(Math.min(...shown), -1);
    const hi = whiteIndex(Math.max(...shown), 1);
    this.scrollTo(Math.round((lo + hi + 1 - this.whiteCount) / 2));
  }

  /** Make sure every note in `notes` is visible, sliding the view as little as possible. */
  ensureVisible(notes: number[]): void {
    if (notes.length === 0 || this.isVisible(notes)) return;
    const lo = whiteIndex(Math.min(...notes), -1);
    const hi = whiteIndex(Math.max(...notes), 1);
    if (hi - lo + 1 > this.whiteCount) this.scrollTo(Math.round((lo + hi - this.whiteCount) / 2));
    else if (lo < this.startWhite) this.scrollTo(lo - 1);
    else this.scrollTo(hi - this.whiteCount + 2);
  }

  /** Add or remove a highlight on a key. Several can stack (e.g. "target" + "you"). */
  setHighlight(midi: number, kind: KeyHighlight, on: boolean): void {
    const set = this.highlights.get(midi) ?? new Set<KeyHighlight>();
    if (on) set.add(kind);
    else set.delete(kind);
    if (set.size) this.highlights.set(midi, set);
    else this.highlights.delete(midi);
    this.paintKey(midi);
  }

  clearHighlights(kind?: KeyHighlight): void {
    for (const midi of [...this.highlights.keys()]) {
      if (kind) this.setHighlight(midi, kind, false);
      else {
        this.highlights.delete(midi);
        this.paintKey(midi);
      }
    }
  }

  /** Replace every label at once (Learn mode moves its labels to the next keys). */
  setLabels(labels: Map<number, string>): void {
    const touched = new Set([...this.labels.keys(), ...labels.keys()]);
    this.labels = new Map(labels);
    for (const midi of touched) this.paintKey(midi);
  }

  /** A small sideways nudge, used to point at the right key after a wrong press. */
  wiggle(midi: number): void {
    const key = this.keyEls.get(midi);
    if (!key) return;
    key.classList.remove('wiggle');
    void key.offsetWidth; // restart the CSS animation
    key.classList.add('wiggle');
  }

  // ---------------------------------------------------------------- layout

  private queueLayout(): void {
    if (this.layoutQueued) return;
    this.layoutQueued = true;
    requestAnimationFrame(() => {
      this.layoutQueued = false;
      this.layout();
    });
  }

  /**
   * Decide the key size, then how many keys fit:
   *  1. Start from the comfortable key width for this screen.
   *  2. If the keys would be too short for that width (a wide but short window),
   *     use narrower keys so the shape stays a proper piano key.
   *  3. Show as many whole keys as fit across, and set the height from the width.
   */
  private layout(): void {
    const width = this.keysEl.clientWidth;
    if (width === 0) return;
    const widthLimitedByHeight = this.maxHeight / MIN_ASPECT;
    const comfortable = Math.max(18, Math.min(this.options.targetKeyWidth, widthLimitedByHeight));
    const count = Math.min(ALL_WHITES.length, Math.max(7, Math.round(width / comfortable)));

    // Keep the view centred on the same spot when the number of visible keys changes.
    const middle = this.startWhite + this.whiteCount / 2;
    this.whiteCount = count;
    this.keyWidth = width / count;
    this.el.style.setProperty('--kw', `${this.keyWidth}px`);
    this.trackEl.style.width = `${this.keyWidth * ALL_WHITES.length}px`;
    const natural = this.keyWidth * IDEAL_ASPECT;
    this.keysEl.style.height = `${Math.round(this.fillHeight ? this.maxHeight : Math.min(this.maxHeight, natural))}px`;
    this.setStart(Math.round(middle - count / 2), false);
    this.markLaidOut();
  }

  private clampStart(index: number): number {
    return Math.max(0, Math.min(ALL_WHITES.length - this.whiteCount, index));
  }

  private scrollTo(index: number): void {
    this.setStart(index, true);
  }

  /** Slide the track so `index` is the leftmost visible white key. */
  private setStart(index: number, animate: boolean): void {
    this.startWhite = this.clampStart(index);
    this.trackEl.classList.toggle('is-sliding', animate);
    this.trackEl.style.transform = `translateX(${-this.startWhite * this.keyWidth}px)`;
    this.updateOverviewWindow();
  }

  private isVisible(notes: number[]): boolean {
    const lo = whiteIndex(Math.min(...notes), -1);
    const hi = whiteIndex(Math.max(...notes), 1);
    return lo >= this.startWhite && hi <= this.startWhite + this.whiteCount - 1;
  }

  private whiteSpan(notes: number[]): number {
    return whiteIndex(Math.max(...notes), 1) - whiteIndex(Math.min(...notes), -1) + 1;
  }

  /** The highest notes of a chord that fit on screen together (the melody wins). */
  private melodyFirst(notes: number[]): number[] {
    const sorted = [...notes].sort((a, b) => b - a);
    const kept: number[] = [];
    for (const n of sorted) {
      if (kept.length && this.whiteSpan([...kept, n]) > this.whiteCount - 1) break;
      kept.push(n);
    }
    return kept;
  }

  /** Build all 88 keys once. Positions are in % of the track, so resizing needs no rebuild. */
  private buildKeys(): void {
    const unit = 100 / ALL_WHITES.length;
    ALL_WHITES.forEach((midi, i) => this.trackEl.append(this.makeKey(midi, 'white', i * unit, unit)));
    ALL_WHITES.forEach((white, i) => {
      const black = white + 1;
      if (!isBlackKey(black) || black > PIANO_HIGHEST) return;
      const width = unit * 0.6;
      const left = (i + 1) * unit - width / 2 + BLACK_KEY_OFFSET[black % 12] * unit;
      this.trackEl.append(this.makeKey(black, 'black', left, width));
    });
  }

  private makeKey(midi: number, color: 'white' | 'black', leftPct: number, widthPct: number): HTMLDivElement {
    const key = document.createElement('div');
    key.className = `key key-${color}`;
    key.dataset.midi = String(midi);
    key.style.left = `${leftPct}%`;
    key.style.width = `${widthPct}%`;
    key.setAttribute('role', 'button');
    key.setAttribute('aria-label', noteName(midi));
    const cap = document.createElement('div');
    cap.className = 'key-cap';
    const label = document.createElement('span');
    label.className = 'key-label';
    cap.append(label);
    key.append(cap);
    key.addEventListener('animationend', () => key.classList.remove('wiggle'));
    this.keyEls.set(midi, key);
    return key;
  }

  private paintKey(midi: number): void {
    const kinds = this.highlights.get(midi);
    const pressed = !!kinds && (kinds.has('you') || kinds.has('magic'));

    const mini = this.overviewKeys.get(midi);
    if (mini) mini.classList.toggle('is-lit', pressed || !!kinds?.has('target'));

    const key = this.keyEls.get(midi);
    if (!key) return;
    key.classList.toggle('is-pressed', pressed);
    key.classList.toggle('lit-you', !!kinds?.has('you'));
    key.classList.toggle('lit-magic', !!kinds?.has('magic'));
    key.classList.toggle('lit-target', !!kinds?.has('target'));
    // Labels only appear where they help: the glowing keys in Learn mode.
    // (Names flashing on every played key go by too fast to read; the sheet music shows them instead.)
    const label = key.querySelector<HTMLSpanElement>('.key-label')!;
    const text = this.labels.get(midi) ?? '';
    label.replaceChildren(
      ...(text ? text.split('\n') : []).map((line) => {
        const span = document.createElement('span');
        span.textContent = line;
        return span;
      }),
    );
  }

  // ---------------------------------------------------------------- overview (full piano)

  private buildOverview(): void {
    const unit = 100 / ALL_WHITES.length;
    ALL_WHITES.forEach((midi, i) => {
      const k = document.createElement('div');
      k.className = 'mini mini-white';
      k.style.left = `${i * unit}%`;
      k.style.width = `${unit}%`;
      this.overviewEl.append(k);
      this.overviewKeys.set(midi, k);
      const black = midi + 1;
      if (isBlackKey(black) && black <= PIANO_HIGHEST) {
        const b = document.createElement('div');
        b.className = 'mini mini-black';
        b.style.left = `${(i + 1) * unit - unit * 0.3}%`;
        b.style.width = `${unit * 0.6}%`;
        this.overviewEl.append(b);
        this.overviewKeys.set(black, b);
      }
    });
    this.overviewEl.append(this.windowEl);
  }

  private updateOverviewWindow(): void {
    const unit = 100 / ALL_WHITES.length;
    this.windowEl.style.left = `${this.startWhite * unit}%`;
    this.windowEl.style.width = `${this.whiteCount * unit}%`;
  }

  /** Click or drag on the full-piano strip to move the visible section there. */
  private bindOverviewEvents(): void {
    let dragging = false;
    const moveTo = (clientX: number) => {
      const rect = this.overviewEl.getBoundingClientRect();
      const whiteAt = Math.floor(((clientX - rect.left) / rect.width) * ALL_WHITES.length);
      this.scrollTo(whiteAt - Math.floor(this.whiteCount / 2));
    };
    this.overviewEl.addEventListener('pointerdown', (e) => {
      dragging = true;
      this.overviewEl.setPointerCapture(e.pointerId);
      moveTo(e.clientX);
    });
    this.overviewEl.addEventListener('pointermove', (e) => dragging && moveTo(e.clientX));
    const stop = () => (dragging = false);
    this.overviewEl.addEventListener('pointerup', stop);
    this.overviewEl.addEventListener('pointercancel', stop);

    // Two-finger sideways swipe on a trackpad also scrolls along the piano.
    let wheelCarry = 0;
    this.el.addEventListener(
      'wheel',
      (e) => {
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
        e.preventDefault();
        wheelCarry += e.deltaX;
        const keys = Math.trunc(wheelCarry / this.keyWidth);
        if (keys) {
          wheelCarry -= keys * this.keyWidth;
          this.scrollTo(this.startWhite + keys);
        }
      },
      { passive: false },
    );
  }

  // ---------------------------------------------------------------- playing input

  private keyAt(x: number, y: number): HTMLDivElement | null {
    const hit = document.elementFromPoint(x, y)?.closest<HTMLDivElement>('.key');
    return hit && this.keysEl.contains(hit) ? hit : null;
  }

  /** Pressing nearer the front of a key plays louder, like a real piano. */
  private velocityFor(key: HTMLDivElement, y: number): number {
    const rect = key.getBoundingClientRect();
    const depth = Math.min(1, Math.max(0, (y - rect.top) / rect.height));
    return 0.45 + depth * 0.45;
  }

  /**
   * Sliding a finger across keys plays each one. Magic mode turns this off: there each
   * tap is one magic step, and a finger that drifts over a key edge must not add notes.
   */
  glide = true;

  private bindPointerEvents(): void {
    const press = (pointerId: number, key: HTMLDivElement, y: number) => {
      const midi = Number(key.dataset.midi);
      this.pointerNotes.set(pointerId, midi);
      this.options.onPress(midi, this.velocityFor(key, y));
    };
    const release = (pointerId: number) => {
      const midi = this.pointerNotes.get(pointerId);
      if (midi === undefined) return;
      this.pointerNotes.delete(pointerId);
      this.options.onRelease(midi);
    };

    this.keysEl.addEventListener('pointerdown', (e) => {
      const key = this.keyAt(e.clientX, e.clientY);
      if (!key) return;
      e.preventDefault();
      this.keysEl.setPointerCapture(e.pointerId);
      press(e.pointerId, key, e.clientY);
    });
    // Sliding a finger across the keys plays each one (glissando), unless turned off.
    this.keysEl.addEventListener('pointermove', (e) => {
      if (!this.glide || !this.pointerNotes.has(e.pointerId)) return;
      const key = this.keyAt(e.clientX, e.clientY);
      if (!key || Number(key.dataset.midi) === this.pointerNotes.get(e.pointerId)) return;
      release(e.pointerId);
      press(e.pointerId, key, e.clientY);
    });
    const end = (e: PointerEvent) => release(e.pointerId);
    this.keysEl.addEventListener('pointerup', end);
    this.keysEl.addEventListener('pointercancel', end);
    this.keysEl.addEventListener('lostpointercapture', end);
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}

/** The white key at `midi`, or the one next to it if `midi` is a black key. */
function nearestWhite(midi: number, direction: 1 | -1 = -1): number {
  const m = Math.min(PIANO_HIGHEST, Math.max(PIANO_LOWEST, midi));
  return isBlackKey(m) ? m + direction : m;
}

/** Position of a note among the 52 white keys (black keys round to a neighbour). */
function whiteIndex(midi: number, direction: 1 | -1): number {
  return ALL_WHITES.indexOf(nearestWhite(midi, direction));
}
