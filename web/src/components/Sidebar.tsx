// On a computer or a tablet: the chosen places, and the whole library always at hand, as a panel beside the page.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { getPlaylists, getStarred } from "../lib/api";
import { activePlace, tabsFrom } from "../lib/nav";
import type { EntryType, LibraryEntry } from "../lib/types";
import { entryRoute, entrySong, favoritesEntry, FAVORITES_ID, libraryRows, playlistEntry, useLibraryState } from "../stores/library";
import * as offline from "../stores/offline";
import * as player from "../stores/player";
import { useOnline, useSettings } from "../stores/settings";
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
    <li className={`side-row${route === pathname ? " current" : ""}`} title={entry.name}
      onClick={() => { if (route) navigate(route); else player.play([entrySong(entry)], 0); }}>
      <EntryArt entry={entry} />
      <div className="text">
        <b>{entry.name}</b>
        <span>{pinned && entry.id !== FAVORITES_ID && <span className="pin-mark"><Icon name="pin-fill" size={12} /></span>}{entry.subtitle}</span>
      </div>
    </li>
  );
}

export function Sidebar() {
  const { pathname } = useLocation();
  const online = useOnline();
  const chosen = useSettings((s) => s.tabs);
  const [kind, setKind] = useState("all");
  const state = useLibraryState();
  offline.useOfflineVersion();
  const { data: favorites } = useQuery({ queryKey: ["favorites"], queryFn: getStarred, enabled: online });
  const { data: playlists } = useQuery({ queryKey: ["playlists"], queryFn: getPlaylists, enabled: online });

  const tabs = tabsFrom(chosen);
  const active = activePlace(tabs, pathname);
  const rows = libraryRows(state, favoritesEntry(favorites?.length ?? offline.collection(FAVORITES_ID)?.songIds.length));
  // Every playlist belongs here, opened lately or not
  for (const list of playlists ?? []) {
    if (!rows.some(({ entry }) => entry.type === "playlist" && entry.id === list.id)) rows.push({ entry: playlistEntry(list, list.songCount), pinned: false });
  }
  const types = KINDS.find(([id]) => id === kind)?.[2];
  const shown = rows.filter(({ entry }) => (!types || types.includes(entry.type)) && (online || availableOffline(entry)));

  return (
    <aside className="side">
      <nav className="side-nav" aria-label="Main">
        {tabs.map((place) => (
          <NavLink key={place.id} to={place.to} end title={place.label} className={place.id === active ? "active" : ""}>
            <Icon name={place.icon} size={22} /><span>{place.label}</span>
          </NavLink>
        ))}
      </nav>
      <section className="side-library" aria-label="Your library">
        <header className="side-head">
          <Link to="/library" title="Your library"><Icon name="library" size={22} /><span>Your library</span></Link>
          {online && <Link className="icon-button" to="/import" title="Import a playlist" aria-label="Import a playlist"><Icon name="plus" size={18} /></Link>}
        </header>
        <div className="side-kinds" role="group" aria-label="Show">
          {KINDS.map(([id, label]) => <button key={id} type="button" className="chip" aria-pressed={kind === id} onClick={() => setKind(id)}>{label}</button>)}
        </div>
        <ul className="side-list">
          {shown.map(({ entry, pinned }) => <LibraryRow key={`${entry.type}/${entry.id}`} entry={entry} pinned={pinned} />)}
        </ul>
      </section>
    </aside>
  );
}
