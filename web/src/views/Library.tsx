// The library. It opens on Recent, as Spotify does: Favorites first, then what you pinned, then what you opened or
// played lately, whatever it is. The chips filter down to one kind of thing.
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Navigate, useNavigate, useParams } from "react-router";
import { getAlbums, getArtists, getPlaylists, getSongs, getStarred, toSong } from "../lib/api";
import { plural } from "../lib/format";
import { scrollRoot } from "../lib/media";
import type { Album, CollectionRecord, LibraryEntry, MediaKind, Playlist } from "../lib/types";
import { AlbumCard, ArtistCard, SavedCard } from "../components/cards";
import { Empty, OfflineBanner, Pill, Section, Skeleton, Welcome } from "../components/common";
import { ArtistAvatar, Picture, PlaylistArt } from "../components/Cover";
import { Icon } from "../components/Icon";
import { SavedStatus, SongList } from "../components/songs";
import { deleteSongForEveryone, isAdmin } from "../stores/admin";
import { useIsCurrent } from "../stores/connect";
import { coverUrl } from "../lib/api";
import { cx, ui } from "../lib/ui";
import {
  entryRoute, entrySong, favoritesEntry, FAVORITES_ID, forget, isPinned, libraryRows, playlistEntry, togglePin, useLibraryState,
} from "../stores/library";
import * as offline from "../stores/offline";
import * as player from "../stores/player";
import { setSettings, useOnline, useSettings } from "../stores/settings";
import { openSheet, toast } from "../stores/ui";
import { CollectionCover } from "./Home";
import { MediaLibrary } from "./media";

const TABS: [string, string][] = [
  ["recent", "Recent"], ["playlists", "Playlists"], ["albums", "Albums"], ["artists", "Artists"], ["songs", "Songs"],
  ["podcast", "Podcasts"], ["audiobook", "Audiobooks"], ["other", "Other"], ["offline", "Downloads"],
];
const OFFLINE_TABS = new Set(["recent", "playlists", "albums", "podcast", "audiobook", "other", "offline"]);
const MEDIA_TABS = new Set<string>(["podcast", "audiobook", "other"]);

export function Library() {
  const { tab } = useParams();
  const online = useOnline();
  offline.useOfflineVersion();
  // Favorites used to be a tab and Videos no longer exist: old links and home-screen shortcuts still land somewhere
  if (tab === "favorites") return <Navigate to={`/playlist/${FAVORITES_ID}`} replace />;
  const tabs = online ? TABS : TABS.filter(([key]) => OFFLINE_TABS.has(key));
  const active = tabs.some(([key]) => key === tab) ? tab! : "recent";
  return (
    <>
      <header className={cx(ui.heroCompact, "flex items-center justify-between gap-3")}>
        <h1>Library</h1>
        {online && (active === "albums" || active === "artists") && <ViewToggle />}
      </header>
      {!online && <OfflineBanner />}
      <nav className={ui.segments} aria-label="Library sections">
        {tabs.map(([key, label]) => (
          <NavLink key={key} to={key === "recent" ? "/library" : `/library/${key}`} className={ui.segment} data-on={key === active || undefined} end>
            {label}{key === "offline" && offline.count() > 0 && <small>{offline.count()}</small>}
          </NavLink>
        ))}
      </nav>
      <div>
        {active === "recent" && <RecentTab />}
        {active === "playlists" && <PlaylistsTab />}
        {active === "albums" && <AlbumsTab />}
        {active === "artists" && <ArtistsTab />}
        {active === "songs" && <SongsTab />}
        {MEDIA_TABS.has(active) && <MediaLibrary kind={active as MediaKind} />}
        {active === "offline" && <DownloadsTab />}
      </div>
    </>
  );
}

function ViewToggle() {
  const view = useSettings((s) => s.libraryView);
  return (
    <button type="button" className={ui.round} aria-label={view === "grid" ? "Show as a list" : "Show as a grid"} title={view === "grid" ? "Show as a list" : "Show as a grid"}
      onClick={() => setSettings({ libraryView: view === "grid" ? "list" : "grid" })}>
      <Icon name={view === "grid" ? "list" : "grid"} size={20} />
    </button>
  );
}

// ---------------- Recent ----------------

export function EntryArt({ entry }: { entry: LibraryEntry }) {
  switch (entry.type) {
    case "playlist": return <PlaylistArt id={entry.id} cover={entry.cover} size={96} />;
    case "artist": return <ArtistAvatar name={entry.name} cover={entry.cover} size={96} className={ui.avatarSmall} />;
    case "catalog_album":
    case "spotify_album": return <Picture src={entry.cover_url} external />;
    default: return <Picture src={coverUrl(entry.cover, 96)} />;
  }
}

function EntryRow({ entry, pinned, fixed, inRecents }: { entry: LibraryEntry; pinned: boolean; fixed?: boolean; inRecents: boolean }) {
  const navigate = useNavigate();
  const online = useOnline();
  const isSong = entry.type === "song";
  const { current: isCurrent } = useIsCurrent(isSong ? entry.id : undefined);
  const open = () => {
    const route = entryRoute(entry);
    if (route) navigate(route);
    else player.play([entrySong(entry)], 0);
  };
  const menu = () => openSheet(entry.name, entry.subtitle, [
    isSong && { icon: "play", label: "Play next", run: () => player.playNext(entrySong(entry)) },
    online && { icon: pinned ? "pin-fill" : "pin", label: pinned ? "Unpin" : "Pin to the top", run: () => void togglePin(entry) },
    online && inRecents && { icon: "history", label: "Remove from recents", run: () => { void forget(entry); toast("Removed from recents"); } },
    online && isSong && isAdmin() && { icon: "trash", label: "Delete for everyone", danger: true, run: () => void deleteSongForEveryone(entrySong(entry)) },
  ]);
  return (
    <li className={ui.row} data-current={isCurrent || undefined} onClick={open}>
      <EntryArt entry={entry} />
      <div className={ui.text}>
        <b>{entry.name}</b>
        <span>{pinned && <span className={ui.pinMark} title="Pinned"><Icon name="pin-fill" size={12} /></span>}{entry.subtitle}</span>
      </div>
      {isSong && <SavedStatus id={entry.id} />}
      {!fixed && <button className={ui.rowMore} aria-label={`More options for ${entry.name}`} onClick={(e) => { e.stopPropagation(); menu(); }}><Icon name="more" size={20} /></button>}
    </li>
  );
}

/** Saved on this device: an entry can be opened without a connection only if it was downloaded. */
export function availableOffline(entry: LibraryEntry): boolean {
  switch (entry.type) {
    case "playlist": return entry.id === FAVORITES_ID || offline.hasCollectionSongs(`playlist:${entry.id}`);
    case "album": return offline.hasCollectionSongs(`album:${entry.id}`);
    case "song": return offline.isSaved(entry.id);
    default: return false;
  }
}

function RecentTab() {
  const online = useOnline();
  const state = useLibraryState();
  const { data: favorites } = useQuery({ queryKey: ["favorites"], queryFn: getStarred, enabled: online });
  const savedFavorites = offline.collection(FAVORITES_ID)?.songIds.length;
  const rows = libraryRows(state, favoritesEntry(favorites?.length ?? savedFavorites)).filter(({ entry }) => online || availableOffline(entry));
  const recentKeys = new Set(state.recents.map((r) => `${r.type}/${r.id}`));
  const isFirstRun = online && rows.length === 1;
  return (
    <>
      <ul className={ui.rows}>
        {rows.map(({ entry, pinned }) => (
          <EntryRow key={`${entry.type}/${entry.id}`} entry={entry} pinned={pinned} fixed={entry.id === FAVORITES_ID} inRecents={recentKeys.has(`${entry.type}/${entry.id}`)} />
        ))}
      </ul>
      {isFirstRun && <p className={ui.note}>Playlists, albums and artists you open will show up here. Open the ⋯ menu on anything to pin it to the top.</p>}
    </>
  );
}

// ---------------- Playlists ----------------

function PlaylistRow({ playlist }: { playlist: Playlist }) {
  const navigate = useNavigate();
  const { pins } = useLibraryState();
  const entry = playlistEntry(playlist, playlist.songCount);
  const pinned = isPinned(pins, entry);
  offline.useOfflineVersion();
  return (
    <li className={ui.row} onClick={() => navigate(`/playlist/${playlist.id}`)}>
      <PlaylistArt id={playlist.id} cover={playlist.cover} size={96} />
      <div className={ui.text}>
        <b>{playlist.name}</b>
        <span>{pinned && <span className={ui.pinMark} title="Pinned"><Icon name="pin-fill" size={12} /></span>}{plural(playlist.songCount, "song")}</span>
      </div>
      {offline.isCollectionSaved(`playlist:${playlist.id}`) && <span className={ui.status}><Icon name="check" size={16} /></span>}
      <button className={ui.rowMore} aria-label={`More options for ${playlist.name}`} onClick={(e) => {
        e.stopPropagation();
        openSheet(playlist.name, "Playlist", [{ icon: pinned ? "pin-fill" : "pin", label: pinned ? "Unpin" : "Pin to the top", run: () => void togglePin(entry) }]);
      }}><Icon name="more" size={20} /></button>
    </li>
  );
}

function FavoritesRow({ count }: { count?: number }) {
  const navigate = useNavigate();
  return (
    <li className={ui.row} onClick={() => navigate(`/playlist/${FAVORITES_ID}`)}>
      <PlaylistArt id={FAVORITES_ID} />
      <div className={ui.text}><b>Favorites</b><span>{count === undefined ? "Your favorite songs" : plural(count, "song")}</span></div>
    </li>
  );
}

const SavedCollectionRow = ({ collection }: { collection: CollectionRecord }) => {
  const navigate = useNavigate();
  return (
    <li className={ui.row} onClick={() => navigate(offline.collectionRoute(collection.id))}>
      <CollectionCover id={collection.id} className={ui.cover} />
      <div className={ui.text}><b>{collection.title}</b><span>{`${collection.subtitle} · ${plural(collection.songIds.length, "song")}`}</span></div>
      <span className={ui.status}><Icon name="check" size={16} /></span>
    </li>
  );
};

function PlaylistsTab() {
  const online = useOnline();
  const lists = useQuery({ queryKey: ["playlists"], queryFn: getPlaylists, enabled: online });
  const favorites = useQuery({ queryKey: ["favorites"], queryFn: getStarred, enabled: online });
  if (!online) {
    const saved = offline.collectionList("playlist").filter((c) => c.complete);
    return (
      <ul className={ui.rows}>
        <FavoritesRow count={offline.collection(FAVORITES_ID)?.songIds.length} />
        {saved.map((c) => <SavedCollectionRow key={c.id} collection={c} />)}
      </ul>
    );
  }
  return (
    <>
      <div className={ui.actions}><Link className={ui.pill} to="/import"><Icon name="upload" size={16} />Import a playlist</Link></div>
      <ul className={ui.rows}>
        <FavoritesRow count={favorites.data?.length} />
        {lists.data?.map((p) => <PlaylistRow key={p.id} playlist={p} />)}
      </ul>
      {lists.isPending && <Skeleton rows={3} />}
      {lists.error && <Empty>{lists.error.message}</Empty>}
    </>
  );
}

// ---------------- Albums, artists, songs ----------------

function AlbumsTab() {
  const online = useOnline();
  const view = useSettings((s) => s.libraryView);
  const { data, error, isPending } = useQuery<Album[]>({ queryKey: ["albums"], queryFn: getAlbums, enabled: online });
  if (!online) {
    const saved = offline.collectionList("album").filter((c) => c.complete);
    if (!saved.length) return <Empty>No albums are downloaded.</Empty>;
    return <div className={ui.grid}>{saved.map((c) => <SavedCard key={c.id} to={offline.collectionRoute(c.id)} art={<CollectionCover id={c.id} className={cx(ui.coverBig, ui.cardCover)} />} title={c.title} subtitle={c.subtitle} />)}</div>;
  }
  if (isPending) return <Skeleton />;
  if (error) return <Empty>{error.message}</Empty>;
  if (!data.length) return <Empty>No albums yet.</Empty>;
  if (view === "list") {
    return (
      <ul className={ui.rows}>
        {data.map((a) => (
          <li key={a.id} className={ui.row}><Link className={ui.rowLink} to={`/album/${a.id}`}>
            <Picture src={coverUrl(a.cover, 96)} />
            <div className={ui.text}><b>{a.name}</b><span>{[a.artist, a.year].filter(Boolean).join(" · ")}</span></div>
          </Link></li>
        ))}
      </ul>
    );
  }
  return <div className={ui.grid}>{data.map((a) => <AlbumCard key={a.id} album={a} />)}</div>;
}

function ArtistsTab() {
  const { data, error, isPending } = useQuery({ queryKey: ["artists"], queryFn: async () => (await getArtists()).sort((a, b) => a.name.localeCompare(b.name)) });
  const [filter, setFilter] = useState("");
  const view = useSettings((s) => s.libraryView);
  if (isPending) return <Skeleton />;
  if (error) return <Empty>{error.message}</Empty>;
  if (!data.length) return <Empty>No artists yet.</Empty>;
  const needle = filter.toLowerCase();
  return (
    <>
      <input type="search" className={ui.filter} placeholder={`Filter ${data.length} artists`} aria-label="Filter artists" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {view === "list"
        ? (
          <ul className={ui.rows}>
            {data.filter((a) => a.name.toLowerCase().includes(needle)).map((a) => (
              <li key={a.id} className={ui.row}><Link className={ui.rowLink} to={`/artist/${a.id}`}>
                <ArtistAvatar name={a.name} cover={a.cover} size={96} className={ui.avatarSmall} />
                <div className={ui.text}><b>{a.name}</b><span>{a.albumCount !== undefined ? plural(a.albumCount, "album") : "Artist"}</span></div>
              </Link></li>
            ))}
          </ul>
        )
        : <div className={ui.grid}>{data.filter((a) => a.name.toLowerCase().includes(needle)).map((a) => <ArtistCard key={a.id} artist={a} />)}</div>}
    </>
  );
}

const PAGE = 100;

function SongsTab() {
  const { data, error, isPending, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["songs"],
    queryFn: ({ pageParam }) => getSongs(pageParam, PAGE),
    initialPageParam: 0,
    getNextPageParam: (last, _pages, lastParam) => (last.has_more ? lastParam + PAGE : undefined),
  });
  const marker = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!marker.current || !hasNextPage) return;
    const watcher = new IntersectionObserver((entries) => { if (entries[0].isIntersecting && !isFetchingNextPage) void fetchNextPage(); }, { root: scrollRoot(marker.current), rootMargin: "800px" });
    watcher.observe(marker.current);
    return () => watcher.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  if (isPending) return <Skeleton />;
  if (error) return <Empty>{error.message}</Empty>;
  const songs = data.pages.flatMap((p) => p.songs).map(toSong);
  return (
    <>
      <p className={ui.count}>{plural(data.pages[0].total, "song")}</p>
      <SongList songs={songs} />
      <div className={ui.more} ref={marker} />
    </>
  );
}

// ---------------- Downloads ----------------

function DownloadsTab() {
  const version = offline.useOfflineVersion();
  const [space, setSpace] = useState<{ used: number; quota: number } | null>(null);
  useEffect(() => { void offline.usage().then(setSpace); }, [version]);
  const collections = offline.collectionList().filter((c) => c.complete);
  const saved = offline.list().filter((s) => !s.kind);
  const spoken = offline.list().filter((s) => s.kind);
  if (!collections.length && !saved.length && !spoken.length) {
    return (
      <Welcome title="Nothing downloaded yet">
        <p>Tap Download on your favorites, a playlist or an album, or open the ⋯ menu on any song and choose Save for offline. Downloads play without a connection.</p>
      </Welcome>
    );
  }
  return (
    <>
      {space && <p className={ui.count}>{`${plural(offline.count(), "song")} · ${offline.megabytes(space.used)}${space.quota ? ` of ${offline.megabytes(space.quota)} available` : ""}`}</p>}
      {collections.length > 0 && <Section title="Collections"><ul className={ui.rows}>{collections.map((c) => <SavedCollectionRow key={c.id} collection={c} />)}</ul></Section>}
      {saved.length > 0 && <Section title="Songs" action={<Pill icon="play" onClick={() => player.play(saved, 0)}>Play</Pill>}><SongList songs={saved} /></Section>}
      {spoken.length > 0 && <Section title="Podcasts, audiobooks & more"><SongList songs={spoken} /></Section>}
      <button className={ui.dangerLink} onClick={async () => {
        if (!confirm("Remove every download from this device?")) return;
        for (const c of collections) await offline.removeCollection(c.id);
        for (const s of offline.list()) await offline.remove(s.id);
        toast("Downloads removed");
      }}>Remove all downloads from this device</button>
    </>
  );
}
