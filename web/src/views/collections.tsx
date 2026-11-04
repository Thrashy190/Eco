// Album and playlist pages. Favorites are a playlist here (in Navidrome they stay favourites). Every page falls back
// to the copy saved on this device when there is no connection.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate, useParams } from "react-router";
import { coverUrl, discover, getAlbum, getArtist, getPlaylist, getStarred, lookupArtist, matchCatalogAlbum } from "../lib/api";
import { plural } from "../lib/format";
import { pictureToCover } from "../lib/image";
import type { CollectionSpec, LibraryEntry, Song } from "../lib/types";
import { ArtistLinks } from "../components/ArtistLinks";
import { AlbumCard, DownloadToggle, ExternalAlbumCard, PinButton } from "../components/cards";
import { BackButton, Empty, OfflineBanner, Section, Shelf, Skeleton, Welcome } from "../components/common";
import { ArtistAvatar, Picture, PlaylistArt } from "../components/Cover";
import { Icon, Ring } from "../components/Icon";
import { ExternalRow, GetAllButton, PlayButtons, SongList } from "../components/songs";
import { albumEntry, artistEntry, favoritesEntry, FAVORITES_ID, playlistEntry, removePlaylistCover, setPlaylistCover, touch, useLibraryState } from "../stores/library";
import * as offline from "../stores/offline";
import { syncCollectionIfSaved } from "../stores/saving";
import { useOnline } from "../stores/settings";
import { openSheet, toast } from "../stores/ui";
import { CollectionCover } from "./Home";
import { AlbumPage } from "./CatalogAlbum";

/** Remember this page in the Recent view, once it has loaded. */
function useRecent(entry: LibraryEntry | null): void {
  const key = entry && `${entry.type}/${entry.id}/${entry.name}`;
  const latest = useRef(entry);
  latest.current = entry;
  useEffect(() => { if (latest.current) touch(latest.current); }, [key]);
}

interface PageProps {
  art: ReactNode;
  title: string;
  subtitle: ReactNode;
  songs: Song[];
  spec: CollectionSpec;
  entry: LibraryEntry;
  numbered?: boolean;
  fromDevice?: boolean;
  extra?: ReactNode;
}

function CollectionPage({ art, title, subtitle, songs, spec, entry, numbered, fromDevice, extra }: PageProps) {
  return (
    <>
      {fromDevice && <OfflineBanner />}
      <header className="detail">{art}<div className="info"><h1>{title}</h1><p>{subtitle}</p></div></header>
      <PlayButtons songs={songs} from={fromDevice ? undefined : entry}>
        {!fromDevice && <DownloadToggle spec={spec} songs={songs} />}
        {!fromDevice && <PinButton entry={entry} />}
        {extra}
      </PlayButtons>
      <SongList songs={songs} numbered={numbered} hideAlbum={numbered} from={fromDevice ? undefined : entry} />
    </>
  );
}

// ---------------- Album ----------------

export function AlbumView() {
  const { id = "" } = useParams();
  const online = useOnline();
  const key = `album:${id}`;
  offline.useOfflineVersion();
  const { data: album, error, isPending } = useQuery({ queryKey: ["album", id], queryFn: () => getAlbum(id), enabled: online });
  const entry = album ? albumEntry(album) : null;
  useRecent(entry);
  useEffect(() => { if (album) void syncCollectionIfSaved(key, album.songs); }, [album, key]);

  // The library answers first; when the catalogue knows the album the page becomes the same one search leads to
  const [waiting, setWaiting] = useState(false);
  // The server says so when the catalogue could not answer in time, and what it did learn is kept: asking again gets further
  const { data: whole, isPending: matching, fetchStatus, error: noMatch, refetch } = useQuery({
    queryKey: ["album-match", album?.name, album?.artist],
    queryFn: () => matchCatalogAlbum(album!.name, album!.artist),
    enabled: online && Boolean(album), retry: 4, retryDelay: 2000, refetchInterval: waiting ? 10_000 : false,
  });
  const extra = useMemo(() => album?.songs.filter((s) => !whole?.tracks.some((t) => t.library?.id === s.id)) ?? [], [album, whole]);

  let body;
  if (album && whole) {
    const page = { ...whole, album: { ...whole.album, year: album.year ?? whole.album.year } };
    body = <AlbumPage art={<Picture src={coverUrl(album.cover, 400)} className="cover huge" />} page={page} artistId={album.artistId} entry={entry!} extra={extra} onWaiting={setWaiting} />;
  } else if (album) {
    const spec: CollectionSpec = { id: key, kind: "album", title: album.name, subtitle: album.artist };
    body = (
      <>
        <CollectionPage art={<Picture src={coverUrl(album.cover, 400)} className="cover huge" />} title={album.name}
          subtitle={<><ArtistLinks name={album.artist} id={album.artistId} />{album.year ? ` · ${album.year}` : ""}</>}
          songs={album.songs} spec={spec} entry={entry!} numbered />
        {online && matching && fetchStatus === "fetching" && <p className="note album-more"><Ring percent={-1} size={16} />Looking for the rest of this album…</p>}
        {online && noMatch && !whole && (
          <p className="note album-more">The catalogue is not answering, so this only shows what you have. <button type="button" className="link" onClick={() => void refetch()}>Try again</button></p>
        )}
      </>
    );
  } else if (online && isPending) {
    body = <Skeleton />;
  } else {
    const saved = offline.collection(key);
    body = saved && offline.hasCollectionSongs(key)
      ? <CollectionPage art={<CollectionCover id={key} className="cover huge" />} title={saved.title} subtitle={saved.subtitle} songs={offline.collectionSongs(key)} spec={saved} entry={{ type: "album", id, name: saved.title }} numbered fromDevice />
      : <Empty>{online && error ? error.message : "This album is not downloaded."}</Empty>;
  }
  return <><BackButton />{body}</>;
}

// ---------------- Playlist ----------------

/** The picture at the top of a playlist. Tapping it changes the picture. It stays on this server, for this user. */
function EditableCover({ id, cover, enabled }: { id: string; cover?: string; enabled: boolean }) {
  const { covers } = useLibraryState();
  const input = useRef<HTMLInputElement>(null);
  const hasCustom = Boolean(covers[id]);

  async function choose(file: File | undefined) {
    if (!file) return;
    try {
      await setPlaylistCover(id, await pictureToCover(file));
      toast("Cover updated");
    } catch (e) {
      toast((e as Error).message);
    }
  }
  const pick = () => input.current?.click();
  const art = <PlaylistArt id={id} cover={cover} size={400} className="cover huge" />;
  if (!enabled) return art;
  return (
    <div className="cover-edit">
      <button type="button" aria-label="Change cover" onClick={() => {
        if (!hasCustom) { pick(); return; }
        openSheet("Playlist cover", undefined, [
          { icon: "image", label: "Choose another picture", run: pick },
          { icon: "trash", label: "Remove this picture", danger: true, run: () => void removePlaylistCover(id).then(() => toast("Cover removed")).catch((e: Error) => toast(e.message)) },
        ]);
      }}>
        {art}
        <span className="cover-edit-badge"><Icon name="pencil" size={16} /></span>
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}

const FAVORITES_SPEC: CollectionSpec = { id: FAVORITES_ID, kind: "favorites", title: "Favorites", subtitle: "Your favorites" };

function FavoritesPlaylist() {
  const online = useOnline();
  offline.useOfflineVersion();
  const { data: songs, isPending, error } = useQuery({ queryKey: ["favorites"], queryFn: getStarred, enabled: online });
  const entry = favoritesEntry(songs?.length);
  useRecent(songs ? entry : null);
  useEffect(() => { if (songs) void syncCollectionIfSaved(FAVORITES_ID, songs); }, [songs]);

  if (songs) {
    return (
      <>
        <header className="detail">
          <EditableCover id={FAVORITES_ID} enabled />
          <div className="info"><h1>Favorites</h1><p>{`Playlist · ${plural(songs.length, "song")}, most recent first`}</p></div>
        </header>
        {songs.length > 0
          ? <>
              <PlayButtons songs={songs} from={entry}><DownloadToggle spec={FAVORITES_SPEC} songs={songs} /></PlayButtons>
              <SongList songs={songs} from={entry} />
            </>
          : <Welcome title="No favorites yet"><p>Open the ⋯ menu on a song, or tap the heart in the player, to add it here.</p></Welcome>}
      </>
    );
  }
  if (online && isPending) return <Skeleton />;
  const saved = offline.collectionSongs(FAVORITES_ID);
  if (saved.length) {
    return <CollectionPage art={<PlaylistArt id={FAVORITES_ID} className="cover huge" />} title="Favorites" subtitle={`${plural(saved.length, "favorite")} saved on this device`} songs={saved} spec={FAVORITES_SPEC} entry={favoritesEntry(saved.length)} fromDevice />;
  }
  if (online && error) return <Empty>{error.message}</Empty>;
  return <><OfflineBanner /><Welcome title="Favorites are not downloaded"><p>Open this playlist while online and tap Download to keep your favorites without a connection.</p></Welcome></>;
}

function RegularPlaylist({ id }: { id: string }) {
  const online = useOnline();
  const key = `playlist:${id}`;
  offline.useOfflineVersion();
  const { data: playlist, isPending, error } = useQuery({ queryKey: ["playlist", id], queryFn: () => getPlaylist(id), enabled: online });
  const entry = playlist ? playlistEntry(playlist, playlist.songs.length) : null;
  useRecent(entry);
  useEffect(() => { if (playlist) void syncCollectionIfSaved(key, playlist.songs); }, [playlist, key]);

  if (playlist) {
    return (
      <CollectionPage art={<EditableCover id={id} cover={playlist.cover} enabled />} title={playlist.name} subtitle={`Playlist · ${plural(playlist.songs.length, "song")}`}
        songs={playlist.songs} spec={{ id: key, kind: "playlist", title: playlist.name, subtitle: "Playlist" }} entry={entry!} />
    );
  }
  if (online && isPending) return <Skeleton />;
  const saved = offline.collection(key);
  if (saved && offline.hasCollectionSongs(key)) {
    const here = offline.collectionSongs(key);
    return <CollectionPage art={<CollectionCover id={key} className="cover huge" />} title={saved.title} subtitle={plural(here.length, "song")} songs={here} spec={saved} entry={{ type: "playlist", id, name: saved.title }} fromDevice />;
  }
  return <Empty>{online && error ? error.message : "This playlist is not downloaded."}</Empty>;
}

export function PlaylistView() {
  const { id = "" } = useParams();
  return <><BackButton />{id === FAVORITES_ID ? <FavoritesPlaylist /> : <RegularPlaylist key={id} id={id} />}</>;
}

// ---------------- Artist ----------------

/** What the catalogue has by this artist and the library does not. */
function Discover({ artist }: { artist: string }) {
  const { data, error, isPending } = useQuery({ queryKey: ["discover", artist], queryFn: () => discover(artist), retry: false, staleTime: 5 * 60_000 });
  if (isPending) return <Section title="Not in your library yet"><Skeleton rows={3} /></Section>;
  if (error) return <Section title="Not in your library yet"><Empty>{error.message}</Empty></Section>;
  const { albums, external, warning } = data;
  return (
    <>
      {albums.length > 0 && <Section title="More albums"><Shelf>{albums.map((a) => <ExternalAlbumCard key={a.id} album={a} />)}</Shelf></Section>}
      <Section title="Not in your library yet">
        {external.length > 0
          ? <>
              <div className="actions"><GetAllButton externals={external} /></div>
              <ul className="rows">{external.map((ext) => <ExternalRow key={ext.id} ext={ext} />)}</ul>
            </>
          : <Empty>{warning ?? "Nothing else to suggest right now."}</Empty>}
        {external.length > 0 && warning && <p className="note">{warning}</p>}
      </Section>
    </>
  );
}

/** A name to follow: the library's artist when there is one, otherwise what the catalogue has by them. */
export function ArtistByName() {
  const { name = "" } = useParams();
  const online = useOnline();
  const { data, error, isPending } = useQuery({ queryKey: ["artist-lookup", name], queryFn: () => lookupArtist(name), enabled: online });
  if (!online) return <><BackButton /><Empty>Artist pages need a connection.</Empty></>;
  if (isPending) return <><BackButton /><Skeleton /></>;
  if (error) return <><BackButton /><Empty>{error.message}</Empty></>;
  if (data.id) return <Navigate to={`/artist/${data.id}`} replace />;
  return (
    <>
      <BackButton />
      <header className="detail">
        <ArtistAvatar name={name} size={300} className="avatar big" />
        <div className="info"><h1>{name}</h1><p>Nothing in your library yet</p></div>
      </header>
      <Discover artist={name} />
    </>
  );
}

export function ArtistView() {
  const { id = "" } = useParams();
  const online = useOnline();
  const { data: artist, error, isPending } = useQuery({ queryKey: ["artist", id], queryFn: () => getArtist(id), enabled: online });
  const { data: songs } = useQuery({
    queryKey: ["artist-songs", id, artist?.albums.length],
    queryFn: async () => (await Promise.all(artist!.albums.map((a) => getAlbum(a.id).then((x) => x.songs).catch(() => [] as Song[])))).flat(),
    enabled: online && Boolean(artist),
  });
  const entry = artist ? artistEntry(artist) : null;
  useRecent(entry);

  if (!online) return <><BackButton /><Empty>Artist pages need a connection.</Empty></>;
  if (isPending) return <><BackButton /><Skeleton /></>;
  if (error) return <><BackButton /><Empty>{error.message}</Empty></>;
  return (
    <>
      <BackButton />
      <header className="detail">
        <ArtistAvatar name={artist.name} cover={artist.cover} size={300} className="avatar big" />
        <div className="info"><h1>{artist.name}</h1><p>{`${plural(artist.albums.length, "album")} in your library`}</p></div>
      </header>
      {songs && songs.length > 0
        ? <PlayButtons songs={songs} from={entry!}><PinButton entry={entry!} /></PlayButtons>
        : <div className="actions"><PinButton entry={entry!} /></div>}
      {artist.albums.length > 0 && <Section title="Albums"><Shelf>{artist.albums.map((a) => <AlbumCard key={a.id} album={a} />)}</Shelf></Section>}
      {songs && songs.length > 0 && <Section title={`Songs (${songs.length})`}><SongList songs={songs} /></Section>}
      <Discover artist={artist.name} />
    </>
  );
}
