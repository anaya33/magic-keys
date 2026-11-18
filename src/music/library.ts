/**
 * The song library.
 *
 * Built-in songs: every *.musicxml (or *.xml) file in /songs is picked up
 * automatically at build time by Vite's import.meta.glob. Drop a new file in the
 * folder and it appears in the app; no code changes. Files load lazily.
 *
 * Your songs: uploads and Listen-mode recordings. They're saved on this device
 * (IndexedDB, see storage.ts) so they survive a reload, and can be deleted.
 * Nothing is ever sent anywhere.
 */
import { unzipSync, strFromU8 } from 'fflate';
import { parseMusicXml } from './musicxml';
import { deleteSavedSong, loadSavedSongs, saveSong } from './storage';
import type { Difficulty, Song } from './types';

const files = import.meta.glob(['/songs/*.musicxml', '/songs/*.xml'], {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;

/** Built-in songs in a friendly order (anything not listed follows, by name). */
const PREFERRED_ORDER = ['fur-elise', 'moonlight-sonata', 'clair-de-lune', 'gymnopedie-1', 'bach-prelude-in-c'];

export interface SongInfo {
  id: string;
  title: string;
  composer: string;
  difficulty: Difficulty;
  fromSession: boolean;
}

const cache = new Map<string, Song>();
const yourSongs: Song[] = [];
let restored: Promise<void> | null = null;

/** Bring back the songs saved on this device (once, when the app starts). */
export function restoreYourSongs(): Promise<void> {
  restored ??= loadSavedSongs().then((saved) => {
    for (const s of saved) {
      try {
        const song = parseMusicXml(s.musicXml, s.id);
        song.title = s.title;
        song.fromSession = true;
        cache.set(song.id, song);
        yourSongs.push(song);
      } catch {
        void deleteSavedSong(s.id); // unreadable: tidy it away
      }
    }
  });
  return restored;
}

/** "/songs/fur-elise.musicxml" → "fur-elise" */
function idFromPath(path: string): string {
  return path.split('/').pop()!.replace(/\.(musicxml|xml)$/, '');
}

function builtInIds(): string[] {
  const ids = Object.keys(files).map(idFromPath);
  const rank = (id: string) => (PREFERRED_ORDER.includes(id) ? PREFERRED_ORDER.indexOf(id) : 100);
  return ids.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Everything to show in the library: built-in songs first, then your songs. */
export async function listSongs(): Promise<SongInfo[]> {
  await restoreYourSongs();
  const builtIn = await Promise.all(
    builtInIds().map(async (id): Promise<SongInfo> => {
      const song = cache.get(id);
      if (song) return info(song, false);
      const path = Object.keys(files).find((p) => idFromPath(p) === id)!;
      return { id, ...quickInfo(await files[path]()), fromSession: false };
    }),
  );
  return [...builtIn, ...yourSongs.map((s) => info(s, true))];
}

export async function loadSong(id: string): Promise<Song> {
  const cached = cache.get(id);
  if (cached) return cached;
  if (isYourSong(id)) await restoreYourSongs();
  const restoredSong = cache.get(id);
  if (restoredSong) return restoredSong;
  const path = Object.keys(files).find((p) => idFromPath(p) === id);
  if (!path) throw new Error(`No song called "${id}"`);
  const song = parseMusicXml(await files[path](), id);
  cache.set(id, song);
  return song;
}

/** Recordings and uploads have ids like "recording-…" / "upload-…". */
export function isYourSong(id: string): boolean {
  return id.startsWith('recording-') || id.startsWith('upload-');
}

/** Add a recording or upload, and save it on this device. */
export function addSessionSong(song: Song): void {
  song.fromSession = true;
  cache.set(song.id, song);
  yourSongs.push(song);
  if (song.musicXml) {
    void saveSong({
      id: song.id,
      kind: song.id.startsWith('recording-') ? 'recording' : 'upload',
      title: song.title,
      musicXml: song.musicXml,
      addedAt: Date.now(),
    });
  }
}

/** Delete one of your songs (from this visit and from the device). */
export async function deleteYourSong(id: string): Promise<void> {
  if (!isYourSong(id)) return; // built-in songs can't be deleted
  cache.delete(id);
  const index = yourSongs.findIndex((s) => s.id === id);
  if (index >= 0) yourSongs.splice(index, 1);
  await deleteSavedSong(id);
}

/** The number for the next "My recording N" (keeps counting across visits). */
export async function nextRecordingNumber(): Promise<number> {
  await restoreYourSongs();
  const used = yourSongs.map((s) => Number(s.title.match(/^My recording (\d+)$/)?.[1] ?? 0));
  return Math.max(0, ...used) + 1;
}

/**
 * Read an uploaded file: .musicxml / .xml (plain text) or .mxl (zip-compressed
 * MusicXML, the format most notation apps export). Throws a friendly error if
 * the file can't be used.
 */
export async function songFromFile(file: File): Promise<Song> {
  if (file.size > 20 * 1024 * 1024) throw new Error('That file is too big (over 20 MB).');
  const name = file.name.toLowerCase();
  let xml: string;
  if (name.endsWith('.mxl')) {
    xml = readMxl(new Uint8Array(await file.arrayBuffer()));
  } else if (name.endsWith('.musicxml') || name.endsWith('.xml')) {
    xml = await file.text();
  } else {
    throw new Error('Please choose a MusicXML file (.musicxml, .xml or .mxl). Most notation apps can export one.');
  }
  const id = `upload-${Date.now()}`;
  const song = parseMusicXml(xml, id);
  if (song.title === 'Untitled') song.title = file.name.replace(/\.(musicxml|xml|mxl)$/i, '');
  await restoreYourSongs();
  addSessionSong(song);
  return song;
}

/** .mxl is a zip; META-INF/container.xml names the main score file inside it. */
function readMxl(bytes: Uint8Array): string {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error('This .mxl file could not be opened.');
  }
  const container = entries['META-INF/container.xml'];
  let rootPath: string | null = null;
  if (container) {
    const doc = new DOMParser().parseFromString(strFromU8(container), 'application/xml');
    rootPath = doc.querySelector('rootfile')?.getAttribute('full-path') ?? null;
  }
  rootPath ??= Object.keys(entries).find((p) => /\.(musicxml|xml)$/i.test(p) && !p.startsWith('META-INF')) ?? null;
  if (!rootPath || !entries[rootPath]) throw new Error('No score was found inside this .mxl file.');
  return strFromU8(entries[rootPath]);
}

function info(song: Song, fromSession: boolean): SongInfo {
  return { id: song.id, title: song.title, composer: song.composer, difficulty: song.difficulty, fromSession };
}

/** Title, composer and difficulty without parsing the whole score (fast, for the library cards). */
function quickInfo(xml: string): Omit<SongInfo, 'id' | 'fromSession'> {
  const pick = (re: RegExp) => decode(xml.match(re)?.[1]?.trim() ?? '');
  const difficulty = pick(/<miscellaneous-field name="difficulty">([^<]*)</) as Difficulty;
  return {
    title: pick(/<work-title>([^<]*)</) || pick(/<movement-title>([^<]*)</) || 'Untitled',
    composer: pick(/<creator type="composer">([^<]*)</) || 'Unknown composer',
    difficulty: ['Easy', 'Medium', 'Hard'].includes(difficulty) ? difficulty : 'Medium',
  };
}

function decode(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
