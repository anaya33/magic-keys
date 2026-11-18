/**
 * Learn mode: the song waits for you.
 *
 *  - The next key(s) to press glow, labelled with the note name and the computer key.
 *  - The song only moves on when every glowing key has been pressed.
 *  - A wrong key still sounds (softly, it's a piano after all) and the right key
 *    gives a little wiggle to point the way. No buzzers, no game over.
 *  - "Right hand" practice (the default): you play the melody and the magic fingers
 *    play the left hand underneath, in time with you. "Both hands" asks for every note.
 */
import { piano } from '../audio/piano';
import { noteName } from '../music/notes';
import type { Song, SongNote, Step } from '../music/types';
import { expressiveVelocity } from './expression';

export type Hands = 'right' | 'both';

/** One thing to press: the notes the player must play, and the score step it belongs to. */
interface Target {
  step: Step;
  stepIndex: number;
  notes: SongNote[];
}

export interface LearnView {
  /** Show which keys to press next, with their labels. Empty map = nothing to press. */
  showTargets(labels: Map<number, string>): void;
  wiggle(midi: number): void;
  /** Light a key played by the magic fingers (the hand you're not practising). */
  light(midi: number, on: boolean): void;
  follow(upcoming: number[][]): void;
  position(beat: number): void;
  progress(done: number, total: number): void;
  finished(): void;
}

export class LearnMode {
  private targets: Target[] = [];
  private index = 0;
  /** Target notes already pressed for the current target (chords need all of them). */
  private hit = new Set<number>();
  private timers = new Set<number>();
  /** Left-hand notes the magic fingers are currently holding. */
  private accompanying = new Set<number>();

  constructor(
    private song: Song,
    private view: LearnView,
    private hands: Hands,
    /** The computer key for a note, or null if it can't be reached (MIDI/mouse still work). */
    private shortcutFor: (midi: number, upcoming: number[]) => string | null,
  ) {
    this.buildTargets();
    this.present();
  }

  get done(): boolean {
    return this.index >= this.targets.length;
  }

  /** Every target's notes, in order (the tiles view draws one tile per target). */
  get targetNotes(): number[][] {
    return this.targets.map((t) => t.notes.map((n) => n.midi));
  }

  /** When each target is due in the song, in seconds at the written tempo. */
  get targetTimes(): number[] {
    return this.targets.map((t) => t.step.start);
  }

  /** Index of the target waiting to be played. */
  get position(): number {
    return this.index;
  }

  /**
   * Play the whole current target in one go (the tiles view: tapping the right lane
   * counts as pressing every note of that tile). Notes ring for their written length.
   * `stretch` slows the left-hand accompaniment to match a slower practice tempo.
   */
  playCurrent(velocity = 0.72, stretch = 1): void {
    if (this.done) this.restart();
    const target = this.targets[this.index];
    for (const note of target.notes) {
      piano.noteOn(note.midi, velocity);
      this.view.light(note.midi, true);
      this.later(note.sounding * stretch, () => {
        piano.noteOff(note.midi);
        this.view.light(note.midi, false);
      });
    }
    this.advance(stretch);
  }

  /** A key went down. Returns nothing: Learn mode plays the sound itself. */
  press(midi: number, velocity: number): void {
    if (this.done) this.restart();
    const target = this.targets[this.index];
    const wanted = target.notes.find((n) => n.midi === midi);
    if (!wanted) {
      piano.noteOn(midi, velocity * 0.5); // soft, so a wrong note never sounds harsh
      this.view.wiggle(this.closestTarget(target, midi));
      return;
    }
    piano.noteOn(midi, velocity);
    this.hit.add(midi);
    if (target.notes.every((n) => this.hit.has(n.midi))) this.advance();
  }

  release(midi: number): void {
    piano.noteOff(midi);
  }

  restart(): void {
    this.clearTimers();
    this.index = 0;
    this.present();
  }

  destroy(): void {
    this.clearTimers();
    this.view.showTargets(new Map());
  }

  // ----------------------------------------------------------------

  private buildTargets(): void {
    let melodyStarted = false;
    this.song.steps.forEach((step, stepIndex) => {
      const right = step.notes.filter((n) => n.hand === 'right');
      if (right.length) melodyStarted = true;
      // Right-hand practice still asks for a left-hand-only introduction (e.g. Gymnopédie's
      // first bars): nobody else is there to play it before the melody comes in.
      const notes = this.hands === 'both' || !melodyStarted ? step.notes : right;
      if (notes.length) this.targets.push({ step, stepIndex, notes });
    });
    // A song with no right-hand part (e.g. a recorded bass line): ask for everything.
    if (this.targets.length === 0) {
      this.song.steps.forEach((step, stepIndex) => this.targets.push({ step, stepIndex, notes: step.notes }));
    }
  }

  private advance(stretch = 1): void {
    const target = this.targets[this.index];
    this.accompany(target, stretch);
    this.index++;
    this.present();
    if (this.done) this.view.finished();
  }

  /**
   * Right-hand practice: play the left-hand notes that belong with this target, and
   * the ones written between this target and the next, at their written timing.
   */
  private accompany(target: Target, stretch = 1): void {
    if (this.hands === 'both') return;
    const next = this.targets[this.index + 1];
    const endIndex = next ? next.stepIndex : this.song.steps.length;
    for (let i = target.stepIndex; i < endIndex; i++) {
      const step = this.song.steps[i];
      const delay = (step.start - target.step.start) * stretch;
      for (const note of step.notes) {
        if (target.notes.includes(note)) continue;
        this.later(delay, () => {
          piano.noteOn(note.midi, expressiveVelocity(this.song, step, note));
          this.accompanying.add(note.midi);
          this.view.light(note.midi, true);
        });
        this.later(delay + note.sounding * stretch, () => {
          piano.noteOff(note.midi);
          this.accompanying.delete(note.midi);
          this.view.light(note.midi, false);
        });
      }
    }
  }

  /** Show the current target: glowing keys with labels, sheet cursor, progress. */
  private present(): void {
    this.hit.clear();
    this.view.progress(this.index, this.targets.length);
    if (this.done) {
      this.view.showTargets(new Map());
      return;
    }
    const target = this.targets[this.index];
    const upcoming = this.targets.slice(this.index, this.index + 8);
    const midis = target.notes.map((n) => n.midi);
    const labels = new Map<number, string>();
    for (const midi of midis) {
      const key = this.shortcutFor(midi, midis);
      labels.set(midi, key ? `${noteName(midi, false)}\n${key}` : noteName(midi, false));
    }
    this.view.follow(upcoming.map((t) => t.notes.map((n) => n.midi)));
    this.view.showTargets(labels);
    this.view.position(target.step.sourceBeat);
  }

  /** The target note nearest to a wrong press (that's the key that wiggles). */
  private closestTarget(target: Target, midi: number): number {
    return target.notes.reduce((best, n) => (Math.abs(n.midi - midi) < Math.abs(best - midi) ? n.midi : best), target.notes[0].midi);
  }

  private later(seconds: number, fn: () => void): void {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, Math.max(0, seconds * 1000));
    this.timers.add(id);
  }

  /** Cancel pending accompaniment and let go of any left-hand notes still held. */
  private clearTimers(): void {
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    for (const midi of this.accompanying) {
      piano.noteOff(midi);
      this.view.light(midi, false);
    }
    this.accompanying.clear();
  }
}
