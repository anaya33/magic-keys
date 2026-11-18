/**
 * LibraryView — the full-screen song library.
 *
 *  Songs        the built-in pieces (title, composer, difficulty)
 *  Your songs   Record (opens Listen) · Upload sheet music · your recordings and uploads
 *
 * Your songs are saved on this device and each has a delete button (tap it twice:
 * the first tap asks "Delete?"). Uploads accept MusicXML (.musicxml / .xml / .mxl),
 * the format every notation app can export; you can also drag a file onto the page.
 */
import { deleteYourSong, listSongs, songFromFile, type SongInfo } from '../music/library';
import type { Song } from '../music/types';

const DIFFICULTY_DOTS = { Easy: 1, Medium: 2, Hard: 3 } as const;

export class LibraryView {
  private el: HTMLDivElement;
  private builtInGrid: HTMLDivElement;
  private yourGrid: HTMLDivElement;
  private message: HTMLParagraphElement;
  private input: HTMLInputElement;
  private currentId = '';

  constructor(
    private handlers: {
      onPick: (id: string) => void;
      onUploaded: (song: Song) => void;
      onRecord: () => void;
      /** A song was deleted (if it was the one playing, the app moves to another). */
      onDeleted: (id: string) => void;
    },
  ) {
    this.el = document.createElement('div');
    this.el.className = 'panel library';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-labelledby', 'library-title');
    this.el.innerHTML = `
      <button class="close-btn" aria-label="Close the song library"><span></span><span></span></button>
      <div class="library-body">
        <h2 class="library-title" id="library-title">Songs</h2>
        <p class="library-message" role="status" hidden></p>
        <div class="song-grid" data-grid="built-in"></div>
        <h3 class="library-subtitle">Your songs</h3>
        <div class="song-grid" data-grid="yours"></div>
      </div>
      <input type="file" accept=".musicxml,.xml,.mxl,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml" hidden />`;
    document.body.append(this.el);

    this.builtInGrid = this.el.querySelector('[data-grid="built-in"]')!;
    this.yourGrid = this.el.querySelector('[data-grid="yours"]')!;
    this.message = this.el.querySelector('.library-message')!;
    this.input = this.el.querySelector('input')!;
    this.el.querySelector('.close-btn')!.addEventListener('click', () => this.hide());
    this.input.addEventListener('change', () => {
      const file = this.input.files?.[0];
      if (file) void this.upload(file);
      this.input.value = '';
    });

    // Drag a file anywhere onto the library to add it.
    this.el.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.el.classList.add('is-dropping');
    });
    this.el.addEventListener('dragleave', (e) => {
      if (e.target === this.el) this.el.classList.remove('is-dropping');
    });
    this.el.addEventListener('drop', (e) => {
      e.preventDefault();
      this.el.classList.remove('is-dropping');
      const file = e.dataTransfer?.files?.[0];
      if (file) void this.upload(file);
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.open) this.hide();
    });
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  async show(currentId: string): Promise<void> {
    this.currentId = currentId;
    this.message.hidden = true;
    this.el.hidden = false;
    await this.refresh();
  }

  hide(): void {
    this.el.hidden = true;
  }

  private async refresh(): Promise<void> {
    const songs = await listSongs();
    this.builtInGrid.replaceChildren(...songs.filter((s) => !s.fromSession).map((s) => this.card(s)));
    this.yourGrid.replaceChildren(
      this.actionCard('record', 'Record a song', 'Play or hum something. Listen turns it into notes.', () => {
        this.hide();
        this.handlers.onRecord();
      }),
      this.actionCard('upload', 'Upload sheet music', 'MusicXML (.musicxml, .xml, .mxl).', () => this.input.click()),
      ...songs.filter((s) => s.fromSession).map((s) => this.card(s)),
    );
  }

  private card(song: SongInfo): HTMLElement {
    // A div (not a button) so it can hold its own delete button; it still acts like a button.
    const card = document.createElement('div');
    card.className = 'song-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    if (song.id === this.currentId) card.classList.add('is-current');
    const dots = DIFFICULTY_DOTS[song.difficulty];
    const kind = song.id.startsWith('recording-') ? 'Your recording' : 'Your upload';
    card.innerHTML = `
      <span class="song-card-title"></span>
      <span class="song-card-composer"></span>
      <span class="song-card-foot">
        <span class="difficulty" aria-label="Difficulty: ${song.difficulty}">
          ${[1, 2, 3].map((i) => `<span class="dot${i <= dots ? ' is-on' : ''}"></span>`).join('')}
          ${song.difficulty}
        </span>
        ${song.fromSession ? `<span class="tag">${kind}</span>` : ''}
        ${song.id === this.currentId ? '<span class="tag tag-now">Playing</span>' : ''}
      </span>`;
    // Titles can come from uploaded files, so they are set as text, never as HTML.
    card.querySelector('.song-card-title')!.textContent = song.title;
    card.querySelector('.song-card-composer')!.textContent = song.composer;
    const pick = () => {
      this.hide();
      this.handlers.onPick(song.id);
    };
    card.addEventListener('click', pick);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pick();
      }
    });
    if (song.fromSession) card.append(this.deleteButton(song));
    return card;
  }

  /** Two-tap delete: the first tap asks "Delete?", the second removes the song. */
  private deleteButton(song: SongInfo): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'delete-btn';
    btn.setAttribute('aria-label', `Delete ${song.title}`);
    btn.innerHTML = '<span class="delete-x"><span></span><span></span></span><span class="delete-ask">Delete?</span>';
    let timer = 0;
    btn.addEventListener('click', async (e) => {
      e.stopPropagation(); // don't open the song
      if (!btn.classList.contains('is-asking')) {
        btn.classList.add('is-asking');
        btn.setAttribute('aria-label', `Tap again to delete ${song.title}`);
        timer = window.setTimeout(() => btn.classList.remove('is-asking'), 3000);
        return;
      }
      clearTimeout(timer);
      await deleteYourSong(song.id);
      this.handlers.onDeleted(song.id);
      if (song.id === this.currentId) this.currentId = '';
      await this.refresh();
    });
    btn.addEventListener('keydown', (e) => e.stopPropagation());
    return btn;
  }

  private actionCard(kind: 'record' | 'upload', title: string, note: string, onClick: () => void): HTMLButtonElement {
    const card = document.createElement('button');
    card.className = `song-card action-card action-${kind}`;
    const icon =
      kind === 'record'
        ? '<span class="action-icon" aria-hidden="true"><span class="mic-dot"></span></span>'
        : '<span class="action-icon" aria-hidden="true"><span class="plus"></span><span class="plus plus-v"></span></span>';
    card.innerHTML = `${icon}<span class="song-card-title"></span><span class="song-card-composer"></span>`;
    card.querySelector('.song-card-title')!.textContent = title;
    card.querySelector('.song-card-composer')!.textContent = note;
    card.addEventListener('click', onClick);
    return card;
  }

  private async upload(file: File): Promise<void> {
    this.message.hidden = false;
    this.message.className = 'library-message';
    this.message.textContent = `Reading ${file.name}…`;
    try {
      const song = await songFromFile(file);
      this.hide();
      this.handlers.onUploaded(song);
    } catch (err) {
      this.message.classList.add('is-error');
      this.message.textContent = err instanceof Error ? err.message : 'That file could not be read.';
    }
  }
}
