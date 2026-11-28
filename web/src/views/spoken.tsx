// Podcasts and audiobooks, each a section of its own: a shelf of books with where you are in each, the page of a book
// (its parts and chapters, your bookmarks and notes, what it is about), the shows you follow with their newest
// episodes, the page of a show, and making or changing a show or a book. The library's Songs-style lists stay for music.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import * as api from "../lib/api";
import { clock } from "../lib/format";
import { queryClient } from "../lib/query";
import { bookPosition, itemState, progressRatio, resumePoint, spokenLength, type ItemState, type Progress } from "../lib/spoken";
import type { Collection, CollectionEdit, CollectionSpec, ContinueItem, Job, MediaItem, Song } from "../lib/types";
import { cx, ui } from "../lib/ui";
import { isPlaylistLink, videoIdOf } from "../lib/youtube";
import { DownloadToggle } from "../components/cards";
import { DetailPage, Empty, OfflineBanner, Section, Shelf, Skeleton, Welcome } from "../components/common";
import { Picture, SongCover } from "../components/Cover";
import { Icon, Ring } from "../components/Icon";
import { ChapterList, MarkList } from "../components/SpokenControls";
import { isAdmin } from "../stores/admin";
import { isActive, requestMedia, useJobs } from "../stores/downloads";
import { useIsCurrent } from "../stores/connect";
import * as offline from "../stores/offline";
import * as player from "../stores/player";
import { removeOffline, saveOffline, syncCollectionIfSaved } from "../stores/saving";
import { useOnline } from "../stores/settings";
import { flush, progressOf, useSpoken } from "../stores/spoken";
import { cancel, clearDone, sendFiles, useUploads } from "../stores/uploads";
import { askText, cropPicture, openSheet, toast } from "../stores/ui";

type Kind = Collection["kind"];
const WORDS = {
  podcast: { section: "Podcasts", one: "show", item: "episode", items: "episodes", author: "Host", page: "podcast", make: "New show" },
  audiobook: { section: "Audiobooks", one: "book", item: "part", items: "parts", author: "Author", page: "book", make: "Add book" },
} as const;

const showsKey = (kind: Kind) => ["collections", kind];
const collectionKey = (kind: Kind, id: string) => ["collection", kind, id];
const refreshShelves = () => {
  void queryClient.invalidateQueries({ queryKey: ["collections"] });
  void queryClient.invalidateQueries({ queryKey: ["collection"] });
  void queryClient.invalidateQueries({ queryKey: ["media"] });
  void queryClient.invalidateQueries({ queryKey: ["continue"] });
};

/** The person's progress in every item, redrawn whenever it changes. */
const useAllProgress = () => useSpoken((s) => s.progress);
const progressFrom = (all: Record<string, Progress>) => (id: string) => all[id] ?? progressOf(id);

/** A collection's picture: its own, or its first item's. */
function CollectionArt({ c, className }: { c: Pick<Collection, "id" | "kind" | "cover" | "thumb" | "count">; className: string }) {
  const src = c.cover || c.thumb ? api.collectionCoverUrl(c) : "";
  return <Picture src={src} className={className} />;
}

/** A thin bar of how far through something is. */
function ProgressBar({ ratio, className }: { ratio: number; className?: string }) {
  if (ratio <= 0) return null;
  return (
    <span className={cx("block h-1 rounded-full bg-[var(--slider)] overflow-hidden", className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
      <i className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(3, ratio * 100)}%` }} />
    </span>
  );
}

/** New (a dot), started (a ring of how far) or finished (a tick), at the end of a row. */
function StateMark({ state, ratio }: { state: ItemState; ratio: number }) {
  if (state === "finished") return <span className="flex-none text-accent" title="Finished" aria-label="Finished"><Icon name="check" size={18} /></span>;
  if (state === "started") return <span className="flex-none text-accent" title={`${Math.round(ratio * 100)}% heard`} aria-label={`${Math.round(ratio * 100)}% heard`}><Ring percent={Math.max(4, ratio * 100)} size={20} /></span>;
  return <span className="flex-none size-2.5 rounded-full bg-accent mx-1.75" title="New" aria-label="New" />;
}

const mine = (by?: string) => Boolean(by) && by!.toLowerCase() === api.username().toLowerCase();

/** What can be done with one episode or part. */
function itemMenu(item: MediaItem, song: Song, collection: Collection | undefined, songs: Song[], index: number): void {
  const p = progressOf(item.id);
  const finished = p?.finished === true;
  const canChange = mine(item.added_by) || isAdmin();
  openSheet(item.title, collection?.title ?? item.channel, [
    { icon: "play", label: "Play", run: () => player.play(songs, index) },
    { icon: "queue", label: "Play next", run: () => player.playNext(song) },
    finished || (p && p.position > 0)
      ? { icon: "history", label: "Mark as not heard", run: () => player.markFinished(song, false) }
      : { icon: "check", label: "Mark as finished", run: () => player.markFinished(song, true) },
    !finished && p && p.position > 0 && { icon: "check", label: "Mark as finished", run: () => player.markFinished(song, true) },
    offline.isSaved(song.id)
      ? { icon: "trash", label: "Remove from this device", run: () => void removeOffline(song) }
      : { icon: "offline", label: "Save offline", run: () => void saveOffline(song) },
    canChange && { icon: "pencil", label: "Rename", run: async () => {
      const answer = await askText({ title: "Rename", label: "Title", initial: item.title, maxLength: 200 });
      if (!answer || answer.text === "") return;
      try { await api.editMedia(item.id, { title: answer.text }); refreshShelves(); } catch (e) { toast((e as Error).message); }
    } },
    canChange && { icon: "note", label: item.description ? "Edit the description" : "Add a description", run: async () => {
      const answer = await askText({ title: "Description", label: "What it is about", initial: item.description, multiline: true });
      if (!answer) return;
      try { await api.editMedia(item.id, { description: answer.text }); refreshShelves(); } catch (e) { toast((e as Error).message); }
    } },
    canChange && collection && { icon: "library", label: `Move to another ${WORDS[collection.kind].one}`, run: () => void moveItem(item, collection) },
    canChange && { icon: "trash", label: "Delete for everyone", danger: true, run: async () => {
      if (!confirm(`Delete “${item.title}” for everyone?\n\nThe file is erased from the server. This cannot be undone.`)) return;
      try {
        await api.deleteMedia(item.id);
        await offline.remove(song.id);
        player.forgetSong(song.id);
        toast("Deleted");
        refreshShelves();
      } catch (e) { toast((e as Error).message); }
    } },
  ]);
}

async function moveItem(item: MediaItem, from: Collection): Promise<void> {
  const others = (await api.listCollections(from.kind).catch(() => [] as Collection[])).filter((c) => c.id !== from.id);
  if (!others.length) { toast(`There is no other ${WORDS[from.kind].one} yet`); return; }
  openSheet(`Move to another ${WORDS[from.kind].one}`, item.title, others.map((c) => ({
    icon: "library" as const, label: c.title, run: async () => {
      try { await api.editMedia(item.id, { parent: c.id }); toast(`Moved to ${c.title}`); refreshShelves(); } catch (e) { toast((e as Error).message); }
    },
  })));
}

/** One episode or part as a row: its picture, title, when or which part, length, and where you are in it. */
function ItemRow({ item, song, label, progress, onPlay, onMenu }: { item: MediaItem; song: Song; label: string; progress: Progress | undefined; onPlay: () => void; onMenu: () => void }) {
  const { current, playing } = useIsCurrent(song.id);
  const state = itemState(progress);
  const ratio = progressRatio(progress, item.duration);
  const left = state === "started" ? `${spokenLength(Math.max(0, item.duration - (progress?.position ?? 0)))} left` : item.duration ? spokenLength(item.duration) : "";
  return (
    <li className={ui.row} data-current={current || undefined} data-playing={playing || undefined} onClick={onPlay}>
      <SongCover song={song} />
      <div className={ui.text}>
        <b>{item.title}</b>
        <span>{[label, left, offline.isSaved(song.id) ? "on this device" : ""].filter(Boolean).join(" · ")}</span>
      </div>
      <StateMark state={state} ratio={ratio} />
      <button type="button" className={ui.rowMore} aria-label={`More about ${item.title}`} onClick={(e) => { e.stopPropagation(); onMenu(); }}><Icon name="more" size={20} /></button>
    </li>
  );
}

const dateOf = (item: MediaItem) => {
  const when = item.published || item.added_at;
  return when ? new Date(when * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
};

// ---------------- The sections: Podcasts and Audiobooks ----------------

type Filter = "all" | "started" | "new" | "finished";
const FILTERS: [Filter, string][] = [["all", "All"], ["started", "In progress"], ["new", "Not started"], ["finished", "Finished"]];

/** A book's place across all its parts. */
function bookProgress(items: MediaItem[], read: (id: string) => Progress | undefined) {
  const point = resumePoint(items, read);
  const all = items.length > 0 && items.every((it) => read(it.id)?.finished);
  const { heard, total } = bookPosition(items.map((it) => it.duration), point.index >= 0 && (point.position > 0 || point.index > 0) ? { part: point.index, position: point.position } : null);
  const state: ItemState = all ? "finished" : heard > 0 ? "started" : "new";
  return { point, heard: all ? total : heard, total, state, ratio: all ? 1 : total ? heard / total : 0 };
}

/** Play a collection from where the person is in it (a book), or from an item. */
function playFrom(collection: Collection, items: MediaItem[], index: number): void {
  const songs = items.map((it) => api.mediaSong(it, collection));
  player.play(songs, index, undefined, collection.title);
}

/** The newest thing you were in the middle of, large, with the rest beside it. Home shows both kinds. */
export function ContinueListening({ kind }: { kind?: Kind }) {
  const online = useOnline();
  useAllProgress(); // redraw as positions move
  // What this device heard last goes to the server first, or the list would leave it out
  const { data } = useQuery({ queryKey: ["continue"], queryFn: async () => { await flush(); return api.continueListening(); }, enabled: online });
  const items = (data ?? []).filter((c) => (kind ? c.item.kind === kind : c.item.kind !== "other"));
  if (!items.length) return null;
  const [first, ...rest] = items;
  return (
    <Section title="Continue listening">
      <div className="px-4 grid gap-3.5 wide:px-8 @4xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <ContinueCard entry={first} big />
        {rest.length > 0 && <ul className="grid gap-2 content-start">{rest.slice(0, 4).map((c) => <li key={c.item.id}><ContinueCard entry={c} /></li>)}</ul>}
      </div>
    </Section>
  );
}

function ContinueCard({ entry, big }: { entry: ContinueItem; big?: boolean }) {
  const c = entry.collection;
  const song = api.mediaSong(entry.item, c);
  const p = progressOf(entry.item.id) ?? entry.progress;
  const ratio = progressRatio(p, entry.item.duration);
  const left = spokenLength(Math.max(0, entry.item.duration - p.position));
  const to = c ? `/${WORDS[c.kind].page}/${c.id}` : "";
  const play = () => player.play([song], 0, undefined, c?.title ?? "");
  if (!big) {
    return (
      <div className="tap flex items-center gap-3 p-2 pr-3 rounded-[18px] bg-ghost hover:brightness-125 cursor-pointer" onClick={play}>
        <SongCover song={song} size={96} className="size-14 flex-none rounded-xl object-cover bg-surface-2" />
        <span className="flex-1 min-w-0 grid gap-1">
          <b className="truncate font-semibold text-[.92rem]">{c?.title ?? entry.item.title}</b>
          <span className="truncate text-muted text-[.8rem]">{c && entry.item.title !== c.title ? `${entry.item.title} · ${left} left` : `${left} left`}</span>
          <ProgressBar ratio={ratio} />
        </span>
        <span className="flex-none size-10 grid place-items-center rounded-full bg-text text-bg"><Icon name="play" size={16} /></span>
      </div>
    );
  }
  return (
    <div className="relative isolate overflow-hidden flex items-center gap-4 p-4 rounded-[28px] wide:gap-5 wide:p-5 bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)]">
      <SongCover song={song} size={96} className="absolute inset-0 -z-10 size-full object-cover scale-125 blur-2xl saturate-150 opacity-60" />
      {to ? <Link to={to} className="flex-none w-[clamp(104px,34%,180px)]" aria-label={c?.title}><SongCover song={song} size={400} className="w-full h-auto aspect-square rounded-big object-cover bg-surface-3 shadow-[0_18px_40px_rgb(0_0_0/.45)]" /></Link>
        : <SongCover song={song} size={400} className="flex-none w-[clamp(104px,34%,180px)] h-auto aspect-square rounded-big object-cover bg-surface-3" />}
      <div className="flex-1 min-w-0 grid gap-1 justify-items-start">
        <span className="text-[.8rem] font-semibold">Continue listening</span>
        <b className="w-full font-title text-[clamp(1.35rem,3cqi,2.2rem)] font-bold leading-[1.05] tracking-[-.03em] line-clamp-2">{c?.title ?? entry.item.title}</b>
        <span className="w-full truncate font-medium">{c && entry.item.title !== c.title ? entry.item.title : c?.author || entry.item.channel}</span>
        <ProgressBar ratio={ratio} className="w-full mt-1.5" />
        <span className="text-[.82rem] text-muted">{`${left} left`}</span>
        <button type="button" className={cx(ui.primary, "mt-2")} onClick={play}><Icon name="play" size={20} />Continue</button>
      </div>
    </div>
  );
}

/** What is saved on this device, when there is no connection. */
function OfflineShelf({ kind }: { kind: Kind }) {
  offline.useOfflineVersion();
  const songs = offline.allSongs().filter((s) => s.kind === kind && s.mediaId);
  if (!songs.length) return <Welcome title="Nothing saved on this device"><p>{`When you are online, save ${WORDS[kind].items} or a whole ${WORDS[kind].one} to hear them here without a connection.`}</p></Welcome>;
  return (
    <ul className={ui.rows}>
      {songs.map((song, i) => (
        <li key={song.id} className={ui.row} onClick={() => player.play(songs, i)}>
          <SongCover song={song} />
          <div className={ui.text}><b>{song.title}</b><span>{[song.album, song.duration ? spokenLength(song.duration) : ""].filter(Boolean).join(" · ")}</span></div>
        </li>
      ))}
    </ul>
  );
}

function SectionHeader({ kind }: { kind: Kind }) {
  const navigate = useNavigate();
  const w = WORDS[kind];
  const online = useOnline();
  return (
    <>
      <header className={ui.hero}>
        <h1>{w.section}</h1>
        <p>{kind === "audiobook" ? "Your books, and where you are in each" : "Your shows and their newest episodes"}</p>
      </header>
      {online && (
        <div className={ui.actions}>
          <button type="button" className={ui.primary} onClick={() => navigate(`/${kind === "podcast" ? "podcasts" : "audiobooks"}/new`)}><Icon name="plus" size={20} />{w.make}</button>
          {kind === "podcast" && <button type="button" className={ui.pill} onClick={() => navigate("/search")}><Icon name="search" size={16} />Add from a YouTube link</button>}
        </div>
      )}
    </>
  );
}

/** Audiobooks: what you are reading, then the shelf. */
export function Audiobooks() {
  const online = useOnline();
  const all = useAllProgress();
  const read = progressFrom(all);
  const [filter, setFilter] = useState<Filter>("all");
  const books = useQuery({ queryKey: showsKey("audiobook"), queryFn: () => api.listCollections("audiobook"), enabled: online });
  const items = useQuery({ queryKey: ["media", "audiobook"], queryFn: () => api.listMedia("audiobook"), enabled: online });
  if (!online) return <><SectionHeader kind="audiobook" /><OfflineBanner /><OfflineShelf kind="audiobook" /></>;
  let body: ReactNode;
  if (books.isPending || items.isPending) body = <Skeleton rows={3} />;
  else if (books.error) body = <Empty>{books.error.message}</Empty>;
  else if (!books.data.length) {
    body = <Welcome title="No audiobooks yet"><p>Tap Add book: give it its details and a cover, then paste one YouTube link (the whole book in one video) or several (one per chapter).</p></Welcome>;
  } else {
    const byBook = new Map<string, MediaItem[]>();
    for (const it of items.data ?? []) byBook.set(it.parent ?? "", [...(byBook.get(it.parent ?? "") ?? []), it]);
    const shown = books.data
      .map((b) => ({ book: b, parts: [...(byBook.get(b.id) ?? [])].sort((x, y) => (x.part ?? 0) - (y.part ?? 0)) }))
      .map((b) => ({ ...b, progress: bookProgress(b.parts, read) }))
      .filter((b) => filter === "all" || b.progress.state === filter);
    body = (
      <>
        <div className={ui.segments} role="group" aria-label="Show">
          {FILTERS.map(([id, label]) => <button key={id} type="button" className={ui.segment} data-on={filter === id || undefined} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
        </div>
        {shown.length === 0 ? <Empty>Nothing here.</Empty> : (
          <div className={ui.grid}>
            {shown.map(({ book, progress }) => (
              <Link key={book.id} to={`/book/${book.id}`} className={ui.card}>
                <span className={ui.cardArt}>
                  <CollectionArt c={book} className={cx(ui.coverBig, ui.cardCover)} />
                  {progress.state === "finished" && <span className="absolute right-2 bottom-3.5 size-7 grid place-items-center rounded-full bg-accent text-accent-ink"><Icon name="check" size={16} /></span>}
                </span>
                <b>{book.title}</b>
                <span>{book.author || plainCount(book)}</span>
                {progress.state === "started" && <ProgressBar ratio={progress.ratio} className="mt-1.5" />}
              </Link>
            ))}
          </div>
        )}
      </>
    );
  }
  return (
    <>
      <SectionHeader kind="audiobook" />
      <ContinueListening kind="audiobook" />
      <Section title="Your books">{body}</Section>
    </>
  );
}

const plainCount = (c: Collection) => `${c.count} ${c.count === 1 ? WORDS[c.kind].item : WORDS[c.kind].items}${c.duration ? ` · ${spokenLength(c.duration)}` : ""}`;

/** Podcasts: your shows, and the newest episodes across them. */
export function Podcasts() {
  const online = useOnline();
  const all = useAllProgress();
  const read = progressFrom(all);
  const [unheard, setUnheard] = useState(false);
  const shows = useQuery({ queryKey: showsKey("podcast"), queryFn: () => api.listCollections("podcast"), enabled: online });
  const items = useQuery({ queryKey: ["media", "podcast"], queryFn: () => api.listMedia("podcast"), enabled: online });
  if (!online) return <><SectionHeader kind="podcast" /><OfflineBanner /><OfflineShelf kind="podcast" /></>;
  if (shows.isPending || items.isPending) return <><SectionHeader kind="podcast" /><Skeleton rows={3} /></>;
  if (shows.error) return <><SectionHeader kind="podcast" /><Empty>{shows.error.message}</Empty></>;
  const byId = new Map(shows.data.map((s) => [s.id, s]));
  const newest = [...(items.data ?? [])].sort((a, b) => (b.published || b.added_at || 0) - (a.published || a.added_at || 0))
    .filter((it) => !unheard || itemState(read(it.id)) !== "finished").slice(0, 30);
  const songs = newest.map((it) => api.mediaSong(it, byId.get(it.parent ?? "")));
  const unheardIn = (id: string) => (items.data ?? []).filter((it) => it.parent === id && itemState(read(it.id)) === "new").length;
  return (
    <>
      <SectionHeader kind="podcast" />
      <ContinueListening kind="podcast" />
      {!shows.data.length ? (
        <Welcome title="No podcasts yet"><p>Make a show, then add its episodes from YouTube links. Each one remembers where you stopped.</p></Welcome>
      ) : (
        <>
          <Section title="Your shows">
            <Shelf>
              {shows.data.map((s) => {
                const fresh = unheardIn(s.id);
                return (
                  <Link key={s.id} to={`/podcast/${s.id}`} className={ui.card}>
                    <span className={ui.cardArt}>
                      <CollectionArt c={s} className={cx(ui.coverBig, ui.cardCover)} />
                      {fresh > 0 && <span className="absolute left-2 top-2 px-2 py-0.5 rounded-full bg-accent text-accent-ink text-[.72rem] font-extrabold">{`${fresh} new`}</span>}
                    </span>
                    <b>{s.title}</b><span>{s.author || plainCount(s)}</span>
                  </Link>
                );
              })}
            </Shelf>
          </Section>
          <Section title="Latest episodes" action={<button type="button" className={ui.pill} data-on={unheard || undefined} aria-pressed={unheard} onClick={() => setUnheard(!unheard)}><Icon name="check" size={16} />Hide finished</button>}>
            {newest.length === 0 ? <Empty>Nothing new.</Empty> : (
              <ul className={ui.rows}>
                {newest.map((it, i) => {
                  const show = byId.get(it.parent ?? "");
                  return <ItemRow key={it.id} item={it} song={songs[i]} label={[show?.title, dateOf(it)].filter(Boolean).join(" · ")} progress={read(it.id)}
                    onPlay={() => player.play(songs, i, undefined, "Latest episodes")} onMenu={() => itemMenu(it, songs[i], show, songs, i)} />;
                })}
              </ul>
            )}
          </Section>
        </>
      )}
    </>
  );
}

// ---------------- Files from this device ----------------

const AUDIO_FILES = "audio/*,.m4b,.mp3,.m4a,.aac,.ogg,.opus,.flac,.wav";

/**
 * Add episodes or parts: files from this device (several at once for a book in parts: they join it in the order of their
 * names), or a YouTube link. One button, so the page's buttons fit a phone's width.
 */
function AddButton({ c }: { c: Collection }) {
  const navigate = useNavigate();
  const files = useRef<HTMLInputElement>(null);
  const what = c.kind === "podcast" ? "episodes" : "parts";
  return (
    <>
      <button type="button" className={ui.pill} onClick={() => openSheet(`Add ${what}`, c.title, [
        { icon: "upload", label: "Upload files from this device", run: () => files.current?.click() },
        c.kind === "audiobook" && c.can_edit
          ? { icon: "plus", label: "From YouTube links", run: () => navigate(`/book/${c.id}/edit`) }
          : { icon: "search", label: "From a YouTube link", run: () => navigate("/search") },
      ])}><Icon name="plus" size={16} />Add</button>
      <input ref={files} type="file" multiple accept={AUDIO_FILES} className="hidden" aria-label={`Upload ${what}`}
        onChange={(e) => { if (e.target.files?.length) sendFiles(e.target.files, c.kind, c.id); e.target.value = ""; }} />
    </>
  );
}

const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0)} MB`;

/** The files on their way to this show or book. */
function UploadList({ c }: { c: Collection }) {
  const all = useUploads((s) => s.list); // the whole list: a filtered copy would be new on every read, and loop
  const list = all.filter((u) => u.collection === c.id);
  if (!list.length) return null;
  return (
    <section className="mx-4 my-2 p-2 rounded-[22px] bg-glass-strong shadow-[inset_0_0_0_1px_var(--line)] wide:mx-8" aria-label="Uploads">
      <div className="flex items-center justify-between px-2 py-1">
        <b className="text-[.9rem]">Uploading</b>
        {list.some((u) => u.state === "done") && <button type="button" className="text-[.85rem] font-semibold text-muted hover:text-text" onClick={clearDone}>Clear finished</button>}
      </div>
      <ul className="grid">
        {list.map((u) => (
          <li key={u.key} className="flex items-center gap-3 px-2 py-2">
            <span className="flex-none text-accent">
              {u.state === "done" ? <Icon name="check" size={20} /> : u.state === "failed" ? <Icon name="close" size={20} /> : <Ring percent={u.state === "checking" || u.state === "waiting" ? -1 : (u.sent / u.size) * 100} size={22} />}
            </span>
            <span className="flex-1 min-w-0 grid">
              <b className="truncate font-[650] text-[.92rem]">{u.name}</b>
              <span className={cx("truncate text-[.8rem]", u.state === "failed" ? "text-danger" : "text-muted")}>
                {u.state === "waiting" ? "Waiting" : u.state === "checking" ? "Checking the file…" : u.state === "done" ? "Added" : u.state === "failed" ? u.error : `${megabytes(u.sent)} of ${megabytes(u.size)}`}
              </span>
            </span>
            {u.state !== "done" && <button type="button" className={ui.iconButton} aria-label={`Stop sending ${u.name}`} onClick={() => cancel(u.key)}><Icon name="close" size={18} /></button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The YouTube links on their way into this book or show. The page reloads its parts as each one is ready. */
function ImportList({ c }: { c: Collection }) {
  const jobs = useJobs((s) => s.jobs);
  const list = Object.values(jobs).filter((j) => j.parent === c.id && (isActive(j) || j.state === "error"));
  const running = list.filter(isActive).length;
  const before = useRef(running);
  useEffect(() => {
    if (running < before.current) refreshShelves(); // one finished: its part is in the book now
    before.current = running;
  }, [running]);
  if (!list.length) return null;
  return (
    <section className="mx-4 my-2 p-2 rounded-[22px] bg-glass-strong shadow-[inset_0_0_0_1px_var(--line)] wide:mx-8" aria-label="Downloading">
      <b className="block px-2 py-1 text-[.9rem]">Downloading from YouTube</b>
      <ul className="grid">{list.map((j) => <JobRow key={j.key} job={j} />)}</ul>
    </section>
  );
}

function JobRow({ job }: { job: Job }) {
  const downloading = job.state === "downloading" && job.progress > 0;
  return (
    <li className="flex items-center gap-3 px-2 py-2">
      <span className="flex-none text-accent">{job.state === "error" ? <Icon name="close" size={20} /> : <Ring percent={downloading ? job.progress : -1} size={22} />}</span>
      <span className="flex-1 min-w-0 grid">
        <b className="truncate font-[650] text-[.92rem]">{job.title}</b>
        <span className={cx("truncate text-[.8rem]", job.state === "error" ? "text-danger" : "text-muted")}>{job.state === "error" ? job.error : downloading ? `${Math.round(job.progress)}%` : "Waiting"}</span>
      </span>
    </li>
  );
}

// ---------------- One show or book ----------------

function collectionMenu(c: Collection, items: MediaItem[], navigate: ReturnType<typeof useNavigate>): void {
  const w = WORDS[c.kind];
  openSheet(c.title, c.author, [
    c.can_edit && { icon: "pencil", label: c.kind === "audiobook" ? "Edit book" : "Edit details", run: () => navigate(`/${w.page}/${c.id}/edit`) },
    c.can_edit && { icon: "trash", label: `Delete this ${w.one}`, danger: true, run: async () => {
      const question = items.length > 0
        ? `Delete “${c.title}” and its ${items.length === 1 ? `${w.item}` : `${items.length} ${w.items}`} for everyone?\n\nThe files are erased from the server. This cannot be undone.`
        : `Delete “${c.title}”?`;
      if (!confirm(question)) return;
      try {
        await api.deleteCollection(c.kind, c.id, items.length > 0);
        for (const it of items) {
          const song = api.mediaSong(it, c);
          await offline.remove(song.id);
          player.forgetSong(song.id);
        }
        toast("Deleted");
        refreshShelves();
        navigate(c.kind === "podcast" ? "/podcasts" : "/audiobooks", { replace: true });
      } catch (e) { toast((e as Error).message); }
    } },
  ]);
}

/** A description that can be long: a few lines, and the rest on request. */
function About({ text }: { text?: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const long = text.length > 280;
  return (
    <div className="px-5 pb-2 wide:px-8 @4xl:px-0">
      <p className={cx("text-[.95rem] whitespace-pre-wrap wrap-anywhere text-muted", long && !open && "line-clamp-4")}>{text}</p>
      {long && <button type="button" className="mt-1 font-semibold text-[.9rem] text-text" onClick={() => setOpen(!open)}>{open ? "Less" : "More"}</button>}
    </div>
  );
}

type BookTab = "chapters" | "marks" | "about";

/** The page of an audiobook: where you are, its parts or chapters, your bookmarks and notes, and what it is about. */
export function BookPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const online = useOnline();
  const all = useAllProgress();
  const read = progressFrom(all);
  const [tab, setTab] = useState<BookTab>("chapters");
  const jobs = useJobs((s) => s.jobs);
  const { data, error, isPending } = useQuery({ queryKey: collectionKey("audiobook", id), queryFn: () => api.getCollection("audiobook", id), enabled: online });
  if (!online) return <><OfflineBanner /><OfflineShelf kind="audiobook" /></>;
  if (isPending) return <Skeleton />;
  if (error) return <Empty>{error.message}</Empty>;
  const { collection: book, items, related = [] } = data;
  const songs = items.map((it) => api.mediaSong(it, book));
  const progress = bookProgress(items, read);
  const spec: CollectionSpec = { id: `book:${book.id}`, kind: "book", title: book.title, subtitle: book.author || "Audiobook" };
  void syncCollectionIfSaved(spec.id, songs);
  const resume = () => progress.point.index >= 0 && playFrom(book, items, progress.point.index);
  const onePart = items.length === 1;
  const left = Math.max(0, progress.total - progress.heard);
  const tabs: [BookTab, string][] = [["chapters", onePart ? "Chapters" : "Parts"], ["marks", "Bookmarks & notes"], ["about", "About"]];
  return (
    <DetailPage
      art={<CollectionArt c={book} className={ui.coverHuge} />}
      info={(
        <>
          <span className="text-[.8rem] font-semibold text-muted">{book.series ? `${book.series}${book.series_index ? `, book ${book.series_index}` : ""}` : "Audiobook"}</span>
          <h1>{book.title}</h1>
          {book.author && <p>{`By ${book.author}`}</p>}
          {book.narrator && <p>{`Narrated by ${book.narrator}`}</p>}
          <p className="text-[.88rem]">{[plainCount(book), progress.state === "started" ? `${spokenLength(left)} left` : progress.state === "finished" ? "Finished" : ""].filter(Boolean).join(" · ")}</p>
          {progress.state === "started" && <ProgressBar ratio={progress.ratio} className="mt-2 max-w-80" />}
        </>
      )}
      actions={(
        <div className={ui.actions}>
          {items.length > 0 && <button type="button" className={ui.primary} onClick={resume}><Icon name="play" size={20} />{progress.state === "started" ? "Continue" : progress.state === "finished" ? "Listen again" : "Start listening"}</button>}
          {items.length > 0 && <DownloadToggle spec={spec} songs={songs} />}
          <AddButton c={book} />
          {book.can_edit && <button type="button" className={ui.round} aria-label="More" onClick={() => collectionMenu(book, items, navigate)}><Icon name="more" size={18} /></button>}
        </div>
      )}>
      <UploadList c={book} />
      <ImportList c={book} />
      <nav className={ui.segments} aria-label="Book">
        {tabs.map(([t, label]) => <button key={t} type="button" className={ui.segment} data-on={tab === t || undefined} aria-pressed={tab === t} onClick={() => setTab(t)}>{label}</button>)}
      </nav>
      {tab === "chapters" && (items.length === 0
        ? Object.values(jobs).some((j) => j.parent === book.id && isActive(j)) ? null : <Welcome title="No parts yet"><p>{book.can_edit ? "Add its YouTube links with Edit book (one for the whole book, or one per chapter), or upload files from this device. Chapters come with the video when it has them." : "Nothing has been added to this book yet."}</p></Welcome>
        : onePart
          ? <OnePartChapters book={book} item={items[0]} song={songs[0]} />
          : (
            <ul className={ui.rows}>
              {items.map((it, i) => <ItemRow key={it.id} item={it} song={songs[i]} label={`Part ${it.part ?? i + 1}`} progress={read(it.id)} onPlay={() => playFrom(book, items, i)} onMenu={() => itemMenu(it, songs[i], book, songs, i)} />)}
            </ul>
          ))}
      {tab === "marks" && <BookMarks items={items} songs={songs} />}
      {tab === "about" && (book.description ? <About text={book.description} /> : <Empty>{book.can_edit ? "No description yet. Add one with Edit book." : "No description yet."}</Empty>)}
      {related.length > 0 && (
        <Section title="Related books">
          <Shelf>
            {related.map((r) => (
              <Link key={r.id} to={`/book/${r.id}`} className={ui.card}>
                <span className={ui.cardArt}><CollectionArt c={r} className={cx(ui.coverBig, ui.cardCover)} /></span>
                <b>{r.title}</b><span>{r.author || plainCount(r)}</span>
              </Link>
            ))}
          </Shelf>
        </Section>
      )}
    </DetailPage>
  );
}

/** A book in one file: its chapters, which play the book from there. */
function OnePartChapters({ book, item, song }: { book: Collection; item: MediaItem; song: Song }) {
  const { current } = useIsCurrent(song.id);
  if (!current) {
    return (
      <div className="px-3 wide:px-6 grid gap-2">
        <ChapterPreview item={item} onPlay={(at) => player.playAt(song, at, book.title)} />
      </div>
    );
  }
  return <ChapterList song={song} className="px-1 wide:px-4" />;
}

/** The chapters of something not playing: tapping one starts it there. */
function ChapterPreview({ item, onPlay }: { item: MediaItem; onPlay: (at: number) => void }) {
  const { data } = useQuery({ queryKey: ["chapters", item.id], queryFn: () => api.getChapters(item.id) });
  if (!data) return <Skeleton rows={2} />;
  if (!data.length) return <p className="text-muted text-[.9rem] px-2 py-1.5">This video has no chapters. Bookmark a moment to come back to it.</p>;
  return (
    <ol className="grid">
      {data.map((c, i) => (
        <li key={c.start}>
          <button type="button" className="tap w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-left hover:bg-hover" onClick={() => onPlay(c.start)}>
            <span className="w-6 flex-none text-right text-muted text-[.82rem] tabular-nums">{i + 1}</span>
            <span className="flex-1 min-w-0 grid"><b className="truncate font-[650]">{c.title}</b><span className="text-muted text-[.8rem] tabular-nums">{`${clock(c.start)} · ${spokenLength(((data[i + 1]?.start ?? item.duration) || c.start) - c.start)}`}</span></span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Bookmarks and notes across every part of a book. */
function BookMarks({ items, songs }: { items: MediaItem[]; songs: Song[] }) {
  if (!items.length) return <Empty>Nothing yet.</Empty>;
  return (
    <div className="grid gap-4 px-2 wide:px-5">
      {items.map((it, i) => (
        <div key={it.id} className="grid gap-1">
          {items.length > 1 && <b className={ui.discTitle}>{`Part ${it.part ?? i + 1}`}</b>}
          <MarkList song={songs[i]} onPlay={(at) => player.playAt(songs[i], at)} />
        </div>
      ))}
    </div>
  );
}

/** The page of a podcast show: its episodes newest first, with what you heard. */
export function ShowPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const online = useOnline();
  const all = useAllProgress();
  const read = progressFrom(all);
  const [filter, setFilter] = useState<Filter>("all");
  const [oldest, setOldest] = useState(false);
  const { data, error, isPending } = useQuery({ queryKey: collectionKey("podcast", id), queryFn: () => api.getCollection("podcast", id), enabled: online });
  if (!online) return <><OfflineBanner /><OfflineShelf kind="podcast" /></>;
  if (isPending) return <Skeleton />;
  if (error) return <Empty>{error.message}</Empty>;
  const { collection: show, items } = data;
  const ordered = oldest ? [...items].reverse() : items;
  const shown = ordered.filter((it) => filter === "all" || itemState(read(it.id)) === filter);
  const songs = shown.map((it) => api.mediaSong(it, show));
  const allSongs = items.map((it) => api.mediaSong(it, show));
  const spec: CollectionSpec = { id: `podcast:${show.id}`, kind: "podcast", title: show.title, subtitle: show.author || "Podcast" };
  void syncCollectionIfSaved(spec.id, allSongs);
  const firstNew = items.findIndex((it) => itemState(read(it.id)) !== "finished");
  return (
    <DetailPage
      art={<CollectionArt c={show} className={ui.coverHuge} />}
      info={(
        <>
          <span className="text-[.8rem] font-semibold text-muted">Podcast</span>
          <h1>{show.title}</h1>
          {show.author && <p>{show.author}</p>}
          <p className="text-[.88rem]">{plainCount(show)}</p>
        </>
      )}
      actions={(
        <>
          <div className={ui.actions}>
            {items.length > 0 && <button type="button" className={ui.primary} onClick={() => player.play(allSongs, Math.max(0, firstNew), undefined, show.title)}><Icon name="play" size={20} />{firstNew > 0 ? "Play newest not heard" : "Play newest"}</button>}
            {items.length > 0 && <DownloadToggle spec={spec} songs={allSongs} />}
            <AddButton c={show} />
            {show.can_edit && <button type="button" className={ui.round} aria-label="More" onClick={() => collectionMenu(show, items, navigate)}><Icon name="more" size={18} /></button>}
          </div>
          <About text={show.description} />
        </>
      )}>
      <UploadList c={show} />
      <div className="flex items-center gap-2 pr-4 wide:pr-8">
        <nav className={cx(ui.segments, "flex-1")} aria-label="Show">
          {FILTERS.map(([f, label]) => <button key={f} type="button" className={ui.segment} data-on={filter === f || undefined} aria-pressed={filter === f} onClick={() => setFilter(f)}>{label}</button>)}
        </nav>
        <button type="button" className={ui.pill} onClick={() => setOldest(!oldest)}><Icon name="sort" size={16} />{oldest ? "Oldest first" : "Newest first"}</button>
      </div>
      {items.length === 0
        ? <Welcome title="No episodes yet"><p>Upload episodes from this device, or paste a YouTube link in Search and choose this show.</p></Welcome>
        : shown.length === 0 ? <Empty>Nothing here.</Empty> : (
          <ul className={ui.rows}>
            {shown.map((it, i) => <ItemRow key={it.id} item={it} song={songs[i]} label={dateOf(it)} progress={read(it.id)} onPlay={() => player.play(songs, i, undefined, show.title)} onMenu={() => itemMenu(it, songs[i], show, songs, i)} />)}
          </ul>
        )}
    </DetailPage>
  );
}

// ---------------- Making or changing a show or a book ----------------

const FIELD = "grid gap-1.5 [&>span]:text-[.75rem] [&>span]:uppercase [&>span]:tracking-[.09em] [&>span]:text-muted [&>span]:font-bold [&>span]:px-1.5";

/** The form for a new show or book, or one being changed. A book also takes its YouTube links and related books here. */
export function CollectionEditor({ kind }: { kind: Kind }) {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const online = useOnline();
  // Always asked again: the copy the book's page left may be from before its last parts arrived
  const existing = useQuery({ queryKey: collectionKey(kind, id ?? ""), queryFn: () => api.getCollection(kind, id!), enabled: Boolean(id) && online, refetchOnMount: "always" });
  if (id && existing.isPending) return <Skeleton />;
  if (id && existing.error) return <Empty>{existing.error.message}</Empty>;
  if (id && existing.data && !existing.data.collection.can_edit) return <Navigate to={`/${WORDS[kind].page}/${id}`} replace />;
  const link = params.get("url") ?? "";
  return <EditorForm key={id ?? "new"} kind={kind} start={existing.data?.collection} parts={existing.data?.items ?? []} firstLink={link}
    onDone={(c) => navigate(`/${WORDS[kind].page}/${c.id}`, { replace: true })} />;
}

/** A playlist pasted as a book's link: how many videos it has, and taking them all as the parts. */
function PlaylistOffer({ link, onExpand }: { link: string; onExpand: (links: string[]) => void }) {
  const list = useQuery({ queryKey: ["media-playlist", link], queryFn: () => api.mediaPlaylist(link), retry: false, staleTime: 5 * 60_000 });
  if (list.isPending) return <span className="flex items-center gap-1.5"><Ring percent={-1} size={14} />Reading the playlist…</span>;
  if (list.error) return <span className="text-danger">{list.error.message}</span>;
  const videos = list.data;
  if (!videos.length) return <span className="text-danger">This playlist has no videos anyone can watch</span>;
  const total = videos.reduce((n, v) => n + (v.duration || 0), 0);
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span>{`A playlist of ${videos.length} ${videos.length === 1 ? "video" : "videos"}${total ? ` · ${spokenLength(total)}` : ""}`}</span>
      <button type="button" className={cx(ui.pill, "py-1.5")} onClick={() => onExpand(videos.map((v) => v.url))}><Icon name="queue" size={16} />{`Use all ${videos.length} as the parts`}</button>
    </span>
  );
}

/** One YouTube link of a book, with what it is once YouTube answers. A playlist offers to become every part. */
function LinkField({ value, index, onChange, onRemove, onExpand, removable }: { value: string; index: number; onChange: (v: string) => void; onRemove: () => void; onExpand: (links: string[]) => void; removable: boolean }) {
  const [asked, setAsked] = useState(value.trim());
  useEffect(() => {
    const t = setTimeout(() => setAsked(value.trim()), 600); // only once the typing or pasting stops
    return () => clearTimeout(t);
  }, [value]);
  const looksRight = /^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(asked);
  const playlist = looksRight && isPlaylistLink(asked);
  const preview = useQuery({ queryKey: ["media-preview", asked], queryFn: () => api.mediaPreview(asked), enabled: looksRight && !playlist, retry: false, staleTime: 5 * 60_000 });
  let note: ReactNode = null;
  if (asked && !looksRight) note = <span className="text-danger">Paste a YouTube link (youtube.com or youtu.be)</span>;
  else if (playlist) note = <PlaylistOffer link={asked} onExpand={onExpand} />;
  else if (preview.isFetching) note = <span className="flex items-center gap-1.5"><Ring percent={-1} size={14} />Reading the link…</span>;
  else if (preview.error) note = <span className="text-danger">{preview.error.message}</span>;
  else if (preview.data) {
    const p = preview.data;
    note = p.existing ? <span className="text-danger">{`Already in the library: ${p.existing.title}`}</span>
      : p.live ? <span className="text-danger">A live stream cannot be added</span>
      : <span className="truncate">{[p.title, p.duration ? spokenLength(p.duration) : "", p.chapters ? `${p.chapters} chapters` : ""].filter(Boolean).join(" · ")}</span>;
  }
  return (
    <li className="grid gap-1">
      <div className="flex items-center gap-2">
        <span className="w-6 flex-none text-right text-muted text-[.85rem] tabular-nums">{index + 1}</span>
        <input className={ui.input} type="url" inputMode="url" placeholder="https://www.youtube.com/watch?v=…" aria-label={`YouTube link ${index + 1}`} value={value} onChange={(e) => onChange(e.target.value)} />
        {removable && <button type="button" className={ui.iconButton} aria-label={`Remove link ${index + 1}`} onClick={onRemove}><Icon name="close" size={18} /></button>}
      </div>
      {note && <p className="pl-8 pr-2 text-[.82rem] text-muted min-w-0 grid">{note}</p>}
    </li>
  );
}

/** A book's parts in the order they play: drag one by its handle, or move it with the arrows. */
function PartOrder({ parts, order, onChange }: { parts: MediaItem[]; order: string[]; onChange: (ids: string[]) => void }) {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    next.splice(to, 0, ...next.splice(from, 1));
    onChange(next);
  };
  // Where the pointer is decides the place: past the middle of a row is after it
  const drag = (e: React.PointerEvent, id: string) => {
    if (dragging !== id) return;
    const from = order.indexOf(id);
    let to = from;
    rows.current.forEach((row, i) => {
      if (!row || i === from) return;
      const box = row.getBoundingClientRect();
      if (i < from && e.clientY < box.top + box.height / 2) to = Math.min(to, i);
      if (i > from && e.clientY > box.top + box.height / 2) to = Math.max(to, i);
    });
    move(from, to);
  };
  return (
    <ol className="grid gap-1 select-none">
      {order.map((id, i) => {
        const it = byId.get(id);
        if (!it) return null;
        return (
          <li key={id} ref={(el) => { rows.current[i] = el; }} data-on={dragging === id || undefined}
            className="flex items-center gap-2 pl-1 pr-1 py-1 rounded-2xl bg-ghost data-on:bg-[rgb(var(--glow)/.18)] data-on:shadow-[0_8px_24px_rgb(0_0_0/.25)]">
            <span className="tap size-9 flex-none grid place-items-center text-muted cursor-grab active:cursor-grabbing touch-none" aria-hidden="true"
              onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setDragging(id); }}
              onPointerMove={(e) => drag(e, id)} onPointerUp={() => setDragging(null)} onPointerCancel={() => setDragging(null)}>
              <Icon name="grip" size={18} />
            </span>
            <span className="w-6 flex-none text-right text-muted text-[.85rem] tabular-nums">{i + 1}</span>
            <span className="flex-1 min-w-0 grid">
              <b className="truncate font-[650] text-[.92rem]">{it.title}</b>
              <span className="text-muted text-[.8rem]">{it.duration ? spokenLength(it.duration) : ""}</span>
            </span>
            <button type="button" className={cx(ui.iconButton, "size-9 disabled:opacity-25")} aria-label={`Move ${it.title} up`} disabled={i === 0} onClick={() => move(i, i - 1)}><Icon name="up" size={18} /></button>
            <button type="button" className={cx(ui.iconButton, "size-9 disabled:opacity-25")} aria-label={`Move ${it.title} down`} disabled={i === order.length - 1} onClick={() => move(i, i + 1)}><Icon name="down" size={18} /></button>
          </li>
        );
      })}
    </ol>
  );
}

/** Pick the books that go with this one. Optional; the server keeps the link on both books. */
function RelatedPicker({ self, value, onChange }: { self?: string; value: string[]; onChange: (ids: string[]) => void }) {
  const books = useQuery({ queryKey: showsKey("audiobook"), queryFn: () => api.listCollections("audiobook") });
  const [filter, setFilter] = useState("");
  const others = (books.data ?? []).filter((b) => b.id !== self);
  if (books.isPending) return <Skeleton rows={1} />;
  if (!others.length) return <p className="text-muted text-[.9rem] px-1.5">There are no other books yet.</p>;
  const q = filter.trim().toLowerCase();
  const shown = others.filter((b) => !q || b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q) || value.includes(b.id));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="grid gap-2">
      {others.length > 8 && <input className={ui.input} type="search" placeholder="Find a book" aria-label="Find a book" value={filter} onChange={(e) => setFilter(e.target.value)} />}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Related books">
        {shown.map((b) => <button key={b.id} type="button" className={ui.chip} aria-pressed={value.includes(b.id)} onClick={() => toggle(b.id)}>{b.title}</button>)}
      </div>
    </div>
  );
}

function EditorForm({ kind, start, parts, firstLink, onDone }: { kind: Kind; start?: Collection; parts: MediaItem[]; firstLink: string; onDone: (c: Collection) => void }) {
  const w = WORDS[kind];
  const book = kind === "audiobook";
  const [edit, setEdit] = useState<CollectionEdit>({
    title: start?.title ?? "", author: start?.author ?? "", narrator: start?.narrator ?? "", series: start?.series ?? "",
    series_index: start?.series_index ?? 0, description: start?.description ?? "", related: start?.related ?? [],
  });
  const [links, setLinks] = useState<string[]>([firstLink]);
  const [order, setOrder] = useState<string[]>(() => parts.map((p) => p.id));
  // Parts can arrive (or go) while the page is open: keep the order chosen so far, then the new ones at the end
  const partIds = parts.map((p) => p.id).join(",");
  useEffect(() => {
    const ids = partIds ? partIds.split(",") : [];
    setOrder((was) => [...was.filter((id) => ids.includes(id)), ...ids.filter((id) => !was.includes(id))]);
  }, [partIds]);
  const [picture, setPicture] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<CollectionEdit>) => setEdit({ ...edit, ...patch });
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function frame(source: Blob | Promise<Blob>) {
    try {
      const jpeg = await cropPicture(await source);
      if (!jpeg) return;
      setPicture(jpeg);
      setPreview(URL.createObjectURL(jpeg));
    } catch (e) { toast((e as Error).message); }
  }

  // The pictures of its videos, to frame as the cover: the parts it has, then the links being added
  const videoPictures = [
    ...parts.filter((p) => p.thumb).map((p) => ({ label: `Part ${p.part ?? 0}: ${p.title}`, url: api.mediaThumbUrl(p.id) })),
    ...links.map(videoIdOf).filter(Boolean).map((id, i) => ({ label: `Link ${i + 1}`, url: api.videoPictureUrl(id) })),
  ];
  const useVideoPicture = () => {
    if (videoPictures.length === 1) { void frame(api.fetchPicture(videoPictures[0].url)); return; }
    openSheet("Use a video's picture", edit.title || undefined, videoPictures.slice(0, 30).map((v) => ({ icon: "image" as const, label: v.label, run: () => void frame(api.fetchPicture(v.url)) })));
  };
  const reordered = order.some((id, i) => id !== parts[i]?.id);

  const wanted = links.map((l) => l.trim()).filter(Boolean);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      let c = start ? await api.editCollection(kind, start.id, edit) : await api.createCollection(kind, edit);
      if (picture) c = { ...c, ...(await api.uploadCollectionCover(kind, c.id, picture)) };
      if (start && reordered) await api.orderParts(c.id, order);
      // Each link gets its number now: they download side by side and finish in any order
      const after = Math.max(reordered ? order.length : 0, parts.reduce((n, it) => Math.max(n, it.part ?? 0), 0));
      const problems: string[] = [];
      let started = 0;
      for (const [i, link] of wanted.entries()) {
        try {
          const result = await requestMedia(link, "audiobook", c.id, after + i + 1);
          if (result.existing) problems.push(`Link ${i + 1} is already in the library (${result.existing.title})`);
          else started++;
        } catch (err) { problems.push(`Link ${i + 1}: ${(err as Error).message}`); }
      }
      refreshShelves();
      if (problems.length) toast(problems.join(". "));
      else if (started) toast(`${start ? "Saved" : "Book added"}. Downloading ${started === 1 ? "its audio" : `${started} parts`}`);
      else toast(start ? "Saved" : `${book ? "Book" : "Show"} added`);
      onDone(c);
    } catch (err) {
      toast((err as Error).message);
      setBusy(false);
    }
  }

  const art = preview || (start && (start.cover || start.thumb) ? api.collectionCoverUrl(start) : "");
  const title = start ? (book ? "Edit book" : "Edit show") : w.make;
  return (
    <form className="grid gap-5 px-5 pt-2 pb-10 wide:px-8 max-w-190" onSubmit={(e) => void save(e)}>
      <header className={cx(ui.heroCompact, "px-0!")}><h1>{title}</h1></header>
      <div className="flex items-center gap-4">
        <label className="tap relative flex-none w-28 cursor-pointer group/pic" aria-label="Choose a picture">
          <Picture src={art} className={ui.coverBig} />
          <span className="absolute inset-0 grid place-items-center rounded-big bg-black/40 text-white opacity-0 group-hover/pic:opacity-100 transition-opacity"><Icon name="image" size={26} /></span>
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void frame(f); e.target.value = ""; }} />
        </label>
        <div className="grid gap-2 justify-items-start">
          <p className="text-muted text-[.9rem]">{book ? "The book's cover. You frame it in the square after choosing it. Without one, the picture of its first part shows." : "The show's picture. Without one, the newest episode's shows."}</p>
          <div className="flex flex-wrap gap-2">
            {videoPictures.length > 0 && <button type="button" className={ui.pill} onClick={useVideoPicture}><Icon name="image" size={16} />Use a video's picture</button>}
            {picture && <button type="button" className={ui.pill} onClick={() => { setPicture(null); setPreview(""); }}><Icon name="close" size={16} />Undo the new picture</button>}
          </div>
        </div>
      </div>
      <label className={FIELD}><span>Title</span><input className={ui.input} required maxLength={200} value={edit.title} onChange={(e) => set({ title: e.target.value })} /></label>
      <label className={FIELD}><span>{w.author}</span><input className={ui.input} maxLength={200} value={edit.author} onChange={(e) => set({ author: e.target.value })} /></label>
      {book && (
        <>
          <label className={FIELD}><span>Narrator</span><input className={ui.input} maxLength={200} value={edit.narrator} onChange={(e) => set({ narrator: e.target.value })} /></label>
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
            <label className={FIELD}><span>Series</span><input className={ui.input} maxLength={200} value={edit.series} onChange={(e) => set({ series: e.target.value })} /></label>
            <label className={FIELD}><span>Number</span><input className={ui.input} type="number" min={0} step="0.5" value={edit.series_index || ""} onChange={(e) => set({ series_index: Number(e.target.value) || 0 })} /></label>
          </div>
        </>
      )}
      <label className={FIELD}><span>Description</span><textarea className={ui.textarea} maxLength={5000} value={edit.description} onChange={(e) => set({ description: e.target.value })} /></label>
      {book && start && parts.length > 1 && (
        <section className="grid gap-2.5" aria-labelledby="order-title">
          <div className="grid gap-0.5 px-1.5">
            <b id="order-title" className="text-[.75rem] uppercase tracking-[.09em] text-muted font-bold">Order of the parts</b>
            <p className="text-muted text-[.88rem]">Drag a part by its handle, or move it with the arrows. It is saved with the rest.</p>
          </div>
          <PartOrder parts={parts} order={order} onChange={setOrder} />
        </section>
      )}
      {book && (
        <section className="grid gap-2.5" aria-labelledby="links-title">
          <div className="grid gap-0.5 px-1.5">
            <b id="links-title" className="text-[.75rem] uppercase tracking-[.09em] text-muted font-bold">{start ? "Add parts from YouTube" : "YouTube links"}</b>
            <p className="text-muted text-[.88rem]">{start && parts.length > 0
              ? `They come after its ${parts.length === 1 ? "part" : `${parts.length} parts`}, in this order.`
              : "One link when the whole book is one video, or one per chapter, in order. A playlist can fill them all. Only the audio is kept."}</p>
          </div>
          <ol className="grid gap-2">
            {links.map((l, i) => (
              <LinkField key={i} value={l} index={i} removable={links.length > 1}
                onChange={(v) => setLinks(links.map((x, j) => (j === i ? v : x)))} onRemove={() => setLinks(links.filter((_, j) => j !== i))}
                onExpand={(more) => setLinks([...links.slice(0, i), ...more, ...links.slice(i + 1)].filter((x, j, all) => x.trim() === "" || all.indexOf(x) === j))} />
            ))}
          </ol>
          <button type="button" className={cx(ui.pill, "justify-self-start ml-8")} onClick={() => setLinks([...links, ""])}><Icon name="plus" size={16} />Another link</button>
        </section>
      )}
      {book && (
        <section className="grid gap-2.5" aria-labelledby="related-title">
          <div className="grid gap-0.5 px-1.5">
            <b id="related-title" className="text-[.75rem] uppercase tracking-[.09em] text-muted font-bold">Related books</b>
            <p className="text-muted text-[.88rem]">Optional. Each one shows on the other's page.</p>
          </div>
          <RelatedPicker self={start?.id} value={edit.related ?? []} onChange={(related) => set({ related })} />
        </section>
      )}
      <div className="flex gap-2.5">
        <button type="submit" className={ui.primary} disabled={busy || edit.title.trim() === ""}>{busy ? <Ring percent={-1} size={20} /> : <Icon name="check" size={20} />}{start ? "Save" : book ? "Add book" : "Make show"}</button>
      </div>
    </form>
  );
}

/** Your newest bookmarks and notes, on your own profile: tap one to carry on from there. Only you see this. */
export function RecentMarks() {
  const online = useOnline();
  const marks = useQuery({ queryKey: ["marks", ""], queryFn: () => api.getMarks(), enabled: online });
  const podcasts = useQuery({ queryKey: ["media", "podcast"], queryFn: () => api.listMedia("podcast"), enabled: online });
  const books = useQuery({ queryKey: ["media", "audiobook"], queryFn: () => api.listMedia("audiobook"), enabled: online });
  const items = new Map([...(podcasts.data ?? []), ...(books.data ?? [])].map((it) => [it.id, it]));
  const list = (marks.data?.marks ?? []).filter((m) => items.has(m.item)).slice(0, 8);
  if (!list.length) return null;
  return (
    <Section title="Your bookmarks & notes">
      <ul className={ui.rows}>
        {list.map((m) => {
          const item = items.get(m.item)!;
          const song = api.mediaSong(item);
          return (
            <li key={m.id} className={ui.row} onClick={() => player.playAt(song, m.at)}>
              <SongCover song={song} />
              <div className={ui.text}>
                <b>{m.note || item.title}</b>
                <span>{`${m.note ? `${item.title} · ` : ""}${clock(m.at)}${m.shared ? " · shared" : ""}`}</span>
              </div>
              <span className="flex-none text-accent"><Icon name={m.note ? "note" : "bookmark-fill"} size={18} /></span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

