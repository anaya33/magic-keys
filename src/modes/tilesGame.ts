/**
 * TilesGame — keeps the player on tempo in the piano-tiles view (phone held upright).
 *
 * The tiles move at the song's real speed, on a song clock that starts with your
 * first tap (so you're never rushed at the start). Each tap is judged against the
 * tile waiting in the tap zone:
 *
 *   Magic (strict)    tap anywhere, but on time. Up to EARLY_STRICT seconds early is
 *                     fine; earlier, the tile shakes its head and nothing plays. A tile
 *                     more than LATE_STRICT seconds late is missed and the music moves
 *                     on without it. At the end you get a score.
 *   Learn (lenient)   tap the tile's lane. The song runs a little slower (speed), an
 *                     early tap up to EARLY_LENIENT seconds counts, and when a tile
 *                     reaches the tap zone it waits there for you; nothing is missed.
 *
 * Notes too quick to tap (marked `auto`, Magic only) play themselves when their time
 * comes, as long as the tap that led into them landed; otherwise they're skipped with it.
 *
 * The clock is the browser's high-resolution timer (performance.now), read once per
 * animation frame; taps are judged against the same clock, so what you see is what
 * is judged.
 */
import type { TilesView } from '../ui/tiles';

const EARLY_STRICT = 0.15; // seconds
const LATE_STRICT = 0.2;
const EARLY_LENIENT = 0.5;

export interface TilesGameOptions {
  view: TilesView;
  strict: boolean;
  /** Song speed: 1 = as written, 0.8 = 80%. */
  speed: number;
  /** Tile to start from (the mode's current position). */
  startIndex: number;
  /** Per tile: true if it plays itself (too quick to tap). Optional. */
  auto?: boolean[];
  onHit: (index: number) => void;
  onMiss: (index: number) => void;
  onFinish: (hits: number, total: number) => void;
}

export class TilesGame {
  private index: number;
  private hits = 0;
  private total: number;
  private running = false;
  private waiting = false; // Learn: the clock is holding at a tile until it's played
  private songAtStart = 0; // song time when the clock (re)started
  private wallAtStart = 0; // performance.now() at that moment
  private frame = 0;
  private lastTapLanded = true; // did the most recent tappable tile get played?

  constructor(private o: TilesGameOptions) {
    this.index = o.startIndex;
    this.total = 0;
    for (let i = o.startIndex; i < o.view.count; i++) if (!this.isAuto(i)) this.total++;
    o.view.show(o.view.timeOf(this.index), this.index);
  }

  private isAuto(i: number): boolean {
    return !!this.o.auto?.[i];
  }

  get active(): boolean {
    return this.index < this.o.view.count;
  }

  /** Song time right now. */
  private now(): number {
    if (!this.running) return this.o.view.timeOf(this.index);
    if (this.waiting) return this.songAtStart;
    return this.songAtStart + ((performance.now() - this.wallAtStart) / 1000) * this.o.speed;
  }

  tap(lane: number): void {
    if (!this.active) return;
    const { view, strict } = this.o;
    // A run's self-playing notes still waiting finish first, so the tap counts for your tile.
    while (this.running && this.isAuto(this.index)) {
      const i = this.index++;
      view.mark(i, this.lastTapLanded ? 'hit' : 'missed');
      if (this.lastTapLanded) this.o.onHit(i);
      else this.o.onMiss(i);
    }
    if (!this.active) return this.finish();
    const due = view.timeOf(this.index);

    // Learn: it has to be the tile's lane.
    if (!strict && lane !== view.laneOf(this.index)) {
      view.wiggle(this.index);
      return;
    }
    // First tap starts the clock at the waiting tile.
    if (!this.running) {
      this.running = true;
      this.restartClock(due);
      this.hit();
      this.frame = requestAnimationFrame(this.tick);
      return;
    }
    const early = strict ? EARLY_STRICT : EARLY_LENIENT;
    if (this.now() >= due - early) this.hit();
    else view.wiggle(this.index); // too early: "not yet"
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.running = false;
  }

  private hit(): void {
    const i = this.index++;
    if (!this.isAuto(i)) this.hits++;
    this.lastTapLanded = true;
    this.o.view.mark(i, 'hit');
    this.o.onHit(i);
    if (this.waiting) {
      // Learn: the player caught up; the music carries on from here.
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
    if (!this.running) return;
    const { view, strict } = this.o;
    let t = this.now();
    if (strict) {
      while (this.active) {
        const i = this.index;
        if (this.isAuto(i) && t >= view.timeOf(i)) {
          // Too quick to tap: plays itself if the tap leading into it landed.
          this.index++;
          if (this.lastTapLanded) {
            view.mark(i, 'hit');
            this.o.onHit(i);
          } else {
            view.mark(i, 'missed');
            this.o.onMiss(i);
          }
        } else if (!this.isAuto(i) && t > view.timeOf(i) + LATE_STRICT) {
          // Magic: a tile that went by untouched is missed; the music doesn't wait.
          this.index++;
          this.lastTapLanded = false;
          view.mark(i, 'missed');
          this.o.onMiss(i);
        } else break;
      }
      if (!this.active) return this.finish();
    } else if (!this.waiting && t >= view.timeOf(this.index)) {
      // Learn: hold the tile in the tap zone until it's played.
      this.waiting = true;
      this.songAtStart = view.timeOf(this.index);
      t = this.songAtStart;
    }
    view.show(t, this.index);
    this.frame = requestAnimationFrame(this.tick);
  };

  private finish(): void {
    this.stop();
    this.o.view.show(this.o.view.timeOf(this.o.view.count - 1), this.o.view.count);
    this.o.onFinish(this.hits, this.total);
  }
}
