// The play order. Songs someone adds ("Play next", "Add to queue") wait in front of the album or playlist that is
// playing, in the order they were added, and stay marked (`queued`) so the queue can tell them apart. They also survive
// starting another album: they were asked for, the album was not. Everything here is pure, so it is tested.
import type { Song } from "./types";

export interface Order {
  queue: Song[];
  index: number; // the song playing
}

const mark = (song: Song): Song => (song.queued ? song : { ...song, queued: true });
const unmark = (song: Song): Song => {
  if (!song.queued) return song;
  const { queued: _, ...rest } = song;
  return rest;
};

/** Where the next added song goes: after the current song and everything added before it. */
export function queueEnd({ queue, index }: Order): number {
  let at = index + 1;
  while (queue[at]?.queued) at++;
  return at;
}

const insert = (queue: Song[], at: number, song: Song) => [...queue.slice(0, at), song, ...queue.slice(at)];

/** "Add to queue": after the songs already waiting, before the rest of the album or playlist. */
export const addToQueue = (order: Order, song: Song): Order => ({ queue: insert(order.queue, queueEnd(order), mark(song)), index: order.index });

/** "Play next": straight after the current song, ahead of anything waiting. */
export const addNext = (order: Order, song: Song): Order => ({ queue: insert(order.queue, order.index + 1, mark(song)), index: order.index });

/** The songs added by hand that have not played yet. */
export const waiting = ({ queue, index }: Order): Song[] => queue.slice(index + 1).filter((s) => s.queued);

/** Start a list (already in play order) at song i. What was waiting in the queue comes right after that song. */
export function startList(order: Order, songs: Song[], i: number): Order {
  const list = songs.map(unmark);
  return { queue: [...list.slice(0, i + 1), ...waiting(order), ...list.slice(i + 1)], index: i };
}

/**
 * Jump to a song further down. Added songs it skips over stay waiting, right after it; skipped songs of the album or
 * playlist count as passed. Going back changes nothing but the position.
 */
export function jump(order: Order, to: number): Order {
  const { queue, index } = order;
  if (to <= index + 1 || to >= queue.length) return { queue, index: Math.max(0, Math.min(to, queue.length - 1)) };
  const skipped = queue.slice(index + 1, to);
  const kept = skipped.filter((s) => s.queued);
  if (kept.length === 0) return { queue, index: to };
  const before = [...queue.slice(0, index + 1), ...skipped.filter((s) => !s.queued)];
  return { queue: [...before, queue[to], ...kept, ...queue.slice(to + 1)], index: before.length };
}

/** Shuffle what comes next. Added songs keep their order at the front: they were chosen to play next. */
export function shuffleUpcoming(order: Order, mix: (songs: Song[]) => Song[]): Order {
  const { queue, index } = order;
  const upcoming = queue.slice(index + 1);
  return { queue: [...queue.slice(0, index + 1), ...upcoming.filter((s) => s.queued), ...mix(upcoming.filter((s) => !s.queued))], index };
}

/**
 * Move a song that has not played yet from one position to another (both counted in the whole queue, `to` as it
 * reads after the move). It joins whatever it lands among: dropped between added songs, or above them, it is added
 * too; dropped among the album's songs, it becomes one of them. That keeps the added songs together at the front.
 */
export function move(order: Order, from: number, to: number): Order {
  const { queue, index } = order;
  if (from === to || from <= index || to <= index || from >= queue.length || to >= queue.length) return order;
  const out = queue.slice();
  const [song] = out.splice(from, 1);
  out.splice(to, 0, song);
  const above = to - 1 > index ? out[to - 1] : undefined;
  const below = out[to + 1];
  const queued = above ? Boolean(above.queued) : Boolean(song.queued || below?.queued);
  out[to] = queued ? mark(song) : unmark(song);
  return { queue: out, index };
}

/** What comes next, in runs of added songs and songs of the list, for the queue to show under their own headings. */
export function sections(upcoming: Song[]): { queued: boolean; start: number; songs: Song[] }[] {
  const out: { queued: boolean; start: number; songs: Song[] }[] = [];
  upcoming.forEach((song, k) => {
    const queued = Boolean(song.queued);
    const last = out[out.length - 1];
    if (last && last.queued === queued) last.songs.push(song);
    else out.push({ queued, start: k, songs: [song] });
  });
  return out;
}
