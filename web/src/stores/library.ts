// The user's library as Spotify shows it: what they opened recently and what they pinned. It lives on the server
// so every device agrees, with a copy on this device for when there is no connection.
import { useQuery } from "@tanstack/react-query";
import * as api from "../lib/api";
import { queryClient } from "../lib/query";
import type { Album, ExternalAlbum, LibraryEntry, LibraryState, Song } from "../lib/types";
import { isOnline, useOnline } from "./settings";
import { toast } from "./ui";

export const FAVORITES_ID = "favorites";
const KEY = ["me", "library"];
const EMPTY: LibraryState = { recents: [], pins: [], covers: {} };

const cacheKey = () => `eco.library.${api.username()}`;
/** An answer cut short reaches here as {}. Saved as the copy on this device, it blanked the app on every launch. */
export const isLibraryState = (value: unknown): value is LibraryState => {
  const state = value as LibraryState | null;
  return Array.isArray(state?.recents) && Array.isArray(state?.pins) && typeof state?.covers === "object" && state.covers !== null;
};

function readCache(): LibraryState {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(cacheKey()) ?? "null");
    return isLibraryState(saved) ? saved : EMPTY;
  } catch {
    return EMPTY;
  }
}
function writeCache(state: LibraryState): void {
  try { localStorage.setItem(cacheKey(), JSON.stringify(state)); } catch { /* storage unavailable */ }
}

export function useLibraryState(): LibraryState {
  const online = useOnline();
  const { data } = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const state = await api.getLibrary();
      if (!isLibraryState(state)) throw new Error("The server's answer was cut short");
      writeCache(state);
      return state;
    },
    enabled: online,
    initialData: readCache,
    initialDataUpdatedAt: 0, // the copy on this device is shown right away, then refreshed
  });
  return data ?? EMPTY;
}

const currentState = () => queryClient.getQueryData<LibraryState>(KEY) ?? readCache();
const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });
const patch = (change: Partial<LibraryState>) => { const next = { ...currentState(), ...change }; queryClient.setQueryData(KEY, next); writeCache(next); };

const sameEntry = (a: LibraryEntry, b: LibraryEntry) => a.type === b.type && a.id === b.id;
export const isPinned = (pins: LibraryEntry[], entry: LibraryEntry) => pins.some((p) => sameEntry(p, entry));

/** Remember that something was opened or played. Failing is harmless: it only affects the Recent view. */
export function touch(entry: LibraryEntry): void {
  if (!isOnline()) return;
  api.touchRecent(entry).then(refresh).catch(() => undefined);
}

export async function togglePin(entry: LibraryEntry): Promise<void> {
  const { pins } = currentState();
  const pinned = isPinned(pins, entry);
  patch({ pins: pinned ? pins.filter((p) => !sameEntry(p, entry)) : [entry, ...pins] }); // answer at once
  try {
    await (pinned ? api.removePin(entry) : api.addPin(entry));
    toast(pinned ? "Unpinned" : "Pinned to your library");
  } catch (e) {
    patch({ pins }); // put it back
    toast((e as Error).message);
  }
  void refresh();
}

export async function forget(entry: LibraryEntry): Promise<void> {
  const { recents } = currentState();
  patch({ recents: recents.filter((r) => !sameEntry(r, entry)) });
  try {
    await api.forgetRecent(entry);
  } catch (e) {
    patch({ recents });
    toast((e as Error).message);
  }
}

export async function setPlaylistCover(id: string, picture: Blob): Promise<void> {
  const state = await api.uploadPlaylistCover(id, picture);
  patch({ covers: state.covers });
}

export async function removePlaylistCover(id: string): Promise<void> {
  const state = await api.deletePlaylistCover(id);
  patch({ covers: state.covers });
}

export async function setAvatar(picture: Blob): Promise<void> {
  patch({ avatar: (await api.uploadAvatar(picture)).avatar });
}

export async function removeAvatar(): Promise<void> {
  patch({ avatar: (await api.deleteAvatar()).avatar });
}

// ---- Building entries ----

export const favoritesEntry = (count?: number): LibraryEntry => ({
  type: "playlist", id: FAVORITES_ID, name: "Favorites", subtitle: count === undefined ? "Playlist" : `Playlist · ${count} ${count === 1 ? "song" : "songs"}`,
});
export const playlistEntry = (p: { id: string; name: string; cover?: string }, count: number): LibraryEntry => ({
  type: "playlist", id: p.id, name: p.name, subtitle: `Playlist · ${count} ${count === 1 ? "song" : "songs"}`, cover: p.cover,
});
export const albumEntry = (a: Album): LibraryEntry => ({ type: "album", id: a.id, name: a.name, subtitle: `Album · ${a.artist}`, cover: a.cover });
export const artistEntry = (a: { id: string; name: string; cover?: string }): LibraryEntry => ({ type: "artist", id: a.id, name: a.name, subtitle: "Artist", cover: a.cover });
export const catalogAlbumEntry = (a: ExternalAlbum): LibraryEntry => ({
  type: "catalog_album", id: a.id, name: a.name, subtitle: `Album · ${a.artist}`, cover_url: a.cover_url,
});
export const songEntry = (s: Song): LibraryEntry => ({
  type: "song", id: s.id, name: s.title, subtitle: `Song · ${s.artist}`, cover: s.cover ?? undefined,
  artist: s.artist, artist_id: s.artistId, album: s.album, album_id: s.albumId, duration: s.duration,
});
/** A pinned song, ready to play. */
export const entrySong = (e: LibraryEntry): Song => ({
  id: e.id, title: e.name, artist: e.artist ?? "", artistId: e.artist_id, album: e.album, albumId: e.album_id, duration: e.duration, cover: e.cover,
});

export function entryRoute(entry: LibraryEntry): string | null {
  switch (entry.type) {
    case "playlist": return `/playlist/${entry.id}`;
    case "album": return `/album/${entry.id}`;
    case "artist": return `/artist/${entry.id}`;
    case "catalog_album": return `/catalog-album/${entry.id}`;
    // Saved when the catalogue was Spotify: its ID means nothing now, but the name still finds the album
    case "spotify_album": return `/album-lookup?name=${encodeURIComponent(entry.name)}&artist=${encodeURIComponent((entry.subtitle ?? "").replace(/^Album · /, ""))}`;
    case "song": return null; // a song plays instead of opening
  }
}

/** Pinned first, then recents, each item once. Favorites always leads, as Liked Songs does on Spotify. */
export function libraryRows(state: LibraryState, favorites: LibraryEntry): { entry: LibraryEntry; pinned: boolean }[] {
  const rows = [{ entry: favorites, pinned: true }];
  const seen = new Set([identity(favorites)]);
  for (const [list, pinned] of [[state.pins, true], [state.recents, false]] as const) {
    for (const entry of list) {
      const key = identity(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ entry, pinned });
    }
  }
  return rows;
}

/** An album can be opened from the library or from the catalogue, with different IDs. To the user it is one album. */
function identity(entry: LibraryEntry): string {
  const isAlbum = entry.type === "album" || entry.type === "catalog_album" || entry.type === "spotify_album";
  return isAlbum ? `album/${entry.name}/${entry.subtitle}`.toLowerCase() : `${entry.type}/${entry.id}`;
}
