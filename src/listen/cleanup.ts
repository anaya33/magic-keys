/**
 * Raw transcription → a tidy little piece of music.
 *
 * Basic Pitch hears everything: breaths, overtones, a fridge humming. These rules
 * turn its raw notes into something you'd want to play back:
 *
 *  1. Drop very short notes (blips) and very quiet notes (room noise).
 *  2. Drop overtones: a real piano or voice note also rings an octave (and an octave
 *     and a fifth) higher, quietly. Those echoes are not notes anyone played.
 *  3. Merge flickers: the same pitch stopping and restarting within a moment is one note.
 *  4. Find the key (Krumhansl–Schmuckler key profiles) and snap *out-of-tune* notes to
 *     it: a note is only moved if it was measurably off-pitch towards a note of the
 *     scale (Basic Pitch reports that). Notes played cleanly are never changed, so
 *     intentional "out of key" notes, like Für Elise's D♯, survive.
 *  5. Keep the main melody and simple chords: notes that start together form a group;
 *     its top note is the melody, up to two notes close below it make a chord, and one
 *     low note can be the bass (left hand). Everything else is dropped.
 *
 * The rhythm (beat, triplets, note lengths) is worked out afterwards, in rhythm.ts.
 */
import type { TimedNote } from './rhythm';
import type { RawNote } from './transcribe';

export interface KeyInfo {
  fifths: number; // key signature: sharps (+) or flats (−)
  keyName: string; // e.g. "A minor"
  /** True when there were enough notes to trust the key name. */
  keyConfident: boolean;
}

export interface CleanResult extends KeyInfo {
  notes: TimedNote[];
}


const MIN_DURATION = 0.12; // seconds
const TOGETHER = 0.07; // seconds: notes this close count as starting together
const FLICKER_GAP = 0.03; // seconds: a break this short inside a note is a detection glitch
const FLICKER_PIECE = 0.15; // seconds: …if one side of the break is this short

// Krumhansl–Kessler key profiles: how strongly each scale degree belongs to a key.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10, 11]; // natural minor plus the raised 7th (harmonic minor)
const NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
/** Key signature (sharps/flats) of each major key, by tonic pitch class. */
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

export function cleanUp(raw: RawNote[]): CleanResult {
  // 1. Blips and quiet noise.
  const loud = percentile(raw.map((n) => n.amplitude), 0.9);
  let notes = raw.filter((n) => n.duration >= MIN_DURATION && n.amplitude >= Math.max(0.2, loud * 0.35));
  if (notes.length === 0) {
    throw new Error("I couldn't hear any clear notes. Try playing a little louder, or closer to the microphone.");
  }

  // 2. Overtones.  3. Flickers.
  notes = mergeFlickers(dropOvertones(notes));

  // 4. Key, and snapping out-of-tune notes to it. Tuning is measured against the
  //    recording's own typical tuning, so a voice (or piano) that is a little flat or
  //    sharp overall isn't "corrected" on every note, only the odd ones out.
  const key = detectKey(notes);
  const scale = new Set((key.minor ? MINOR_SCALE : MAJOR_SCALE).map((d) => (d + key.tonic) % 12));
  const typicalBend = percentile(notes.map((n) => n.bend), 0.5);
  notes = notes.map((n) => ({ ...n, midi: snapToScale({ ...n, bend: n.bend - typicalBend }, scale) }));
  notes = mergeFlickers(notes); // snapping can make neighbours identical

  // 5. Melody, chords and bass.
  const groups = groupByOnset(notes);
  const kept: { note: RawNote; staff: 1 | 2; groupStart: number }[] = [];
  for (const group of groups) {
    const sorted = [...group].sort((a, b) => b.midi - a.midi);
    const top = sorted[0];
    kept.push({ note: top, staff: 1, groupStart: group[0].start });
    const chord = sorted
      .slice(1)
      .filter((n) => n.midi > top.midi - 12 && n.midi !== top.midi && n.amplitude >= top.amplitude * 0.5)
      .slice(0, 2);
    for (const n of chord) kept.push({ note: n, staff: 1, groupStart: group[0].start });
    // An octave or more below the melody is the bass (left hand).
    const bass = sorted.reverse().find((n) => n.midi <= top.midi - 12 && n.amplitude >= top.amplitude * 0.4);
    if (bass) kept.push({ note: bass, staff: 2, groupStart: group[0].start });
  }

  return {
    notes: kept.map(({ note, staff, groupStart }) => ({
      midi: note.midi,
      staff,
      amplitude: note.amplitude,
      start: groupStart,
      duration: note.duration,
    })),
    ...keyInfo(key, notes.length),
  };
}

/** Key signature and name for a set of notes (used for voice recordings too). */
export function describeKey(notes: { midi: number; duration: number; amplitude: number }[]): KeyInfo {
  return keyInfo(detectKey(notes), notes.length);
}

function keyInfo(key: { tonic: number; minor: boolean }, noteCount: number): KeyInfo {
  return {
    fifths: key.minor ? MAJOR_FIFTHS[(key.tonic + 3) % 12] : MAJOR_FIFTHS[key.tonic],
    keyName: `${NAMES[key.tonic]} ${key.minor ? 'minor' : 'major'}`,
    keyConfident: noteCount >= 16,
  };
}

/**
 * Same pitch, a tiny glitchy break, same pitch again: really one note. A genuinely
 * repeated note has its own attack, which Basic Pitch already separates, so we only
 * merge very short breaks next to a very short piece.
 */
function mergeFlickers(notes: RawNote[]): RawNote[] {
  const sorted = [...notes].sort((a, b) => a.midi - b.midi || a.start - b.start);
  const out: RawNote[] = [];
  for (const n of sorted) {
    const prev = out[out.length - 1];
    const gap = prev ? n.start - (prev.start + prev.duration) : Infinity;
    const glitchy = prev && (prev.duration < FLICKER_PIECE || n.duration < FLICKER_PIECE);
    if (prev && prev.midi === n.midi && (gap < 0 || (gap < FLICKER_GAP && glitchy))) {
      prev.duration = Math.max(prev.duration, n.start + n.duration - prev.start);
      prev.amplitude = Math.max(prev.amplitude, n.amplitude);
    } else {
      out.push({ ...n });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Find the key. Krumhansl–Schmuckler correlates how long each pitch class sounds with
 * every key's profile; we add how much of the music fits that key's scale (so a C-major
 * tune that lingers on G isn't called G major), then settle major vs minor by which
 * third (minor or major) is actually heard.
 */
function detectKey(notes: { midi: number; duration: number; amplitude: number }[]): { tonic: number; minor: boolean } {
  const weight = new Array(12).fill(0);
  for (const n of notes) weight[((n.midi % 12) + 12) % 12] += n.duration * n.amplitude;
  const total = weight.reduce((s, w) => s + w, 0) || 1;
  let best = { tonic: 0, minor: false, score: -Infinity };
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const minor of [false, true]) {
      const profile = minor ? MINOR_PROFILE : MAJOR_PROFILE;
      const rotated = weight.map((_, pc) => profile[(pc - tonic + 12) % 12]);
      const inScale = (minor ? MINOR_SCALE : MAJOR_SCALE).reduce((s, d) => s + weight[(tonic + d) % 12], 0) / total;
      const score = correlation(weight, rotated) + inScale;
      if (score > best.score) best = { tonic, minor, score };
    }
  }
  const minorThird = weight[(best.tonic + 3) % 12];
  const majorThird = weight[(best.tonic + 4) % 12];
  if (minorThird > majorThird) best.minor = true;
  else if (majorThird > minorThird) best.minor = false;
  return best;
}

/** How far off-pitch (in semitones) a note must be before we move it into the key. */
const OUT_OF_TUNE = 0.2;

/**
 * Move a note into the key only if it was sung/played out of tune *towards* a scale
 * note (e.g. a hummed F that was really a sharp-ish E♭… in E♭ major). In-tune notes stay.
 */
function snapToScale(note: RawNote, scale: Set<number>): number {
  const midi = note.midi;
  if (scale.has(midi % 12)) return midi;
  if (note.bend >= OUT_OF_TUNE && scale.has((midi + 1) % 12)) return midi + 1;
  if (note.bend <= -OUT_OF_TUNE && scale.has((midi + 11) % 12)) return midi - 1;
  return midi;
}

/**
 * Overtones: a note an octave (12), an octave and a fifth (19) or two octaves (24)
 * above a louder note that starts at the same moment is almost always that note's
 * own harmonic, not something that was played.
 */
function dropOvertones(notes: RawNote[]): RawNote[] {
  const groups = groupByOnset(notes);
  return groups.flatMap((group) =>
    group.filter(
      (n) =>
        !group.some(
          // An overtone is always clearly quieter than the note that makes it.
          (lower) => [12, 19, 24].includes(n.midi - lower.midi) && n.amplitude <= lower.amplitude * 0.75,
        ),
    ),
  );
}

/** Notes that start within a moment of each other form one group (a note or a chord). */
function groupByOnset(notes: RawNote[]): RawNote[][] {
  const groups: RawNote[][] = [];
  for (const n of [...notes].sort((a, b) => a.start - b.start)) {
    const last = groups[groups.length - 1];
    if (last && n.start - last[0].start < TOGETHER) last.push(n);
    else groups.push([n]);
  }
  return groups;
}



function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function correlation(a: number[], b: number[]): number {
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}
