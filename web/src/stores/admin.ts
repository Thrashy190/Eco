// What only administrators can do. Being admin decides what the app offers; the server checks again on every action.
import { deleteSong } from "../lib/api";
import { queryClient } from "../lib/query";
import type { Song } from "../lib/types";
import * as offline from "./offline";
import { forgetSong } from "./player";
import { toast } from "./ui";

export const ME_KEY = ["whoami"];

export const isAdmin = () => queryClient.getQueryData<{ admin: boolean }>(ME_KEY)?.admin === true;

/** Everything that can list a song. */
export const SONG_LISTS = ["songs", "songs-total", "favorites", "album", "albums", "artist", "artist-songs", "artists", "playlist", "playlists", "catalog-album", "home", "search", "me", "discover", "artists-index", "import", "imports"];

/** Erase a song's file from the server, for every user. */
export async function deleteSongForEveryone(song: Song): Promise<void> {
  if (!confirm(`Delete “${song.title}” by ${song.artist} for everyone?\n\nThe file is erased from the server. This cannot be undone.`)) return;
  toast(`Deleting “${song.title}”…`);
  try {
    await deleteSong(song.id);
  } catch (e) {
    toast((e as Error).message);
    return;
  }
  forgetSong(song.id);
  await offline.remove(song.id).catch(() => undefined);
  for (const key of SONG_LISTS) void queryClient.invalidateQueries({ queryKey: [key] });
  toast(`Deleted “${song.title}”`);
}
