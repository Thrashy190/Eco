// Favorites are Navidrome's stars. A song object can be held by many screens at once, so what changed since it
// was fetched is kept here and every heart reads through it.
import { create } from "zustand";
import { favoritePlaylist, favoriteSongs, getStarred, star, unstar } from "../lib/api";
import { plural } from "../lib/format";
import { queryClient } from "../lib/query";
import type { Song } from "../lib/types";
import { FAVORITES_ID } from "./library";
import { refreshSavedCollection } from "./saving";
import { toast } from "./ui";

const useOverrides = create<{ starred: Record<string, boolean> }>(() => ({ starred: {} }));

export const isStarred = (song: Song) => useOverrides.getState().starred[song.id] ?? Boolean(song.starred);
export const useStarred = (song: Song | null) => useOverrides((s) => (song ? s.starred[song.id] ?? Boolean(song.starred) : false));
/** Whether every song of a list is a favorite. */
export const useAllStarred = (songs: Song[]) => useOverrides((s) => songs.length > 0 && songs.every((song) => s.starred[song.id] ?? Boolean(song.starred)));

/** Ask for the favorites again, here and in their copy on this device. */
function refreshFavorites(): void {
  void queryClient.invalidateQueries({ queryKey: ["favorites"] });
  refreshSavedCollection(FAVORITES_ID, () => queryClient.fetchQuery({ queryKey: ["favorites"], queryFn: getStarred, staleTime: 0 }));
}

/** Add or remove a song from the favorites. */
export async function toggleFavorite(song: Song): Promise<void> {
  const on = !isStarred(song);
  const set = (value: boolean) => useOverrides.setState((s) => ({ starred: { ...s.starred, [song.id]: value } }));
  set(on);
  try {
    await (on ? star(song.id) : unstar(song.id));
    toast(on ? "Added to favorites" : "Removed from favorites");
    refreshFavorites();
  } catch (e) {
    set(!on);
    toast((e as Error).message);
  }
}

/**
 * Make every song of a list a favorite. The server stars them from the bottom up, so Favorites reads like the list;
 * songs that already are favorites are skipped and keep their place. Nothing is ever taken out.
 */
async function starAll(songs: Song[], run: () => Promise<{ added: number }>): Promise<void> {
  try {
    const { added } = await run();
    useOverrides.setState((s) => ({ starred: { ...s.starred, ...Object.fromEntries(songs.map((song) => [song.id, true])) } }));
    toast(added > 0 ? `Added ${plural(added, "song")} to favorites` : "These songs are already in your favorites");
    refreshFavorites();
  } catch (e) {
    toast((e as Error).message);
  }
}

/** Every song of a playlist, read by the server, so a long one does not travel in the request. */
export async function favoriteAll(playlistId: string, songs: Song[]): Promise<void> {
  await starAll(songs, () => favoritePlaylist(playlistId));
  void queryClient.invalidateQueries({ queryKey: ["playlist", playlistId] });
}

/** Every song of an album, as its page lists them. Imported audio is not music of the library and stays out. */
export function favoriteAlbum(songs: Song[]): Promise<void> {
  const music = songs.filter((s) => !s.mediaId);
  return starAll(music, () => favoriteSongs(music.map((s) => s.id)));
}
