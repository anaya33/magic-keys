/**
 * TilesGame — the piano-tiles view's clock (phone held upright).
 *
 * The tiles move at the song's speed, on a song clock that starts with your first tap
 * (so you're never rushed at the start). When a tile reaches the tap zone it waits
 * there for you: nothing is ever missed, and nothing goes by in silence.
 *
 *   Magic   tap anywhere: every tap plays the next note, right away. Tap early and
 *           the music simply jumps ahead to meet you. Notes too quick to tap (marked
 *           `auto`) play themselves after your tap, so runs sound effortless. Magic
 *           is about sounding like you have the skills.
 *   Learn   tap the tile's lane (or, with tiles falling onto the piano, its key). The song runs a little slower (speed), and an early
 *           tap counts up to EARLY_LEARN seconds before the tile arrives; earlier, or
 *           in the wrong lane, the tile shakes its head.
 *
 * The clock is the browser's high-resolution timer (performance.now), read once per
 * animation frame; taps are judged against the same clock, so what you see is what
 * is judged.
 */
import type { TilesView } from '../ui/tiles';

const EARLY_LEARN = 0.5; // seconds

export interface TilesGameOptions {
  view: TilesView;
  /** 'magic': any tap plays the next note. 'learn': tap the tile's own lane. */
  kind: 'magic' | 'learn';
  /** Song speed: 1 = as written, 0.8 = 80%. */
  speed: number;
  /** Tile to start from (the mode's current position). */
  startIndex: number;
  /** Per tile: true if it plays itself (too quick to tap). Optional. */
  auto?: boolean[];
  onHit: (index: number) => void;
  onFinish: () => void;
  /** The clock started, paused, resumed or ended (drives the play/pause button). */
  onState?: (state: TilesState) => void;
}

/** idle: waiting for the first tap. running: tiles moving. paused. done: song over. */
export type TilesState = 'idle' | 'running' | 'paused' | 'done';

export class TilesGame {
  private index: number;
  private running = false;
  private waiting = false; // the clock is holding at a tile until it's played
  private songAtStart = 0; // song time when the clock (re)started
  private wallAtStart = 0; // performance.now() at that moment
  private frame = 0;
  private pausedAt: number | null = null; // song time where the player paused

  constructor(private o: TilesGameOptions) {
    this.index = o.startIndex;
    o.view.show(o.view.timeOf(this.index), this.index);
  }

  private isAuto(i: number): boolean {
    return !!this.o.auto?.[i];
  }

  get paused(): boolean {
    return this.pausedAt !== null;
  }

  get active(): boolean {
    return this.index < this.o.view.count;
  }

  /** Freeze the tiles where they are. */
  pause(): void {
    if (!this.running || this.paused) return;
    this.pausedAt = this.now();
    cancelAnimationFrame(this.frame);
    this.o.view.show(this.pausedAt, this.index);
    this.o.onState?.('paused');
  }

  /** Carry on from exactly where it was paused. */
  resume(): void {
    if (this.pausedAt === null) return;
    if (this.waiting) this.songAtStart = this.pausedAt;
    else this.restartClock(this.pausedAt);
    this.pausedAt = null;
    this.o.onState?.('running');
    this.frame = requestAnimationFrame(this.tick);
  }

  /** Song time right now. */
  private now(): number {
    if (!this.running) return this.o.view.timeOf(this.index);
    if (this.pausedAt !== null) return this.pausedAt;
    if (this.waiting) return this.songAtStart;
    return this.songAtStart + ((performance.now() - this.wallAtStart) / 1000) * this.o.speed;
  }

  tap(lane: number): void {
    if (!this.active) return;
    if (this.paused) return this.resume(); // a tap while paused just carries on
    const { view, kind } = this.o;
    // A run's self-playing notes still waiting finish first, so the tap counts for your tile.
    while (this.running && this.active && this.isAuto(this.index)) this.hit();
    if (!this.active) return this.finish();
    const due = view.timeOf(this.index);

    if (kind === 'learn') {
      // Learn: it has to be the tile's lane, and not too early.
      if (!view.accepts(this.index, lane)) return view.wiggle(this.index);
      if (this.running && this.now() < due - EARLY_LEARN) return view.wiggle(this.index);
    }
    if (!this.running) {
      // First tap starts the clock at this tile.
      this.running = true;
      this.restartClock(due);
      this.o.onState?.('running');
      this.hit();
      if (this.running) this.frame = requestAnimationFrame(this.tick);
      return;
    }
    // Magic: early is fine; the music jumps ahead to meet you.
    if (this.now() < due) {
      this.waiting = false;
      this.restartClock(due);
    }
    this.hit();
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.running = false;
  }

  private hit(): void {
    const i = this.index++;
    this.o.view.mark(i, 'hit');
    this.o.onHit(i);
    if (this.waiting) {
      // The player caught up; the music carries on from here.
      this.waiting = false;
      this.restartClock(this.songAtStart);
    }
    if (!this.active) this.finish();
  }

  private restartClock(songTime: number): void {
    this.songAtStart = songTime;
    this.wallAtStart = performance.now();
  }

  private tick = (): void => {
    if (!this.running || this.paused) return;
    const { view } = this.o;
    let t = this.now();
    // Quick notes play themselves when their time comes (after the tap that led in).
    while (this.active && this.isAuto(this.index) && !this.waiting && t >= view.timeOf(this.index)) this.hit();
    if (!this.active) return; // finish() already ran
    if (!this.waiting && t >= view.timeOf(this.index)) {
      // The next tile reached the tap zone: it waits there for you.
      this.waiting = true;
      this.songAtStart = view.timeOf(this.index);
      t = this.songAtStart;
    }
    view.show(t, this.index);
    this.frame = requestAnimationFrame(this.tick);
  };

  private finish(): void {
    this.stop();
    this.pausedAt = null;
    this.o.onState?.('done');
    this.o.view.show(this.o.view.timeOf(this.o.view.count - 1), this.o.view.count);
    this.o.onFinish();
  }
}
