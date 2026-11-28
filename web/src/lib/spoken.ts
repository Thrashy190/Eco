// The rules of podcasts and audiobooks, kept apart from the player so they can be tested: chapters, skipping, speed,
// and stepping back a little after a pause.

export interface Chapter {
  start: number; // seconds into the file
  title: string;
  by?: string; // who marked it; empty when it came with the file
  at?: number;
}

/** The chapter playing at a moment (its index), or -1 before the first one or with none. */
export function chapterAt(chapters: readonly Chapter[], t: number): number {
  let found = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].start <= t + 0.25) found = i; // a quarter second early still counts: a jump lands at the start
    else break;
  }
  return found;
}

/** Where a chapter ends: where the next one starts, or the end of the file. */
export const chapterEnd = (chapters: readonly Chapter[], i: number, length: number): number =>
  chapters[i + 1]?.start ?? length;

/** Seconds into the chapter after which "previous" restarts it instead of going to the one before, as with songs. */
const RESTART_AFTER = 3;

/**
 * Where "previous chapter" goes: the start of this chapter if it has played a moment, else the start of the one
 * before. null means there is nothing before in this file (go to the previous file).
 */
export function previousChapterStart(chapters: readonly Chapter[], t: number): number | null {
  const i = chapterAt(chapters, t);
  if (i < 0) return t > RESTART_AFTER ? 0 : null;
  if (t - chapters[i].start > RESTART_AFTER) return chapters[i].start;
  if (i > 0) return chapters[i - 1].start;
  return chapters[0].start > 0 ? 0 : null;
}

/** Where "next chapter" goes, or null when this is the last one (go to the next file). */
export function nextChapterStart(chapters: readonly Chapter[], t: number): number | null {
  const next = chapters[chapterAt(chapters, t) + 1];
  return next ? next.start : null;
}

/** The lengths a skip can be, in seconds. */
export const SKIPS = [5, 10, 15, 30, 45, 60, 90] as const;
export const DEFAULT_SKIP_BACK = 30;
export const DEFAULT_SKIP_FORWARD = 30;
export const skipLength = (value: unknown, fallback: number): number => ((SKIPS as readonly number[]).includes(Number(value)) ? Number(value) : fallback);

/** Where a skip lands: never before the start, and never right on the end, which would end the file at once. */
export function skipTarget(t: number, by: number, length: number): number {
  const to = t + by;
  if (to < 0) return 0;
  if (length > 0 && to > length - 1) return Math.max(0, length - 1);
  return to;
}

/** Speeds from half to three times, in steps of 0.05. */
export const MIN_SPEED = 0.5;
export const MAX_SPEED = 3;
export const SPEED_PRESETS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** A speed someone asked for, rounded to a step and kept in range; 1 for anything that is not a number. */
export function cleanSpeed(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.round(Math.min(Math.max(n, MIN_SPEED), MAX_SPEED) * 20) / 20;
}

/** How a speed reads: 1.5×, 1.25×, 1×. */
export const speedLabel = (speed: number): string => `${Number(speed.toFixed(2))}×`;

/** Time it takes to hear what is left at this speed, in seconds. */
export const leftAtSpeed = (left: number, speed: number): number => Math.max(0, left) / (speed > 0 ? speed : 1);

/**
 * How far to step back when someone plays again after a pause: nothing after a moment, a few seconds after a few
 * minutes, more after a long break, so the sentence that was cut makes sense again.
 */
export function rewindAfterPause(pausedMs: number): number {
  if (!(pausedMs > 0)) return 0;
  const minutes = pausedMs / 60_000;
  if (minutes < 1) return 0;
  if (minutes < 10) return 5;
  if (minutes < 60) return 15;
  return 30;
}

/** How long something is, as a person says it: 3 h 12 min, 45 min, 30 s. */
export function spokenLength(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}

/** Where someone is in one item. */
export interface Progress {
  position: number;
  finished?: boolean;
  at: number; // when that was true, in ms
}

/** The newer of two reports of progress; ties keep the first. */
export const newer = (a: Progress | undefined, b: Progress | undefined): Progress | undefined =>
  !a ? b : !b ? a : b.at > a.at ? b : a;

/** How far through an item someone is, from 0 to 1 (1 once finished). */
export function progressRatio(p: Progress | undefined, length: number): number {
  if (!p) return 0;
  if (p.finished) return 1;
  return length > 0 ? Math.min(Math.max(p.position / length, 0), 1) : 0;
}

/**
 * Where someone is in a whole book made of several files: the parts before the one they are in count whole.
 * `parts` are the lengths in reading order; `at` is which part and the position in it.
 */
export function bookPosition(parts: readonly number[], at: { part: number; position: number } | null): { heard: number; total: number } {
  const total = parts.reduce((sum, n) => sum + Math.max(0, n), 0);
  if (!at || at.part < 0) return { heard: 0, total };
  const before = parts.slice(0, at.part).reduce((sum, n) => sum + Math.max(0, n), 0);
  return { heard: Math.min(total, before + Math.max(0, at.position)), total };
}

/** Whether an item is new to someone, started, or heard to the end. */
export type ItemState = "new" | "started" | "finished";
export function itemState(p: Progress | undefined): ItemState {
  if (p?.finished) return "finished";
  return p && p.position >= 1 ? "started" : "new";
}

/**
 * Where a book carries on, given its parts in order: the part heard most recently if it is not finished, else the
 * first part not finished after it, else the start. `progress` reads the person's progress of a part.
 */
export function resumePoint<T extends { id: string }>(parts: readonly T[], progress: (id: string) => Progress | undefined): { index: number; position: number } {
  if (!parts.length) return { index: -1, position: 0 };
  let last = -1;
  let lastAt = -1;
  parts.forEach((part, i) => {
    const p = progress(part.id);
    if (p && p.at > lastAt && (p.position >= 1 || p.finished)) { last = i; lastAt = p.at; }
  });
  if (last < 0) return { index: 0, position: 0 };
  const p = progress(parts[last].id)!;
  if (!p.finished) return { index: last, position: p.position };
  for (let i = last + 1; i < parts.length; i++) {
    if (!progress(parts[i].id)?.finished) return { index: i, position: progress(parts[i].id)?.position ?? 0 };
  }
  return { index: 0, position: 0 }; // every part heard: from the beginning
}
