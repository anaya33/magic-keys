/**
 * Pitch track → sung notes.
 *
 * A singer's pitch line is never a staircase: notes scoop in, wobble (vibrato),
 * drift, and glide into the next one. These rules turn it into the notes the singer
 * meant, in the spirit of Tony's note stage (attack → stable → release):
 *
 *  1. Tuning: measure how far the voice sits from concert pitch overall (the median
 *     offset of every pitched frame) and correct for it, so a singer who is a little
 *     flat throughout isn't "fixed" note by note.
 *  2. Pitch changes: a new note starts only when the pitch moves at least
 *     NEW_NOTE_SEMITONES away from the current note and *stays* there for STEADY_FRAMES.
 *     Vibrato (±½ semitone) and small drift never split a note; glides do not create
 *     extra notes.
 *  3. Re-attacks: the same pitch sung twice ("la-la") shows up as a dip in loudness
 *     followed by a rise. That splits it into two notes. Loudness for this is measured
 *     over a short 12 ms window, so even a quick re-articulation is caught.
 *  4. Each note's pitch is the median of its steady middle (the scoop at the start and
 *     the fall-off at the end are ignored), rounded to the nearest semitone.
 */
import { FRAME_SECONDS, type PitchFrame } from './pitch';

export interface SungNote {
  midi: number;
  start: number; // seconds
  duration: number; // seconds
  amplitude: number; // 0..1
}

const NEW_NOTE_SEMITONES = 0.7;
const STEADY_FRAMES = 5; // ≈ 58 ms
const MIN_NOTE = 0.08; // seconds
const DIP = 0.55; // a loudness dip to 55% of the note's level, then back up = a re-attack

export function sungNotes(frames: PitchFrame[]): { notes: SungNote[]; tuningCents: number } {
  // 1. Overall tuning, from every pitched frame.
  const offsets = frames.filter((f) => f.midi !== null).map((f) => wrapHalf(f.midi! - Math.round(f.midi!)));
  const tuning = offsets.length ? median(offsets) : 0;
  const pitch = frames.map((f) => (f.midi === null ? null : f.midi - tuning));

  // 2. Segment pitched runs into steady notes.
  // Frame indices (inclusive); `run` = which unbroken stretch of pitched sound it came from.
  type Segment = { from: number; to: number; run: number; reattack?: boolean };
  const segments: Segment[] = [];
  let run = 0;
  let i = 0;
  while (i < frames.length) {
    if (pitch[i] === null) {
      i++;
      continue;
    }
    let from = i;
    let reference = pitch[i]!; // running median of the current note
    const window: number[] = [reference];
    let j = i + 1;
    for (; j < frames.length && pitch[j] !== null; j++) {
      const p = pitch[j]!;
      if (Math.abs(p - reference) >= NEW_NOTE_SEMITONES) {
        // Is this a real new note? It has to stay near the new pitch for a while.
        let steady = 0;
        for (let k = j; k < Math.min(frames.length, j + STEADY_FRAMES) && pitch[k] !== null; k++) {
          if (Math.abs(pitch[k]! - p) < NEW_NOTE_SEMITONES) steady++;
        }
        if (steady >= STEADY_FRAMES) {
          segments.push({ from, to: j - 1, run });
          from = j;
          window.length = 0;
        } else continue; // a wobble or a glide: ignore
      }
      window.push(p);
      if (window.length > 12) window.shift();
      reference = median(window);
    }
    segments.push({ from, to: j - 1, run });
    run++; // a silence ends this stretch: whatever comes next is a new attack
    i = j;
  }

  // 3. Split re-attacks on the same pitch (loudness dip, then rise).
  const split: Segment[] = [];
  for (const seg of segments) {
    let start = seg.from;
    let reattack = false;
    let peak = frames[start].rmsShort;
    let lowest = Infinity;
    let lowestAt = -1;
    for (let k = seg.from + 1; k <= seg.to; k++) {
      const level = frames[k].rmsShort;
      if (level > peak && lowestAt < 0) peak = level;
      if (level < peak * DIP && level < lowest) {
        lowest = level;
        lowestAt = k;
      }
      if (lowestAt > 0 && level > lowest / DIP && level > peak * 0.8) {
        split.push({ from: start, to: lowestAt, run: seg.run, reattack });
        start = lowestAt + 1;
        reattack = true;
        peak = level;
        lowest = Infinity;
        lowestAt = -1;
      }
    }
    split.push({ from: start, to: seg.to, run: seg.run, reattack });
  }

  // 4. Pitch from the steady middle; drop blips.
  const notes: (SungNote & { reattack: boolean; run: number })[] = [];
  const loudest = Math.max(1e-6, ...frames.map((f) => f.rms));
  for (const seg of split) {
    const length = seg.to - seg.from + 1;
    const duration = length * FRAME_SECONDS;
    if (duration < MIN_NOTE) continue;
    const trim = Math.floor(length * 0.2);
    const middle = pitch.slice(seg.from + trim, seg.to + 1 - trim).filter((p): p is number => p !== null);
    const values = middle.length ? middle : pitch.slice(seg.from, seg.to + 1).filter((p): p is number => p !== null);
    if (!values.length) continue;
    const level = Math.max(...frames.slice(seg.from, seg.to + 1).map((f) => f.rms));
    notes.push({
      midi: Math.round(median(values)),
      start: frames[seg.from].time - FRAME_SECONDS / 2,
      duration,
      amplitude: Math.min(1, level / loudest),
      reattack: !!seg.reattack,
      run: seg.run,
    });
  }

  // Pieces of one unbroken stretch that ended up on the same pitch, with no re-attack,
  // are one held note (e.g. split by a glide that came back). Across a silence, never.
  const merged: (SungNote & { run: number })[] = [];
  for (const n of notes) {
    const prev = merged[merged.length - 1];
    if (prev && prev.midi === n.midi && prev.run === n.run && !n.reattack) {
      prev.duration = n.start + n.duration - prev.start;
    } else merged.push({ midi: n.midi, start: n.start, duration: n.duration, amplitude: n.amplitude, run: n.run });
  }
  return {
    notes: merged.map(({ run: _run, ...note }) => note),
    tuningCents: Math.round(tuning * 100),
  };
}

function wrapHalf(x: number): number {
  return ((((x + 0.5) % 1) + 1) % 1) - 0.5;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
