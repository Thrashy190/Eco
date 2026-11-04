// Saving to the device as the user sees it, and the queue behind it. A long download outlives a bad moment: what is left
// is remembered on the device, a failed song is tried again, and a song that cannot be fetched does not stop the others.
// iPhones freeze a web app in the background, so there the queue carries on when the app comes back.
import { create } from "zustand";
import { retryDelay } from "../lib/retry";
import type { CollectionSpec, Song } from "../lib/types";
import * as offline from "./offline";
import { isOnline } from "./settings";
import { toast } from "./ui";

export interface CollectionProgress {
  done: number;
  total: number;
  percent: number;
  waiting?: boolean; // no connection, or the server is not answering: it carries on by itself
}

interface Saving {
  songs: Record<string, number>; // song ID → percent
  collections: Record<string, CollectionProgress>;
}

export const useSaving = create<Saving>(() => ({ songs: {}, collections: {} }));

function setSong(id: string, percent: number | null): void {
  useSaving.setState((state) => {
    const songs = { ...state.songs };
    if (percent === null) delete songs[id]; else songs[id] = percent;
    return { songs };
  });
}

function setCollection(id: string, progress: CollectionProgress | null): void {
  useSaving.setState((state) => {
    const collections = { ...state.collections };
    if (progress === null) delete collections[id]; else collections[id] = progress;
    return { collections };
  });
}

// ---- The queue ----

const SONGS_KEY = "eco.saving.songs"; // single songs waiting; a collection keeps its own list in IndexedDB
const LOCK = "eco-saving"; // two tabs must not download the same songs
const ATTEMPTS = 3;
const IN_A_ROW = 3; // this many songs failing one after another means the server, not the songs
const STALL_WAIT = 30_000;
const STALLS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let waitingSongs: Song[] = [];
const queue: string[] = []; // collections waiting
let currentCollection: string | null = null;
const cancelled = new Set<string>();
let pumping = false;
let halted = true; // signed out, or not started yet
let outOfRoom = false;

const rememberSongs = () => { try { localStorage.setItem(SONGS_KEY, JSON.stringify(waitingSongs)); } catch { /* it just will not survive closing the app */ } };
function recallSongs(): Song[] {
  try { return JSON.parse(localStorage.getItem(SONGS_KEY) ?? "[]") as Song[]; } catch { return []; }
}

// ---- Keeping the screen on: an iPhone that locks stops the download ----

let screen: WakeLockSentinel | null = null;
async function holdScreen(): Promise<void> {
  if (screen || document.hidden || !navigator.wakeLock) return;
  try {
    const lock = await navigator.wakeLock.request("screen");
    lock.addEventListener("release", () => { if (screen === lock) screen = null; });
    screen = lock;
  } catch { /* refused, for example on low battery: it only means the screen may lock */ }
}
function letScreenGo(): void {
  void screen?.release().catch(() => undefined);
  screen = null;
}

type Outcome = "saved" | "gone" | "failed";

/** Save one song, trying again as long as that can help. Time in the background or offline does not count as failing. */
async function patiently(song: Song, options: Parameters<typeof offline.save>[1], onWaiting?: (waiting: boolean) => void): Promise<Outcome> {
  for (let tries = 0; !halted;) {
    if (!isOnline()) {
      onWaiting?.(true);
      letScreenGo();
      while (!isOnline() && !halted) await sleep(1000);
      void holdScreen();
      onWaiting?.(false);
      continue;
    }
    try {
      await offline.save(song, options);
      return "saved";
    } catch (e) {
      if (e instanceof offline.Unavailable) return "gone";
      if (e instanceof offline.NoRoom) throw e;
      const counts = !document.hidden && isOnline(); // an iPhone cuts downloads off when the app leaves the screen
      if (counts && ++tries >= ATTEMPTS) return "failed";
      await sleep(retryDelay(counts ? tries - 1 : 0));
    }
  }
  return "failed";
}

async function saveWaitingSongs(): Promise<void> {
  while (waitingSongs.length && !halted) {
    const song = waitingSongs[0];
    const outcome = await patiently(song, { onProgress: (percent) => setSong(song.id, percent) });
    if (halted) return;
    waitingSongs = waitingSongs.slice(1);
    rememberSongs();
    setSong(song.id, null);
    if (outcome === "saved") toast(`Saved “${song.title}” for offline`);
    else if (outcome === "gone") toast(`“${song.title}” is no longer in the library`);
    else toast(`Could not save “${song.title}”. Check your connection`);
  }
}

async function runCollection(id: string): Promise<void> {
  const record = offline.collection(id);
  if (!record?.songs) return;
  const total = record.songs.length;
  const todo = offline.stillToSave(id);
  const show = (done: number, percent: number, waiting = false) => { if (!cancelled.has(id)) setCollection(id, { done, total, percent, waiting }); };
  const gone: string[] = [];
  let failed: Song[] = [];
  let inARow = 0;
  let stalls = 0;
  let stuck = false;
  for (let i = 0; i < todo.length; i++) {
    await saveWaitingSongs();
    if (halted || cancelled.has(id)) break;
    const done = total - todo.length + i;
    show(done, 0);
    const outcome = await patiently(todo[i], { ref: id, direct: false, onProgress: (percent) => show(done, percent) }, (waiting) => show(done, 0, waiting));
    if (halted || cancelled.has(id)) break;
    if (outcome === "gone") gone.push(todo[i].id);
    if (outcome !== "failed") { inARow = 0; stalls = 0; continue; }
    failed.push(todo[i]);
    if (++inARow < IN_A_ROW) continue;
    if (++stalls >= STALLS) { stuck = true; break; }
    // Several in a row: the server is having trouble. Wait, then go back to those songs
    i -= IN_A_ROW;
    failed = failed.slice(0, -IN_A_ROW);
    inARow = 0;
    show(done, 0, true);
    letScreenGo();
    await sleep(STALL_WAIT);
    void holdScreen();
  }
  if (cancelled.has(id)) {
    await offline.removeCollection(id);
    cancelled.delete(id);
    setCollection(id, null);
    return;
  }
  if (halted) return;
  await offline.forgetFromCollection(id, gone);
  const title = record.title;
  if (stuck) {
    toast(`“${title}” stopped: the server is not answering. It carries on when you come back`);
  } else if (failed.length) {
    toast(`${failed.length === 1 ? "1 song" : `${failed.length} songs`} of “${title}” could not be downloaded. Tap Resume to try again`);
  } else {
    await offline.finishCollection(id);
    toast(gone.length ? `“${title}” is ready offline. ${gone.length === 1 ? "1 song is" : `${gone.length} songs are`} no longer in the library` : `“${title}” is ready offline`);
  }
}

function clearQueue(): void {
  waitingSongs.forEach((song) => setSong(song.id, null));
  waitingSongs = [];
  rememberSongs();
  queue.splice(0).forEach((id) => setCollection(id, null));
  if (currentCollection) setCollection(currentCollection, null);
}

async function pump(): Promise<void> {
  if (pumping || halted) return;
  pumping = true;
  void holdScreen();
  const work = async () => {
    for (;;) {
      await saveWaitingSongs();
      if (halted) return;
      const id = queue.shift();
      if (!id) { if (waitingSongs.length) continue; return; }
      currentCollection = id;
      await runCollection(id);
      setCollection(id, null);
      currentCollection = null;
    }
  };
  try {
    if (navigator.locks) await navigator.locks.request(LOCK, work); else await work();
  } catch (e) {
    if (e instanceof offline.NoRoom) outOfRoom = true;
    toast((e as Error).message);
    clearQueue();
  } finally {
    currentCollection = null;
    pumping = false;
    letScreenGo();
  }
}

function queueCollection(id: string): void {
  const record = offline.collection(id);
  if (!record?.songs || queue.includes(id) || currentCollection === id) return;
  queue.push(id);
  setCollection(id, { done: record.songs.length - offline.stillToSave(id).length, total: record.songs.length, percent: 0 });
}

/** Pick up whatever is unfinished, unless another tab is already at it. */
async function resume(): Promise<void> {
  if (halted || outOfRoom || !isOnline()) return;
  if (!pumping && navigator.locks) {
    const { held } = await navigator.locks.query();
    if (held?.some((lock) => lock.name === LOCK)) return;
  }
  offline.unfinishedCollections().forEach((c) => { if (!cancelled.has(c.id)) queueCollection(c.id); });
  void pump();
}

/** Start the queue once what is saved has loaded. Returns how to stop it, for signing out. */
export function watchSaving(): () => void {
  halted = false;
  waitingSongs = recallSongs().filter((song) => !offline.isSaved(song.id));
  rememberSongs();
  waitingSongs.forEach((song) => setSong(song.id, 0));
  const onVisible = () => { if (document.hidden) return; if (pumping) void holdScreen(); void resume(); };
  const onOnline = () => void resume();
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onOnline);
  void resume();
  return () => {
    halted = true;
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onOnline);
    const keep = waitingSongs; // the list stays for next time; only what is on screen goes
    clearQueue();
    waitingSongs = keep;
    rememberSongs();
    letScreenGo();
  };
}

// ---- What the screens call ----

export function saveOffline(song: Song): void {
  if (offline.isSaved(song.id) || song.id in useSaving.getState().songs) return;
  if (!offline.supported()) { toast("Offline storage is not available in this browser"); return; }
  if (!isOnline()) { toast("Connect to the internet to download"); return; }
  outOfRoom = false;
  waitingSongs = [...waitingSongs, song];
  rememberSongs();
  setSong(song.id, 0);
  void pump();
}

export async function removeOffline(song: Song): Promise<void> {
  await offline.remove(song.id);
  toast("Removed from this device");
}

/** The Download / Resume / Downloaded button on a collection. Stopping and removing ask first. */
export async function toggleCollection(spec: CollectionSpec, songs: Song[]): Promise<void> {
  if (cancelled.has(spec.id)) return;
  if (queue.includes(spec.id) || currentCollection === spec.id) {
    if (!confirm(`Stop downloading “${spec.title}”? What it saved so far is removed.`)) return;
    setCollection(spec.id, null);
    const waiting = queue.indexOf(spec.id);
    if (waiting >= 0) {
      queue.splice(waiting, 1);
      await offline.removeCollection(spec.id);
    } else {
      cancelled.add(spec.id);
    }
    toast("Download stopped");
    return;
  }
  if (spec.id in useSaving.getState().collections) return; // quietly catching up with new songs
  if (offline.isCollectionSaved(spec.id)) {
    if (confirm(`Remove “${spec.title}” from this device?`)) { await offline.removeCollection(spec.id); toast("Download removed"); }
    return;
  }
  if (!offline.supported()) { toast("Offline storage is not available in this browser"); return; }
  if (!isOnline()) { toast("Connect to the internet to download"); return; }
  if (!songs.length) { toast("Nothing to download yet"); return; }
  outOfRoom = false;
  await offline.beginCollection(spec, songs);
  queueCollection(spec.id);
  void pump();
}

/** When a downloaded collection is opened online, quietly fetch what is new and drop what was removed. */
export async function syncCollectionIfSaved(id: string, songs: Song[]): Promise<void> {
  if (!offline.isCollectionSaved(id) || id in useSaving.getState().collections || !isOnline()) return;
  setCollection(id, { done: 0, total: songs.length, percent: 0 });
  try {
    const { added } = await offline.syncCollection(id, songs, (done, total) => setCollection(id, { done, total, percent: 0 }));
    if (added) toast(`${added} new ${added === 1 ? "song" : "songs"} downloaded`);
  } catch { /* try again next time */ }
  setCollection(id, null);
}
