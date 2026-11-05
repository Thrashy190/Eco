// Making a playlist from songs in the library, and adding more to one. Songs not in the library are found in Search first.
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { addToPlaylist, createPlaylist, getPlaylist, getSongs, search, toSong } from "../lib/api";
import { plural } from "../lib/format";
import { scrollRoot } from "../lib/media";
import type { Song } from "../lib/types";
import { cx, ui } from "../lib/ui";
import { BackButton, Empty, Skeleton } from "../components/common";
import { SongCover } from "../components/Cover";
import { Icon, Ring } from "../components/Icon";
import { playlistsChanged } from "../stores/playlists";
import { toast } from "../stores/ui";

const PAGE = 100;

/** Every song in the library, or those matching what is typed. Choosing survives searching for something else. */
function SongPicker({ chosen, onToggle, taken }: { chosen: Map<string, Song>; onToggle: (song: Song) => void; taken?: Set<string> }) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const searching = query.length >= 2;
  const found = useQuery({ queryKey: ["search", query], queryFn: ({ signal }) => search(query, signal), enabled: searching });
  const all = useInfiniteQuery({
    queryKey: ["songs"],
    queryFn: ({ pageParam }) => getSongs(pageParam, PAGE),
    initialPageParam: 0,
    getNextPageParam: (last, _pages, lastParam) => (last.has_more ? lastParam + PAGE : undefined),
    enabled: !searching,
  });
  const marker = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = all;
  useEffect(() => {
    if (searching || !marker.current || !hasNextPage) return;
    const watcher = new IntersectionObserver((entries) => { if (entries[0].isIntersecting && !isFetchingNextPage) void fetchNextPage(); }, { root: scrollRoot(marker.current), rootMargin: "800px" });
    watcher.observe(marker.current);
    return () => watcher.disconnect();
  }, [searching, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const songs = (searching ? found.data?.songs ?? [] : all.data?.pages.flatMap((p) => p.songs) ?? []).map(toSong);
  const pending = searching ? found.isPending : all.isPending;
  const error = searching ? found.error : all.error;
  return (
    <>
      <input type="search" className={ui.filter} placeholder="Find songs in your library" aria-label="Find songs in your library" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} />
      {pending && <Skeleton />}
      {error && <Empty>{error.message}</Empty>}
      {!pending && !error && songs.length === 0 && <Empty>{searching ? `Nothing in your library matches “${query}”. Search can find it to download first.` : "Your library is empty."}</Empty>}
      <ul className={ui.rows}>
        {songs.map((song) => {
          const already = taken?.has(song.id);
          const on = chosen.has(song.id);
          return (
            <li key={song.id} className={cx(ui.row, already && "cursor-default opacity-50")} onClick={already ? undefined : () => onToggle(song)}>
              <span className={ui.tick} data-on={on || already || undefined} role="checkbox" aria-checked={on || Boolean(already)} aria-disabled={already || undefined} aria-label={song.title}>{(on || already) && <Icon name="check" size={16} />}</span>
              <SongCover song={song} />
              <div className={ui.text}><b>{song.title}</b><span>{already ? "Already in this playlist" : [song.artist, song.album].filter(Boolean).join(" · ")}</span></div>
            </li>
          );
        })}
      </ul>
      {!searching && <div className={ui.more} ref={marker} />}
    </>
  );
}

function useChosen() {
  const [chosen, setChosen] = useState(new Map<string, Song>());
  const toggle = (song: Song) => setChosen((now) => {
    const next = new Map(now);
    if (next.has(song.id)) next.delete(song.id); else next.set(song.id, song);
    return next;
  });
  return [chosen, toggle] as const;
}

export function NewPlaylist() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [chosen, toggle] = useChosen();
  const [busy, setBusy] = useState(false);

  async function make() {
    setBusy(true);
    try {
      const id = await createPlaylist(name.trim(), [...chosen.keys()]);
      playlistsChanged();
      navigate(`/playlist/${id}`, { replace: true });
    } catch (e) {
      toast((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <BackButton />
      <header className={ui.heroCompact}><h1>New playlist</h1><p>Name it and choose songs from your library.</p></header>
      <input className={ui.filter} placeholder="Playlist name" aria-label="Playlist name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      <div className={ui.selectBar}>
        <span className="pl-1 text-muted text-[.9rem]">{chosen.size ? `${plural(chosen.size, "song")} chosen` : "No songs chosen yet"}</span>
        <button type="button" className={ui.get} disabled={busy || !name.trim()} onClick={() => void make()}>
          {busy ? <Ring percent={-1} size={18} /> : <Icon name="check" size={18} />}Create playlist
        </button>
      </div>
      <SongPicker chosen={chosen} onToggle={toggle} />
    </>
  );
}

export function AddSongs() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [chosen, toggle] = useChosen();
  const [busy, setBusy] = useState(false);
  const { data: playlist, error, isPending } = useQuery({ queryKey: ["playlist", id], queryFn: () => getPlaylist(id) });
  if (isPending) return <><BackButton /><Skeleton /></>;
  if (error) return <><BackButton /><Empty>{error.message}</Empty></>;

  async function add() {
    setBusy(true);
    try {
      await addToPlaylist(id, [...chosen.keys()]);
      playlistsChanged(id);
      navigate(-1);
    } catch (e) {
      toast((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <BackButton />
      <header className={ui.heroCompact}><h1>Add songs</h1><p>{`To ${playlist.name}`}</p></header>
      <div className={ui.selectBar}>
        <span className="pl-1 text-muted text-[.9rem]">{chosen.size ? `${plural(chosen.size, "song")} chosen` : "Choose songs to add"}</span>
        <button type="button" className={ui.get} disabled={busy || !chosen.size} onClick={() => void add()}>
          {busy ? <Ring percent={-1} size={18} /> : <Icon name="plus" size={18} />}Add
        </button>
      </div>
      <SongPicker chosen={chosen} onToggle={toggle} taken={new Set(playlist.songs.map((s) => s.id))} />
    </>
  );
}
