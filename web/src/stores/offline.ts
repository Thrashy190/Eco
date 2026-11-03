// Everything saved on this device for offline listening, in IndexedDB.
//
// Songs: audio and cover are Blobs in their own stores; a small metadata record lists them without loading audio.
// Collections: "Download" on favorites, a playlist or an album saves every song and remembers the list, so the
// collection can be shown and played offline. A song can be held by several collections and by an individual
// save at once; its files are deleted only when nothing holds it any more.
import { useSyncExternalStore } from "react";
import { hasCover, songCover, sourceUrl } from "../lib/api";
import { megabytes } from "../lib/format";
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

async function download(item: Song, onProgress?: (percent: number) => void): Promise<Blob> {
  const response = await fetch(sourceUrl(item));
  if (!response.ok || !response.body) throw new Error("Could not download this song");
  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array<ArrayBuffer>);
    received += value.length;
    onProgress?.(total ? (received / total) * 100 : -1);
  }
  return new Blob(chunks, { type: response.headers.get("content-type") || "audio/mp4" });
}

interface SaveOptions {
  ref?: string | null; // the collection holding it, if any
  direct?: boolean; // an individual save
  onProgress?: (percent: number) => void; // 0–100 for this song, or -1 when the size is unknown
}

/** Save a song to the device. */
export async function save(item: Song, { ref = null, direct = true, onProgress }: SaveOptions = {}): Promise<void> {
  const existing = meta.get(item.id);
  if (existing) { // already here: just record who holds it
    const next = { ...existing, direct: existing.direct || direct, refs: [...new Set([...(existing.refs ?? []), ...(ref ? [ref] : [])])] };
    await run(["meta"], "readwrite", (m) => { m.put(next); });
    meta.set(item.id, next);
    notify();
    return;
  }
  const audio = await download(item, onProgress);
  let cover: Blob | null = null;
  if (hasCover(item)) {
    try { const r = await fetch(songCover(item, 400)); if (r.ok) cover = await r.blob(); } catch { /* the song is fine without art */ }
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

/** Download every song of a collection and remember it. onProgress receives (songsDone, songsTotal, percentOfCurrentSong). */
export async function saveCollection(spec: CollectionSpec, songs: Song[], onProgress?: (done: number, total: number, percent: number) => void): Promise<void> {
  let record: CollectionRecord = { ...spec, songIds: songs.map((s) => s.id), complete: false, savedAt: Date.now() };
  await putCollection(record);
  for (let i = 0; i < songs.length; i++) {
    onProgress?.(i, songs.length, 0);
    await save(songs[i], { ref: spec.id, direct: false, onProgress: (p) => onProgress?.(i, songs.length, p) });
  }
  record = { ...record, complete: true };
  await putCollection(record);
  onProgress?.(songs.length, songs.length, 100);
}

/** Make a saved collection match the server's current list: download new songs, release removed ones. */
export async function syncCollection(id: string, songs: Song[], onProgress?: (done: number, total: number) => void): Promise<{ added: number; removed: number }> {
  const record = collections.get(id);
  if (!record?.complete) return { added: 0, removed: 0 };
  const wanted = new Set(songs.map((s) => s.id));
  const gone = record.songIds.filter((x) => !wanted.has(x));
  const fresh = songs.filter((s) => !(meta.get(s.id)?.refs ?? []).includes(id));
  for (let i = 0; i < fresh.length; i++) {
    onProgress?.(i, fresh.length);
    await save(fresh[i], { ref: id, direct: false });
  }
  for (const x of gone) await release(x, id);
  if (fresh.length || gone.length) await putCollection({ ...record, songIds: songs.map((s) => s.id) });
  return { added: fresh.length, removed: gone.length };
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
