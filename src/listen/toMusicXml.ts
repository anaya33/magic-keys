/**
 * Cleaned notes → a MusicXML score.
 *
 * Writing a real score (instead of building a Song object directly) means a
 * recording goes through exactly the same path as every other song: the same
 * parser, real sheet music on screen, and Magic / Learn / Autoplay / tiles for free.
 *
 * The score is 4/4 with a treble staff (melody and chords) and a bass staff.
 * Time is counted in sixteenths (divisions = 4 per quarter). Each staff is walked
 * bar by bar: gaps become rests, notes crossing a bar line are split and tied, and
 * every length is written as standard note values (whole, dotted half, … sixteenth).
 */
import type { CleanResult, GridNote } from './cleanup';

const BAR = 16; // sixteenths in a 4/4 bar
/** Note values we can write, longest first: [sixteenths, type, dotted]. */
const VALUES: [number, string, boolean][] = [
  [16, 'whole', false],
  [12, 'half', true],
  [8, 'half', false],
  [6, 'quarter', true],
  [4, 'quarter', false],
  [3, 'eighth', true],
  [2, 'eighth', false],
  [1, '16th', false],
];
const SHARP_SPELLING: [string, number][] = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const FLAT_SPELLING: [string, number][] = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];

/** A run of time in one staff: a chord (one or more pitches) or a rest. */
interface Piece {
  start: number;
  length: number;
  midis: number[]; // empty = rest
  tieStart: boolean;
  tieStop: boolean;
}

export function toMusicXml(music: CleanResult, title: string): string {
  const end = Math.max(...music.notes.map((n) => n.start + n.length));
  const bars = Math.max(1, Math.ceil(end / BAR));
  const spelling = music.fifths < 0 ? FLAT_SPELLING : SHARP_SPELLING;
  const staffPieces = ([1, 2] as const).map((staff) => piecesForStaff(music.notes.filter((n) => n.staff === staff), bars));

  const measures: string[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const parts: string[] = [];
    if (bar === 0) {
      parts.push(`
      <attributes>
        <divisions>4</divisions>
        <key><fifths>${music.fifths}</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <direction placement="above"><direction-type><words>Recorded</words></direction-type><sound tempo="${music.qpm}"/></direction>`);
    }
    staffPieces.forEach((pieces, i) => {
      if (i === 1) parts.push(`\n      <backup><duration>${BAR}</duration></backup>`);
      for (const piece of pieces.filter((p) => p.start >= bar * BAR && p.start < (bar + 1) * BAR)) {
        parts.push(noteXml(piece, (i + 1) as 1 | 2, spelling));
      }
    });
    const barline = bar === bars - 1 ? '\n      <barline location="right"><bar-style>light-heavy</bar-style></barline>' : '';
    measures.push(`    <measure number="${bar + 1}">${parts.join('')}${barline}\n    </measure>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work><work-title>${escapeXml(title)}</work-title></work>
  <identification>
    <creator type="composer">You</creator>
    <rights>Recorded in Magic Keys. Key: ${escapeXml(music.keyName)}.</rights>
  </identification>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
${measures.join('\n')}
  </part>
</score-partwise>
`;
}

/** Fill one staff with chords and rests, split at bar lines and into writable note values. */
function piecesForStaff(notes: GridNote[], bars: number): Piece[] {
  const chords = new Map<number, GridNote[]>();
  for (const n of notes) chords.set(n.start, [...(chords.get(n.start) ?? []), n]);
  const starts = [...chords.keys()].sort((a, b) => a - b);

  // 1. A timeline of chords and the rests between them.
  const timeline: { start: number; length: number; midis: number[] }[] = [];
  let at = 0;
  for (const start of starts) {
    if (start > at) timeline.push({ start: at, length: start - at, midis: [] });
    const group = chords.get(start)!;
    const length = Math.min(...group.map((n) => n.length));
    timeline.push({ start, length, midis: group.map((n) => n.midi).sort((a, b) => a - b) });
    at = start + length;
  }
  if (at < bars * BAR) timeline.push({ start: at, length: bars * BAR - at, midis: [] });

  // 2. Split at bar lines and into note values; sounding pieces are tied together.
  const pieces: Piece[] = [];
  for (const item of timeline) {
    const parts: { start: number; length: number }[] = [];
    let pos = item.start;
    let left = item.length;
    while (left > 0) {
      const room = BAR - (pos % BAR); // until the next bar line
      let take = Math.min(left, room);
      take = VALUES.find(([v]) => v <= take)![0];
      parts.push({ start: pos, length: take });
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
  return pieces;
}

function noteXml(piece: Piece, staff: 1 | 2, spelling: [string, number][]): string {
  const [, type, dotted] = VALUES.find(([v]) => v === piece.length)!;
  const common = (tieXml: string) =>
    `<duration>${piece.length}</duration>${tieXml}<voice>${staff}</voice><type>${type}</type>${dotted ? '<dot/>' : ''}<staff>${staff}</staff>`;
  if (piece.midis.length === 0) return `\n      <note><rest/>${common('')}</note>`;
  const ties = `${piece.tieStop ? '<tie type="stop"/>' : ''}${piece.tieStart ? '<tie type="start"/>' : ''}`;
  const tied = `${piece.tieStop ? '<tied type="stop"/>' : ''}${piece.tieStart ? '<tied type="start"/>' : ''}`;
  return piece.midis
    .map((midi, i) => {
      const [step, alter] = spelling[midi % 12];
      const octave = Math.floor(midi / 12) - 1;
      const pitch = `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>`;
      const notations = tied ? `<notations>${tied}</notations>` : '';
      return `\n      <note>${i > 0 ? '<chord/>' : ''}${pitch}${common(ties)}${notations}</note>`;
    })
    .join('');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
