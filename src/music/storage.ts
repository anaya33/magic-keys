/**
 * "Your songs" storage: recordings and uploads, kept on this device.
 *
 * Uses IndexedDB, the browser's built-in database. Nothing leaves the device:
 * no server, no account. Each song is stored as its MusicXML text (a few KB for a
 * recording) and parsed again when the app opens.
 *
 * Storage can be unavailable (private browsing, blocked site data). Every call
 * fails softly: the app keeps working, the songs just don't survive a reload.
 */
const DB_NAME = 'magic-keys';
const STORE = 'your-songs';

export interface SavedSong {
  id: string;
  kind: 'recording' | 'upload';
  title: string;
  musicXml: string;
  addedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

/** Run one request in a transaction and resolve with its result. */
async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = work(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadSavedSongs(): Promise<SavedSong[]> {
  try {
    const all = await run<SavedSong[]>('readonly', (s) => s.getAll());
    return all.sort((a, b) => a.addedAt - b.addedAt);
  } catch {
    return [];
  }
}

export async function saveSong(song: SavedSong): Promise<void> {
  try {
    await run('readwrite', (s) => s.put(song));
  } catch {
    /* not saved: the song still works for this visit */
  }
}

export async function deleteSavedSong(id: string): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(id));
  } catch {
    /* nothing to do */
  }
}
