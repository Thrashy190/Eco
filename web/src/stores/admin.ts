// What only administrators can do. Being admin decides what the app offers; the server checks again on every action.
import { create } from "zustand";
import { deleteSong, HttpError } from "../lib/api";
import { queryClient } from "../lib/query";
import type { Song } from "../lib/types";
import * as offline from "./offline";
import { forgetSong } from "./player";
import { toast } from "./ui";

export const ME_KEY = ["whoami"];

export const isAdmin = () => queryClient.getQueryData<{ admin: boolean }>(ME_KEY)?.admin === true;

/** Everything that can list a song. */
export const SONG_LISTS = ["songs", "songs-total", "favorites", "album", "albums", "artist", "artist-songs", "artists", "playlist", "playlists", "catalog-album", "home", "search", "me", "discover", "artists-index", "import", "imports"];

// ---- Confirming the password ----
// Some actions need Navidrome's own API, which only opens with a password. The server keeps that session for 15
// minutes and answers 428 when there is none; the app then asks (components/PasswordPrompt.tsx) and tries again.

export const usePasswordAsk = create<{ reason: string; answer: ((unlocked: boolean) => void) | null }>(() => ({ reason: "", answer: null }));

/** Ask the administrator for their password. True once the server has the session, false if they cancel. */
export function confirmPassword(reason: string): Promise<boolean> {
  usePasswordAsk.getState().answer?.(false); // a question already open is cancelled, never left hanging
  return new Promise((resolve) => usePasswordAsk.setState({ reason, answer: resolve }));
}

/** Run an action; if the server first wants the password, ask for it and run the action once more. Null if cancelled. */
export async function withPassword<T>(run: () => Promise<T>, reason: string): Promise<T | null> {
  try {
    return await run();
  } catch (e) {
    if (!(e instanceof HttpError && e.status === 428)) throw e;
  }
  if (!(await confirmPassword(reason))) return null;
  return run();
}

export const DELETE_REASON = "Navidrome asks for your password before Eco can remove songs from it completely. You will not be asked again for 15 minutes.";

/** Erase a song's file from the server and have Navidrome forget it, for every user. */
export async function deleteSongForEveryone(song: Song): Promise<void> {
  if (!confirm(`Delete “${song.title}” by ${song.artist} for everyone?\n\nThe file is erased from the server. This cannot be undone.`)) return;
  let result: Awaited<ReturnType<typeof deleteSong>> | null;
  try {
    result = await withPassword(() => {
      toast(`Deleting “${song.title}”…`);
      return deleteSong(song.id);
    }, DELETE_REASON);
  } catch (e) {
    toast((e as Error).message);
    return;
  }
  if (!result) return;
  forgetSong(song.id);
  await offline.remove(song.id).catch(() => undefined);
  for (const key of SONG_LISTS) void queryClient.invalidateQueries({ queryKey: [key] });
  toast(result.purged ? `Deleted “${song.title}”` : `Deleted “${song.title}”. Navidrome still lists it under Missing Files`);
}
