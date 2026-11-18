/**
 * Grid notes → a MusicXML score.
 *
 * Writing a real score (instead of building a Song object directly) means a recording
 * goes through exactly the same path as every other song: the same parser, real sheet
 * music on screen, and Magic / Learn / Autoplay / tiles for free.
 *
 * Time is in ticks, 12 per quarter-note beat (divisions = 12), so straight notes
 * (sixteenth = 3, eighth = 6, dotted eighth = 9, quarter = 12 …) and triplets
 * (sixteenth-triplet = 2, eighth-triplet = 4, quarter-triplet = 8) are all whole numbers.
 * 4/4 time: a bar is 48 ticks.
 *
 * Each staff is walked from start to end: gaps become rests, and every note or rest is
 * cut into pieces that can be written as standard note values. Pieces never cross a bar
 * line, and inside a triplet beat they never cross the beat; sounding pieces are tied.
 * Pieces in a triplet beat get <time-modification> 3:2 and a tuplet bracket.
 */
import { TICKS_PER_BEAT, type BeatGrid, type GridNote } from './rhythm';

const BAR = TICKS_PER_BEAT * 4;
/** Straight note values: [ticks, type, dotted]. */
const STRAIGHT: [number, string, boolean][] = [
  [48, 'whole', false],
  [36, 'half', true],
  [24, 'half', false],
  [18, 'quarter', true],
  [12, 'quarter', false],
  [9, 'eighth', true],
  [6, 'eighth', false],
  [3, '16th', false],
];
/** Triplet note values (three in the time of two): [ticks, type]. */
const TRIPLET: [number, string][] = [
  [8, 'quarter'],
  [4, 'eighth'],
  [2, '16th'],
];
const SHARP_SPELLING: [string, number][] = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const FLAT_SPELLING: [string, number][] = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];

export interface ScoreInput {
  title: string;
  notes: GridNote[];
  grids: Map<number, BeatGrid>;
  bpm: number;
  fifths: number; // key signature
  keyName: string;
  /** Voice recordings use one staff; instrument recordings use two (melody + bass). */
  staves: 1 | 2;
}

interface Piece {
  start: number;
  length: number;
  midis: number[]; // empty = rest
  tieStart: boolean;
  tieStop: boolean;
  triplet: boolean;
  tupletStart?: boolean;
  tupletStop?: boolean;
}

export function toMusicXml(score: ScoreInput): string {
  const end = Math.max(BAR, ...score.notes.map((n) => n.start + n.length));
  const bars = Math.ceil(end / BAR);
  const isTripletBeat = (beat: number) => {
    const g = score.grids.get(beat);
    return g === 3 || g === 6;
  };
  const spelling = score.fifths < 0 ? FLAT_SPELLING : SHARP_SPELLING;
  const staffNumbers = score.staves === 2 ? [1, 2] : [1];
  const pieces = staffNumbers.map((staff) => piecesForStaff(score.notes.filter((n) => n.staff === staff || score.staves === 1), bars, isTripletBeat));

  // One staff: treble clef, or bass clef for a low (e.g. male) voice.
  const pitches = score.notes.map((n) => n.midi).sort((a, b) => a - b);
  const middle = pitches[pitches.length >> 1] ?? 60;
  const clefs =
    score.staves === 2
      ? '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>'
      : middle < 57
        ? '<clef><sign>F</sign><line>4</line></clef>'
        : '<clef><sign>G</sign><line>2</line></clef>';

  const measures: string[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const parts: string[] = [];
    if (bar === 0) {
      parts.push(`
      <attributes>
        <divisions>${TICKS_PER_BEAT}</divisions>
        <key><fifths>${score.fifths}</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        ${score.staves === 2 ? '<staves>2</staves>' : ''}
        ${clefs}
      </attributes>
      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${score.bpm}</per-minute></metronome></direction-type><sound tempo="${score.bpm}"/></direction>`);
    }
    pieces.forEach((staffPieces, i) => {
      if (i === 1) parts.push(`\n      <backup><duration>${BAR}</duration></backup>`);
      for (const p of staffPieces.filter((x) => x.start >= bar * BAR && x.start < (bar + 1) * BAR)) {
        parts.push(noteXml(p, staffNumbers[i], score.staves, spelling));
      }
    });
    const barline = bar === bars - 1 ? '\n      <barline location="right"><bar-style>light-heavy</bar-style></barline>' : '';
    measures.push(`    <measure number="${bar + 1}">${parts.join('')}${barline}\n    </measure>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work><work-title>${escapeXml(score.title)}</work-title></work>
  <identification>
    <creator type="composer">You</creator>
    <rights>Recorded in Magic Keys. Key: ${escapeXml(score.keyName)}.</rights>
  </identification>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
${measures.join('\n')}
  </part>
</score-partwise>
`;
}

/** Chords and rests for one staff, cut into writable pieces. */
function piecesForStaff(notes: GridNote[], bars: number, isTripletBeat: (beat: number) => boolean): Piece[] {
  const chords = new Map<number, GridNote[]>();
  for (const n of notes) chords.set(n.start, [...(chords.get(n.start) ?? []), n]);
  const starts = [...chords.keys()].sort((a, b) => a - b);

  // Timeline: chords and the rests between them, covering every bar.
  const timeline: { start: number; length: number; midis: number[] }[] = [];
  let at = 0;
  for (const start of starts) {
    if (start < at) continue; // overlaps the previous chord (shouldn't happen after quantizing)
    if (start > at) timeline.push({ start: at, length: start - at, midis: [] });
    const group = chords.get(start)!;
    const length = Math.min(...group.map((n) => n.length));
    timeline.push({ start, length, midis: [...new Set(group.map((n) => n.midi))].sort((a, b) => a - b) });
    at = start + length;
  }
  if (at < bars * BAR) timeline.push({ start: at, length: bars * BAR - at, midis: [] });

  const pieces: Piece[] = [];
  for (const item of timeline) {
    const parts: { start: number; length: number; triplet: boolean }[] = [];
    let pos = item.start;
    let left = item.length;
    while (left > 0) {
      const beat = Math.floor(pos / TICKS_PER_BEAT);
      const triplet = isTripletBeat(beat);
      const toBar = BAR - (pos % BAR);
      let take: number;
      if (triplet) {
        // Inside a triplet beat: stay within the beat, use triplet values.
        const toBeat = (beat + 1) * TICKS_PER_BEAT - pos;
        const room = Math.min(left, toBeat);
        take = TRIPLET.find(([v]) => v <= room)?.[0] ?? room;
      } else {
        // Straight: may span beats, but not into a triplet beat or across the bar line.
        let room = Math.min(left, toBar);
        for (let b = beat + 1; b * TICKS_PER_BEAT < pos + room; b++) {
          if (isTripletBeat(b)) {
            room = b * TICKS_PER_BEAT - pos;
            break;
          }
        }
        // Long values only from a beat boundary; otherwise finish the current beat first.
        const offBeat = pos % TICKS_PER_BEAT;
        if (offBeat) room = Math.min(room, TICKS_PER_BEAT - offBeat);
        take = STRAIGHT.find(([v]) => v <= room)?.[0] ?? room;
      }
      parts.push({ start: pos, length: take, triplet });
      pos += take;
      left -= take;
    }
    parts.forEach((p, i) =>
      pieces.push({
        ...p,
        midis: item.midis,
        tieStop: item.midis.length > 0 && i > 0,
        tieStart: item.midis.length > 0 && i < parts.length - 1,
      }),
    );
  }

  // Tuplet brackets: the first and last piece of each triplet beat.
  const byBeat = new Map<number, Piece[]>();
  for (const p of pieces) {
    if (!p.triplet) continue;
    const beat = Math.floor(p.start / TICKS_PER_BEAT);
    byBeat.set(beat, [...(byBeat.get(beat) ?? []), p]);
  }
  for (const group of byBeat.values()) {
    group[0].tupletStart = true;
    group[group.length - 1].tupletStop = true;
  }
  return pieces;
}

function noteXml(p: Piece, staff: number, staves: 1 | 2, spelling: [string, number][]): string {
  let type: string;
  let dotted = false;
  if (p.triplet) type = TRIPLET.find(([v]) => v === p.length)?.[1] ?? 'eighth';
  else {
    const value = STRAIGHT.find(([v]) => v === p.length);
    type = value?.[1] ?? '16th';
    dotted = value?.[2] ?? false;
  }
  const timeMod = p.triplet ? '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' : '';
  const staffXml = staves === 2 ? `<staff>${staff}</staff>` : '';
  const tuplet = `${p.tupletStart ? '<tuplet type="start" bracket="yes"/>' : ''}${p.tupletStop ? '<tuplet type="stop"/>' : ''}`;
  const tied = p.midis.length ? `${p.tieStop ? '<tied type="stop"/>' : ''}${p.tieStart ? '<tied type="start"/>' : ''}` : '';
  const notations = tuplet || tied ? `<notations>${tied}${tuplet}</notations>` : '';
  const ties = p.midis.length ? `${p.tieStop ? '<tie type="stop"/>' : ''}${p.tieStart ? '<tie type="start"/>' : ''}` : '';
  const body = (chord: boolean, pitch: string) =>
    `\n      <note>${chord ? '<chord/>' : ''}${pitch}<duration>${p.length}</duration>${ties}<voice>${staff}</voice><type>${type}</type>${dotted ? '<dot/>' : ''}${timeMod}${staffXml}${notations}</note>`;
  if (p.midis.length === 0) return body(false, '<rest/>');
  return p.midis
    .map((midi, i) => {
      const [step, alter] = spelling[midi % 12];
      const pitch = `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${Math.floor(midi / 12) - 1}</octave></pitch>`;
      return body(i > 0, pitch);
    })
    .join('');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
