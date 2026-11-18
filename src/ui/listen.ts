/**
 * ListenView — the full-screen Listen (record) panel.
 *
 *   idle       Sing or hum | Play an instrument · optional click (tempo)   [ Listen ]
 *   counting   4 · 3 · 2 · 1 with the click
 *   listening  the note you're singing right now, big, with a tuning needle,
 *              lit up on a small piano · level meter · timer                [ Stop ]
 *   working    "Turning your music into notes… 42%"
 *   done       "24 notes · A minor · 92 bpm · 3 triplet beats", the sheet music of
 *              what you sang                       [ Play it ] [ Learn it ] [ Try again ]
 *   error      a friendly message                                         [ Try again ]
 */
import { recordingToSong, type ListenResult, type RecordKind } from '../listen';
import { MAX_SECONDS, Recorder } from '../listen/recorder';
import { warmUp } from '../listen/transcribe';
import { noteName } from '../music/notes';
import type { Song } from '../music/types';
import { KeyboardView } from './keyboard';
import { SheetView } from './sheet';

type State = 'idle' | 'counting' | 'listening' | 'working' | 'done' | 'error';
const BARS = 24;

export class ListenView {
  private el: HTMLDivElement;
  private status: HTMLParagraphElement;
  private detail: HTMLParagraphElement;
  private meter: HTMLDivElement;
  private mainBtn: HTMLButtonElement;
  private actions: HTMLDivElement;
  private liveNote: HTMLDivElement;
  private needle: HTMLSpanElement;
  private bpmLabel: HTMLSpanElement;
  private keyboard: KeyboardView;
  private sheet = new SheetView();
  private recorder = new Recorder();
  private state: State = 'idle';
  private kind: RecordKind = 'voice';
  private clickOn = false;
  private bpm = 90;
  private startedAt = 0;
  private clock = 0;
  private litKey: number | null = null;
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

        <div class="listen-options" data-show="idle">
          <nav class="tabs" role="tablist" aria-label="What are you recording?">
            <button role="tab" data-kind="voice" aria-selected="true">Sing or hum</button>
            <button role="tab" data-kind="instrument" aria-selected="false">Play an instrument</button>
          </nav>
          <div class="click-row">
            <button class="pill-btn" id="click-toggle" aria-pressed="false">Click: off</button>
            <span class="bpm" hidden>
              <button class="icon-btn" id="bpm-down" aria-label="Slower">−</button>
              <span class="bpm-label">90 bpm</span>
              <button class="icon-btn" id="bpm-up" aria-label="Faster">+</button>
            </span>
          </div>
        </div>

        <p class="listen-status" aria-live="polite"></p>

        <div class="live" data-show="listening counting">
          <div class="live-note" aria-live="off">–</div>
          <div class="tuning" aria-hidden="true"><span class="tuning-mark"></span><span class="tuning-needle"></span></div>
          <div class="live-piano"></div>
        </div>

        <p class="listen-detail"></p>
        <div class="listen-meter" data-show="listening counting" aria-hidden="true">${'<span></span>'.repeat(BARS)}</div>
        <div class="listen-sheet" data-show="done"></div>
        <button class="listen-btn"></button>
        <div class="listen-actions"></div>
      </div>`;
    document.body.append(this.el);
    const $ = <T extends HTMLElement>(s: string) => this.el.querySelector<T>(s)!;
    this.status = $('.listen-status');
    this.detail = $('.listen-detail');
    this.meter = $('.listen-meter');
    this.mainBtn = $('.listen-btn');
    this.actions = $('.listen-actions');
    this.liveNote = $('.live-note');
    this.needle = $('.tuning-needle');
    this.bpmLabel = $('.bpm-label');
    $('.listen-sheet').append(this.sheet.el);

    // A small piano that shows the note you're singing.
    this.keyboard = new KeyboardView({ targetKeyWidth: 26, centerMidi: 60, onPress: () => {}, onRelease: () => {} });
    $('.live-piano').append(this.keyboard.el);
    this.keyboard.setMaxHeight(90);

    // Options.
    this.el.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach((b) =>
      b.addEventListener('click', () => {
        this.kind = b.dataset.kind as RecordKind;
        this.el.querySelectorAll('[data-kind]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
        if (this.kind === 'instrument') void warmUp().catch(() => {}); // fetch Basic Pitch early
        this.setState('idle');
      }),
    );
    const clickToggle = $<HTMLButtonElement>('#click-toggle');
    clickToggle.addEventListener('click', () => {
      this.clickOn = !this.clickOn;
      clickToggle.setAttribute('aria-pressed', String(this.clickOn));
      clickToggle.textContent = this.clickOn ? 'Click: on' : 'Click: off';
      clickToggle.classList.toggle('is-on', this.clickOn);
      $('.bpm').hidden = !this.clickOn;
      this.setState('idle');
    });
    const setBpm = (bpm: number) => {
      this.bpm = Math.min(160, Math.max(50, bpm));
      this.bpmLabel.textContent = `${this.bpm} bpm`;
    };
    $('#bpm-down').addEventListener('click', () => setBpm(this.bpm - 5));
    $('#bpm-up').addEventListener('click', () => setBpm(this.bpm + 5));

    this.el.querySelector('.close-btn')!.addEventListener('click', () => this.hide());
    this.mainBtn.addEventListener('click', () => void this.onMainButton());
    this.recorder.onLevel = (level) => this.showLevel(level);
    this.recorder.onLivePitch = (midi) => this.showLivePitch(midi);
    this.recorder.onCountIn = (n) => this.showCountIn(n);
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
    if (this.kind === 'instrument') void warmUp().catch(() => {});
  }

  hide(): void {
    if (this.state === 'listening' || this.state === 'counting') this.recorder.cancel();
    clearInterval(this.clock);
    this.el.hidden = true;
  }

  private async onMainButton(): Promise<void> {
    if (this.state === 'listening' || this.state === 'counting') return this.stop();
    if (this.state === 'working') return;
    try {
      this.setState(this.clickOn ? 'counting' : 'listening');
      await this.recorder.start({ clickBpm: this.clickOn ? this.bpm : null, livePitch: this.kind === 'voice' });
      this.startedAt = performance.now();
      this.clock = window.setInterval(() => this.tickClock(), 250);
    } catch (err) {
      this.fail(err);
    }
  }

  private async stop(): Promise<void> {
    if (this.state !== 'listening' && this.state !== 'counting') return;
    clearInterval(this.clock);
    this.setState('working');
    try {
      const recording = await this.recorder.stop();
      this.result = await recordingToSong(recording, this.kind, (f) => {
        this.status.textContent = `Turning your music into notes… ${Math.round(f * 100)}%`;
      });
      this.setState('done');
      if (this.result.song.musicXml) void this.sheet.show(this.result.song.musicXml);
    } catch (err) {
      this.fail(err);
    }
  }

  private fail(err: unknown): void {
    this.recorder.cancel();
    this.setState('error');
    this.status.textContent = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
  }

  private setState(state: State): void {
    this.state = state;
    this.el.dataset.state = state;
    this.el.dataset.kind = this.kind;
    this.actions.replaceChildren();
    this.detail.textContent = '';
    this.showLevel(0);
    this.showLivePitch(null);
    switch (state) {
      case 'idle':
        this.status.textContent =
          this.kind === 'voice'
            ? 'Tap Listen, then sing or hum a tune near your microphone.'
            : 'Tap Listen, then play something near your microphone.';
        if (this.clickOn) this.detail.textContent = 'Headphones keep the click out of your recording.';
        this.mainBtn.textContent = 'Listen';
        break;
      case 'counting':
        this.status.textContent = 'Get ready…';
        this.mainBtn.textContent = 'Stop';
        break;
      case 'listening':
        this.status.textContent = this.kind === 'voice' ? 'Sing!' : 'Play!';
        this.detail.textContent = '0:00';
        this.mainBtn.textContent = 'Stop';
        break;
      case 'working':
        this.status.textContent = 'Turning your music into notes…';
        this.mainBtn.textContent = '';
        break;
      case 'done': {
        const r = this.result!;
        const parts = [`${r.song.notes.length} notes`];
        if (r.keyName) parts.push(r.keyName);
        parts.push(`${r.bpm} bpm`);
        if (r.tripletBeats) parts.push(`${r.tripletBeats} triplet beat${r.tripletBeats === 1 ? '' : 's'}`);
        this.status.textContent = parts.join(' · ');
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

  private showCountIn(n: number): void {
    if (this.state !== 'counting' && this.state !== 'listening') return;
    if (n > 0) {
      this.status.textContent = String(n);
      return;
    }
    this.state = 'listening';
    this.el.dataset.state = 'listening';
    this.status.textContent = this.kind === 'voice' ? 'Sing!' : 'Play!';
  }

  /** The note being sung right now: name, tuning needle, and its key on the small piano. */
  private showLivePitch(midi: number | null): void {
    const key = midi === null ? null : Math.round(midi);
    if (key !== this.litKey) {
      if (this.litKey !== null) this.keyboard.setHighlight(this.litKey, 'you', false);
      if (key !== null) {
        this.keyboard.ensureVisible([key]);
        this.keyboard.setHighlight(key, 'you', true);
      }
      this.litKey = key;
    }
    if (midi === null || key === null) {
      this.liveNote.textContent = '–';
      this.needle.style.transform = 'translateX(-50%)';
      this.el.classList.remove('is-in-tune');
      return;
    }
    const cents = Math.round((midi - key) * 100);
    this.liveNote.textContent = noteName(key);
    // Needle: −50 cents (flat) at the left edge, +50 (sharp) at the right.
    this.needle.style.transform = `translateX(calc(-50% + ${cents}%))`;
    this.el.classList.toggle('is-in-tune', Math.abs(cents) <= 12);
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
    if (this.state !== 'listening') return;
    const s = Math.floor((performance.now() - this.startedAt) / 1000);
    this.detail.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}  ·  up to ${MAX_SECONDS / 60} min`;
  }
}
