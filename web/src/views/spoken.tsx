// Podcasts and audiobooks, each a section of its own: a shelf of books with where you are in each, the page of a book
// (its parts and chapters, your bookmarks and notes, what it is about), the shows you follow with their newest
// episodes, the page of a show, and making or changing a show or a book. The library's Songs-style lists stay for music.
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import * as api from "../lib/api";
import { clock } from "../lib/format";
import { pictureToCover } from "../lib/image";
import { queryClient } from "../lib/query";
import { bookPosition, itemState, progressRatio, resumePoint, spokenLength, type ItemState, type Progress } from "../lib/spoken";
import type { Collection, CollectionEdit, CollectionSpec, ContinueItem, MediaItem, Song } from "../lib/types";
import { cx, ui } from "../lib/ui";
import { DownloadToggle } from "../components/cards";
import { DetailPage, Empty, OfflineBanner, Section, Shelf, Skeleton, Welcome } from "../components/common";
import { Picture, SongCover } from "../components/Cover";
import { Icon, Ring } from "../components/Icon";
import { ChapterList, MarkList } from "../components/SpokenControls";
import { isAdmin } from "../stores/admin";
import { useIsCurrent } from "../stores/connect";
import * as offline from "../stores/offline";
import * as player from "../stores/player";
import { removeOffline, saveOffline, syncCollectionIfSaved } from "../stores/saving";
import { useOnline } from "../stores/settings";
import { progressOf, useSpoken } from "../stores/spoken";
import { cancel, clearDone, sendFiles, useUploads } from "../stores/uploads";
import { askText, openSheet, toast } from "../stores/ui";

type Kind = Collection["kind"];
const WORDS = {
  podcast: { section: "Podcasts", one: "show", item: "episode", items: "episodes", author: "Host", page: "podcast", make: "New show" },
  audiobook: { section: "Audiobooks", one: "book", item: "part", items: "parts", author: "Author", page: "book", make: "New book" },
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
  const { data } = useQuery({ queryKey: ["continue"], queryFn: api.continueListening, enabled: online, staleTime: 10_000 });
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
          <span className="truncate text-muted text-[.8rem]">{c ? `${entry.item.title} · ${left} left` : `${left} left`}</span>
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
        <span className="w-full truncate font-medium">{c ? entry.item.title : entry.item.channel}</span>
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
          <button type="button" className={ui.pill} onClick={() => navigate("/search")}><Icon name="search" size={16} />Add from a YouTube link</button>
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
    body = <Welcome title="No audiobooks yet"><p>Make a book, then add its parts from YouTube links. A whole book in one video works too: mark its chapters as you go.</p></Welcome>;
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
                  <CollectionArt c={book} className={cx(ui.coverBig, ui.cardCover, "aspect-[3/4]!")} />
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

/** Send episodes or parts from this device. Several at once for a book in parts: they join it in the order of their names. */
function UploadButton({ c }: { c: Collection }) {
  return (
    <label className={cx(ui.pill, "cursor-pointer")}>
      <Icon name="upload" size={16} />{c.kind === "podcast" ? "Upload episodes" : "Upload files"}
      <input type="file" multiple accept={AUDIO_FILES} className="sr-only" onChange={(e) => { if (e.target.files?.length) sendFiles(e.target.files, c.kind, c.id); e.target.value = ""; }} />
    </label>
  );
}

const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0)} MB`;

/** The files on their way to this show or book. */
function UploadList({ c }: { c: Collection }) {
  const list = useUploads((s) => s.list.filter((u) => u.collection === c.id));
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

// ---------------- One show or book ----------------

function collectionMenu(c: Collection, navigate: ReturnType<typeof useNavigate>): void {
  openSheet(c.title, c.author, [
    c.can_edit && { icon: "pencil", label: "Edit details", run: () => navigate(`/${WORDS[c.kind].page}/${c.id}/edit`) },
    c.can_edit && { icon: "trash", label: `Delete this ${WORDS[c.kind].one}`, danger: true, run: async () => {
      if (c.count > 0) { toast(`Delete or move its ${WORDS[c.kind].items} first`); return; }
      if (!confirm(`Delete “${c.title}”?`)) return;
      try { await api.deleteCollection(c.kind, c.id); refreshShelves(); navigate(c.kind === "podcast" ? "/podcasts" : "/audiobooks"); } catch (e) { toast((e as Error).message); }
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
  const { data, error, isPending } = useQuery({ queryKey: collectionKey("audiobook", id), queryFn: () => api.getCollection("audiobook", id), enabled: online });
  if (!online) return <><OfflineBanner /><OfflineShelf kind="audiobook" /></>;
  if (isPending) return <Skeleton />;
  if (error) return <Empty>{error.message}</Empty>;
  const { collection: book, items } = data;
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
      art={<CollectionArt c={book} className={cx(ui.coverHuge, "aspect-[3/4]!")} />}
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
          <UploadButton c={book} />
          <button type="button" className={ui.pill} onClick={() => navigate(`/search`)}><Icon name="plus" size={16} />From YouTube</button>
          {book.can_edit && <button type="button" className={ui.round} aria-label="More" onClick={() => collectionMenu(book, navigate)}><Icon name="more" size={18} /></button>}
        </div>
      )}>
      <UploadList c={book} />
      <nav className={ui.segments} aria-label="Book">
        {tabs.map(([t, label]) => <button key={t} type="button" className={ui.segment} data-on={tab === t || undefined} aria-pressed={tab === t} onClick={() => setTab(t)}>{label}</button>)}
      </nav>
      {tab === "chapters" && (items.length === 0
        ? <Welcome title="No parts yet"><p>Upload the book from this device (one file, or one per part), or paste a YouTube link in Search and choose this book. Its chapters come with it when the file has them.</p></Welcome>
        : onePart
          ? <OnePartChapters book={book} item={items[0]} song={songs[0]} />
          : (
            <ul className={ui.rows}>
              {items.map((it, i) => <ItemRow key={it.id} item={it} song={songs[i]} label={`Part ${it.part ?? i + 1}`} progress={read(it.id)} onPlay={() => playFrom(book, items, i)} onMenu={() => itemMenu(it, songs[i], book, songs, i)} />)}
            </ul>
          ))}
      {tab === "marks" && <BookMarks items={items} songs={songs} />}
      {tab === "about" && (book.description ? <About text={book.description} /> : <Empty>{book.can_edit ? "No description yet. Add one with Edit details." : "No description yet."}</Empty>)}
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
  if (!data.length) return <p className="text-muted text-[.9rem] px-2 py-1.5">No chapters yet. Play it and mark one where a part begins: everyone who listens can jump to it.</p>;
  return (
    <ol className="grid">
      {data.map((c, i) => (
        <li key={c.start}>
          <button type="button" className="tap w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-left hover:bg-hover" onClick={() => onPlay(c.start)}>
            <span className="w-6 flex-none text-right text-muted text-[.82rem] tabular-nums">{i + 1}</span>
            <span className="flex-1 min-w-0 grid"><b className="truncate font-[650]">{c.title}</b><span className="text-muted text-[.8rem] tabular-nums">{spokenLength(((data[i + 1]?.start ?? item.duration) || c.start) - c.start)}</span></span>
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
            <UploadButton c={show} />
            <button type="button" className={ui.pill} onClick={() => navigate("/search")}><Icon name="plus" size={16} />From YouTube</button>
            {show.can_edit && <button type="button" className={ui.round} aria-label="More" onClick={() => collectionMenu(show, navigate)}><Icon name="more" size={18} /></button>}
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

/** The form for a new show or book, or one being changed. */
export function CollectionEditor({ kind }: { kind: Kind }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const online = useOnline();
  const existing = useQuery({ queryKey: collectionKey(kind, id ?? ""), queryFn: () => api.getCollection(kind, id!), enabled: Boolean(id) && online });
  if (id && existing.isPending) return <Skeleton />;
  if (id && existing.error) return <Empty>{existing.error.message}</Empty>;
  if (id && existing.data && !existing.data.collection.can_edit) return <Navigate to={`/${WORDS[kind].page}/${id}`} replace />;
  return <EditorForm key={id ?? "new"} kind={kind} start={existing.data?.collection} onDone={(c) => navigate(`/${WORDS[kind].page}/${c.id}`, { replace: true })} />;
}

function EditorForm({ kind, start, onDone }: { kind: Kind; start?: Collection; onDone: (c: Collection) => void }) {
  const w = WORDS[kind];
  const [edit, setEdit] = useState<CollectionEdit>({
    title: start?.title ?? "", author: start?.author ?? "", narrator: start?.narrator ?? "", series: start?.series ?? "",
    series_index: start?.series_index ?? 0, description: start?.description ?? "",
  });
  const [picture, setPicture] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<CollectionEdit>) => setEdit({ ...edit, ...patch });

  async function choose(file: File | undefined) {
    if (!file) return;
    try {
      const jpeg = await pictureToCover(file);
      setPicture(jpeg);
      setPreview(URL.createObjectURL(jpeg));
    } catch { toast("That picture could not be read"); }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      let c = start ? await api.editCollection(kind, start.id, edit) : await api.createCollection(kind, edit);
      if (picture) c = { ...c, ...(await api.uploadCollectionCover(kind, c.id, picture)) };
      refreshShelves();
      toast(start ? "Saved" : `${kind === "podcast" ? "Show" : "Book"} made. Add its ${w.items} from a YouTube link`);
      onDone(c);
    } catch (err) {
      toast((err as Error).message);
      setBusy(false);
    }
  }

  const art = preview || (start && (start.cover || start.thumb) ? api.collectionCoverUrl(start) : "");
  return (
    <form className="grid gap-5 px-5 pt-2 pb-10 wide:px-8 max-w-190" onSubmit={(e) => void save(e)}>
      <header className={cx(ui.heroCompact, "px-0!")}><h1>{start ? `Edit ${w.one}` : w.make}</h1></header>
      <div className="flex items-center gap-4">
        <label className="tap relative flex-none w-28 cursor-pointer group/pic" aria-label="Choose a picture">
          <Picture src={art} className={cx(ui.coverBig, kind === "audiobook" && "aspect-[3/4]!")} />
          <span className="absolute inset-0 grid place-items-center rounded-big bg-black/40 text-white opacity-0 group-hover/pic:opacity-100 transition-opacity"><Icon name="image" size={26} /></span>
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => void choose(e.target.files?.[0])} />
        </label>
        <p className="text-muted text-[.9rem]">{kind === "audiobook" ? "The book's cover. Without one, the picture of its first part shows." : "The show's picture. Without one, the newest episode's shows."}</p>
      </div>
      <label className={FIELD}><span>Title</span><input className={ui.input} required maxLength={200} value={edit.title} onChange={(e) => set({ title: e.target.value })} /></label>
      <label className={FIELD}><span>{w.author}</span><input className={ui.input} maxLength={200} value={edit.author} onChange={(e) => set({ author: e.target.value })} /></label>
      {kind === "audiobook" && (
        <>
          <label className={FIELD}><span>Narrator</span><input className={ui.input} maxLength={200} value={edit.narrator} onChange={(e) => set({ narrator: e.target.value })} /></label>
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
            <label className={FIELD}><span>Series</span><input className={ui.input} maxLength={200} value={edit.series} onChange={(e) => set({ series: e.target.value })} /></label>
            <label className={FIELD}><span>Number</span><input className={ui.input} type="number" min={0} step="0.5" value={edit.series_index || ""} onChange={(e) => set({ series_index: Number(e.target.value) || 0 })} /></label>
          </div>
        </>
      )}
      <label className={FIELD}><span>Description</span><textarea className={cx(ui.input, "rounded-[18px] min-h-32 resize-y py-3")} maxLength={5000} value={edit.description} onChange={(e) => set({ description: e.target.value })} /></label>
      <div className="flex gap-2.5">
        <button type="submit" className={ui.primary} disabled={busy || edit.title.trim() === ""}>{busy ? <Ring percent={-1} size={20} /> : <Icon name="check" size={20} />}{start ? "Save" : `Make ${w.one}`}</button>
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

