// Imported audio: podcasts, audiobooks and anything else pasted from a YouTube link. Only the sound is kept.
// The import card (shown in Search when you paste a link), which files a podcast episode or an audiobook part under its
// show or book, and the Library's list of everything else (views/spoken.tsx has the Podcasts and Audiobooks sections).
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import * as api from "../lib/api";
import { clock } from "../lib/format";
import { queryClient } from "../lib/query";
import { sorted } from "../lib/sorting";
import type { Collection, MediaItem, MediaKind, MediaPreview, Song } from "../lib/types";
import { cx, ui } from "../lib/ui";
import { Empty, Skeleton, Welcome } from "../components/common";
import { Tile } from "../components/cards";
import { SongCover } from "../components/Cover";
import { Icon, Ring } from "../components/Icon";
import { isAdmin } from "../stores/admin";
import { isActive, requestMedia, useJobs } from "../stores/downloads";
import * as offline from "../stores/offline";
import * as player from "../stores/player";
import { saveOffline } from "../stores/saving";
import { useOnline, useSettings, useSort } from "../stores/settings";
import { askText, openSheet, toast } from "../stores/ui";

const IMPORT = "grid gap-3 px-4 pt-2 pb-6 wide:px-8 wide:max-w-190";
const DONE = "flex items-center gap-2.5 font-[650] text-accent";

const CATEGORY_HINT: Record<MediaKind, string> = {
  podcast: "An episode of a show. It remembers where you stopped, on every device",
  audiobook: "A whole book or one part of it. Mark its chapters, bookmark moments and take notes",
  other: "Anything else: lectures, talks, sounds",
};

const AUTOMATIC = "";
const pageOf = (kind: MediaKind, collection: string) =>
  kind === "other" ? "/library/other" : collection ? `/${kind === "podcast" ? "podcast" : "book"}/${collection}` : kind === "podcast" ? "/podcasts" : "/audiobooks";

/** Which show or book an import goes into: one there is, a new one, or one named after the channel. */
function CollectionPicker({ kind, channel, value, onChange }: { kind: "podcast" | "audiobook"; channel: string; value: string; onChange: (id: string) => void }) {
  const { data } = useQuery({ queryKey: ["collections", kind], queryFn: () => api.listCollections(kind) });
  const one = kind === "podcast" ? "show" : "book";
  const make = async () => {
    const answer = await askText({ title: kind === "podcast" ? "New show" : "New book", label: "Title", initial: channel, confirm: "Make it", maxLength: 200 });
    if (!answer || answer.text === "") return;
    try {
      const c = await api.createCollection(kind, { title: answer.text, author: kind === "podcast" ? channel : "" });
      queryClient.setQueryData<Collection[]>(["collections", kind], (list) => [...(list ?? []), c]);
      onChange(c.id);
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <div className="grid gap-2">
      <div className={ui.groupTitle}>{kind === "podcast" ? "Which show?" : "Which book?"}</div>
      <div className="flex flex-wrap gap-2 items-center">
        <select className={cx(ui.input, "w-auto max-w-full pr-8")} aria-label={kind === "podcast" ? "Show" : "Book"} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value={AUTOMATIC}>{`A ${one} named “${channel || "Unsorted"}”`}</option>
          {(data ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <button type="button" className={ui.pill} onClick={() => void make()}><Icon name="plus" size={16} />{`New ${one}`}</button>
      </div>
    </div>
  );
}

// ---------------- Import card (Search) ----------------

export function ImportPanel({ link }: { link: string }) {
  const { data, error, isPending } = useQuery({ queryKey: ["media-preview", link], queryFn: () => api.mediaPreview(link), retry: false, staleTime: 60_000 });
  if (isPending) return <div className={IMPORT}><Skeleton rows={2} /></div>;
  if (error) return <div className={IMPORT}><Welcome title="Could not read that link"><p>{error.message}</p></Welcome></div>;
  return <div className={IMPORT}><PreviewCard link={link} preview={data} /></div>;
}

function PreviewCard({ link, preview }: { link: string; preview: MediaPreview }) {
  const navigate = useNavigate();
  const [kind, setKind] = useState<MediaKind | "song">(preview.music ? "song" : "podcast"); // YouTube Music says when it is a song
  const [collection, setCollection] = useState(AUTOMATIC);
  const pick = (k: MediaKind | "song") => { setKind(k); setCollection(AUTOMATIC); };
  const job = useJobs((s) => s.jobs[`media:${preview.id}`]);
  // A running job (started earlier or from another device) is picked up again. A finished one is history unless
  // this card started it: the item may have been deleted since.
  const [startedHere, setStartedHere] = useState(false);
  const current = job && (isActive(job) || startedHere) ? job : undefined;
  const start = useMutation({
    mutationFn: () => requestMedia(link, kind === "song" ? "other" : kind, kind === "podcast" || kind === "audiobook" ? collection : ""),
    onSuccess: (result) => {
      if (result.existing) { toast("Already in your library"); navigate(pageOf(result.existing.kind, result.existing.parent ?? "")); return; }
      setStartedHere(true);
    },
    onError: (e) => toast(e.message),
  });

  const head = (
    <div className="flex gap-3.5 items-center">
      <div className="relative flex-none w-[46%] max-w-55 aspect-video rounded-card overflow-hidden bg-surface-2 grid place-items-center">
        {preview.thumbnail ? <img className="size-full object-cover" src={preview.thumbnail} alt="" referrerPolicy="no-referrer" /> : <Icon name="play" size={28} />}
        {preview.duration > 0 && <span className="absolute right-1.5 bottom-1.5 px-1.75 py-0.5 rounded-md bg-black/70 text-white text-[.75rem] tabular-nums">{clock(preview.duration)}</span>}
      </div>
      <div className="grid gap-0.75 min-w-0 [&>b]:wrap-anywhere [&>span]:text-muted [&>span]:text-[.88rem]"><b>{preview.title}</b><span>{preview.channel}</span></div>
    </div>
  );

  if (preview.existing) {
    const where = api.kindLabel(preview.existing.kind);
    return (
      <>
        {head}
        <p className={ui.note}>{`Already in your library as ${where}.`}</p>
        <button className={ui.primary} onClick={() => navigate(pageOf(preview.existing!.kind, preview.existing!.parent ?? ""))}>{`Open ${where}`}</button>
      </>
    );
  }
  if (preview.live) return <>{head}<p className={ui.note}>This is a live stream, which cannot be imported.</p></>;

  let action;
  if (current?.state === "error") {
    action = <><p className={cx(ui.note, "text-danger!")}>{current.error}</p><button className={ui.pill} onClick={() => start.mutate()}>Try again</button></>;
  } else if (current?.state === "ready") {
    const label = api.kindLabel(current.kind);
    action = (
      <>
        <div className={DONE}><Icon name="check" />{`Added to ${label}`}</div>
        <button className={ui.primary} onClick={() => navigate(pageOf((current.kind ?? "other") as MediaKind, collection))}>{`Open ${label}`}</button>
      </>
    );
  } else if (current) {
    const downloading = current.state === "downloading";
    action = <div className={DONE}><Ring percent={downloading && current.progress > 0 ? current.progress : -1} size={26} />{downloading ? `Downloading ${Math.round(current.progress)}%` : "Getting ready…"}</div>;
  } else if (kind === "song") {
    action = <button className={ui.primary} type="button" onClick={() => navigate(`/add-song?url=${encodeURIComponent(link)}`)}>Continue</button>;
  } else {
    action = <button className={ui.primary} type="button" disabled={start.isPending} onClick={() => start.mutate()}><Icon name="download" size={20} />Add audio to library</button>;
  }

  return (
    <>
      {head}
      <div className={ui.groupTitle}>What is it?</div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="What is it?">
        <button type="button" className={ui.chip} aria-pressed={kind === "song"} onClick={() => pick("song")}>Song</button>
        {api.KINDS.map(([value, label]) => <button key={value} type="button" className={ui.chip} aria-pressed={kind === value} onClick={() => pick(value)}>{label}</button>)}
      </div>
      {(kind === "podcast" || kind === "audiobook") && !current && <CollectionPicker kind={kind} channel={preview.channel} value={collection} onChange={setCollection} />}
      {(preview.chapters ?? 0) > 0 && (kind === "podcast" || kind === "audiobook") && <p className="text-[.9rem] text-muted flex items-center gap-1.5"><Icon name="chapters" size={16} />{`Its ${preview.chapters} chapters come with it`}</p>}
      <p className={ui.note}>{kind === "song" ? "A song joins your music, with the title, artists and album you give it next." : `${CATEGORY_HINT[kind]}. Only the audio is downloaded, and it stays apart from your music.`}</p>
      <div className="grid gap-2.5 justify-items-start mt-1.5">{action}</div>
    </>
  );
}

// ---------------- Library sections ----------------

const savedPercent = (item: MediaItem) => {
  const at = player.savedPosition(`m-${item.id}`);
  return item.duration && at ? Math.min(99, Math.round((at / item.duration) * 100)) : 0;
};

function itemMenu(item: MediaItem, song: Song): void {
  openSheet(item.title, item.channel, [
    offline.isSaved(song.id)
      ? { icon: "trash", label: "Remove from this device", danger: true, run: () => void offline.remove(song.id).then(() => toast("Removed from this device")) }
      : { icon: "offline", label: "Save for offline", run: () => void saveOffline(song) },
    // Whoever added it may delete it, or an administrator; the server checks again
    (isAdmin() || (item.added_by !== undefined && item.added_by.toLowerCase() === api.username().toLowerCase())) && { icon: "trash", label: "Delete for everyone", danger: true, run: async () => {
      if (!confirm(`Delete “${item.title}” for everyone?\n\nThe file is erased from the server. This cannot be undone.`)) return;
      try {
        await api.deleteMedia(item.id);
        await offline.remove(song.id);
        player.forgetSong(song.id);
        player.clearPosition(song.id);
        toast("Deleted");
        void queryClient.invalidateQueries({ queryKey: ["media"] });
      } catch (e) { toast((e as Error).message); }
    } },
  ]);
}

export function MediaLibrary({ kind }: { kind: MediaKind }) {
  const online = useOnline();
  offline.useOfflineVersion();
  const navigate = useNavigate();
  const sort = useSort(kind);
  const { data, error, isPending } = useQuery({ queryKey: ["media", kind], queryFn: () => api.listMedia(kind), enabled: online });
  const found: MediaItem[] | undefined = online ? data
    : offline.list().filter((s) => s.kind === kind && s.mediaId).map((s) => ({ id: s.mediaId!, kind, title: s.title, channel: s.artist, duration: s.duration ?? 0, size: s.size }));
  const items = found && sorted(found, sort, (item) => ({ name: item.title, artist: item.channel, when: item.added_at, length: item.duration }));
  const label = api.kindLabel(kind);
  const view = useSettings((s) => s.libraryView);

  let body;
  if (online && isPending) body = <Skeleton rows={2} />;
  else if (online && error) body = <Empty>{error.message}</Empty>;
  else if (!items?.length) {
    body = (
      <Welcome title={`No ${label.toLowerCase()}s yet`}>
        <p>Paste a YouTube link in Search, choose what it is, and its audio shows up here.</p>
      </Welcome>
    );
  } else {
    const songs = items.map((item) => api.mediaSong(item));
    body = view === "grid" ? (
      <div className={ui.grid}>
        {items.map((item, i) => {
          const percent = savedPercent(item);
          return <Tile key={item.id} art={<SongCover song={songs[i]} size={300} className={cx(ui.coverBig, ui.cardCover)} />} title={item.title}
            subtitle={[item.channel, percent ? `${percent}% played` : ""].filter(Boolean).join(" · ")} onOpen={() => player.play(songs, i)} onMenu={() => itemMenu(item, songs[i])} />;
        })}
      </div>
    ) : (
      <ul className={ui.rows}>
        {items.map((item, i) => {
          const percent = savedPercent(item);
          return (
            <li className={ui.row} key={item.id} data-id={songs[i].id} onClick={() => player.play(songs, i)}>
              <SongCover song={songs[i]} />
              <div className={ui.text}>
                <b>{item.title}</b>
                <span>{[item.channel, item.duration ? clock(item.duration) : "", percent ? `${percent}% played` : ""].filter(Boolean).join(" · ")}</span>
              </div>
              <button className={ui.rowMore} aria-label="More" onClick={(e) => { e.stopPropagation(); itemMenu(item, songs[i]); }}><Icon name="more" size={20} /></button>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <>
      <div className="px-4 pt-1 pb-1.5 wide:px-8"><button className={ui.pill} onClick={() => navigate("/search")}><Icon name="plus" size={16} />Add from YouTube link</button></div>
      {body}
    </>
  );
}
