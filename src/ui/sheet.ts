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
 * OSMD is about 1 MB, so it is loaded only when sheet music is first shown.
 *
 * The notes being played turn blue, the same blue as the piano keys they light up,
 * so you can see the music travel from the page into the piano.
 *
 * Size: the music is scaled to fill the height of its card, so the notes are big
 * and readable whatever the screen size (re-fitted when the window is resized).
 */
import type { OpenSheetMusicDisplay, VexFlowGraphicalNote } from 'opensheetmusicdisplay';

const INK = '#33322D';

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

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'sheet';
    this.el.setAttribute('aria-label', 'Sheet music');
    this.canvas = document.createElement('div');
    this.canvas.className = 'sheet-canvas';
    const placeholder = document.createElement('div');
    placeholder.className = 'sheet-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    placeholder.innerHTML = `<div class="staff">${'<span></span>'.repeat(5)}</div><div class="staff">${'<span></span>'.repeat(5)}</div><p>Drawing the sheet music…</p>`;
    this.el.append(this.canvas, placeholder);
    // Re-fit the music to its card after the window settles on a new size.
    new ResizeObserver(() => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.fitToHeight(), 200);
    }).observe(this.el);
  }

  /** Engrave a song. Safe to call again with the same song (it is only drawn once). */
  show(musicXml: string): Promise<void> {
    if (this.loadedXml === musicXml && this.loading) return this.loading;
    this.loadedXml = musicXml;
    // While the score is drawn (the first time also downloads the engraver), show
    // flat placeholder staff lines instead of an empty card.
    this.el.classList.add('is-loading');
    this.loading = this.render(musicXml)
      .catch((err) => {
        console.warn('Sheet music could not be drawn:', err);
        this.el.classList.add('is-empty');
      })
      .finally(() => this.el.classList.remove('is-loading'));
    return this.loading;
  }

  private async render(musicXml: string): Promise<void> {
    const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
    if (!this.osmd) {
      this.osmd = new OpenSheetMusicDisplay(this.canvas, {
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
      });
      this.osmd.setLogLevel('error');
    }
    this.el.classList.remove('is-empty');
    await this.osmd.load(musicXml);
    this.osmd.zoom = 1;
    this.osmd.render();
    this.osmd.cursor.show();
    this.fitToHeight();
    this.goTo(0);
  }

  /** Choose a zoom so one line of music (both staves) fills the card's height. */
  private fitToHeight(): void {
    const osmd = this.osmd;
    const svg = this.canvas.querySelector('svg');
    if (!osmd || !svg || this.el.clientHeight === 0) return;
    const naturalHeight = svg.getBoundingClientRect().height / osmd.zoom;
    const zoom = Math.min(1.6, Math.max(0.5, (this.el.clientHeight * 0.92) / naturalHeight));
    if (Math.abs(zoom - osmd.zoom) / osmd.zoom < 0.05) return;
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
    if (fromStart || at() > beat + 1e-4) cursor.reset();
    // (The step cap is a safety net against unusual files; real songs need far fewer.)
    for (let steps = 0; !cursor.Iterator.EndReached && at() < beat - 1e-4 && steps < 20_000; steps++) cursor.next();
    this.highlightCurrentNotes();
    this.scrollToCursor();
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
