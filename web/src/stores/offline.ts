// Everything saved on this device for offline listening, in IndexedDB.
//
// Songs: audio and cover are Blobs in their own stores; a small metadata record lists them without loading audio.
// Collections: "Download" on favorites, a playlist or an album saves every song and remembers the list, so the
// collection can be shown and played offline. A song can be held by several collections and by an individual
// save at once; its files are deleted only when nothing holds it any more.
import { useSyncExternalStore } from "react";
import { hasCover, songCover, sourceUrl } from "../lib/api";
import { megabytes } from "../lib/format";
import { cutShort, saysNotFound, streamProblem } from "../lib/retry";
import type { CollectionKind, CollectionRecord, CollectionSpec, MediaKind, Song } from "../lib/types";

export { megabytes };

const DB = "eco-offline"; // the name and version are what keeps existing downloads: do not change them lightly

interface SavedSong {
  id: string;
  title: string;
  artist: string;
  album?: string;
  albumId?: string;
  artistId?: string;
  duration?: number;
  mediaId?: string;
  kind?: MediaKind;
  size: number;
  savedAt: number;
  hasCover: boolean;
  direct: boolean; // saved on its own, not only because a collection holds it
  refs: string[]; // collections holding it
}

let dbPromise: Promise<IDBDatabase> | undefined;
const meta = new Map<string, SavedSong>();
const collections = new Map<string, CollectionRecord>();
const listeners = new Set<() => void>();
let version = 0;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      for (const name of ["meta", "audio", "covers", "collections"]) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run<T>(stores: string[], mode: IDBTransactionMode, fn: (...s: IDBObjectStore[]) => Promise<T> | T): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result: T;
    Promise.resolve(fn(...stores.map((s) => tx.objectStore(s)))).then((r) => { result = r; });
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

const ask = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const notify = () => { version++; listeners.forEach((fn) => fn()); };
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** Re-render a component when anything saved on the device changes. */
export const useOfflineVersion = () => useSyncExternalStore(subscribe, () => version);

/** Whether offline storage works in this browser (private windows often block it). */
export const supported = () => typeof indexedDB !== "undefined";

/** Load what is saved. Call once at start. */
export async function init(): Promise<void> {
  if (!supported()) return;
  try {
    const [songs, cols] = await run(["meta", "collections"], "readonly", (m, c) =>
      Promise.all([ask(m.getAll() as IDBRequest<SavedSong[]>), ask(c.getAll() as IDBRequest<CollectionRecord[]>)]));
    songs.forEach((m) => meta.set(m.id, m));
    cols.forEach((c) => collections.set(c.id, c));
    notify();
  } catch { /* offline storage unavailable: the app works without it */ }
}

// ---------------- Songs ----------------

export const isSaved = (id: string) => meta.has(id);
export const count = () => meta.size;

const asSong = (m: SavedSong): Song => ({
  id: m.id, title: m.title, artist: m.artist, album: m.album, albumId: m.albumId, artistId: m.artistId, duration: m.duration,
  mediaId: m.mediaId, kind: m.kind, size: m.size, cover: m.hasCover ? m.id : null,
});

/** Songs saved on their own (not only because a collection holds them), newest first. */
export const list = () => [...meta.values()].filter((m) => m.direct).sort((a, b) => b.savedAt - a.savedAt).map(asSong);
/** A saved song, shaped for the UI (its cover is the song's own saved picture). */
export const song = (id: string): Song | null => { const m = meta.get(id); return m ? asSong(m) : null; };
export const allSongs = () => [...meta.values()].map(asSong);

/** Trying again cannot help: the library no longer has this song. */
export class Unavailable extends Error {}
/** The device is full: the songs after this one would fail too. */
export class NoRoom extends Error {}

const STALLED_AFTER = 30_000; // a phone coming back from the background can leave a download hanging forever

async function download(item: Song, onProgress?: (percent: number) => void): Promise<Blob> {
  const stop = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const alive = () => { clearTimeout(timer); timer = setTimeout(() => stop.abort(), STALLED_AFTER); };
  alive();
  try {
    const response = await fetch(sourceUrl(item), { signal: stop.signal });
    const type = response.headers.get("content-type") ?? "";
    const problem = streamProblem(response.status, type);
    if (problem === "gone") throw new Unavailable("This song is no longer in the library");
    if (problem === "read-body") {
      if (saysNotFound(await response.json().catch(() => null))) throw new Unavailable("This song is no longer in the library");
      throw new Error("The server refused this song");
    }
    if (problem || !response.body) throw new Error("Could not download this song");
    const total = Number(response.headers.get("content-length")) || 0;
    const encoded = Boolean(response.headers.get("content-encoding"));
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      alive();
      chunks.push(value as Uint8Array<ArrayBuffer>);
      received += value.length;
      onProgress?.(total && !encoded ? (received / total) * 100 : -1);
    }
    if (cutShort(received, total, encoded)) throw new Error("The download was cut short");
    return new Blob(chunks, { type: type || "audio/mp4" });
  } finally {
    clearTimeout(timer);
  }
}

interface SaveOptions {
  ref?: string | null; // the collection holding it, if any
  direct?: boolean; // an individual save
  onProgress?: (percent: number) => void; // 0–100 for this song, or -1 when the size is unknown
}

/** Save a song to the device. */
export async function save(item: Song, { ref = null, direct = true, onProgress }: SaveOptions = {}): Promise<void> {
  const existing = meta.get(item.id);
  if (existing) { // already here: just record who holds it, with no request to the server
    const next = { ...existing, direct: existing.direct || direct, refs: [...new Set([...(existing.refs ?? []), ...(ref ? [ref] : [])])] };
    await run(["meta"], "readwrite", (m) => { m.put(next); });
    meta.set(item.id, next);
    notify();
    return;
  }
  const audio = await download(item, onProgress);
  let cover: Blob | null = null;
  if (hasCover(item)) {
    try { const r = await fetch(songCover(item, 400), { signal: AbortSignal.timeout(STALLED_AFTER) }); if (r.ok) cover = await r.blob(); } catch { /* the song is fine without art */ }
  }
  const info: SavedSong = {
    id: item.id, title: item.title, artist: item.artist, album: item.album, albumId: item.albumId, artistId: item.artistId,
    duration: item.duration, mediaId: item.mediaId, kind: item.kind, size: audio.size, savedAt: Date.now(),
    hasCover: Boolean(cover), direct, refs: ref ? [ref] : [],
  };
  await run(["meta", "audio", "covers"], "readwrite", (m, a, c) => {
    m.put(info);
    a.put({ id: item.id, blob: audio });
    if (cover) c.put({ id: item.id, blob: cover });
  }).catch((e: DOMException) => {
    throw e?.name === "QuotaExceededError" ? new NoRoom("This device is out of space for downloads") : e;
  });
  meta.set(item.id, info);
  void navigator.storage?.persist?.(); // ask the browser not to evict what we saved
  notify();
}

async function drop(id: string): Promise<void> {
  await run(["meta", "audio", "covers"], "readwrite", (m, a, c) => { m.delete(id); a.delete(id); c.delete(id); });
  meta.delete(id);
}

/** Take away an individual save. The files stay if a collection still holds the song. */
export async function remove(id: string): Promise<void> {
  const m = meta.get(id);
  if (!m) return;
  if (m.refs?.length) {
    const next = { ...m, direct: false };
    await run(["meta"], "readwrite", (store) => { store.put(next); });
    meta.set(id, next);
  } else {
    await drop(id);
  }
  notify();
}

async function release(id: string, ref: string): Promise<void> {
  const m = meta.get(id);
  if (!m) return;
  const refs = (m.refs ?? []).filter((r) => r !== ref);
  if (!refs.length && !m.direct) { await drop(id); return; }
  const next = { ...m, refs };
  await run(["meta"], "readwrite", (store) => { store.put(next); });
  meta.set(id, next);
}

const savedBlobUrl = async (store: string, id: string) => {
  const record = await run([store], "readonly", (s) => ask(s.get(id) as IDBRequest<{ blob: Blob } | undefined>)).catch(() => undefined);
  return record ? URL.createObjectURL(record.blob) : null;
};
/** A temporary URL for the saved audio. Revoke it with URL.revokeObjectURL when done. */
export const audioUrl = (id: string) => savedBlobUrl("audio", id);
/** A temporary URL for the saved cover, or null. */
export const savedCoverUrl = (id: string) => savedBlobUrl("covers", id);

// ---------------- Collections ----------------

export const collection = (id: string) => collections.get(id) ?? null;
export const isCollectionSaved = (id: string) => collections.get(id)?.complete === true;
/** Saved collections of a kind ("favorites", "playlist", "album"), newest first. */
export const collectionList = (kind?: CollectionKind) =>
  [...collections.values()].filter((c) => !kind || c.kind === kind).sort((a, b) => b.savedAt - a.savedAt);
/** The songs of a saved collection, in order. */
export const collectionSongs = (id: string) => (collections.get(id)?.songIds ?? []).map(song).filter((s): s is Song => Boolean(s));
/** Where a saved collection opens. Worked out from its ID: favorites used to be a tab with its own address. */
export const collectionRoute = (id: string) => (id === "favorites" ? "/playlist/favorites" : `/${id.replace(":", "/")}`);

async function putCollection(record: CollectionRecord): Promise<void> {
  await run(["collections"], "readwrite", (c) => { c.put(record); });
  collections.set(record.id, record);
  notify();
}

/** Whether anything of this collection can be played from the device. A long download can be under way or waiting. */
export const hasCollectionSongs = (id: string) => (collections.get(id)?.songIds ?? []).some((s) => meta.has(s));

/** Remember a collection to download and its songs, so the download survives the app closing. stores/saving.ts runs it. */
export async function beginCollection(spec: CollectionSpec, songs: Song[]): Promise<void> {
  void navigator.storage?.persist?.(); // asked while someone is tapping, which is when browsers tend to say yes
  const savedAt = collections.get(spec.id)?.savedAt ?? Date.now(); // downloading the rest keeps its place in the list
  await putCollection({ ...spec, songIds: songs.map((s) => s.id), songs, complete: false, savedAt });
}

/** Collections with a download still to finish, unless it was stopped. Records from before downloads could resume have no list and need a new tap. */
export const unfinishedCollections = () => [...collections.values()].filter((c) => !c.complete && !c.paused && c.songs?.length);

/** The songs of a collection not on this device yet. */
export const stillToSave = (id: string) => (collections.get(id)?.songs ?? []).filter((s) => !(meta.get(s.id)?.refs ?? []).includes(id));

/** Take songs the library no longer has out of a collection. */
export async function forgetFromCollection(id: string, songIds: string[]): Promise<void> {
  const record = collections.get(id);
  if (!record || !songIds.length) return;
  const gone = new Set(songIds);
  await putCollection({ ...record, songIds: record.songIds.filter((s) => !gone.has(s)), songs: record.songs?.filter((s) => !gone.has(s.id)) });
}

/** Every song arrived: the list of what to fetch is not needed any more. */
export async function finishCollection(id: string): Promise<void> {
  const record = collections.get(id);
  if (!record) return;
  const { songs: _done, ...rest } = record;
  await putCollection({ ...rest, complete: true });
}

/**
 * Make a collection follow the server's list: songs taken out of it are released, and new ones become songs to download
 * (stores/saving.ts fetches them). Returns how many songs are still to download.
 */
export async function updateCollection(id: string, songs: Song[]): Promise<number> {
  const record = collections.get(id);
  if (!record) return 0;
  const wanted = new Set(songs.map((s) => s.id));
  const gone = record.songIds.filter((x) => !wanted.has(x));
  for (const x of gone) await release(x, id);
  const missing = songs.filter((s) => !(meta.get(s.id)?.refs ?? []).includes(id)).length;
  const same = record.songIds.length === songs.length && record.songIds.every((x, i) => x === songs[i].id);
  if (same && !missing && record.complete) { if (gone.length) notify(); return 0; }
  const { songs: _list, ...rest } = record;
  const songIds = songs.map((s) => s.id);
  await putCollection(missing ? { ...rest, songIds, songs, complete: false } : { ...rest, songIds, complete: true });
  return missing;
}

/** How many of a collection's songs are on this device. */
export const heldCount = (id: string) => (collections.get(id)?.songIds ?? []).filter((s) => (meta.get(s)?.refs ?? []).includes(id)).length;

/**
 * Stop a collection's download where it got to: the songs saved so far stay. With none saved, nothing is kept; with
 * every song saved (the last one arrived as it stopped), it is simply downloaded.
 */
export async function pauseCollection(id: string): Promise<void> {
  const record = collections.get(id);
  if (!record) return;
  if (!heldCount(id)) await removeCollection(id);
  else if (!stillToSave(id).length) await finishCollection(id);
  else await putCollection({ ...record, paused: true });
}

export async function removeCollection(id: string): Promise<void> {
  const record = collections.get(id);
  if (!record) return;
  for (const songId of record.songIds) await release(songId, id);
  await run(["collections"], "readwrite", (c) => { c.delete(id); });
  collections.delete(id);
  notify();
}

/** Space used by saved songs and what the browser allows, in bytes. */
export async function usage(): Promise<{ used: number; quota: number }> {
  const used = [...meta.values()].reduce((sum, m) => sum + m.size, 0);
  const quota = (await navigator.storage?.estimate?.().catch(() => null))?.quota ?? 0;
  return { used, quota };
}
