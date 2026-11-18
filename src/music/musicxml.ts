/**
 * MusicXML → Song.
 *
 * MusicXML stores music bar by bar, with time measured in "divisions" (ticks per
 * quarter note). Inside a bar, notes move a cursor forward; <backup> moves it back
 * (to write the left hand under the right hand, or a second voice) and <forward>
 * skips ahead. Chord notes (<chord/>) start at the same time as the note before them.
 *
 * Parsing happens in two passes:
 *  1. Read every bar as written: its notes (pitch, offset, length, hand, loudness),
 *     its length, tempo marks, pedal marks, and its repeat signs / 1st–2nd endings.
 *  2. Lay the bars out in *playing order* (repeats unrolled), giving every note its
 *     start time in beats and seconds. Ties are joined, and notes held by the
 *     sustain pedal get a longer `sounding` time so playback rings like a real piano.
 *
 * Real-world files are messy, so: grace notes and cue notes are skipped, impossible
 * tempo marks (e.g. 450 bpm) are ignored, and a file with no tempo gets a calm default.
 */
import type { Difficulty, Hand, Song, SongNote, Step } from './types';

const STEP_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const DYNAMIC_VELOCITY: Record<string, number> = {
  ppp: 0.25, pp: 0.34, p: 0.45, mp: 0.55, mf: 0.65, f: 0.76, ff: 0.86, fff: 0.94, sf: 0.85, sfz: 0.85, fz: 0.85,
};

const DEFAULT_QPM = 90;
/** Notes closer together than this (in beats) count as starting together. */
const SAME_TIME = 1e-4;
/** The pedal never holds a note longer than this, in seconds (a real string fades). */
const MAX_PEDAL_RING = 6;

/** A note as written inside its bar (pass 1). */
interface RawNote {
  midi: number;
  offset: number; // beats from the start of the bar
  length: number; // beats
  hand: Hand;
  velocity: number;
  tieStart: boolean;
  tieStop: boolean;
}

interface RawMeasure {
  number: number;
  length: number; // beats
  notes: RawNote[];
  tempos: { offset: number; qpm: number }[];
  pedals: { offset: number; type: string }[];
  forwardRepeat: boolean;
  backwardRepeat: number; // how many times to play (0 = no repeat sign)
  endingStart: number[] | null; // e.g. [1] or [1, 2]
  endingStop: boolean;
}

export function parseMusicXml(xml: string, id: string): Song {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('This file is not valid MusicXML.');
  if (doc.querySelector('score-timewise')) throw new Error('Timewise MusicXML is not supported yet. Please export as "partwise".');

  const title =
    text(doc, 'work > work-title') || text(doc, 'movement-title') || text(doc, 'credit-words') || 'Untitled';
  const composer = text(doc, 'identification > creator[type="composer"]') || 'Unknown composer';
  const difficultyText = text(doc, 'miscellaneous-field[name="difficulty"]');
  const writtenDifficulty = (['Easy', 'Medium', 'Hard'] as const).find((d) => d === difficultyText);

  // ---- pass 1: every part, every bar, as written
  let beatsPerMeasure = 4;
  const parts = Array.from(doc.querySelectorAll('part'));
  if (parts.length === 0) throw new Error('No music was found in this file.');
  const partMeasures: RawMeasure[][] = parts.map((part, partIndex) => {
    let divisions = 1;
    let velocity = DYNAMIC_VELOCITY.mf;
    return Array.from(part.querySelectorAll(':scope > measure')).map((measure): RawMeasure => {
      const raw: RawMeasure = {
        number: Number(measure.getAttribute('number')) || 0,
        length: 0,
        notes: [],
        tempos: [],
        pedals: [],
        forwardRepeat: false,
        backwardRepeat: 0,
        endingStart: null,
        endingStop: false,
      };
      let cursor = 0; // in divisions
      let lastNoteStart = 0;
      let end = 0;
      for (const el of Array.from(measure.children)) {
        switch (el.tagName) {
          case 'attributes': {
            const d = Number(text(el, 'divisions'));
            if (d) divisions = d;
            const beats = Number(text(el, 'time > beats'));
            const beatType = Number(text(el, 'time > beat-type'));
            if (beats && beatType && partIndex === 0) beatsPerMeasure = (beats * 4) / beatType;
            break;
          }
          case 'direction':
          case 'sound': {
            const sound = el.tagName === 'sound' ? el : el.querySelector('sound');
            const tempo = Number(sound?.getAttribute('tempo'));
            if (tempo >= 20 && tempo <= 300) raw.tempos.push({ offset: cursor / divisions, qpm: tempo });
            const dyn = el.querySelector('dynamics > *');
            if (dyn && DYNAMIC_VELOCITY[dyn.tagName] !== undefined) velocity = DYNAMIC_VELOCITY[dyn.tagName];
            const pedal = el.querySelector('pedal');
            const type = pedal?.getAttribute('type');
            if (type) raw.pedals.push({ offset: cursor / divisions, type });
            break;
          }
          case 'barline': {
            const repeat = el.querySelector('repeat');
            if (repeat?.getAttribute('direction') === 'forward') raw.forwardRepeat = true;
            if (repeat?.getAttribute('direction') === 'backward') raw.backwardRepeat = Number(repeat.getAttribute('times')) || 2;
            const ending = el.querySelector('ending');
            const endingType = ending?.getAttribute('type');
            if (endingType === 'start') {
              raw.endingStart = (ending!.getAttribute('number') ?? '1').split(/[,\s]+/).map(Number).filter(Boolean);
            } else if (endingType === 'stop' || endingType === 'discontinue') {
              raw.endingStop = true;
            }
            break;
          }
          case 'backup':
            cursor -= Number(text(el, 'duration')) || 0;
            break;
          case 'forward':
            cursor += Number(text(el, 'duration')) || 0;
            end = Math.max(end, cursor);
            break;
          case 'note': {
            if (el.querySelector('grace') || el.querySelector('cue')) break; // ornaments and cue notes
            const duration = Number(text(el, 'duration')) || 0;
            const isChord = !!el.querySelector('chord');
            const start = isChord ? lastNoteStart : cursor;
            if (!isChord) {
              lastNoteStart = cursor;
              cursor += duration;
              end = Math.max(end, cursor);
            }
            const pitch = el.querySelector('pitch');
            if (!pitch) break; // a rest or an unpitched note
            const midi =
              (Number(text(pitch, 'octave')) + 1) * 12 +
              STEP_SEMITONES[text(pitch, 'step')] +
              Math.round(Number(text(pitch, 'alter')) || 0);
            const staff = Number(text(el, 'staff')) || (partIndex === 0 ? 1 : 2);
            const ties = Array.from(el.querySelectorAll(':scope > tie')).map((t) => t.getAttribute('type'));
            raw.notes.push({
              midi,
              offset: start / divisions,
              length: duration / divisions,
              hand: staff >= 2 ? 'left' : 'right',
              velocity,
              tieStart: ties.includes('start'),
              tieStop: ties.includes('stop'),
            });
            break;
          }
        }
      }
      raw.length = end / divisions;
      return raw;
    });
  });

  // All parts share the bar structure of the first part; bar lengths use the longest part.
  const measures = partMeasures[0].map((m, i) => ({
    ...m,
    length: Math.max(...partMeasures.map((pm) => pm[i]?.length ?? 0)),
    notes: partMeasures.flatMap((pm) => pm[i]?.notes ?? []),
    tempos: partMeasures.flatMap((pm) => pm[i]?.tempos ?? []),
    pedals: partMeasures.flatMap((pm) => pm[i]?.pedals ?? []),
  }));

  // Where each bar starts in the written score (for the sheet music cursor).
  const sourceStart: number[] = [];
  measures.reduce((at, m, i) => ((sourceStart[i] = at), at + m.length), 0);

  // ---- pass 2: bars in playing order
  const notes: SongNote[] = [];
  const tempos: { beat: number; qpm: number }[] = [];
  const pedalEvents: { beat: number; type: string }[] = [];
  const openTies = new Map<string, SongNote>();
  let t = 0;
  for (const index of playingOrder(measures)) {
    const m = measures[index];
    for (const tm of m.tempos) tempos.push({ beat: t + tm.offset, qpm: tm.qpm });
    for (const p of m.pedals) pedalEvents.push({ beat: t + p.offset, type: p.type });
    for (const n of m.notes) {
      const key = `${n.midi}|${n.hand}`;
      const startBeat = t + n.offset;
      const tiedFrom = n.tieStop ? openTies.get(key) : undefined;
      if (tiedFrom && Math.abs(tiedFrom.startBeat + tiedFrom.durationBeats - startBeat) < 0.01) {
        tiedFrom.durationBeats += n.length;
        if (!n.tieStart) openTies.delete(key);
        continue;
      }
      const note: SongNote = {
        midi: n.midi,
        startBeat,
        durationBeats: n.length,
        sourceBeat: sourceStart[index] + n.offset,
        hand: n.hand,
        velocity: n.velocity,
        measure: m.number,
        start: 0,
        duration: 0,
        sounding: 0,
      };
      notes.push(note);
      if (n.tieStart) openTies.set(key, note);
    }
    t += m.length;
  }
  if (notes.length === 0) throw new Error('No notes were found in this file.');

  // Beats → seconds, following tempo changes. Then let the pedal hold notes.
  const toSeconds = makeTempoMap(tempos);
  const pedalUp = makePedalMap(pedalEvents);
  for (const n of notes) {
    n.start = toSeconds(n.startBeat);
    n.duration = toSeconds(n.startBeat + n.durationBeats) - n.start;
    const releaseBeat = pedalUp(n.startBeat + n.durationBeats);
    n.sounding = Math.min(toSeconds(releaseBeat) - n.start, n.duration + MAX_PEDAL_RING);
  }
  notes.sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);
  dedupe(notes);

  // Shift so the song starts at 0 even if the first bar opens with rests.
  const offsetBeat = notes[0].startBeat;
  const offsetSec = notes[0].start;
  for (const n of notes) {
    n.startBeat -= offsetBeat;
    n.start -= offsetSec;
  }

  const duration = Math.max(...notes.map((n) => n.start + n.sounding));
  return {
    id,
    title,
    composer,
    difficulty: writtenDifficulty ?? estimateDifficulty(notes, duration),
    notes,
    steps: groupIntoSteps(notes),
    duration,
    beatsPerMeasure,
    musicXml: xml,
  };
}

/**
 * The order bars are played in, unrolling repeat signs and 1st/2nd endings.
 * e.g. |: A B [1. C :| [2. D  →  A B C A B D
 */
function playingOrder(measures: RawMeasure[]): number[] {
  const order: number[] = [];
  let start = 0; // where the current repeat goes back to
  let pass = 1; // which time through the repeated section we're on
  let skipping = false; // inside an ending that isn't for this pass
  const finished = new Set<number>(); // backward repeats already taken
  let guard = 0;
  for (let i = 0; i < measures.length && guard++ < 10_000; ) {
    const m = measures[i];
    if (m.forwardRepeat && !(pass > 1 && i === start)) {
      start = i;
      pass = 1;
    }
    if (m.endingStart) skipping = !m.endingStart.includes(pass);
    if (!skipping) order.push(i);

    if (m.backwardRepeat && !skipping && !finished.has(i)) {
      if (pass < m.backwardRepeat) {
        pass++;
        i = start;
        continue;
      }
      finished.add(i);
    }
    if (m.endingStop) {
      if (!skipping && pass > 1 && !m.backwardRepeat) {
        // Finished the last ending: the next repeat (if any) starts after it.
        pass = 1;
        start = i + 1;
      }
      skipping = false;
    } else if (m.backwardRepeat && finished.has(i) && !skipping) {
      pass = 1;
      start = i + 1;
    }
    i++;
  }
  return order;
}

/**
 * A rough difficulty for files that don't state one (uploads): how many notes per
 * second, and how widely the hands spread. Good enough to sort a library.
 */
function estimateDifficulty(notes: SongNote[], seconds: number): Difficulty {
  const perSecond = notes.length / Math.max(1, seconds);
  const pitches = notes.map((n) => n.midi);
  const span = Math.max(...pitches) - Math.min(...pitches);
  if (perSecond < 2.5 && span < 48) return 'Easy';
  if (perSecond < 6) return 'Medium';
  return 'Hard';
}

/**
 * Some files write the same note twice at the same moment (two voices sharing a
 * note). A piano key can only be struck once, so keep one, with the longer length.
 * Expects notes sorted by start then pitch.
 */
function dedupe(notes: SongNote[]): void {
  for (let i = notes.length - 1; i > 0; i--) {
    const a = notes[i - 1];
    const b = notes[i];
    if (a.midi === b.midi && Math.abs(a.startBeat - b.startBeat) < SAME_TIME) {
      a.durationBeats = Math.max(a.durationBeats, b.durationBeats);
      a.duration = Math.max(a.duration, b.duration);
      a.sounding = Math.max(a.sounding, b.sounding);
      notes.splice(i, 1);
    }
  }
}

/** Group notes that start together into steps (one key press each in Magic mode). */
export function groupIntoSteps(notes: SongNote[]): Step[] {
  const steps: Step[] = [];
  for (const note of notes) {
    const last = steps[steps.length - 1];
    if (last && Math.abs(last.startBeat - note.startBeat) < SAME_TIME) last.notes.push(note);
    else steps.push({ start: note.start, startBeat: note.startBeat, sourceBeat: note.sourceBeat, notes: [note] });
  }
  return steps;
}

/** Returns a function converting a beat position to seconds, honouring tempo changes. */
function makeTempoMap(marks: { beat: number; qpm: number }[]): (beat: number) => number {
  const sorted = [...marks].sort((a, b) => a.beat - b.beat);
  if (sorted.length === 0 || sorted[0].beat > 0) sorted.unshift({ beat: 0, qpm: sorted[0]?.qpm ?? DEFAULT_QPM });
  // Seconds elapsed at the start of each tempo section.
  const startSec: number[] = [0];
  for (let i = 1; i < sorted.length; i++) {
    startSec[i] = startSec[i - 1] + ((sorted[i].beat - sorted[i - 1].beat) * 60) / sorted[i - 1].qpm;
  }
  return (beat) => {
    let i = sorted.length - 1;
    while (i > 0 && sorted[i].beat > beat) i--;
    return startSec[i] + ((beat - sorted[i].beat) * 60) / sorted[i].qpm;
  };
}

/**
 * Returns a function: "a key let go at beat b keeps sounding until beat …".
 * If the pedal is down at that moment, the note rings until the pedal next lifts
 * (a "change" mark lifts and presses again in one go).
 */
function makePedalMap(events: { beat: number; type: string }[]): (beat: number) => number {
  const sorted = [...events].sort((a, b) => a.beat - b.beat);
  const downRanges: [number, number][] = [];
  let downAt: number | null = null;
  for (const e of sorted) {
    if (e.type === 'start' || e.type === 'resume') {
      if (downAt === null) downAt = e.beat;
    } else if (e.type === 'stop' || e.type === 'discontinue') {
      if (downAt !== null) downRanges.push([downAt, e.beat]);
      downAt = null;
    } else if (e.type === 'change') {
      if (downAt !== null) downRanges.push([downAt, e.beat]);
      downAt = e.beat;
    }
  }
  if (downAt !== null) downRanges.push([downAt, Infinity]);
  return (beat) => {
    const range = downRanges.find(([a, b]) => beat >= a && beat < b);
    return range && Number.isFinite(range[1]) ? range[1] : range ? beat + MAX_PEDAL_RING * 4 : beat;
  };
}

function text(root: ParentNode, selector: string): string {
  return root.querySelector(selector)?.textContent?.trim() ?? '';
}
