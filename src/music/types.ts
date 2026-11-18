/**
 * The shape every song takes inside the app, whatever file it came from
 * (built-in MusicXML, an uploaded score, or a Listen-mode recording).
 */

export type Hand = 'right' | 'left';

/** One note of the score, already placed on the playing timeline. */
export interface SongNote {
  midi: number;
  /** When the note starts, in seconds at the written tempo (repeats unrolled). */
  start: number;
  /** Written length in seconds. */
  duration: number;
  /** How long it actually rings, in seconds: longer than `duration` when the sustain pedal holds it. */
  sounding: number;
  /** Same timing in quarter-note beats (used for musical decisions like phrasing). */
  startBeat: number;
  durationBeats: number;
  /** Position in the score as written, in beats (a repeated bar has the same sourceBeat both times). */
  sourceBeat: number;
  hand: Hand;
  /** 0..1, from the written dynamics (pp, p, mf, f …). */
  velocity: number;
  /** Bar number as written in the score. */
  measure: number;
}

/** Everything that starts together: a single note or a chord. Magic mode plays one step per key press. */
export interface Step {
  start: number;
  startBeat: number;
  /** Where this step is in the written score (moves the sheet music cursor). */
  sourceBeat: number;
  notes: SongNote[];
}

export type Difficulty = 'Easy' | 'Medium' | 'Hard';

export interface Song {
  id: string;
  title: string;
  composer: string;
  difficulty: Difficulty;
  /** Notes sorted by start time. */
  notes: SongNote[];
  /** Notes grouped by start time, in order. */
  steps: Step[];
  /** Length in seconds at the written tempo. */
  duration: number;
  /** Quarter-note beats in one bar (3/8 = 1.5, 4/4 = 4), used for phrasing. */
  beatsPerMeasure: number;
  /** Original MusicXML, kept so the sheet music view can draw it. */
  musicXml?: string;
  /** True for songs added during this visit (uploads, recordings). */
  fromSession?: boolean;
}
