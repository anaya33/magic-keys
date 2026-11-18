/**
 * Listen mode pipeline.
 *
 *   Singing or humming (one line of melody):
 *     recording → pYIN pitch track (pitch.ts) → sung notes (voiceNotes.ts)
 *   Playing an instrument (notes and chords):
 *     recording → Basic Pitch (transcribe.ts) → melody, chords, bass (cleanup.ts)
 *   Then, for both:
 *     → beat and rhythm, with triplets (rhythm.ts)
 *     → a real MusicXML score (toMusicXml.ts)
 *     → the same parser every song uses (music/musicxml.ts)
 *     → saved in your songs (music/library.ts)
 */
import { addSessionSong, nextRecordingNumber } from '../music/library';
import { parseMusicXml } from '../music/musicxml';
import type { Song } from '../music/types';
import { cleanUp, describeKey, type KeyInfo } from './cleanup';
import { toAnalysisRate, trackPitch } from './pitch';
import type { Recording } from './recorder';
import { quantize, type TimedNote } from './rhythm';
import { toMusicXml } from './toMusicXml';
import { transcribe } from './transcribe';
import { sungNotes } from './voiceNotes';

export type RecordKind = 'voice' | 'instrument';

export interface ListenResult {
  song: Song;
  /** Key name, or null when the recording was too short to be sure. */
  keyName: string | null;
  bpm: number;
  tripletBeats: number;
}

export async function recordingToSong(
  recording: Recording,
  kind: RecordKind,
  onProgress: (fraction: number) => void,
): Promise<ListenResult> {
  if (recording.samples.length < recording.sampleRate * 0.5) {
    throw new Error('That was very short. Try singing or playing for a few seconds.');
  }

  let timed: TimedNote[];
  let key: KeyInfo;
  if (kind === 'voice') {
    const audio = await toAnalysisRate(recording.samples, recording.sampleRate);
    const frames = await trackPitch(audio, (f) => onProgress(f * 0.9));
    const { notes } = sungNotes(frames);
    if (notes.length === 0) {
      throw new Error("I couldn't hear a clear melody. Try humming a little louder, or closer to the microphone.");
    }
    timed = notes.map((n) => ({ ...n, staff: 1 as const }));
    key = describeKey(notes);
  } else {
    const audio = new AudioBuffer({ length: recording.samples.length, sampleRate: recording.sampleRate, numberOfChannels: 1 });
    audio.copyToChannel(recording.samples, 0);
    const cleaned = cleanUp(await transcribe(audio, (f) => onProgress(f * 0.9)));
    timed = cleaned.notes;
    key = cleaned;
  }

  const rhythm = quantize(timed, recording.beat);
  const title = `My recording ${await nextRecordingNumber()}`;
  const xml = toMusicXml({
    title,
    notes: rhythm.notes,
    grids: rhythm.grids,
    bpm: rhythm.bpm,
    fifths: key.fifths,
    keyName: key.keyName,
    staves: kind === 'voice' ? 1 : 2,
  });
  const song = parseMusicXml(xml, `recording-${Date.now()}`);
  addSessionSong(song);
  onProgress(1);
  return { song, keyName: key.keyConfident ? key.keyName : null, bpm: rhythm.bpm, tripletBeats: rhythm.tripletBeats };
}
