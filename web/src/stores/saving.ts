// Saving to the device as the user sees it: which songs and collections are on their way, and the messages.
import { create } from "zustand";
import type { CollectionSpec, Song } from "../lib/types";
import * as offline from "./offline";
import { isOnline } from "./settings";
import { toast } from "./ui";

export interface CollectionProgress { done: number; total: number; percent: number }

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

export async function saveOffline(song: Song): Promise<void> {
  if (offline.isSaved(song.id) || song.id in useSaving.getState().songs) return;
  if (!offline.supported()) { toast("Offline storage is not available in this browser"); return; }
  setSong(song.id, 0);
  try {
    await offline.save(song, { onProgress: (percent) => setSong(song.id, percent) });
    toast(`Saved “${song.title}” for offline`);
  } catch (e) {
    toast((e as Error).message);
  } finally {
    setSong(song.id, null);
  }
}

export async function removeOffline(song: Song): Promise<void> {
  await offline.remove(song.id);
  toast("Removed from this device");
}

/** The Download / Downloaded button on a collection. Saved collections ask before removing. */
export async function toggleCollection(spec: CollectionSpec, songs: Song[]): Promise<void> {
  if (spec.id in useSaving.getState().collections) return;
  if (offline.isCollectionSaved(spec.id)) {
    if (confirm(`Remove “${spec.title}” from this device?`)) { await offline.removeCollection(spec.id); toast("Download removed"); }
    return;
  }
  if (!offline.supported()) { toast("Offline storage is not available in this browser"); return; }
  if (!isOnline()) { toast("Connect to the internet to download"); return; }
  if (!songs.length) { toast("Nothing to download yet"); return; }
  setCollection(spec.id, { done: 0, total: songs.length, percent: 0 });
  try {
    await offline.saveCollection(spec, songs, (done, total, percent) => setCollection(spec.id, { done, total, percent }));
    toast(`“${spec.title}” is ready offline`);
  } catch (e) {
    toast(`Download stopped: ${(e as Error).message}`);
  }
  setCollection(spec.id, null);
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
