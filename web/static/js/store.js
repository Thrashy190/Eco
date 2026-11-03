// Everything saved on this device for offline listening, in IndexedDB.
//
// Songs: audio and cover are Blobs in their own stores; a small metadata record lists them without loading audio.
// Collections: "Download" on favorites, a playlist or an album saves every song and remembers the list, so the
// collection can be shown and played offline. A song can be held by several collections and by an individual
// save at once; its files are deleted only when nothing holds it any more.
import { sourceUrl, songCover, hasCover } from "./api.js";

const DB = "eco-offline";
let dbPromise;
const meta = new Map(); // song id → metadata
const collections = new Map(); // collection id → record
const listeners = new Set();

function open() {
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

async function run(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(...stores.map((s) => tx.objectStore(s)))).then((r) => { result = r; });
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

const request = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const notify = () => listeners.forEach((fn) => fn());

/** Whether offline storage works in this browser (private windows often block it). */
export const supported = () => typeof indexedDB !== "undefined";

/** Load what is saved. Call once at start. */
export async function init() {
  if (!supported()) return;
  try {
    const [songs, cols] = await run(["meta", "collections"], "readonly", (m, c) => Promise.all([request(m.getAll()), request(c.getAll())]));
    songs.forEach((m) => meta.set(m.id, m));
    cols.forEach((c) => collections.set(c.id, c));
    notify();
  } catch { /* offline storage unavailable: the app works without it */ }
}

export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// ---------------- Songs ----------------

export const isSaved = (id) => meta.has(id);
export const count = () => meta.size;
/** Songs saved on their own (not only because a collection holds them), newest first. */
export const list = () => [...meta.values()].filter((m) => m.direct).sort((a, b) => b.savedAt - a.savedAt);
/** Metadata of any saved song, shaped for the UI (the cover is the song's own saved picture). */
export const song = (id) => { const m = meta.get(id); return m ? { ...m, cover: m.hasCover ? m.id : null } : null; };

async function download(item, onProgress) {
  const response = await fetch(sourceUrl(item));
  if (!response.ok || !response.body) throw new Error("Could not download this song");
  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(total ? (received / total) * 100 : -1);
  }
  return new Blob(chunks, { type: response.headers.get("content-type") || "audio/mp4" });
}

/**
 * Save a song to the device. `ref` is the collection holding it (if any); `direct` marks an individual save.
 * onProgress receives 0–100 for this song, or -1 when the size is unknown.
 */
export async function save(item, { ref = null, direct = true, onProgress } = {}) {
  const existing = meta.get(item.id);
  if (existing) { // already here: just record who holds it
    const next = { ...existing, direct: existing.direct || direct, refs: [...new Set([...(existing.refs ?? []), ...(ref ? [ref] : [])])] };
    await run(["meta"], "readwrite", (m) => m.put(next));
    meta.set(item.id, next);
    notify();
    return;
  }
  const audio = await download(item, onProgress);
  let cover = null;
  if (hasCover(item)) {
    try { const r = await fetch(songCover(item, 400)); if (r.ok) cover = await r.blob(); } catch { /* the song is fine without art */ }
  }
  const info = { id: item.id, title: item.title, artist: item.artist, album: item.album, albumId: item.albumId, artistId: item.artistId,
    duration: item.duration, mediaId: item.mediaId, kind: item.kind, format: item.format, size: audio.size, savedAt: Date.now(),
    hasCover: Boolean(cover), direct, refs: ref ? [ref] : [] };
  await run(["meta", "audio", "covers"], "readwrite", (m, a, c) => {
    m.put(info);
    a.put({ id: item.id, blob: audio });
    if (cover) c.put({ id: item.id, blob: cover });
  });
  meta.set(item.id, info);
  navigator.storage?.persist?.(); // ask the browser not to evict what we saved
  notify();
}

async function drop(id) {
  await run(["meta", "audio", "covers"], "readwrite", (m, a, c) => { m.delete(id); a.delete(id); c.delete(id); });
  meta.delete(id);
}

/** Take away an individual save. The files stay if a collection still holds the song. */
export async function remove(id) {
  const m = meta.get(id);
  if (!m) return;
  if (m.refs?.length) {
    const next = { ...m, direct: false };
    await run(["meta"], "readwrite", (store) => store.put(next));
    meta.set(id, next);
  } else {
    await drop(id);
  }
  notify();
}

async function release(id, ref) {
  const m = meta.get(id);
  if (!m) return;
  const refs = (m.refs ?? []).filter((r) => r !== ref);
  if (!refs.length && !m.direct) { await drop(id); return; }
  const next = { ...m, refs };
  await run(["meta"], "readwrite", (store) => store.put(next));
  meta.set(id, next);
}

/** A temporary URL for the saved audio. Revoke it with URL.revokeObjectURL when done. */
export async function audioUrl(id) {
  const rec = await run(["audio"], "readonly", (a) => request(a.get(id)));
  return rec ? URL.createObjectURL(rec.blob) : null;
}

/** A temporary URL for the saved cover, or null. */
export async function savedCoverUrl(id) {
  const rec = await run(["covers"], "readonly", (c) => request(c.get(id))).catch(() => null);
  return rec ? URL.createObjectURL(rec.blob) : null;
}

// ---------------- Collections ----------------

export const collection = (id) => collections.get(id) ?? null;
export const isCollectionSaved = (id) => collections.get(id)?.complete === true;
/** Saved collections of a kind ("favorites", "playlist", "album"), newest first. */
export const collectionList = (kind) => [...collections.values()].filter((c) => !kind || c.kind === kind).sort((a, b) => b.savedAt - a.savedAt);
/** The songs of a saved collection, in order. */
export const collectionSongs = (id) => (collections.get(id)?.songIds ?? []).map(song).filter(Boolean);

async function putCollection(rec) {
  await run(["collections"], "readwrite", (c) => c.put(rec));
  collections.set(rec.id, rec);
  notify();
}

/**
 * Download every song of a collection and remember it: spec = { id, kind, title, subtitle }.
 * onProgress receives (songsDone, songsTotal, percentOfCurrentSong).
 */
export async function saveCollection(spec, songs, onProgress) {
  let rec = { ...spec, songIds: songs.map((s) => s.id), complete: false, savedAt: Date.now() };
  await putCollection(rec);
  for (let i = 0; i < songs.length; i++) {
    onProgress?.(i, songs.length, 0);
    await save(songs[i], { ref: spec.id, direct: false, onProgress: (p) => onProgress?.(i, songs.length, p) });
  }
  rec = { ...rec, complete: true };
  await putCollection(rec);
  onProgress?.(songs.length, songs.length, 100);
}

/** Make a saved collection match the server's current list: download new songs, release removed ones. */
export async function syncCollection(id, songs, onProgress) {
  const rec = collections.get(id);
  if (!rec?.complete) return { added: 0, removed: 0 };
  const wanted = new Set(songs.map((s) => s.id));
  const gone = rec.songIds.filter((x) => !wanted.has(x));
  const fresh = songs.filter((s) => !meta.has(s.id) || !(meta.get(s.id).refs ?? []).includes(id));
  for (let i = 0; i < fresh.length; i++) {
    onProgress?.(i, fresh.length);
    await save(fresh[i], { ref: id, direct: false });
  }
  for (const x of gone) await release(x, id);
  if (fresh.length || gone.length) await putCollection({ ...rec, songIds: songs.map((s) => s.id), savedAt: rec.savedAt });
  return { added: fresh.length, removed: gone.length };
}

export async function removeCollection(id) {
  const rec = collections.get(id);
  if (!rec) return;
  for (const songId of rec.songIds) await release(songId, id);
  await run(["collections"], "readwrite", (c) => c.delete(id));
  collections.delete(id);
  notify();
}

/** Space used by saved songs and what the browser allows, in bytes. */
export async function usage() {
  const used = [...meta.values()].reduce((sum, m) => sum + m.size, 0);
  const quota = (await navigator.storage?.estimate?.().catch(() => null))?.quota ?? 0;
  return { used, quota };
}

export const megabytes = (bytes) => (bytes / 1048576 < 10 ? (bytes / 1048576).toFixed(1) : Math.round(bytes / 1048576)) + " MB";
