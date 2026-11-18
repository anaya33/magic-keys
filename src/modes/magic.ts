/**
 * Magic mode: the player sets the pace, the magic fingers pick the notes.
 *
 *  - `playNext()`: every key press (any key, any input) plays the next step of the
 *    song (a note or chord) on the right piano keys, held for its written length.
 *  - Autoplay: the magic fingers perform the whole song at the written tempo, with
 *    the phrasing and dynamics from expression.ts.
 *    Pressing a key during Autoplay hands control back to the player at that spot.
 *
 * How Autoplay keeps perfect time: JavaScript timers can be late by tens of
 * milliseconds, so they are never used to *play* notes. Instead a timer wakes up
 * every 25 ms and schedules the notes due in the next 150 ms on the audio clock,
 * which is sample-accurate. Timers only drive the visuals (key lights).
 */
import { piano } from '../audio/piano';
import type { Song, SongNote, Step } from '../music/types';
import { expressiveTimeline, expressiveVelocity } from './expression';

const LOOKAHEAD_S = 0.15;
const TICK_MS = 25;

/** What Magic mode needs from the screen: lighting keys and keeping notes in view. */
export interface MagicView {
  light(midi: number, on: boolean): void;
  /** Keep the next few steps on screen (each inner array is one step's notes). */
  follow(upcoming: number[][]): void;
  progress(done: number, total: number): void;
  /** The beat of the step just played (moves the sheet music cursor). */
  position(beat: number): void;
  autoplayChanged(playing: boolean): void;
  finished(): void;
}

export class MagicMode {
  private index = 0;
  private timers = new Set<number>();
  /** How many active magic notes are lighting each key (repeated notes can overlap). */
  private litCount = new Map<number, number>();

  private autoplayTimer: number | null = null;
  private timeline: number[] = [];
  /** Audio-clock time at which the song's performance time 0 happens. */
  private audioOrigin = 0;

  constructor(private song: Song, private view: MagicView) {
    this.view.progress(0, song.steps.length);
    this.followFrom(0);
  }

  get autoplaying(): boolean {
    return this.autoplayTimer !== null;
  }

  /** The notes the next press will play (what a "right" key would be). */
  get nextNotes(): number[] {
    const step = this.song.steps[this.atEnd ? 0 : this.index];
    return step ? step.notes.map((n) => n.midi) : [];
  }

  /** Index of the next step to play. */
  get position(): number {
    return this.index;
  }

  get atEnd(): boolean {
    return this.index >= this.song.steps.length;
  }

  /** One key press: play the next note or chord. `touch` (0..1) is how hard the key was hit. */
  playNext(touch = 0.72): void {
    if (this.autoplaying) this.stopAutoplay(); // the player takes over from here
    if (this.atEnd) this.restart();
    const step = this.song.steps[this.index++];
    // Harder presses play a little louder, softer presses a little quieter.
    const touchScale = 0.8 + 0.4 * Math.min(1, Math.max(0, touch));
    for (const note of step.notes) {
      const velocity = Math.min(0.97, expressiveVelocity(this.song, step, note) * touchScale);
      piano.noteOn(note.midi, velocity);
      this.lightFor(note.midi, 0, note.duration);
      // The sound rings for its written length, longer if the score's pedal holds it.
      this.later(note.sounding, () => piano.noteOff(note.midi));
    }
    this.afterStep();
  }

  /** The player missed this note (tiles view, on tempo): move on without playing it. */
  skip(): void {
    if (this.atEnd) return;
    this.index++;
    this.afterStep();
  }

  restart(): void {
    this.stopAutoplay();
    this.index = 0;
    this.view.progress(0, this.song.steps.length);
    this.view.position(0);
    this.followFrom(0);
  }

  toggleAutoplay(): void {
    if (this.autoplaying) this.stopAutoplay();
    else this.startAutoplay();
  }

  startAutoplay(): void {
    if (this.autoplaying) return;
    piano.unlock(); // the Autoplay button is a user gesture, so sound may start now
    if (!piano.ready) {
      // Only possible in the first split second after opening the page.
      void piano.preload().then(() => this.startAutoplay(), (err) => console.warn(err));
      return;
    }
    if (this.atEnd) this.index = 0;
    this.timeline = expressiveTimeline(this.song);
    // Begin a moment from now, positioned so the current step plays first.
    this.audioOrigin = piano.now() + 0.08 - this.timeline[this.index];
    this.autoplayTimer = window.setInterval(() => this.scheduleAhead(), TICK_MS);
    this.scheduleAhead();
    this.view.autoplayChanged(true);
  }

  stopAutoplay(): void {
    if (this.autoplayTimer === null) return;
    clearInterval(this.autoplayTimer);
    this.autoplayTimer = null;
    this.clearTimers();
    piano.allNotesOff(); // notes already queued fade out naturally
    this.view.autoplayChanged(false);
  }

  destroy(): void {
    this.stopAutoplay();
    this.clearTimers();
    piano.allNotesOff(); // pending note-offs were just cancelled, so let go of everything
  }

  // ---------------------------------------------------------------- autoplay internals

  private scheduleAhead(): void {
    const horizon = piano.now() + LOOKAHEAD_S;
    while (!this.atEnd && this.audioOrigin + this.timeline[this.index] <= horizon) {
      const i = this.index++;
      const step = this.song.steps[i];
      const when = this.audioOrigin + this.timeline[i];
      const stretch = this.localStretch(i);
      for (const note of step.notes) this.scheduleNote(step, note, when, stretch);
      this.later(when - piano.now(), () => this.afterStep());
    }
    if (this.atEnd) {
      // Stop the clock; the last notes ring out on their own.
      clearInterval(this.autoplayTimer!);
      this.autoplayTimer = null;
      this.view.autoplayChanged(false);
    }
  }

  /** Book one note on the audio clock: sound for its pedalled length, light for its written length. */
  private scheduleNote(step: Step, note: SongNote, when: number, stretch: number): void {
    piano.noteOn(note.midi, expressiveVelocity(this.song, step, note), when);
    piano.noteOff(note.midi, when + note.sounding * stretch);
    this.lightFor(note.midi, when - piano.now(), note.duration * stretch);
  }

  /** How much the performance is stretched around step i (so note lengths follow the rubato). */
  private localStretch(i: number): number {
    const steps = this.song.steps;
    if (i + 1 >= steps.length) return 1.25; // let the final note breathe
    const written = steps[i + 1].start - steps[i].start;
    return written > 0 ? (this.timeline[i + 1] - this.timeline[i]) / written : 1;
  }

  // ---------------------------------------------------------------- shared helpers

  /** After each step: update progress, keep upcoming notes on screen, announce the end. */
  private afterStep(): void {
    const total = this.song.steps.length;
    const done = Math.min(this.index, total);
    this.view.progress(done, total);
    if (done > 0) this.view.position(this.song.steps[done - 1].sourceBeat);
    this.followFrom(done);
    if (done >= total && !this.autoplaying) this.view.finished();
  }

  /** Ask the keyboard to show the next few steps, so it scrolls before notes arrive. */
  private followFrom(index: number): void {
    const upcoming = this.song.steps.slice(index, index + 8).map((s) => s.notes.map((n) => n.midi));
    if (upcoming.length) this.view.follow(upcoming);
  }

  private lightFor(midi: number, delaySec: number, lengthSec: number): void {
    this.later(delaySec, () => {
      this.litCount.set(midi, (this.litCount.get(midi) ?? 0) + 1);
      this.view.light(midi, true);
    });
    // Keep the light on at least briefly so very short notes are still visible.
    this.later(delaySec + Math.max(lengthSec, 0.09), () => {
      const n = (this.litCount.get(midi) ?? 1) - 1;
      if (n > 0) this.litCount.set(midi, n);
      else {
        this.litCount.delete(midi);
        this.view.light(midi, false);
      }
    });
  }

  private later(seconds: number, fn: () => void): void {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, Math.max(0, seconds * 1000));
    this.timers.add(id);
  }

  private clearTimers(): void {
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    for (const midi of this.litCount.keys()) this.view.light(midi, false);
    this.litCount.clear();
  }
}
