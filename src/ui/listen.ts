/**
 * ListenView — the full-screen Listen panel.
 *
 *   idle       "Tap Listen and play or hum something."      [ big round Listen button ]
 *   listening  live level bars + timer                       [ Stop ]
 *   working    "Turning your music into notes… 42%"
 *   done       "Found 24 notes in A minor"                  [ Play it ] [ Learn it ] [ Try again ]
 *   error      a friendly message                            [ Try again ]
 *
 * Everything happens on this device: the recording is never uploaded or kept.
 */
import { recordingToSong, type ListenResult } from '../listen';
import { MAX_SECONDS, Recorder } from '../listen/recorder';
import { warmUp } from '../listen/transcribe';
import type { Song } from '../music/types';

type State = 'idle' | 'listening' | 'working' | 'done' | 'error';
const BARS = 24;

export class ListenView {
  private el: HTMLDivElement;
  private status: HTMLParagraphElement;
  private detail: HTMLParagraphElement;
  private meter: HTMLDivElement;
  private mainBtn: HTMLButtonElement;
  private actions: HTMLDivElement;
  private recorder = new Recorder();
  private state: State = 'idle';
  private startedAt = 0;
  private clock = 0;
  private result: ListenResult | null = null;

  constructor(private onOpenSong: (song: Song, mode: 'magic' | 'learn') => void) {
    this.el = document.createElement('div');
    this.el.className = 'panel listen';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-labelledby', 'listen-title');
    this.el.innerHTML = `
      <button class="close-btn" aria-label="Close Listen"><span></span><span></span></button>
      <div class="listen-body">
        <h2 class="listen-title" id="listen-title">Listen</h2>
        <p class="listen-status" aria-live="polite"></p>
        <p class="listen-detail"></p>
        <div class="listen-meter" aria-hidden="true">${'<span></span>'.repeat(BARS)}</div>
        <button class="listen-btn"></button>
        <div class="listen-actions"></div>
      </div>`;
    document.body.append(this.el);
    this.status = this.el.querySelector('.listen-status')!;
    this.detail = this.el.querySelector('.listen-detail')!;
    this.meter = this.el.querySelector('.listen-meter')!;
    this.mainBtn = this.el.querySelector('.listen-btn')!;
    this.actions = this.el.querySelector('.listen-actions')!;

    this.el.querySelector('.close-btn')!.addEventListener('click', () => this.hide());
    this.mainBtn.addEventListener('click', () => void this.onMainButton());
    this.recorder.onLevel = (level) => this.showLevel(level);
    this.recorder.onAutoStop = () => void this.stop();
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.open) this.hide();
    });
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  show(): void {
    this.el.hidden = false;
    this.setState('idle');
    void warmUp().catch(() => {}); // start fetching Basic Pitch while the player gets ready
  }

  hide(): void {
    if (this.state === 'listening') this.recorder.cancel();
    clearInterval(this.clock);
    this.el.hidden = true;
  }

  private async onMainButton(): Promise<void> {
    if (this.state === 'listening') return this.stop();
    if (this.state === 'working') return;
    try {
      await this.recorder.start();
      this.startedAt = performance.now();
      this.setState('listening');
      this.clock = window.setInterval(() => this.tickClock(), 250);
    } catch (err) {
      this.fail(err);
    }
  }

  private async stop(): Promise<void> {
    if (this.state !== 'listening') return;
    clearInterval(this.clock);
    this.setState('working');
    try {
      const audio = await this.recorder.stop();
      this.result = await recordingToSong(audio, (f) => {
        this.status.textContent = `Turning your music into notes… ${Math.round(f * 100)}%`;
      });
      this.setState('done');
    } catch (err) {
      this.fail(err);
    }
  }

  private fail(err: unknown): void {
    this.setState('error');
    this.status.textContent = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
  }

  private setState(state: State): void {
    this.state = state;
    this.el.dataset.state = state;
    this.actions.replaceChildren();
    this.detail.textContent = '';
    this.showLevel(0);
    switch (state) {
      case 'idle':
        this.status.textContent = 'Tap Listen, then play or hum something near your microphone.';
        this.mainBtn.textContent = 'Listen';
        break;
      case 'listening':
        this.status.textContent = 'Listening…';
        this.detail.textContent = '0:00';
        this.mainBtn.textContent = 'Stop';
        break;
      case 'working':
        this.status.textContent = 'Turning your music into notes…';
        this.mainBtn.textContent = '';
        break;
      case 'done': {
        const r = this.result!;
        this.status.textContent = r.keyName
          ? `Found ${r.song.notes.length} notes in ${r.keyName}.`
          : `Found ${r.song.notes.length} notes.`;
        this.detail.textContent = `Saved as “${r.song.title}” in your songs.`;
        this.mainBtn.textContent = '';
        this.actions.append(
          this.action('Play it', () => this.openResult('magic'), true),
          this.action('Learn it', () => this.openResult('learn')),
          this.action('Try again', () => this.setState('idle')),
        );
        break;
      }
      case 'error':
        this.mainBtn.textContent = '';
        this.actions.append(this.action('Try again', () => this.setState('idle'), true));
        break;
    }
  }

  private openResult(mode: 'magic' | 'learn'): void {
    if (!this.result) return;
    this.hide();
    this.onOpenSong(this.result.song, mode);
  }

  private action(label: string, onClick: () => void, primary = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = `pill-btn${primary ? ' is-on' : ''}`;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  /** Light up meter bars from the middle outwards, like a flat equaliser. */
  private showLevel(level: number): void {
    const bars = this.meter.children;
    const lit = Math.round(level * (BARS / 2));
    for (let i = 0; i < BARS; i++) {
      const fromCentre = Math.abs(i - (BARS - 1) / 2);
      bars[i].classList.toggle('is-on', fromCentre < lit);
    }
  }

  private tickClock(): void {
    const s = Math.floor((performance.now() - this.startedAt) / 1000);
    this.detail.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}  ·  up to ${MAX_SECONDS / 60} min`;
  }
}
