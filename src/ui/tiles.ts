/**
 * TilesView — the "piano tiles" view for phones held upright.
 *
 * Four lanes. Each step of the song is one flat tile, placed by its *time* in the
 * song: a tile reaches the tap zone at the bottom exactly when its note is due.
 * The column can be shown two ways:
 *   - show(time):        continuous, used while the song runs at tempo (TilesGame)
 *   - setPosition(index): one tile at a time, gliding (used during Autoplay)
 *
 * Notes too quick to tap (Magic) are thin "ghost" tiles that play themselves.
 *
 * Two ways to place them across:
 *   - lanes (default): four lanes that follow the shape of the melody (below).
 *   - keys (setKeys): each tile falls straight onto its own piano key, which sits
 *     right under the field, and slides along with the keys when they move.
 *
 * Lanes follow the shape of the melody: a higher note moves one lane to the
 * right, a lower note one lane to the left, a repeated note stays put. So
 * Für Elise's E–D♯–E–D♯ zig-zags between two lanes and your fingers feel the tune.
 *
 * Only the tiles near the screen exist in the page (a few dozen at most), so even
 * an 800-step piece costs nothing; each tile moves with a single GPU transform.
 */
const LANES = 4;
const GAP = 8; // px between tiles that follow each other closely
/** Never scroll slower or faster than this (px per second of music). */
const MIN_SPEED = 160;
const MAX_SPEED = 900;

export interface Tile {
  /** Highest note of the step (decides the lane). */
  top: number;
  /** When the tile is due, in seconds of song time. */
  time: number;
  /** Text on the tile (Learn mode: the note name). */
  label?: string;
  /** Too quick to tap: plays itself, carried by the tap before it (drawn as a thin ghost tile). */
  auto?: boolean;
  /** Keys mode: every key that counts as playing this tile (a chord). Defaults to `top`. */
  keys?: number[];
}

/** Where the piano's keys are, for tiles that fall onto them. */
export interface KeyGeometry {
  /** A key's place on the piano's long track, in px. */
  box(midi: number): { left: number; width: number } | null;
  /** px from the field's left edge to the track's lowest key, as the keys are slid right now. */
  offset(): number;
}

export class TilesView {
  readonly el: HTMLDivElement;
  private column: HTMLDivElement;
  private tiles: Tile[] = [];
  private lanes: number[] = [];
  private live = new Map<number, HTMLDivElement>();
  private state = new Map<number, 'hit' | 'missed'>();
  private next = 0; // index of the tile waiting to be played
  private time = 0; // song time currently shown at the tap zone
  private speed = 300; // px per second of song time
  private keys: KeyGeometry | null = null;

  constructor(private onTap: (lane: number) => void) {
    this.el = document.createElement('div');
    this.el.className = 'tiles';
    this.el.innerHTML = `
      <div class="tiles-lanes" aria-hidden="true">${'<span></span>'.repeat(LANES)}</div>
      <div class="tiles-zone" aria-hidden="true"></div>
      <div class="tiles-column"></div>`;
    this.column = this.el.querySelector('.tiles-column')!;
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.keys) {
        // Keys mode: a tap on a tile counts as its key; anywhere else is just a tap.
        const tile = (e.target as HTMLElement).closest<HTMLElement>('.tile');
        return this.onTap(tile ? Number(tile.dataset.top) : -1);
      }
      const rect = this.el.getBoundingClientRect();
      const lane = Math.min(LANES - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * LANES)));
      this.onTap(lane);
    });
    // Tiles are sized from the view's own height; refresh positions when it changes.
    new ResizeObserver(() => {
      this.syncKeys(false);
      this.render(false);
    }).observe(this.el);
  }

  /** Show a new list of tiles (a new song, or a mode change), with `next` in the tap zone. */
  setTiles(tiles: Tile[], next = 0): void {
    this.tiles = tiles;
    this.lanes = laneContour(tiles.map((t) => t.top));
    this.state.clear();
    this.column.replaceChildren();
    this.live.clear();
    this.next = next;
    this.time = tiles[next]?.time ?? 0;
    this.render(false);
  }

  /** Let tiles fall onto piano keys (or `null`: back to the four lanes). */
  setKeys(keys: KeyGeometry | null): void {
    if (!keys && !this.keys) return;
    this.keys = keys;
    this.el.classList.toggle('on-keys', !!keys);
    this.column.replaceChildren();
    this.live.clear();
    this.column.style.transform = '';
    this.syncKeys(false);
    this.render(false);
  }

  /** The keys slid or changed size: move the tiles with them (`animate`: glide along). */
  syncKeys(animate: boolean): void {
    if (!this.keys) return;
    this.column.classList.toggle('is-sliding', animate);
    this.column.style.transform = `translateX(${this.keys.offset()}px)`;
    for (const [i, el] of this.live) this.placeOnKey(el, i);
  }

  /** Does a tap on `lane` (keys mode: a key) play tile `index`? */
  accepts(index: number, lane: number): boolean {
    const tile = this.tiles[index];
    if (!tile) return false;
    if (this.keys) return (tile.keys ?? [tile.top]).includes(lane);
    return lane === this.lanes[index];
  }

  get count(): number {
    return this.tiles.length;
  }

  timeOf(index: number): number {
    return this.tiles[index]?.time ?? Infinity;
  }

  laneOf(index: number): number {
    return this.lanes[index] ?? -1;
  }

  /** Lane of the tile waiting in the tap zone (or -1 at the end). */
  get currentLane(): number {
    return this.laneOf(this.next);
  }

  /** Continuous mode: `time` is the song time at the tap zone, `next` the tile waiting. */
  show(time: number, next: number): void {
    this.time = time;
    this.next = next;
    this.render(false);
  }

  /** Step mode (Autoplay): put tile `index` in the tap zone, gliding there. */
  setPosition(index: number): void {
    if (index === this.next && this.time === this.timeOf(index)) return;
    this.next = index;
    this.time = this.timeOf(Math.min(index, this.tiles.length - 1));
    this.render(true);
  }

  mark(index: number, result: 'hit' | 'missed'): void {
    this.state.set(index, result);
    this.live.get(index)?.classList.add(result === 'hit' ? 'is-played' : 'is-missed');
  }

  /** A tile gives a little shake: "not yet" or "not this lane". */
  wiggle(index: number): void {
    const tile = this.live.get(index);
    if (!tile) return;
    tile.classList.remove('wiggle');
    void tile.offsetWidth; // restart the animation
    tile.classList.add('wiggle');
  }

  /** Place the visible tiles: a tile due `d` seconds from now sits `d × speed` px above the tap zone. */
  private render(animate: boolean): void {
    const height = this.el.clientHeight;
    if (height === 0 || this.tiles.length === 0) return;
    const tileHeight = Math.max(64, Math.min(110, height / 5.5));
    this.el.style.setProperty('--tile-h', `${tileHeight}px`);
    this.speed = this.speedFor(tileHeight);
    const zoneTop = height - tileHeight - (this.keys ? 6 : 16); // where a tile sits when it is due

    // Visible song-time window: a little below the tap zone up to the top edge.
    const from = this.time - (tileHeight + 40) / this.speed;
    const to = this.time + (zoneTop + tileHeight) / this.speed;
    const first = Math.max(0, lowerBound(this.tiles, from) - 1);
    const last = Math.min(this.tiles.length - 1, lowerBound(this.tiles, to), first + 60);

    for (const [i, el] of this.live) {
      if (i < first || i > last) {
        el.remove();
        this.live.delete(i);
      }
    }
    for (let i = first; i <= last; i++) {
      let el = this.live.get(i);
      if (!el) {
        el = this.makeTile(i);
        this.column.append(el);
        this.live.set(i, el);
      }
      const y = zoneTop - (this.tiles[i].time - this.time) * this.speed;
      el.classList.toggle('is-next', i === this.next);
      el.classList.toggle('is-animated', animate);
      el.style.transform = `translate(0, ${y}px)`;
    }
  }

  /**
   * Scroll speed: fast enough that the closest notes still get their own tile, so the
   * spacing you see is the rhythm you play.
   */
  private speedFor(tileHeight: number): number {
    const gaps: number[] = [];
    for (let i = 1; i < this.tiles.length; i++) {
      const g = this.tiles[i].time - this.tiles[i - 1].time;
      if (g > 0.02) gaps.push(g);
    }
    gaps.sort((a, b) => a - b);
    const typicalShortGap = gaps.length ? gaps[Math.floor(gaps.length * 0.1)] : 0.5;
    return Math.min(MAX_SPEED, Math.max(MIN_SPEED, (tileHeight + GAP) / Math.max(0.08, typicalShortGap)));
  }

  /** Keys mode: a tile sits right above its key, as wide as the key. */
  private placeOnKey(el: HTMLDivElement, i: number): void {
    const box = this.keys?.box(this.tiles[i].top);
    if (!box) return;
    el.style.left = `${box.left}px`;
    el.style.width = `${box.width}px`;
    el.classList.toggle('on-black', box.width < 0.8 * (this.keys?.box(60)?.width ?? box.width));
  }

  private makeTile(i: number): HTMLDivElement {
    const el = document.createElement('div');
    el.className = this.tiles[i].auto ? 'tile is-auto' : 'tile';
    el.dataset.top = String(this.tiles[i].top);
    if (this.keys) this.placeOnKey(el, i);
    else {
      el.style.left = `${(this.lanes[i] / LANES) * 100}%`;
      el.style.width = `${100 / LANES}%`;
    }
    const result = this.state.get(i);
    if (result) el.classList.add(result === 'hit' ? 'is-played' : 'is-missed');
    const label = this.tiles[i].label;
    if (label) {
      const span = document.createElement('span');
      span.textContent = label;
      el.append(span);
    }
    el.addEventListener('animationend', () => el.classList.remove('wiggle'));
    return el;
  }
}

/** Index of the first tile due at or after `time` (tiles are sorted by time). */
function lowerBound(tiles: Tile[], time: number): number {
  let lo = 0;
  let hi = tiles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tiles[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Lanes that follow the melody's shape: up → right, down → left, same → stay. */
function laneContour(pitches: number[]): number[] {
  const lanes: number[] = [];
  let lane = 1;
  pitches.forEach((p, i) => {
    if (i > 0) {
      const prev = pitches[i - 1];
      if (p > prev) lane = lane < LANES - 1 ? lane + 1 : lane - 1; // at the edge, bounce back
      else if (p < prev) lane = lane > 0 ? lane - 1 : lane + 1;
    }
    lanes.push(lane);
  });
  return lanes;
}
