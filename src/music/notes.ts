/**
 * Small, dependency-free helpers for working with MIDI note numbers.
 * MIDI 60 = middle C (C4), 21 = A0 (lowest piano key), 108 = C8 (highest).
 */

export const PIANO_LOWEST = 21;
export const PIANO_HIGHEST = 108;

const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** Pitch classes that are black keys (C♯, D♯, F♯, G♯, A♯). */
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

export function isBlackKey(midi: number): boolean {
  return BLACK_PITCH_CLASSES.has(((midi % 12) + 12) % 12);
}

/** "C♯4"-style name, used for labels shown to the player. */
export function noteName(midi: number, withOctave = true): string {
  const name = SHARP_NAMES[((midi % 12) + 12) % 12];
  return withOctave ? `${name}${Math.floor(midi / 12) - 1}` : name;
}

/** "C#4"-style name in the plain-ASCII format Tone.js expects. */
export function toneName(midi: number): string {
  return noteName(midi).replace('♯', '#');
}

