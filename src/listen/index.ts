/**
 * Listen mode pipeline:
 *   recording (AudioBuffer)
 *     → Basic Pitch: raw notes                       (transcribe.ts)
 *     → clean up: key, melody, chords, beat grid     (cleanup.ts)
 *     → a real MusicXML score                        (toMusicXml.ts)
 *     → the same parser every song uses              (music/musicxml.ts)
 *     → saved in your songs, on this device          (music/library.ts)
 */
import { addSessionSong, nextRecordingNumber } from '../music/library';
import { parseMusicXml } from '../music/musicxml';
import type { Song } from '../music/types';
import { cleanUp } from './cleanup';
import { toMusicXml } from './toMusicXml';
import { transcribe } from './transcribe';

export interface ListenResult {
  song: Song;
  /** Key name, or null when the recording was too short to be sure. */
  keyName: string | null;
  qpm: number;
}

export async function recordingToSong(audio: AudioBuffer, onProgress: (fraction: number) => void): Promise<ListenResult> {
  if (audio.duration < 0.5) throw new Error('That was very short. Try playing for a few seconds.');
  const raw = await transcribe(audio, onProgress);
  const music = cleanUp(raw);
  const title = `My recording ${await nextRecordingNumber()}`;
  const song = parseMusicXml(toMusicXml(music, title), `recording-${Date.now()}`);
  addSessionSong(song);
  return { song, keyName: music.keyConfident ? music.keyName : null, qpm: music.qpm };
}
