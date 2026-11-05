import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { search, searchExternal, toAlbum, toSong } from "../lib/api";
import { isYoutubeLink } from "../lib/format";
import { AlbumCard, ArtistCard, ExternalAlbumCard } from "../components/cards";
import { Empty, OfflineBanner, Section, Shelf, Skeleton, Welcome } from "../components/common";
import { Icon } from "../components/Icon";
import { ExternalRow, GetAllButton, SongList } from "../components/songs";
import { isWide } from "../lib/media";
import { ui } from "../lib/ui";
import * as offline from "../stores/offline";
import { useOnline } from "../stores/settings";
import { useSearchText } from "../stores/ui";
import { ImportPanel } from "./media";

/** The catalogue is slower and allows few requests: it waits until the typing stops. */
const CATALOG_PAUSE = 700;

function Results({ query }: { query: string }) {
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSettled(query), CATALOG_PAUSE);
    return () => clearTimeout(timer);
  }, [query]);

  const library = useQuery({ queryKey: ["search", query], queryFn: ({ signal }) => search(query, signal), placeholderData: keepPreviousData });
  const beyond = useQuery({
    queryKey: ["search-external", settled], queryFn: ({ signal }) => searchExternal(settled, signal),
    enabled: settled === query && settled.length >= 2, retry: false, staleTime: 5 * 60_000,
  });

  if (library.isPending) return <Skeleton rows={5} />;
  if (library.error && !library.data) return <Empty>{library.error.message}</Empty>;
  const local = library.data;
  const songs = (local?.songs ?? []).map(toSong);
  const external = beyond.data?.external ?? [];
  const externalAlbums = beyond.data?.external_albums ?? [];
  const hidden = new Set(beyond.data?.hide_albums ?? []);
  const localAlbums = (local?.albums ?? []).filter((a) => !hidden.has(a.id));
  const artists = local?.artists ?? [];
  const hasAlbums = externalAlbums.length > 0 || localAlbums.length > 0;
  const looking = settled !== query || beyond.isPending;
  const warning = beyond.data?.warning ?? (beyond.error ? `Could not search beyond your library: ${beyond.error.message}` : undefined);
  const nothing = !artists.length && !hasAlbums && !songs.length && !external.length && !warning && !looking;
  if (nothing) return <Empty>{`Nothing found for “${query}”.`}</Empty>;
  return (
    <>
      {artists.length > 0 && (
        <Section title="Artists">
          <Shelf>{artists.map((a) => <ArtistCard key={a.id} artist={{ id: a.id, name: a.name, cover: a.cover, albumCount: a.album_count }} />)}</Shelf>
        </Section>
      )}
      {hasAlbums && (
        <Section title="Albums">
          <Shelf>
            {localAlbums.map((a) => <AlbumCard key={a.id} album={toAlbum(a)} />)}
            {externalAlbums.map((a) => <ExternalAlbumCard key={a.id} album={a} />)}
          </Shelf>
        </Section>
      )}
      {songs.length > 0 && <Section title="In your library"><SongList songs={songs} /></Section>}
      {external.length > 0 && (
        <Section title="Not in your library yet" action={<GetAllButton externals={external} />}>
          <ul className={ui.rows}>{external.map((ext) => <ExternalRow key={ext.id} ext={ext} />)}</ul>
        </Section>
      )}
      {looking && <p className={ui.note}>Looking in the catalogue…</p>}
      {warning && <p className={ui.note}>{warning}</p>}
    </>
  );
}

/** With no connection, search looks only through what is saved on the device. */
function SavedResults({ query }: { query: string }) {
  offline.useOfflineVersion();
  const needle = query.toLowerCase();
  const songs = offline.allSongs().filter((s) => [s.title, s.artist, s.album].some((text) => (text ?? "").toLowerCase().includes(needle)));
  return (
    <>
      <OfflineBanner />
      {songs.length ? <Section title="Saved on this device"><SongList songs={songs} /></Section> : <Empty>{`Nothing saved matches “${query}”.`}</Empty>}
    </>
  );
}

export function Search() {
  const online = useOnline();
  const text = useSearchText((s) => s.text); // kept in a store: coming back to Search keeps what you were looking for
  const [opening] = useState(text);
  const [query, setQuery] = useState(text.trim());

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);

  let body;
  if (query.length < 2) {
    body = (
      <Welcome title="Search everything">
        <p>Your library first, then songs and albums you do not have yet. Paste a YouTube link to add the audio of a podcast or an audiobook.</p>
      </Welcome>
    );
  } else if (!online) {
    body = <SavedResults query={query} />;
  } else if (isYoutubeLink(query)) {
    body = <ImportPanel key={query} link={query} />;
  } else {
    body = <Results query={query} />;
  }

  return (
    <>
      <div className="sticky top-[calc(var(--safe-top)+8px)] z-10 flex items-center mx-3 my-2 text-muted wide:hidden">
        <span className="absolute left-4 pointer-events-none inline-flex"><Icon name="search" size={20} /></span>
        <input type="search" className="flex-1 min-w-0 pl-11 pr-4 py-3.25 rounded-full border border-transparent bg-glass-strong backdrop-blur-xl text-text outline-none shadow-[inset_0_0_0_1px_var(--line)] focus:border-accent" placeholder="Songs, artists, albums, or a YouTube link…" autoComplete="off" enterKeyHint="search" aria-label="Search"
          value={text} autoFocus={!opening && !isWide()} onChange={(e) => useSearchText.setState({ text: e.target.value })} />
      </div>
      <div className="wide:pt-2">{body}</div>
    </>
  );
}
