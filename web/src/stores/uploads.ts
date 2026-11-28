// Files sent from this device to a show or a book: one after the other, each in pieces, so a lost connection only costs
// the piece that was on its way. A failed piece is tried again a few times, after asking the server where it got to.
import { create } from "zustand";
import * as api from "../lib/api";
import { queryClient } from "../lib/query";
import type { MediaKind } from "../lib/types";
import { toast } from "./ui";

export interface Sending {
  key: string;
  name: string;
  size: number;
  sent: number;
  state: "waiting" | "sending" | "checking" | "done" | "failed";
  error?: string;
  collection: string;
}

interface Queued { key: string; file: File; kind: MediaKind; collection: string }

export const useUploads = create<{ list: Sending[] }>(() => ({ list: [] }));

const queue: Queued[] = [];
let running = false;
let stop: AbortController | null = null;
let cancelled = new Set<string>();

const change = (key: string, patch: Partial<Sending>) =>
  useUploads.setState((s) => ({ list: s.list.map((u) => (u.key === key ? { ...u, ...patch } : u)) }));

/** Names in the order a person reads them: "Part 2" before "Part 10". */
const byName = (a: File, b: File) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/** Send files to a show or a book. A book's parts are sent in the order of their names, which is the order they join it. */
export function sendFiles(files: FileList | File[], kind: MediaKind, collection: string): void {
  const sorted = [...files].sort(byName);
  for (const file of sorted) {
    const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    queue.push({ key, file, kind, collection });
    useUploads.setState((s) => ({ list: [...s.list, { key, name: file.name, size: file.size, sent: 0, state: "waiting", collection }] }));
  }
  void run();
}

/** Stop sending a file (or take it off the list when it has finished). */
export function cancel(key: string): void {
  const waiting = queue.findIndex((q) => q.key === key);
  if (waiting >= 0) queue.splice(waiting, 1);
  cancelled.add(key);
  if (current === key) stop?.abort();
  useUploads.setState((s) => ({ list: s.list.filter((u) => u.key !== key) }));
}

/** Clear the files that finished from the list. */
export const clearDone = () => useUploads.setState((s) => ({ list: s.list.filter((u) => u.state !== "done") }));

let current = "";
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function run(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (let next = queue.shift(); next; next = queue.shift()) await sendOne(next);
  } finally {
    running = false;
    current = "";
    cancelled = new Set();
  }
}

async function sendOne({ key, file, kind, collection }: Queued): Promise<void> {
  current = key;
  stop = new AbortController();
  change(key, { state: "sending" });
  let id = "";
  try {
    const started = await api.startUpload({ kind, collection, name: file.name, size: file.size });
    id = started.upload.id;
    let offset = 0;
    let tries = 0;
    while (offset < file.size) {
      if (cancelled.has(key)) throw new DOMException("cancelled", "AbortError");
      try {
        const state = await api.uploadPiece(id, offset, file.slice(offset, offset + started.chunk), stop.signal);
        offset = state.received;
        tries = 0;
        change(key, { sent: offset });
      } catch (e) {
        if (cancelled.has(key)) throw new DOMException("cancelled", "AbortError"); // request() reports an abort as no connection
        if (++tries > 5) throw e;
        await pause(1000 * 2 ** tries); // a moment's trouble: wait, then go on from where the server is
        offset = (await api.uploadStatus(id).catch(() => ({ received: offset }))).received;
      }
    }
    change(key, { state: "checking", sent: file.size });
    await api.finishUpload(id);
    change(key, { state: "done" });
    void queryClient.invalidateQueries({ queryKey: ["collection"] });
    void queryClient.invalidateQueries({ queryKey: ["collections"] });
    void queryClient.invalidateQueries({ queryKey: ["media"] });
  } catch (e) {
    if (id) void api.cancelUpload(id).catch(() => undefined);
    if ((e as Error).name === "AbortError") return;
    change(key, { state: "failed", error: (e as Error).message });
    toast(`${file.name}: ${(e as Error).message}`);
  }
}
