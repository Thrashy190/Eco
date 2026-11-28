// The player's controls for podcasts and audiobooks, in place of a song's: back and forward by chapter and by a few
// seconds, the speed, a timer to the end of the chapter, bookmarks and notes, and the list of chapters. They are used by
// every form of the player (the phone's, the deck, the capsule and the stage), and work on whichever device plays.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import * as api from "../lib/api";
import { clock } from "../lib/format";
import { queryClient } from "../lib/query";
import { chapterAt, chapterEnd, cleanSpeed, leftAtSpeed, MAX_SPEED, MIN_SPEED, skipLength, speedLabel, spokenLength, type Chapter } from "../lib/spoken";
import type { Mark, SharedMark, Song } from "../lib/types";
import { cx, ui } from "../lib/ui";
import { isAdmin } from "../stores/admin";
import * as player from "../stores/player";
import { useOnline, useSettings } from "../stores/settings";
import { setChapters, useChapters } from "../stores/spoken";
import { askText, openSheet, toast } from "../stores/ui";
import { Icon, Ring, type IconName } from "./Icon";

export type SpokenSize = "small" | "medium" | "large" | "stage";

const SIZES: Record<SpokenSize, { button: string; icon: number; play: string; playIcon: number; label: string }> = {
  small: { button: "size-9", icon: 20, play: "size-11 bg-text text-bg", playIcon: 18, label: "text-[.55rem]" },
  medium: { button: "size-11", icon: 24, play: "size-14 bg-accent text-accent-ink shadow-[0_10px_28px_rgb(var(--glow)/.3)]", playIcon: 22, label: "text-[.6rem]" },
  large: { button: "size-13", icon: 30, play: "size-19 bg-accent text-accent-ink shadow-[0_12px_32px_rgb(var(--glow)/.35)]", playIcon: 24, label: "text-[.68rem]" },
  stage: { button: "size-14", icon: 32, play: "size-20 bg-accent text-accent-ink shadow-[0_14px_36px_rgb(var(--glow)/.35)]", playIcon: 28, label: "text-[.7rem]" },
};

const plain = "tap relative grid place-items-center rounded-full text-text opacity-85 hover:opacity-100 active:scale-[.94]";

/** A skip button: the round arrow with its seconds inside, as on every podcast app. */
function SkipButton({ back, size }: { back?: boolean; size: SpokenSize }) {
  const seconds = useSettings((s) => skipLength(back ? s.skipBack : s.skipForward, 30));
  const s = SIZES[size];
  return (
    <button type="button" className={cx(plain, s.button)} aria-label={back ? `Back ${seconds} seconds` : `Forward ${seconds} seconds`} title={back ? `Back ${seconds} s` : `Forward ${seconds} s`}
      onClick={back ? player.skipBack : player.skipForward}>
      <Icon name={back ? "rewind" : "forward"} size={s.icon} />
      <span className={cx("absolute inset-0 grid place-items-center pt-[.1em] font-extrabold tabular-nums pointer-events-none", s.label)}>{seconds}</span>
    </button>
  );
}

/** Previous chapter · back · play · forward · next chapter. */
export function SpokenTransport({ playing, loading, size, className }: { playing: boolean; loading: boolean; size: SpokenSize; className?: string }) {
  const s = SIZES[size];
  return (
    <div className={cx("flex items-center justify-between", className)}>
      <button type="button" className={cx(plain, s.button)} aria-label="Previous chapter" title="Previous chapter" onClick={player.previousChapter}><Icon name="prev" size={s.icon - 4} /></button>
      <SkipButton back size={size} />
      <button type="button" className={cx("tap flex-none grid place-items-center rounded-full hover:scale-105 active:scale-[.96]", s.play)} aria-label={playing ? "Pause" : "Play"} onClick={player.toggle}>
        {loading ? <Ring percent={-1} size={s.playIcon} /> : <Icon name={playing ? "pause" : "play"} size={s.playIcon} />}
      </button>
      <SkipButton size={size} />
      <button type="button" className={cx(plain, s.button)} aria-label="Next chapter" title="Next chapter" onClick={player.nextChapter}><Icon name="next" size={s.icon - 4} /></button>
    </div>
  );
}

/** The usual speeds, and finer steps beside the one playing. */
export function openSpeedMenu(speed: number): void {
  const choices = [0.75, 0.9, 1, 1.1, 1.2, 1.25, 1.3, 1.5, 1.75, 2, 2.5, 3];
  openSheet("Playback speed", `Now ${speedLabel(speed)}`, [
    speed - 0.05 >= MIN_SPEED && { icon: "down" as IconName, label: `Slower, ${speedLabel(cleanSpeed(speed - 0.05))}`, run: () => player.setSpeed(speed - 0.05) },
    speed + 0.05 <= MAX_SPEED && { icon: "up" as IconName, label: `Faster, ${speedLabel(cleanSpeed(speed + 0.05))}`, run: () => player.setSpeed(speed + 0.05) },
    ...choices.map((value) => ({ icon: (Math.abs(value - speed) < 0.01 ? "check" : undefined) as IconName | undefined, label: value === 1 ? "1× (normal)" : speedLabel(value), run: () => player.setSpeed(value) })),
  ]);
}

/** The speed, as a button that opens the choices. */
export function SpeedButton({ speed, className }: { speed: number; className: string }) {
  return <button type="button" className={className} aria-label={`Playback speed, ${speedLabel(speed)}`} title="Playback speed" onClick={() => openSpeedMenu(speed)}>{speedLabel(speed)}</button>;
}

/** The speed with a step either side, where there is room (the phone's player, the stage). */
export function SpeedStepper({ speed }: { speed: number }) {
  const step = "tap size-9 grid place-items-center rounded-full text-muted hover:text-text disabled:opacity-30";
  return (
    <div className="flex items-center rounded-full bg-ghost" role="group" aria-label="Playback speed">
      <button type="button" className={step} aria-label="Slower" disabled={speed <= MIN_SPEED} onClick={() => player.setSpeed(speed - 0.05)}><Icon name="down" size={18} /></button>
      <button type="button" className="tap min-w-14 h-9 px-1 font-bold tabular-nums text-[.92rem]" title="More speeds" onClick={() => openSpeedMenu(speed)}>{speedLabel(speed)}</button>
      <button type="button" className={step} aria-label="Faster" disabled={speed >= MAX_SPEED} onClick={() => player.setSpeed(speed + 0.05)}><Icon name="up" size={18} /></button>
    </div>
  );
}

const marksKey = (mediaId: string) => ["marks", mediaId];

/** A bookmark where the item is now, on whichever device plays it. */
export async function addBookmark(song: Song, at: number): Promise<void> {
  if (!song.mediaId) return;
  try {
    await api.addMark({ item: song.mediaId, at });
    toast(`Bookmark at ${clock(at)}`);
    void queryClient.invalidateQueries({ queryKey: marksKey(song.mediaId) });
  } catch (e) { toast((e as Error).message); }
}

/** A note at this moment: private, unless the box to share it is ticked. */
export async function addNote(song: Song, at: number): Promise<void> {
  if (!song.mediaId) return;
  const answer = await askText({ title: `Note at ${clock(at)}`, label: "What do you want to remember?", multiline: true, confirm: "Save note", option: { label: "Share with everyone who listens", on: false } });
  if (!answer || answer.text === "") return;
  try {
    await api.addMark({ item: song.mediaId, at, note: answer.text, shared: answer.option });
    toast(answer.option ? "Note saved and shared" : "Note saved");
    void queryClient.invalidateQueries({ queryKey: marksKey(song.mediaId) });
  } catch (e) { toast((e as Error).message); }
}

/** Mark a chapter at this moment, for everyone. */
export async function markChapter(song: Song, at: number): Promise<void> {
  if (!song.mediaId) return;
  const answer = await askText({ title: `A chapter starts at ${clock(at)}`, label: "Name of the chapter", confirm: "Add chapter", maxLength: 120 });
  if (!answer || answer.text === "") return;
  try {
    setChapters(song.mediaId, await api.addChapter(song.mediaId, at, answer.text));
    toast("Chapter added. Everyone sees it");
  } catch (e) { toast((e as Error).message); }
}

/** The tools beside the controls: speed, sleep, a bookmark, a note. */
export function SpokenTools({ song, speed, className, button, sleep }: { song: Song; speed: number; className?: string; button: string; sleep: React.ReactNode }) {
  const at = () => player.useTime.getState().position;
  return (
    <div className={cx("flex items-center gap-1.5", className)}>
      <SpeedButton speed={speed} className={cx(button, "w-auto! px-3 font-bold tabular-nums text-[.9rem]")} />
      {sleep}
      <button type="button" className={button} aria-label="Add a bookmark" title="Bookmark this moment" onClick={() => void addBookmark(song, at())}><Icon name="bookmark" size={20} /></button>
      <button type="button" className={button} aria-label="Add a note" title="A note at this moment" onClick={() => void addNote(song, at())}><Icon name="note" size={20} /></button>
    </div>
  );
}

/** The chapter playing and the time left in it, at this speed. Nothing when the item has no chapters. */
export function ChapterLine({ song, speed, className }: { song: Song; speed: number; className?: string }) {
  const chapters = useChapters(song.mediaId);
  const position = player.useTime((t) => Math.floor(t.position));
  const length = player.useTime((t) => t.length);
  const i = chapterAt(chapters, position);
  if (i < 0) return null;
  const left = leftAtSpeed(chapterEnd(chapters, i, length) - position, speed);
  return (
    <p className={cx("min-w-0 flex items-center gap-1.5 text-[.85rem] text-muted", className)}>
      <span className="truncate font-semibold text-text">{chapters[i].title}</span>
      <span className="flex-none tabular-nums">{`· ${spokenLength(left)} left`}</span>
    </p>
  );
}

/** Where the chapters start, as ticks over a seek bar. */
export function ChapterTicks({ song }: { song: Song }) {
  const chapters = useChapters(song.mediaId);
  const length = player.useTime((t) => t.length);
  if (!length || chapters.length < 2) return null;
  return (
    <div aria-hidden="true" className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0 pointer-events-none">
      {chapters.filter((c) => c.start > 0 && c.start < length).map((c) => (
        <i key={c.start} className="absolute -top-1.25 h-2.5 w-0.5 -translate-x-1/2 rounded-full bg-bg/80" style={{ left: `calc(7px + (100% - 14px) * ${c.start / length})` }} />
      ))}
    </div>
  );
}

function chapterMenu(song: Song, c: Chapter, mine: boolean): void {
  if (!song.mediaId) return;
  const id = song.mediaId;
  openSheet(c.title, `${clock(c.start)}${c.by ? ` · marked by ${c.by}` : " · came with the file"}`, [
    { icon: "play", label: "Play from here", run: () => player.seek(c.start) },
    mine && { icon: "pencil", label: "Rename", run: async () => {
      const answer = await askText({ title: "Rename the chapter", label: "Name of the chapter", initial: c.title, maxLength: 120 });
      if (!answer || answer.text === "") return;
      try { setChapters(id, await api.changeChapter(id, c.start, answer.text)); } catch (e) { toast((e as Error).message); }
    } },
    mine && { icon: "trash", label: "Remove the chapter", danger: true, run: async () => {
      try { setChapters(id, await api.changeChapter(id, c.start, "")); toast("Chapter removed"); } catch (e) { toast((e as Error).message); }
    } },
  ]);
}

/** Every chapter, the one playing lit, and a way to mark one where it is now. */
export function ChapterList({ song, className }: { song: Song; className?: string }) {
  const chapters = useChapters(song.mediaId);
  const position = player.useTime((t) => Math.floor(t.position));
  const length = player.useTime((t) => t.length);
  const online = useOnline();
  const me = api.username().toLowerCase();
  const playing = chapterAt(chapters, position);
  return (
    <div className={cx("grid gap-1", className)}>
      {chapters.length === 0 && <p className="text-muted text-[.9rem] px-2 py-1.5">No chapters yet. Mark one where a part begins, and everyone who listens can jump to it.</p>}
      <ol className="grid">
        {chapters.map((c, i) => {
          const end = chapterEnd(chapters, i, length);
          const mine = Boolean(c.by) && c.by!.toLowerCase() === me;
          return (
            <li key={c.start} className="group/ch flex items-center rounded-2xl hover:bg-hover data-current:bg-[rgb(var(--glow)/.14)]" data-current={i === playing || undefined}>
              <button type="button" className="tap flex-1 min-w-0 flex items-center gap-3 px-3 py-2.5 text-left" onClick={() => player.seek(c.start)}>
                <span className="w-6 flex-none text-right text-muted text-[.82rem] tabular-nums group-data-current/ch:text-accent">{i + 1}</span>
                <span className="flex-1 min-w-0 grid">
                  <b className="truncate font-[650] group-data-current/ch:text-accent">{c.title}</b>
                  <span className="text-muted text-[.8rem] tabular-nums">{`${clock(c.start)}${length ? ` · ${spokenLength(end - c.start)}` : ""}`}</span>
                </span>
              </button>
              <button type="button" className={ui.rowMore} aria-label={`More about ${c.title}`} onClick={() => chapterMenu(song, c, mine || isAdmin())}><Icon name="more" size={18} /></button>
            </li>
          );
        })}
      </ol>
      {online && <button type="button" className={cx(ui.pill, "justify-self-start ml-2")} onClick={() => void markChapter(song, player.useTime.getState().position)}><Icon name="flag" size={16} />Mark a chapter here</button>}
    </div>
  );
}

function markMenu(song: Song, m: Mark): void {
  const id = song.mediaId!;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: marksKey(id) });
  openSheet(m.note ? "Note" : "Bookmark", clock(m.at), [
    { icon: "play", label: "Play from here", run: () => player.seek(m.at) },
    { icon: "pencil", label: m.note ? "Edit the note" : "Add a note", run: async () => {
      const answer = await askText({ title: `Note at ${clock(m.at)}`, label: "What do you want to remember?", initial: m.note, multiline: true, option: { label: "Share with everyone who listens", on: Boolean(m.shared) } });
      if (!answer) return;
      try { await api.editMark(m.id, { note: answer.text, shared: answer.option }); refresh(); } catch (e) { toast((e as Error).message); }
    } },
    Boolean(m.note) && { icon: "people", label: m.shared ? "Stop sharing" : "Share with everyone who listens", run: async () => {
      try { await api.editMark(m.id, { shared: !m.shared }); refresh(); toast(m.shared ? "Only you see it now" : "Shared"); } catch (e) { toast((e as Error).message); }
    } },
    { icon: "trash", label: "Delete", danger: true, run: async () => {
      try { await api.deleteMark(m.id); refresh(); } catch (e) { toast((e as Error).message); }
    } },
  ]);
}

/** The person's bookmarks and notes on this item, and the notes others shared on it. */
export function MarkList({ song, className, onPlay = (at) => player.seek(at) }: { song: Song; className?: string; onPlay?: (at: number) => void }) {
  const online = useOnline();
  const id = song.mediaId ?? "";
  const { data, isPending } = useQuery({ queryKey: marksKey(id), queryFn: () => api.getMarks(id), enabled: online && id !== "" });
  const [showShared, setShowShared] = useState(true);
  if (!online) return <p className={cx("text-muted text-[.9rem] px-2", className)}>Bookmarks and notes show when you are online.</p>;
  if (isPending) return <div className={cx("px-2", className)}><Ring percent={-1} size={22} /></div>;
  const mine = data?.marks ?? [];
  const shared = data?.shared ?? [];
  const row = (m: Mark | SharedMark, others: boolean) => (
    <li key={m.id} className="flex items-start rounded-2xl hover:bg-hover">
      <button type="button" className="tap flex-1 min-w-0 flex items-start gap-3 px-3 py-2.5 text-left" onClick={() => onPlay(m.at)}>
        <span className="flex-none mt-0.5 text-accent"><Icon name={m.note ? "note" : "bookmark-fill"} size={18} /></span>
        <span className="flex-1 min-w-0 grid gap-0.5">
          <b className="font-[650] tabular-nums">{clock(m.at)}{others && <span className="text-muted font-medium">{` · ${(m as SharedMark).name || (m as SharedMark).user}`}</span>}{!others && m.shared && <span className="text-muted font-medium"> · shared</span>}</b>
          {m.note && <span className="text-[.9rem] whitespace-pre-wrap wrap-anywhere">{m.note}</span>}
        </span>
      </button>
      {!others && <button type="button" className={ui.rowMore} aria-label="More" onClick={() => markMenu(song, m)}><Icon name="more" size={18} /></button>}
    </li>
  );
  return (
    <div className={cx("grid gap-1", className)}>
      {mine.length === 0 && <p className="text-muted text-[.9rem] px-2 py-1.5">Bookmark a moment to come back to it, or write a note. Only you see them, unless you share a note.</p>}
      <ul className="grid">{mine.map((m) => row(m, false))}</ul>
      {shared.length > 0 && (
        <>
          <button type="button" className="flex items-center gap-1.5 px-2 pt-3 pb-1 text-[.8rem] font-semibold text-muted" aria-expanded={showShared} onClick={() => setShowShared(!showShared)}>
            <Icon name="people" size={16} />{`Shared by others (${shared.length})`}<Icon name={showShared ? "up" : "down"} size={14} />
          </button>
          {showShared && <ul className="grid">{shared.map((m) => row(m, true))}</ul>}
        </>
      )}
    </div>
  );
}

type Tab = "chapters" | "marks" | "next";

/** Chapters, bookmarks and notes, and what comes next, under the controls (the phone's player and the deck). */
export function SpokenPanel({ song, next, className, heading }: { song: Song; next?: React.ReactNode; className?: string; heading?: string }) {
  const [tab, setTab] = useState<Tab>("chapters");
  const tabs: [Tab, string][] = [["chapters", "Chapters"], ["marks", "Bookmarks & notes"], ...(next ? [["next", "Up next"] as [Tab, string]] : [])];
  return (
    <div className={cx("grid gap-2 content-start", className)}>
      <div className={cx("flex gap-1.5 overflow-x-auto no-scrollbar", heading)} role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={cx(ui.chip, "py-1.5 px-3.5 text-[.85rem] whitespace-nowrap")} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === "chapters" && <ChapterList song={song} />}
      {tab === "marks" && <MarkList song={song} />}
      {tab === "next" && next}
    </div>
  );
}
