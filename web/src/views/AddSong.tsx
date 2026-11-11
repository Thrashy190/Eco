// Adding a song by hand from a YouTube link, for songs the catalogue does not have or has wrong. Eco guesses what the
// song is from the video, the person corrects it, and chooses the album: one already in the library (the song joins
// it), one from the catalogue, or a new one they describe. Artists come from the library or are typed in.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import * as api from "../lib/api";
import { clock } from "../lib/format";
import { blobToBase64, pictureToCover } from "../lib/image";
import { guessSong } from "../lib/songguess";
import type { AddSongRequest, Album, ExternalAlbum, MediaPreview } from "../lib/types";
import { cx, ui } from "../lib/ui";
import { BackButton, Skeleton, Welcome } from "../components/common";
import { Picture } from "../components/Cover";
import { Icon, Ring } from "../components/Icon";
import { ArtistsField, BADGE, LABEL, NUMBER, OPTION, PAGE, PANEL, same } from "../components/fields";
import { liveJob, requestAddSong, useJobs } from "../stores/downloads";
import { toast } from "../stores/ui";


const isYouTube = (text: string) => /^https?:\/\/([a-z0-9-]+\.)*(youtube\.com|youtu\.be)\//i.test(text.trim());

export function AddSong() {
  const [params, setParams] = useSearchParams();
  const link = params.get("url") ?? "";
  return (
    <>
      <BackButton />
      <header className={ui.heroCompact}><h1>Add a song</h1><p>From a YouTube link, with the details you give it</p></header>
      {link ? <Form key={link} link={link} onChangeLink={() => setParams({})} /> : <LinkStep onLink={(url) => setParams({ url })} />}
    </>
  );
}

function LinkStep({ onLink }: { onLink: (url: string) => void }) {
  const [text, setText] = useState("");
  const ok = isYouTube(text);
  return (
    <form className={PAGE} onSubmit={(e) => { e.preventDefault(); if (ok) onLink(text.trim()); }}>
      <label className={LABEL}>
        <span>YouTube link</span>
        <input className={ui.input} type="url" inputMode="url" placeholder="https://www.youtube.com/watch?v=…" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <p className="text-muted text-[.9rem] px-1.5">For a song search cannot find. Only its audio is kept, tagged with what you write next, and it joins your music like any download.</p>
      <div><button className={ui.primary} type="submit" disabled={!ok}>Continue</button></div>
    </form>
  );
}

// ---------------- Album ----------------

interface NewAlbum { name: string; artists: string[]; date: string; cover: "video" | "upload" | ""; picture?: { blob: Blob; url: string } }
type AlbumChoice = { kind: "library"; album: Album } | { kind: "catalog"; album: ExternalAlbum } | ({ kind: "new" } & NewAlbum);

function useDebounced(value: string, ms = 450): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const t = setTimeout(() => setDebounced(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return debounced;
}

/** Choosing the album: what the library holds first, then the catalogue, then a new one named as typed. */
function AlbumSearch({ initial, artist, title, year, onChoose }: { initial: string; artist: string; title: string; year?: number; onChoose: (choice: AlbumChoice) => void }) {
  const [text, setText] = useState(initial);
  const query = useDebounced(text.trim());
  const { data: albums = [] } = useQuery({ queryKey: ["albums"], queryFn: api.getAlbums });
  const inLibrary = useMemo(() => {
    const q = query.toLowerCase();
    const byArtist = (a: Album) => (artist && a.artist.toLowerCase().includes(artist.toLowerCase()) ? 0 : 1);
    return albums.filter((a) => (q ? a.name.toLowerCase().includes(q) : artist !== "" && byArtist(a) === 0))
      .sort((a, b) => byArtist(a) - byArtist(b)).slice(0, 6);
  }, [albums, query, artist]);
  const external = useQuery({
    queryKey: ["album-search", query, artist], enabled: query.length >= 2, retry: false, staleTime: 5 * 60_000,
    queryFn: ({ signal }) => api.searchExternal(`${query} ${artist}`.trim(), signal),
  });
  const fromCatalogue = (external.data?.external_albums ?? []).filter((e) => !inLibrary.some((a) => same(a.name, e.name) && same(a.artist, e.artist))).slice(0, 6);
  const name = text.trim() || title;
  return (
    <div className={LABEL}>
      <span>Album</span>
      <input className={ui.input} type="search" placeholder="Search for the album" aria-label="Search for the album" value={text} onChange={(e) => setText(e.target.value)} />
      <div className={PANEL}>
        {inLibrary.length > 0 && <p className="px-2.5 pt-1.5 text-[.8rem] font-bold text-muted">In your library</p>}
        {inLibrary.map((a) => (
          <button key={a.id} type="button" className={OPTION} onClick={() => onChoose({ kind: "library", album: a })}>
            <Picture src={api.coverUrl(a.cover, 96)} />
            <div className={ui.text}><b>{a.name}</b><span>{[a.artist, a.year].filter(Boolean).join(" · ")}</span></div>
          </button>
        ))}
        {query.length >= 2 && (
          <p className="flex items-center gap-2 px-2.5 pt-2 text-[.8rem] font-bold text-muted">
            From the catalogue{external.isFetching && <Ring percent={-1} size={14} />}
          </p>
        )}
        {fromCatalogue.map((a) => (
          <button key={a.id} type="button" className={OPTION} onClick={() => onChoose({ kind: "catalog", album: a })}>
            <Picture src={a.cover_url} external />
            <div className={ui.text}><b>{a.name}</b><span>{[a.artist, a.album_type, a.year].filter(Boolean).join(" · ")}</span></div>
          </button>
        ))}
        {query.length >= 2 && !external.isFetching && fromCatalogue.length === 0 && <p className="px-2.5 py-1 text-[.85rem] text-muted">{external.error ? "The catalogue did not answer" : "Nothing more in the catalogue"}</p>}
        <button type="button" className={OPTION} onClick={() => onChoose({ kind: "new", name, artists: [], date: year ? String(year) : "", cover: "video" })}>
          <span className="size-12 flex-none grid place-items-center rounded-[10px] bg-ghost text-accent"><Icon name="plus" size={20} /></span>
          <div className={ui.text}><b>{name ? `New album “${name}”` : "New album"}</b><span>Not found? Describe it yourself</span></div>
        </button>
      </div>
    </div>
  );
}

function NewAlbumFields({ album, preview, onChange }: { album: NewAlbum; preview: MediaPreview; onChange: (album: NewAlbum) => void }) {
  async function pick(file: File) {
    try {
      const blob = await pictureToCover(file);
      if (album.picture) URL.revokeObjectURL(album.picture.url);
      onChange({ ...album, cover: "upload", picture: { blob, url: URL.createObjectURL(blob) } });
    } catch (e) { toast((e as Error).message); }
  }
  const coverChip = (value: NewAlbum["cover"], label: string) => (
    <button type="button" className={ui.chip} aria-pressed={album.cover === value} onClick={() => onChange({ ...album, cover: value })}>{label}</button>
  );
  return (
    <div className="grid gap-4">
      <label className={LABEL}><span>Album name</span><input className={ui.input} value={album.name} maxLength={200} onChange={(e) => onChange({ ...album, name: e.target.value })} /></label>
      <ArtistsField label="Album artist" value={album.artists} onChange={(artists) => onChange({ ...album, artists })} placeholder={album.artists.length ? "Add another" : "The song's artists, unless you say otherwise"} />
      <label className={LABEL}><span>Year or date</span><input className={cx(ui.input, "max-w-60")} placeholder="2021 or 2021-05-14" inputMode="numeric" value={album.date} onChange={(e) => onChange({ ...album, date: e.target.value })} /></label>
      <div className={LABEL}>
        <span>Cover</span>
        <div className="flex items-center gap-3.5">
          {album.cover === "video" && preview.thumbnail && <img className="size-20 rounded-[14px] object-cover bg-surface-2" src={`https://i.ytimg.com/vi/${preview.id}/mqdefault.jpg`} alt="" referrerPolicy="no-referrer" />}
          {album.cover === "upload" && album.picture && <img className="size-20 rounded-[14px] object-cover bg-surface-2" src={album.picture.url} alt="" />}
          {album.cover === "" && <span className={cx("size-20 rounded-[14px]", ui.noCover)}><Icon name="image" size={22} /></span>}
          <div className="flex flex-wrap gap-2">
            {coverChip("video", "The video's picture")}
            <label className={cx(ui.chip, "cursor-pointer")} aria-pressed={album.cover === "upload"}>
              Choose a picture<input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ""; }} />
            </label>
            {coverChip("", "None")}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The album chosen, with a way back to choosing. */
function ChosenAlbum({ choice, onChange }: { choice: Exclude<AlbumChoice, { kind: "new" }>; onChange: () => void }) {
  const a = choice.album;
  const cover = choice.kind === "library" ? <Picture src={api.coverUrl(choice.album.cover, 160)} className="size-16 rounded-[12px] object-cover bg-surface-2 flex-none" />
    : <Picture src={choice.album.cover_url} external className="size-16 rounded-[12px] object-cover bg-surface-2 flex-none" />;
  return (
    <div className={LABEL}>
      <span>Album</span>
      <div className={cx(PANEL, "flex! items-center gap-3 p-3!")}>
        {cover}
        <div className={ui.text}><b>{a.name}</b><span>{[a.artist, a.year].filter(Boolean).join(" · ")}</span><span>{choice.kind === "library" ? "In your library" : "From the catalogue"}</span></div>
        <button type="button" className={ui.pill} onClick={onChange}>Change</button>
      </div>
    </div>
  );
}

/** For an album from the catalogue: which of its songs this is, which also gives its number. */
function CatalogTracks({ id, onPick, picked }: { id: string; picked: number; onPick: (t: { title: string; track: number; disc: number }) => void }) {
  const { data, isPending } = useQuery({ queryKey: ["catalog-album", id], queryFn: () => api.getCatalogAlbum(id), retry: false });
  if (isPending) return <Skeleton rows={2} />;
  if (!data?.tracks.length) return null;
  return (
    <div className={LABEL}>
      <span>Which song is it?</span>
      <div className={cx(PANEL, "max-h-80 overflow-y-auto")}>
        {data.tracks.map((t) => (
          <button key={t.id} type="button" className={OPTION} aria-pressed={picked === t.track} onClick={() => onPick({ title: t.title, track: t.track, disc: t.disc })}>
            <span className={cx(ui.num, picked === t.track && "text-accent font-bold")}>{t.track}</span>
            <div className={ui.text}><b className={picked === t.track ? "text-accent" : undefined}>{t.title}</b><span>{t.artist}</span></div>
            {t.library && <span className={BADGE}>In your library</span>}
            <span className={ui.time}>{t.duration ? clock(t.duration) : ""}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- The form ----------------

function Form({ link, onChangeLink }: { link: string; onChangeLink: () => void }) {
  const { data: preview, error, isPending } = useQuery({ queryKey: ["media-preview", link], queryFn: () => api.mediaPreview(link), retry: false, staleTime: 60_000 });
  if (isPending) return <div className={PAGE}><Skeleton rows={3} /></div>;
  if (error) return <div className={PAGE}><Welcome title="Could not read that link"><p>{error.message}</p><button className={ui.pill} onClick={onChangeLink}>Try another link</button></Welcome></div>;
  if (preview.live) return <div className={PAGE}><Video preview={preview} onChange={onChangeLink} /><p className="text-muted">This is a live stream, which cannot be added.</p></div>;
  return <SongForm link={link} preview={preview} onChangeLink={onChangeLink} />;
}

function Video({ preview, onChange }: { preview: MediaPreview; onChange: () => void }) {
  return (
    <div className="flex gap-3.5 items-center">
      <div className="relative flex-none w-[40%] max-w-50 aspect-video rounded-card overflow-hidden bg-surface-2 grid place-items-center">
        {preview.thumbnail ? <img className="size-full object-cover" src={preview.thumbnail} alt="" referrerPolicy="no-referrer" /> : <Icon name="play" size={28} />}
        {preview.duration > 0 && <span className="absolute right-1.5 bottom-1.5 px-1.75 py-0.5 rounded-md bg-black/70 text-white text-[.75rem] tabular-nums">{clock(preview.duration)}</span>}
      </div>
      <div className="grid gap-0.75 min-w-0 [&>b]:wrap-anywhere [&>span]:text-muted [&>span]:text-[.88rem]">
        <b>{preview.title}</b><span>{preview.channel}</span>
        <button type="button" className={cx(ui.link, "justify-self-start text-[.88rem] font-semibold")} onClick={onChange}>Another link</button>
      </div>
    </div>
  );
}

function SongForm({ link, preview, onChangeLink }: { link: string; preview: MediaPreview; onChangeLink: () => void }) {
  const navigate = useNavigate();
  const guess = useMemo(() => guessSong(preview), [preview]);
  const [title, setTitle] = useState(guess.title);
  const [artists, setArtists] = useState(guess.artists);
  const [choice, setChoice] = useState<AlbumChoice | null>(null);
  const [track, setTrack] = useState("");
  const [disc, setDisc] = useState("");
  const [busy, setBusy] = useState(false);
  const [startedHere, setStartedHere] = useState(false);
  const job = liveJob(useJobs((s) => s.jobs[`link:${preview.id}`]));
  const current = job && (startedHere || (job.state !== "ready" && job.state !== "error")) ? job : undefined;

  // The library album the song joins: its songs, to warn about one already there and suggest the next number
  const libraryAlbum = useQuery({ queryKey: ["album", choice?.kind === "library" ? choice.album.id : ""], queryFn: () => api.getAlbum((choice as { album: Album }).album.id), enabled: choice?.kind === "library" });
  const looked = useDebounced(title.trim());
  const already = useQuery({ queryKey: ["search", looked], queryFn: ({ signal }) => api.search(looked, signal), enabled: looked.length > 1, staleTime: 30_000 });
  const twin = (already.data?.songs ?? []).map(api.toSong).find((s) => same(s.title, title) && artists.some((a) => s.artist.toLowerCase().includes(a.toLowerCase())));
  useEffect(() => {
    const songs = libraryAlbum.data?.songs;
    if (songs && track === "") setTrack(String(songs.length + 1));
  }, [libraryAlbum.data, track]);

  const missing = !title.trim() ? "Give the song a title" : !artists.length ? "Add who made it" : !choice ? "Choose its album" : choice.kind === "new" && !choice.name.trim() ? "Give the album a name" : "";

  async function submit() {
    if (missing || !choice) { toast(missing); return; }
    setBusy(true);
    try {
      let album: AddSongRequest["album"];
      if (choice.kind === "library") album = { library: choice.album.id };
      else if (choice.kind === "catalog") album = { catalog: choice.album.id };
      else {
        const cover = choice.cover === "upload" && !choice.picture ? "" : choice.cover;
        album = { name: choice.name.trim(), artists: choice.artists, date: choice.date.trim(), cover, picture: cover === "upload" && choice.picture ? await blobToBase64(choice.picture.blob) : undefined };
      }
      await requestAddSong({ url: link, title: title.trim(), artists, track: Number(track) || 0, disc: Number(disc) || 0, album });
      setStartedHere(true);
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  }

  async function openAlbum(id: string) {
    try {
      const song = (await api.subsonic("getSong", { id })).song as { albumId?: string };
      if (song.albumId) navigate(`/album/${song.albumId}`);
    } catch (e) { toast((e as Error).message); }
  }

  let action: ReactNode;
  if (current?.state === "error") {
    action = <><p className="text-danger text-[.9rem]">{current.error}</p><button className={ui.pill} onClick={() => void submit()}>Try again</button></>;
  } else if (current?.state === "ready") {
    action = (
      <>
        <div className="flex items-center gap-2.5 font-[650] text-accent"><Icon name="check" />{`Added to ${current.album}`}</div>
        <div className="flex flex-wrap gap-2.5">
          {current.library_id && <button className={ui.primary} onClick={() => void openAlbum(current.library_id!)}>Open the album</button>}
          <button className={ui.pill} onClick={onChangeLink}><Icon name="plus" size={16} />Add another</button>
        </div>
      </>
    );
  } else if (current) {
    const downloading = current.state === "downloading";
    action = <div className="flex items-center gap-2.5 font-[650] text-accent"><Ring percent={downloading && current.progress > 0 ? current.progress : -1} size={26} />{downloading ? `Downloading ${Math.round(current.progress)}%` : current.state === "queued" ? "Waiting its turn…" : "Saving it…"}</div>;
  } else {
    action = (
      <>
        {missing && <p className="text-muted text-[.88rem]">{missing}</p>}
        <div><button className={ui.primary} type="button" disabled={busy || missing !== ""} onClick={() => void submit()}>{busy ? <Ring percent={-1} size={20} /> : <Icon name="download" size={20} />}Add to library</button></div>
      </>
    );
  }
  const locked = current !== undefined && current.state !== "error";

  return (
    <div className={PAGE}>
      <Video preview={preview} onChange={onChangeLink} />
      <fieldset className="grid gap-5 disabled:opacity-60" disabled={locked}>
        <label className={LABEL}><span>Title</span><input className={ui.input} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></label>
        <ArtistsField label="Artists" value={artists} onChange={setArtists} placeholder={artists.length ? "Add another artist" : "Who made it"} />
        {twin && (
          <p className={cx(ui.banner, "mx-0! mt-0!")}><Icon name="check" size={18} />{`Already in your library: “${twin.title}” on ${twin.album || "no album"}.`}</p>
        )}
        {!choice && <AlbumSearch initial={preview.music?.album ?? ""} artist={artists[0] ?? ""} title={title.trim()} year={preview.music?.year} onChoose={(c) => { setChoice(c); setTrack(""); }} />}
        {choice && choice.kind !== "new" && <ChosenAlbum choice={choice} onChange={() => setChoice(null)} />}
        {choice?.kind === "new" && (
          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-3 px-1.5"><b className="font-title text-[1.2rem]">New album</b><button type="button" className={ui.pill} onClick={() => setChoice(null)}>Search again</button></div>
            <NewAlbumFields album={choice} preview={preview} onChange={(a) => setChoice({ kind: "new", ...a })} />
          </div>
        )}
        {choice?.kind === "catalog" && <CatalogTracks id={choice.album.id} picked={Number(track) || 0} onPick={(t) => { setTitle(t.title); setTrack(String(t.track)); setDisc(t.disc > 1 ? String(t.disc) : ""); }} />}
        {libraryAlbum.data?.songs.some((s) => same(s.title, title)) && <p className="text-danger text-[.9rem] px-1.5">{`“${title.trim()}” is already on this album.`}</p>}
        {choice && (
          <div className="flex flex-wrap gap-4">
            <label className={LABEL}><span>Track</span><input className={NUMBER} inputMode="numeric" placeholder="—" value={track} onChange={(e) => setTrack(e.target.value.replace(/\D/g, "").slice(0, 3))} /></label>
            <label className={LABEL}><span>Disc</span><input className={NUMBER} inputMode="numeric" placeholder="—" value={disc} onChange={(e) => setDisc(e.target.value.replace(/\D/g, "").slice(0, 2))} /></label>
          </div>
        )}
      </fieldset>
      <div className="grid gap-2.5 justify-items-start">{action}</div>
    </div>
  );
}
