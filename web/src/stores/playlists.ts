// Making and changing playlists, from wherever a menu offers it. They are real Navidrome playlists, so they show up in every
// other Subsonic app too. Only the owner of a playlist can change it.
import { addToPlaylist, createPlaylist, deletePlaylist, getPlaylist, getPlaylists, removeFromPlaylist, renamePlaylist, username } from "../lib/api";
import { plural } from "../lib/format";
import { queryClient } from "../lib/query";
import type { LibraryEntry, Song } from "../lib/types";
import { forget, isPinned, togglePin } from "./library";
import * as offline from "./offline";
import { refreshSavedCollection } from "./saving";
import { openSheet, toast } from "./ui";

/** Screens showing playlists fetch them again, and a playlist kept offline follows its new songs. */
export function playlistsChanged(id?: string): void {
  void queryClient.invalidateQueries({ queryKey: ["playlists"] });
  if (!id) return;
  void queryClient.invalidateQueries({ queryKey: ["playlist", id] });
  refreshSavedCollection(`playlist:${id}`, async () => (await queryClient.fetchQuery({ queryKey: ["playlist", id], queryFn: () => getPlaylist(id), staleTime: 0 })).songs);
}

const askName = (current = "") => prompt("Playlist name", current)?.trim() ?? "";

/** The playlists this person can add songs to. Others may share theirs, but those are only for listening. */
const myPlaylists = async () => (await queryClient.fetchQuery({ queryKey: ["playlists"], queryFn: getPlaylists })).filter((p) => p.owner === username());

/**
 * Navidrome keeps a playlist imported from a .m3u file identical to that file and refuses to change its songs, even for
 * its owner, answering "not authorized". It stays in the menu, or it would look lost, and says what to do.
 */
const followsItsFile = (name: string) => `“${name}” follows its .m3u file. Turn off Auto-import for it in Navidrome to change its songs.`;

export async function openAddToPlaylist(song: Song): Promise<void> {
  let lists;
  try { lists = await myPlaylists(); } catch (e) { toast((e as Error).message); return; }
  openSheet("Add to playlist", song.title, [
    { icon: "plus", label: "New playlist", run: () => void startWith(song) },
    ...lists.map((list) => ({
      icon: "queue" as const,
      label: list.name,
      run: () => list.readonly ? toast(followsItsFile(list.name)) : void addToPlaylist(list.id, [song.id]).then(() => { playlistsChanged(list.id); toast(`Added to ${list.name}`); }).catch((e: Error) => toast(e.message)),
    })),
  ]);
}

async function startWith(song: Song): Promise<void> {
  const name = askName();
  if (!name) return;
  try {
    await createPlaylist(name, [song.id]);
    playlistsChanged();
    toast(`Added to ${name}`);
  } catch (e) { toast((e as Error).message); }
}

export async function removeSong(playlistId: string, index: number, song: Song): Promise<void> {
  try {
    await removeFromPlaylist(playlistId, index);
    playlistsChanged(playlistId);
    toast(`Removed ${song.title}`);
  } catch (e) { toast((e as Error).message); }
}

export async function rename(id: string, current: string): Promise<void> {
  const name = askName(current);
  if (!name || name === current) return;
  try {
    await renamePlaylist(id, name);
    playlistsChanged(id);
  } catch (e) { toast((e as Error).message); }
}

/** Deletes the playlist, never its songs. Returns whether it went. */
export async function remove(entry: LibraryEntry, songCount: number, pins: LibraryEntry[]): Promise<boolean> {
  if (!confirm(`Delete “${entry.name}”?\n\nThe ${plural(songCount, "song")} stay in your library. This also removes the playlist from every other app.`)) return false;
  try {
    await deletePlaylist(entry.id);
    if (offline.collection(`playlist:${entry.id}`)) await offline.removeCollection(`playlist:${entry.id}`);
    if (isPinned(pins, entry)) await togglePin(entry);
    await forget(entry);
    playlistsChanged(entry.id);
    toast(`Deleted ${entry.name}`);
    return true;
  } catch (e) {
    toast((e as Error).message);
    return false;
  }
}
