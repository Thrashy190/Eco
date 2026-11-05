// Your whole library always at hand, in the deck beside the page.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { getPlaylists, getStarred } from "../lib/api";
import type { EntryType, LibraryEntry } from "../lib/types";
import { ui } from "../lib/ui";
import { entryRoute, entrySong, favoritesEntry, FAVORITES_ID, libraryRows, playlistEntry, useLibraryState } from "../stores/library";
import * as offline from "../stores/offline";
import * as player from "../stores/player";
import { useOnline } from "../stores/settings";
import { availableOffline, EntryArt } from "../views/Library";
import { Icon } from "./Icon";

const KINDS: [string, string, EntryType[] | null][] = [
  ["all", "All", null],
  ["playlist", "Playlists", ["playlist"]],
  ["album", "Albums", ["album", "catalog_album", "spotify_album"]],
  ["artist", "Artists", ["artist"]],
];

function LibraryRow({ entry, pinned }: { entry: LibraryEntry; pinned: boolean }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const route = entryRoute(entry);
  return (
    <li title={entry.name} data-on={route === pathname || undefined}
      className="tap flex items-center gap-3 p-1.5 rounded-[14px] cursor-pointer hover:bg-ghost data-on:bg-ghost"
      onClick={() => { if (route) navigate(route); else player.play([entrySong(entry)], 0); }}>
      <EntryArt entry={entry} />
      <div className="flex-1 min-w-0 grid [&>*]:truncate [&>b]:font-[650] [&>b]:text-[.95rem] [&>span]:text-muted [&>span]:text-[.8rem]">
        <b>{entry.name}</b>
        <span>{pinned && entry.id !== FAVORITES_ID && <span className={ui.pinMark}><Icon name="pin-fill" size={12} /></span>}{entry.subtitle}</span>
      </div>
    </li>
  );
}

export function LibraryPanel() {
  const online = useOnline();
  const [kind, setKind] = useState("all");
  const state = useLibraryState();
  offline.useOfflineVersion();
  const { data: favorites } = useQuery({ queryKey: ["favorites"], queryFn: getStarred, enabled: online });
  const { data: playlists } = useQuery({ queryKey: ["playlists"], queryFn: getPlaylists, enabled: online });

  const rows = libraryRows(state, favoritesEntry(favorites?.length ?? offline.collection(FAVORITES_ID)?.songIds.length));
  // Every playlist belongs here, opened lately or not
  for (const list of playlists ?? []) {
    if (!rows.some(({ entry }) => entry.type === "playlist" && entry.id === list.id)) rows.push({ entry: playlistEntry(list, list.songCount), pinned: false });
  }
  const types = KINDS.find(([id]) => id === kind)?.[2];
  const shown = rows.filter(({ entry }) => (!types || types.includes(entry.type)) && (online || availableOffline(entry)));

  return (
    <section className="flex-1 min-h-0 flex flex-col" aria-label="Your library">
      <div className="flex-none flex items-center gap-1 px-2.5 pb-2 overflow-x-auto no-scrollbar" role="group" aria-label="Show">
        {KINDS.map(([id, label]) => <button key={id} type="button" className={`${ui.chip} px-3! py-1.5! text-[.78rem]! whitespace-nowrap`} aria-pressed={kind === id} onClick={() => setKind(id)}>{label}</button>)}
        {online && <Link className={`${ui.iconButton} size-8! ml-auto`} to="/import" title="Import a playlist" aria-label="Import a playlist"><Icon name="plus" size={18} /></Link>}
      </div>
      <ul className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 [scrollbar-width:thin]">
        {shown.map(({ entry, pinned }) => <LibraryRow key={`${entry.type}/${entry.id}`} entry={entry} pinned={pinned} />)}
      </ul>
    </section>
  );
}
