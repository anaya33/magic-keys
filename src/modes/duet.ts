/**
 * Duet mode: two players at one piano, Magic-style. One plays the right-hand part,
 * the other the left-hand part; each press plays that part's next note or chord.
 *
 *  - Piano keys (mouse, touch, MIDI): below middle C is the left hand's side, middle C
 *    and up is the right hand's side.
 *  - Computer keyboard: the bottom row (Z …) is the left hand, the top row (Q …) the
 *    right hand, so two people can share one laptop.
 *
 * Each part moves at its own player's pace. The song is finished when both are.
 * Under the hood it's two Magic modes, one per hand, playing on the same piano.
 */
import { groupIntoSteps } from '../music/musicxml';
import type { Hand, Song } from '../music/types';
import { MagicMode, type MagicView } from './magic';

/** Middle C: the line between the two players on the piano. */
export const DUET_SPLIT = 60;

export interface DuetView {
  light(midi: number, on: boolean): void;
  follow(upcoming: number[][]): void;
  /** Where each part is (notes played / total). */
  progress(left: [number, number], right: [number, number]): void;
  /** The right hand's place in the score (moves the sheet music cursor). */
  position(beat: number): void;
  finished(): void;
}

/** The song with only one hand's notes. */
function onePart(song: Song, hand: Hand): Song {
  const notes = song.notes.filter((n) => n.hand === hand);
  return { ...song, id: `${song.id}:${hand}`, notes, steps: groupIntoSteps(notes) };
}

export class DuetMode {
  private parts: Record<Hand, MagicMode>;
  private done: Record<Hand, [number, number]> = { left: [0, 0], right: [0, 0] };
  private upcoming: Record<Hand, number[][]> = { left: [], right: [] };
  private celebrated = false;

  constructor(song: Song, view: DuetView) {
    const partView = (hand: Hand): MagicView => ({
      light: (midi, on) => view.light(midi, on),
      follow: (groups) => {
        this.upcoming[hand] = groups;
        view.follow([...this.upcoming.right, ...this.upcoming.left]);
      },
      progress: (done, total) => {
        this.done[hand] = [done, total];
        view.progress(this.done.left, this.done.right);
        if (!this.celebrated && this.bothFinished) {
          this.celebrated = true;
          view.finished();
        }
      },
      position: (beat) => {
        if (hand === 'right') view.position(beat);
      },
      autoplayChanged: () => {},
      finished: () => {},
    });
    this.parts = {
      left: new MagicMode(onePart(song, 'left'), partView('left')),
      right: new MagicMode(onePart(song, 'right'), partView('right')),
    };
  }

  /** True if this song has notes for both hands (a duet needs two parts). */
  static canPlay(song: Song): boolean {
    return song.notes.some((n) => n.hand === 'left') && song.notes.some((n) => n.hand === 'right');
  }

  private get bothFinished(): boolean {
    return (['left', 'right'] as const).every((h) => this.done[h][1] > 0 && this.done[h][0] >= this.done[h][1]);
  }

  /** The player on this side pressed a key: their part's next note or chord plays. */
  press(hand: Hand, touch = 0.72): void {
    const part = this.parts[hand];
    if (part.atEnd) return; // this player is done; wait for the other one
    part.playNext(touch);
  }

  /** Which player a piano key belongs to. */
  static handFor(midi: number): Hand {
    return midi < DUET_SPLIT ? 'left' : 'right';
  }

  restart(): void {
    this.celebrated = false;
    this.parts.left.restart();
    this.parts.right.restart();
  }

  destroy(): void {
    this.parts.left.destroy();
    this.parts.right.destroy();
  }
}
