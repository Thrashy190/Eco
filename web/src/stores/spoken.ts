// Where you are in podcasts and audiobooks, and their chapters, for the player and the screens. Progress is kept on the
// server, so every device carries on from the same place, and on this device too, so it works offline. Each report
// carries when it was true; the newer one wins, so a phone coming back online never undoes what the computer did.
import { useEffect } from "react";
import { create } from "zustand";
import * as api from "../lib/api";
import { newer, type Chapter, type Progress } from "../lib/spoken";
import { isOnline } from "./settings";

// Per account: two people signing in on one device must not see where the other is
const key = () => `eco.progress.${api.username() || "_"}`;
const LEGACY = (id: string) => `eco.pos.m-${id}`; // where positions were kept before, by song ID; read, never renamed

function readLocal(): Record<string, Progress> {
  try {
    const raw = JSON.parse(localStorage.getItem(key()) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object") return {};
    const out: Record<string, Progress> = {};
    for (const [id, p] of Object.entries(raw as Record<string, unknown>)) {
      const v = p as Partial<Progress> | null;
      if (v && typeof v.position === "number" && Number.isFinite(v.position) && typeof v.at === "number") out[id] = { position: v.position, finished: v.finished === true, at: v.at };
    }
    return out;
  } catch {
    return {};
  }
}

interface SpokenState {
  progress: Record<string, Progress>; // by media ID
  chapters: Record<string, Chapter[]>; // by media ID, as last fetched
}

export const useSpoken = create<SpokenState>(() => ({ progress: {}, chapters: {} }));
const state = () => useSpoken.getState();

let dirty = new Set<string>(); // reports the server has not heard yet
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function keep(progress: Record<string, Progress>): void {
  useSpoken.setState({ progress });
  try { localStorage.setItem(key(), JSON.stringify(progress)); } catch { /* storage full or blocked */ }
}

/** Where someone is in an item: what this device or the server last knew, or a position kept the old way. */
export function progressOf(id: string): Progress | undefined {
  const known = state().progress[id];
  if (known) return known;
  try {
    const legacy = Number(localStorage.getItem(LEGACY(id)));
    if (legacy > 0) return { position: legacy, at: 0 };
  } catch { /* ignore */ }
  return undefined;
}

export const useProgress = (id: string | undefined): Progress | undefined =>
  useSpoken((s) => (id ? s.progress[id] : undefined)) ?? (id ? progressOf(id) : undefined);

/** Where to start an item: where it was left, unless it was finished, which starts it again. */
export function startPosition(id: string): number {
  const p = progressOf(id);
  return p && !p.finished ? p.position : 0;
}

/** Record where someone is. `urgent` sends it now (pausing, leaving); otherwise it goes with the next batch. */
export function report(id: string, position: number, finished = false, urgent = false): void {
  const p: Progress = { position: finished ? 0 : Math.max(0, Math.floor(position)), finished, at: Date.now() };
  keep({ ...state().progress, [id]: p });
  dirty.add(id);
  if (urgent) void flush();
  else if (!flushTimer) flushTimer = setTimeout(() => void flush(), 15_000);
}

/** Start an item over as if new, here and on the server. */
export async function forget(id: string): Promise<void> {
  const rest = { ...state().progress };
  delete rest[id];
  keep(rest);
  dirty.delete(id);
  try { localStorage.removeItem(LEGACY(id)); } catch { /* ignore */ }
  if (isOnline()) await api.forgetProgress(id).catch(() => undefined);
}

/** Send what the server has not heard. What fails stays to be sent next time. */
export async function flush(): Promise<void> {
  clearTimeout(flushTimer);
  flushTimer = undefined;
  if (!dirty.size || !isOnline()) return;
  const sending = dirty;
  dirty = new Set();
  await Promise.all([...sending].map(async (id) => {
    const p = state().progress[id];
    if (!p) return;
    try {
      const kept = await api.putProgress(id, p);
      if (kept.at > (state().progress[id]?.at ?? 0)) keep({ ...state().progress, [id]: kept }); // another device was further on
    } catch {
      dirty.add(id);
    }
  }));
}

/** Join what the server knows with what this device does: per item, the newer report wins. */
export async function syncProgress(): Promise<void> {
  if (!isOnline()) return;
  await flush();
  const server = await api.getProgress().catch(() => null);
  if (!server) return;
  const merged = { ...state().progress };
  for (const [id, p] of Object.entries(server)) merged[id] = newer(merged[id], p) ?? p;
  keep(merged);
}

/** Keep progress moving: on start, on coming back to the app or online, and before the app goes away. */
export function watchProgress(): () => void {
  dirty = new Set();
  useSpoken.setState({ progress: readLocal() }); // this account's, as this device last knew it
  void syncProgress();
  const onShow = () => { if (document.visibilityState === "visible") void syncProgress(); else void flush(); };
  const onOnline = () => void syncProgress();
  document.addEventListener("visibilitychange", onShow);
  window.addEventListener("online", onOnline);
  return () => { document.removeEventListener("visibilitychange", onShow); window.removeEventListener("online", onOnline); };
}

// ---- Chapters ----

const chapterKey = (id: string) => `eco.chapters.${id}`;
const asking = new Map<string, Promise<Chapter[]>>();

function chaptersFromDevice(id: string): Chapter[] | undefined {
  try {
    const raw = JSON.parse(localStorage.getItem(chapterKey(id)) ?? "null") as unknown;
    return Array.isArray(raw) ? raw.filter((c): c is Chapter => typeof c?.start === "number" && typeof c?.title === "string") : undefined;
  } catch {
    return undefined;
  }
}

/** Keep an item's chapters, here and for offline. */
export function setChapters(id: string, list: Chapter[]): void {
  useSpoken.setState({ chapters: { ...state().chapters, [id]: list } });
  try { localStorage.setItem(chapterKey(id), JSON.stringify(list)); } catch { /* ignore */ }
}

/** An item's chapters as known now (fetched, or kept on this device), without asking. */
export const chaptersOf = (id: string | undefined): Chapter[] => (id ? state().chapters[id] ?? chaptersFromDevice(id) ?? [] : []);

/** Fetch an item's chapters (once at a time), falling back to the copy on this device. */
export function loadChapters(id: string): Promise<Chapter[]> {
  if (!isOnline()) {
    const saved = chaptersFromDevice(id) ?? [];
    if (!state().chapters[id]) useSpoken.setState({ chapters: { ...state().chapters, [id]: saved } });
    return Promise.resolve(saved);
  }
  let pending = asking.get(id);
  if (!pending) {
    pending = api.getChapters(id)
      .then((list) => { setChapters(id, list); return list; })
      .catch(() => chaptersOf(id))
      .finally(() => asking.delete(id));
    asking.set(id, pending);
  }
  return pending;
}

/** The chapters of an item, fetched when first shown. */
export function useChapters(id: string | undefined): Chapter[] {
  const list = useSpoken((s) => (id ? s.chapters[id] : undefined));
  const missing = id !== undefined && list === undefined;
  useEffect(() => { if (id && missing) void loadChapters(id); }, [id, missing]);
  return list ?? (id ? chaptersFromDevice(id) ?? [] : []);
}
