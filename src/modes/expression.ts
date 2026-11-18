/**
 * The "magic fingers" performance model: how to play a score like a person,
 * not a metronome. It is a small set of rules that pianists use instinctively:
 *
 *  Dynamics
 *   - Start from the written dynamic (pp, mf, f …).
 *   - Phrases swell a little in the middle and relax at the end (an arch).
 *   - The melody (top note of the right hand) sings out over the accompaniment.
 *   - The left hand plays softer, and the first beat of each bar gets a tiny accent.
 *   - A touch of random variation, so no two notes are identical.
 *
 *  Timing
 *   - Phrases (4 bars) push forward slightly in the middle and broaden at the end.
 *   - The final phrase slows down more (a ritardando into the last note).
 *   - Tiny human timing jitter of a few milliseconds.
 *
 * Magic mode uses the dynamics rules for each key press; Autoplay uses both.
 */
import type { Song, SongNote, Step } from '../music/types';

const PHRASE_BARS = 4;

/** Where a beat sits inside its phrase, 0 (start) … 1 (end). */
function phrasePosition(song: Song, beat: number): number {
  const phraseBeats = song.beatsPerMeasure * PHRASE_BARS;
  return (beat % phraseBeats) / phraseBeats;
}

/** How loud a note should be (0..1), before the player's own touch is applied. */
export function expressiveVelocity(song: Song, step: Step, note: SongNote): number {
  const pos = phrasePosition(song, step.startBeat);
  let v = note.velocity;
  v += 0.09 * Math.sin(Math.PI * pos) - 0.04; // phrase arch: swell, then relax

  const rightHand = step.notes.filter((n) => n.hand === 'right');
  const isMelody = note.hand === 'right' && note.midi === Math.max(...rightHand.map((n) => n.midi));
  if (isMelody) v += 0.07;
  if (note.hand === 'left') v *= 0.8;

  const onDownbeat = Math.abs(step.startBeat % song.beatsPerMeasure) < 1e-3;
  if (onDownbeat) v += 0.035;

  v += (Math.random() - 0.5) * 0.05; // human variation
  return Math.min(0.95, Math.max(0.12, v));
}

/**
 * Performance start time (seconds) for every step, after rubato.
 * Each gap between steps is stretched or squeezed by where it falls in its phrase.
 */
export function expressiveTimeline(song: Song): number[] {
  const times: number[] = [];
  const lastPhraseStart = song.steps.length
    ? song.steps[song.steps.length - 1].startBeat - song.beatsPerMeasure * PHRASE_BARS
    : 0;
  let t = 0;
  song.steps.forEach((step, i) => {
    if (i > 0) {
      const prev = song.steps[i - 1];
      const gap = step.start - prev.start;
      const pos = phrasePosition(song, prev.startBeat);
      // Slightly faster mid-phrase, broader at the phrase end.
      let stretch = 1 - 0.035 * Math.sin(Math.PI * pos) + 0.12 * Math.pow(pos, 4);
      // Final phrase: a gradual ritardando, up to ~30% slower by the last note.
      if (prev.startBeat > lastPhraseStart) {
        const into = (prev.startBeat - lastPhraseStart) / (song.beatsPerMeasure * PHRASE_BARS);
        stretch *= 1 + 0.3 * into * into;
      }
      t += gap * stretch;
    }
    times.push(t + (i > 0 ? (Math.random() - 0.5) * 0.012 : 0)); // ±6 ms of human jitter
  });
  return times;
}
