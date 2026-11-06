// Making a playlist from songs in the library, and adding more to one. Songs not in the library are found in Search first.
// Both look like the playlist they make: its picture, its name as the title, then its songs and the library to pick from.
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { addToPlaylist, createPlaylist, getPlaylist, getSongs, search, toSong } from "../lib/api";
import { listLength, plural } from "../lib/format";
import { pictureToCover } from "../lib/image";
import { scrollRoot, useWide } from "../lib/media";
import type { Song } from "../lib/types";
import { cx, ui } from "../lib/ui";
import { BackButton, DetailPage, Empty, Section, Skeleton } from "../components/common";
import { PlaylistArt, SongCover } from "../components/Cover";
import { Icon, Ring } from "../components/Icon";
import { setPlaylistCover } from "../stores/library";
import { playlistsChanged } from "../stores/playlists";
import { toast } from "../stores/ui";

const PAGE = 100;

/** The round button at the end of a row: add it, or it is in. */
const ADD = "tap flex-none size-9 grid place-items-center rounded-full bg-ghost text-text group-hover/row:bg-surface-3 data-on:bg-accent data-on:text-accent-ink data-on:shadow-[0_4px_14px_rgb(var(--glow)/.35)]";

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
    <Section title={searching ? "Found in your library" : "Add songs"}>
      <label className="flex items-center gap-2.5 mx-4 mb-2 px-4 py-3 rounded-full bg-ghost text-muted focus-within:shadow-[inset_0_0_0_1.5px_var(--accent)] wide:mx-8 wide:max-w-120">
        <Icon name="search" size={18} />
        <input type="search" className="flex-1 min-w-0 bg-transparent outline-none text-text placeholder:text-muted" placeholder="Search your library" aria-label="Search your library" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {pending && <Skeleton />}
      {error && <Empty>{error.message}</Empty>}
      {!pending && !error && songs.length === 0 && <Empty>{searching ? `Nothing in your library matches “${query}”. Search can find it to download first.` : "Your library is empty."}</Empty>}
      <ul className={ui.rows}>
        {songs.map((song) => {
          const already = taken?.has(song.id);
          const on = chosen.has(song.id);
          return (
            <li key={song.id} className={cx(ui.row, already && "cursor-default opacity-50")} onClick={already ? undefined : () => onToggle(song)}>
              <SongCover song={song} />
              <div className={ui.text}><b>{song.title}</b><span>{already ? "Already in this playlist" : [song.artist, song.album].filter(Boolean).join(" · ")}</span></div>
              {!already && (
                <span className={ADD} data-on={on || undefined} role="checkbox" aria-checked={on} aria-label={on ? `Remove ${song.title}` : `Add ${song.title}`}>
                  <Icon name={on ? "check" : "plus"} size={18} />
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {!searching && <div className={ui.more} ref={marker} />}
    </Section>
  );
}

/** The songs chosen so far, in the order they will play, each with a way out. */
function Chosen({ title, chosen, onToggle }: { title: string; chosen: Map<string, Song>; onToggle: (song: Song) => void }) {
  if (chosen.size === 0) return null;
  return (
    <Section title={`${title} (${chosen.size})`}>
      <ul className={ui.rows}>
        {[...chosen.values()].map((song, i) => (
          <li key={song.id} className={cx(ui.row, "cursor-default")}>
            <span className={ui.num}>{i + 1}</span>
            <SongCover song={song} />
            <div className={ui.text}><b>{song.title}</b><span>{song.artist}</span></div>
            <button type="button" className={ui.iconButton} aria-label={`Remove ${song.title}`} onClick={() => onToggle(song)}><Icon name="close" size={18} /></button>
          </li>
        ))}
      </ul>
    </Section>
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

const summary = (songs: Song[], none: string) =>
  songs.length ? [plural(songs.length, "song"), listLength(songs.reduce((total, s) => total + (s.duration ?? 0), 0))].filter(Boolean).join(" · ") : none;

/**
 * What the new playlist will look like: the picture chosen for it, or the covers of its first songs, as Navidrome will
 * show them. Tapping it chooses a picture.
 */
function CoverPreview({ songs, picture, onPick }: { songs: Song[]; picture: string | null; onPick: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const shown = songs.slice(0, 4);
  let art: ReactNode;
  if (picture) art = <img src={picture} alt="" className="size-full object-cover" />;
  else if (shown.length >= 4) art = <span className="grid grid-cols-2 size-full">{shown.map((s) => <SongCover key={s.id} song={s} size={200} className="size-full object-cover" />)}</span>;
  else if (shown.length > 0) art = <SongCover song={shown[0]} size={400} className="size-full object-cover" />;
  else art = <span className="size-full grid place-items-center text-accent-ink bg-[linear-gradient(135deg,var(--accent),rgb(var(--glow)/.35))]"><Icon name="queue" size={64} /></span>;
  return (
    <div className="relative flex-none leading-none @4xl:w-full">
      <button type="button" className={cx(ui.coverHuge, "group/edit relative block overflow-hidden")} aria-label={picture ? "Change the picture" : "Choose a picture"} onClick={() => input.current?.click()}>
        {art}
        <span className="absolute right-2 bottom-2 inline-flex items-center gap-1.5 h-8.5 px-3 rounded-full bg-black/60 text-white text-[.8rem] font-bold can-hover:opacity-80 can-hover:group-hover/edit:opacity-100 transition-opacity">
          <Icon name={picture ? "pencil" : "image"} size={15} />{picture ? "Change" : "Picture"}
        </span>
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) onPick(file); e.target.value = ""; }} />
    </div>
  );
}

const TITLE_INPUT = "w-full min-w-0 bg-transparent outline-none font-title font-bold tracking-[-.035em] leading-[1.04] text-[clamp(1.9rem,8.5cqi,2.6rem)] placeholder:text-muted/70 border-b-2 border-transparent focus:border-accent pb-1 wide:text-[clamp(2rem,4.6cqi,3.25rem)] @4xl:text-[clamp(1.9rem,2.6cqi,2.5rem)]";
const EYEBROW = "text-[.78rem] uppercase tracking-[.12em] font-semibold text-muted!";

export function NewPlaylist() {
  const navigate = useNavigate();
  const wide = useWide();
  const [name, setName] = useState("");
  const [chosen, toggle] = useChosen();
  const [picture, setPicture] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (picture) URL.revokeObjectURL(picture.url); }, [picture]);

  async function pick(file: File) {
    try {
      const blob = await pictureToCover(file);
      setPicture({ blob, url: URL.createObjectURL(blob) });
    } catch (e) { toast((e as Error).message); }
  }

  async function make() {
    setBusy(true);
    try {
      const id = await createPlaylist(name.trim(), [...chosen.keys()]);
      if (picture) await setPlaylistCover(id, picture.blob).catch(() => toast("The playlist was made, but its picture could not be saved"));
      playlistsChanged();
      navigate(`/playlist/${id}`, { replace: true });
    } catch (e) {
      toast((e as Error).message);
      setBusy(false);
    }
  }

  const songs = [...chosen.values()];
  return (
    <>
      <BackButton />
      <DetailPage
        art={<CoverPreview songs={songs} picture={picture?.url ?? null} onPick={(file) => void pick(file)} />}
        info={(
          <>
            <p className={EYEBROW}>New playlist</p>
            {/* On a phone the keyboard would hide the page the moment it opens */}
            <input className={TITLE_INPUT} placeholder="Name it" aria-label="Playlist name" maxLength={120} autoFocus={wide} value={name}
              onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim() && !busy) void make(); }} />
            <p>{summary(songs, "Add songs from your library below")}</p>
          </>
        )}
        actions={(
          <div className={ui.actions}>
            <button type="button" className={ui.primary} disabled={busy || !name.trim()} onClick={() => void make()}>
              {busy ? <Ring percent={-1} size={20} /> : <Icon name="check" size={20} />}Create playlist
            </button>
            <button type="button" className={ui.pill} onClick={() => navigate(-1)}>Cancel</button>
          </div>
        )}>
        <Chosen title="In this playlist" chosen={chosen} onToggle={toggle} />
        <SongPicker chosen={chosen} onToggle={toggle} />
      </DetailPage>
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

  const songs = [...chosen.values()];
  return (
    <>
      <BackButton />
      <DetailPage
        art={<PlaylistArt id={id} cover={playlist.cover} size={400} className={ui.coverHuge} />}
        info={<><p className={EYEBROW}>Add songs to</p><h1>{playlist.name}</h1><p>{songs.length ? `Adding ${summary(songs, "")}` : `${plural(playlist.songs.length, "song")} now`}</p></>}
        actions={(
          <div className={ui.actions}>
            <button type="button" className={ui.primary} disabled={busy || !chosen.size} onClick={() => void add()}>
              {busy ? <Ring percent={-1} size={20} /> : <Icon name="plus" size={20} />}{chosen.size ? `Add ${plural(chosen.size, "song")}` : "Add"}
            </button>
            <button type="button" className={ui.pill} onClick={() => navigate(-1)}>Cancel</button>
          </div>
        )}>
        <Chosen title="Adding" chosen={chosen} onToggle={toggle} />
        <SongPicker chosen={chosen} onToggle={toggle} taken={new Set(playlist.songs.map((s) => s.id))} />
      </DetailPage>
    </>
  );
}
