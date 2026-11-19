/**
 * SheetView — the sheet music strip at the top of the screen.
 *
 * Uses OpenSheetMusicDisplay (OSMD) to engrave the song's MusicXML as one long
 * horizontal line of music. A cursor sits on the note being played, and the strip
 * glides sideways so the cursor stays near the left third, like reading ahead.
 *
 * Syncing with the app: every step knows its position in the *written* score
 * (`sourceBeat`, the same both times through a repeat), so `goTo(beat)` walks OSMD's
 * cursor until its written timestamp reaches that beat (OSMD counts in whole notes,
 * we count in quarter notes, hence × 4). Going backwards (a repeat) restarts the walk.
 *
 * No waiting:
 *  - Built-in songs have a ready-made picture of their opening bars
 *    (public/sheet-previews/<song>.svg, made by tools/sheet-previews.html). It appears
 *    instantly, with the page.
 *  - Meanwhile the engraver (OSMD, ~1 MB) starts downloading as soon as the page opens
 *    (preloadSheetEngine). It draws the first bars live (sized from the picture, so
 *    in one pass), takes over from the picture without any visible change, and draws
 *    the rest of the score when the browser is idle.
 *
 * The notes being played turn blue, the same blue as the piano keys they light up,
 * so you can see the music travel from the page into the piano.
 *
 * Size: the music is scaled to fill the height of its card, so the notes are big
 * and readable whatever the screen size (re-fitted when the window is resized).
 */
import type { OpenSheetMusicDisplay, VexFlowGraphicalNote } from 'opensheetmusicdisplay';

const INK = '#33322D';
/** Bars drawn in the quick first pass (and in the preview pictures): more than fit on screen. */
export const FIRST_BARS = 12;

/** How the sheet music is engraved (shared with the preview-picture tool). */
export const SHEET_OPTIONS = {
  backend: 'svg',
  autoResize: false, // one long line: a new screen width never needs a re-layout
  renderSingleHorizontalStaffline: true,
  drawTitle: false,
  drawSubtitle: false,
  drawComposer: false,
  drawLyricist: false,
  drawCredits: false,
  drawPartNames: false,
  drawMetronomeMarks: false,
  followCursor: false, // we scroll the strip ourselves, gently
  defaultColorMusic: INK,
  cursorsOptions: [{ type: 1, color: '#5FB3E0', alpha: 1, follow: false }],
};

let engine: Promise<typeof import('opensheetmusicdisplay')> | null = null;
/** Start downloading the sheet music engine now, in parallel with everything else. */
export function preloadSheetEngine(): Promise<typeof import('opensheetmusicdisplay')> {
  engine ??= import('opensheetmusicdisplay');
  return engine;
}

/** Run when the browser has a free moment (so drawing never competes with playing). */
function whenIdle(fn: () => void): void {
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(fn, { timeout: 600 });
  else window.setTimeout(fn, 60);
}

export class SheetView {
  readonly el: HTMLDivElement;
  private canvas: HTMLDivElement;
  private osmd: OpenSheetMusicDisplay | null = null;
  private loadedXml = '';
  private loading: Promise<void> | null = null;
  private currentBeat = 0;
  private resizeTimer = 0;
  /** SVG groups of the notes currently coloured blue. */
  private highlighted: Element[] = [];
  /** The ready-made picture of the opening bars, shown until the live score is drawn. */
  private preview: HTMLImageElement;
  /** Height of one line of music at zoom 1, read from the preview picture. */
  private naturalHeight: number | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'sheet';
    this.el.setAttribute('aria-label', 'Sheet music');
    this.canvas = document.createElement('div');
    this.canvas.className = 'sheet-canvas';
    const placeholder = document.createElement('div');
    placeholder.className = 'sheet-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    placeholder.innerHTML = `<div class="staff">${'<span></span>'.repeat(5)}</div><div class="staff">${'<span></span>'.repeat(5)}</div>`;
    this.preview = document.createElement('img');
    this.preview.className = 'sheet-preview';
    this.preview.alt = '';
    this.preview.hidden = true;
    this.el.append(this.canvas, this.preview, placeholder);
    // Re-fit the music to its card after the window settles on a new size.
    new ResizeObserver(() => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.fitToHeight(), 200);
    }).observe(this.el);
  }

  /**
   * Engrave a song. Safe to call again with the same song (it is only drawn once).
   * `previewUrl`: a ready-made picture of the opening bars, shown instantly.
   */
  show(musicXml: string, previewUrl?: string): Promise<void> {
    if (this.loadedXml === musicXml && this.loading) return this.loading;
    this.loadedXml = musicXml;
    if (!previewUrl || this.preview.getAttribute('src') !== previewUrl) {
      this.naturalHeight = null;
      this.preview.hidden = true;
    }
    // For the split second before the first bars are drawn, the card shows empty staves.
    this.el.classList.add('is-loading');
    // The engine only starts once the picture is on screen: starting it blocks the page
    // for a moment, and that moment must never hold the picture back.
    const ready = previewUrl ? this.showPreview(previewUrl) : Promise.resolve();
    this.loading = ready
      .then(() => this.whenVisible())
      .then(() => this.render(musicXml))
      .catch((err) => {
        console.warn('Sheet music could not be drawn:', err);
        this.el.classList.add('is-empty');
      })
      .finally(() => this.el.classList.remove('is-loading'));
    return this.loading;
  }

  /**
   * Show the picture of the opening bars at the size the live score will be (it fills
   * the card's height). Resolves once it is painted (or if there is no picture).
   * Called right at start-up for the first song, so music is on screen with the page.
   */
  showPreview(url: string): Promise<void> {
    const img = this.preview;
    this.el.classList.add('is-loading');
    if (img.getAttribute('src') !== url) img.src = url;
    return img
      .decode()
      .then(() => {
        this.naturalHeight = img.naturalHeight;
        img.style.height = `${Math.round(this.el.clientHeight * 0.92)}px`;
        if (this.el.classList.contains('is-loading')) img.hidden = false;
        return new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
      })
      .catch(() => {
        img.hidden = true; // no picture for this song: the live score is drawn directly
      });
  }

  /**
   * Resolves once the sheet music card is actually on screen. Phones hide it (tiles,
   * or the full piano sideways), and drawing a score nobody can see would freeze the
   * page for a moment, so it's drawn only if and when the card appears.
   */
  private whenVisible(): Promise<void> {
    const visible = () => this.el.clientHeight > 0 && this.el.clientWidth > 0;
    if (visible()) return Promise.resolve();
    return new Promise((resolve) => {
      const watch = new ResizeObserver(() => {
        if (!visible()) return;
        watch.disconnect();
        resolve();
      });
      watch.observe(this.el);
    });
  }

  private async render(musicXml: string): Promise<void> {
    const { OpenSheetMusicDisplay } = await preloadSheetEngine();
    if (!this.osmd) {
      this.osmd = new OpenSheetMusicDisplay(this.canvas, SHEET_OPTIONS as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
      this.osmd.setLogLevel('error');
    }
    this.el.classList.remove('is-empty');
    const osmd = this.osmd;
    await osmd.load(musicXml);
    if (this.loadedXml !== musicXml) return; // another song was picked meanwhile

    // 1. Quick first pass: just the first bars, sized to fill the card. With a preview
    //    picture we already know the size, so it's a single pass.
    osmd.setOptions({ drawFromMeasureNumber: 1, drawUpToMeasureNumber: FIRST_BARS });
    const known = this.naturalHeight ? this.zoomFor(this.naturalHeight) : null;
    osmd.zoom = known ?? 1;
    osmd.render();
    if (!known) {
      const zoom = this.fittedZoom();
      if (zoom && Math.abs(zoom - 1) > 0.03) {
        osmd.zoom = zoom;
        osmd.render();
      }
    }
    osmd.cursor.show();
    this.preview.hidden = true; // the live score takes over, same size and place
    this.goTo(this.currentBeat, true);

    // 2. The whole score, when the browser is free, at the same size.
    whenIdle(() => {
      if (this.loadedXml !== musicXml) return;
      osmd.setOptions({ drawUpToMeasureNumber: Number.MAX_SAFE_INTEGER });
      osmd.render();
      osmd.cursor.show();
      this.goTo(this.currentBeat, true);
    });
  }

  /** The zoom at which one line of music (both staves) fills the card's height. */
  private fittedZoom(): number | null {
    const svg = this.canvas.querySelector('svg');
    if (!this.osmd || !svg || this.el.clientHeight === 0) return null;
    return this.zoomFor(svg.getBoundingClientRect().height / this.osmd.zoom);
  }

  private zoomFor(naturalHeight: number): number {
    return Math.min(1.6, Math.max(0.5, (this.el.clientHeight * 0.92) / naturalHeight));
  }

  /** Choose a zoom so one line of music (both staves) fills the card's height. */
  private fitToHeight(): void {
    const osmd = this.osmd;
    const zoom = this.fittedZoom();
    if (!osmd || !zoom || Math.abs(zoom - osmd.zoom) / osmd.zoom < 0.05) return;
    osmd.zoom = zoom;
    osmd.render();
    osmd.cursor.show();
    this.goTo(this.currentBeat, true);
  }

  /** Put the cursor on the note that starts at `beat` (quarter notes from the start). */
  goTo(beat: number, fromStart = false): void {
    this.currentBeat = beat;
    const osmd = this.osmd;
    if (!osmd?.cursor) return;
    const cursor = osmd.cursor;
    const at = () => cursor.Iterator.CurrentSourceTimestamp.RealValue * 4;
    try {
      if (fromStart || at() > beat + 1e-4) cursor.reset();
      // (The step cap is a safety net against unusual files; real songs need far fewer.)
      for (let steps = 0; !cursor.Iterator.EndReached && at() < beat - 1e-4 && steps < 20_000; steps++) cursor.next();
      this.highlightCurrentNotes();
      this.scrollToCursor();
    } catch {
      /* the cursor is past the bars drawn so far; the full score arrives in a moment */
    }
  }

  /** Colour the notes under the cursor blue (and the previous ones back to ink). */
  private highlightCurrentNotes(): void {
    for (const el of this.highlighted) el.classList.remove('is-current');
    this.highlighted = [];
    const notes = this.osmd?.cursor.GNotesUnderCursor() ?? [];
    for (const note of notes) {
      const group = (note as VexFlowGraphicalNote).getSVGGElement?.();
      if (!group) continue;
      group.classList.add('is-current');
      this.highlighted.push(group);
    }
  }

  /** Glide the strip so the cursor sits about a third of the way across. */
  private scrollToCursor(): void {
    const cursorEl = this.osmd?.cursor.cursorElement;
    if (!cursorEl) return;
    const x = parseFloat(cursorEl.style.left) || 0;
    const target = Math.max(0, x - this.el.clientWidth * 0.3);
    if (Math.abs(this.el.scrollLeft - target) > 2) this.el.scrollTo({ left: target, behavior: 'smooth' });
  }
}
