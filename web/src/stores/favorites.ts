// Favorites are Navidrome's stars. A song object can be held by many screens at once, so what changed since it
// was fetched is kept here and every heart reads through it.
import { create } from "zustand";
import { getStarred, star, unstar } from "../lib/api";
import { queryClient } from "../lib/query";
import type { Song } from "../lib/types";
import { FAVORITES_ID } from "./library";
import { refreshSavedCollection } from "./saving";
import { toast } from "./ui";

const useOverrides = create<{ starred: Record<string, boolean> }>(() => ({ starred: {} }));

export const isStarred = (song: Song) => useOverrides.getState().starred[song.id] ?? Boolean(song.starred);
export const useStarred = (song: Song | null) => useOverrides((s) => (song ? s.starred[song.id] ?? Boolean(song.starred) : false));

/** Add or remove a song from the favorites. */
export async function toggleFavorite(song: Song): Promise<void> {
  const on = !isStarred(song);
  const set = (value: boolean) => useOverrides.setState((s) => ({ starred: { ...s.starred, [song.id]: value } }));
  set(on);
  try {
    await (on ? star(song.id) : unstar(song.id));
    toast(on ? "Added to favorites" : "Removed from favorites");
    void queryClient.invalidateQueries({ queryKey: ["favorites"] });
    refreshSavedCollection(FAVORITES_ID, () => queryClient.fetchQuery({ queryKey: ["favorites"], queryFn: getStarred, staleTime: 0 }));
  } catch (e) {
    set(!on);
    toast((e as Error).message);
  }
}
