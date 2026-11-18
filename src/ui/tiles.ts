/**
 * TilesView — the "piano tiles" view for phones held upright.
 *
 * Four lanes. Each step of the song is one flat tile; tiles stack upwards from a
 * tap zone at the bottom, and the whole column glides down one tile each time a
 * step is played, so the next tile always lands in the tap zone.
 *
 * Lanes follow the shape of the melody: a higher note moves one lane to the
 * right, a lower note one lane to the left, a repeated note stays put. So
 * Für Elise's E–D♯–E–D♯ zig-zags between two lanes and your fingers feel the tune.
 *
 * Only the tiles near the tap zone exist in the page (about 16 at a time), so even
 * an 800-step piece costs nothing; each tile moves with a single GPU transform.
 */
const LANES = 4;
/** How many upcoming tiles to keep in the page. */
const AHEAD = 14;

export interface Tile {
  /** Highest note of the step (decides the lane). */
  top: number;
  /** Text on the tile (Learn mode: the note name). */
  label?: string;
}

export class TilesView {
  readonly el: HTMLDivElement;
  private column: HTMLDivElement;
  private tiles: Tile[] = [];
  private lanes: number[] = [];
  private position = 0;
  private live = new Map<number, HTMLDivElement>();

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
      const rect = this.el.getBoundingClientRect();
      const lane = Math.min(LANES - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * LANES)));
      this.onTap(lane);
    });
    // Tiles are sized from the view's own height; refresh positions when it changes.
    new ResizeObserver(() => this.layout(false)).observe(this.el);
  }

  /** Show a new list of tiles (a new song, or a mode change), starting at `position`. */
  setTiles(tiles: Tile[], position = 0): void {
    this.tiles = tiles;
    this.lanes = laneContour(tiles.map((t) => t.top));
    this.position = position;
    this.column.replaceChildren();
    this.live.clear();
    this.layout(false);
  }

  /** Lane of the tile waiting in the tap zone (or -1 at the end). */
  get currentLane(): number {
    return this.lanes[this.position] ?? -1;
  }

  /** Move the column so tile `index` sits in the tap zone (animated). */
  setPosition(index: number): void {
    if (index === this.position) return;
    this.position = index;
    this.layout(true);
  }

  /** The waiting tile gives a little shake (Learn mode: wrong lane). */
  wiggleCurrent(): void {
    const tile = this.live.get(this.position);
    if (!tile) return;
    tile.classList.remove('wiggle');
    void tile.offsetWidth; // restart the animation
    tile.classList.add('wiggle');
  }

  /** Place the visible tiles. Tile i sits (i - position) tile-heights above the tap zone. */
  private layout(animate: boolean): void {
    const height = this.el.clientHeight;
    if (height === 0) return;
    const tileHeight = Math.max(64, Math.min(110, height / 5.5));
    this.el.style.setProperty('--tile-h', `${tileHeight}px`);
    const gap = 8;
    const zoneTop = height - tileHeight - 16; // top edge of the tap zone

    const first = Math.max(0, this.position - 2);
    const last = Math.min(this.tiles.length - 1, this.position + AHEAD);
    // Remove tiles that scrolled out of the window.
    for (const [i, el] of this.live) {
      if (i < first || i > last) {
        el.remove();
        this.live.delete(i);
      }
    }
    for (let i = first; i <= last; i++) {
      let el = this.live.get(i);
      const y = zoneTop - (i - this.position) * (tileHeight + gap);
      if (!el) {
        el = this.makeTile(i);
        // New tiles appear already in place (above the screen), then glide with the rest.
        el.style.transform = `translate(0, ${y - (animate ? tileHeight + gap : 0)}px)`;
        this.column.append(el);
        this.live.set(i, el);
        void el.offsetWidth;
      }
      el.classList.toggle('is-next', i === this.position);
      el.classList.toggle('is-played', i < this.position);
      el.classList.toggle('is-animated', animate);
      el.style.transform = `translate(0, ${y}px)`;
    }
  }

  private makeTile(i: number): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'tile';
    el.style.left = `${(this.lanes[i] / LANES) * 100}%`;
    el.style.width = `${100 / LANES}%`;
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
