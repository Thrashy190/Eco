import { describe, expect, it } from "vitest";
import { addNext, addToQueue, jump, move, sections, shuffleUpcoming, startList, type Order } from "./queue";
import type { Song } from "./types";

const song = (id: string, queued = false): Song => ({ id, title: id, artist: "Someone", ...(queued ? { queued: true } : {}) });
const list = (...ids: string[]) => ids.map((id) => song(id));
/** The queue as text: added songs as `+id`, the one playing in brackets. */
const read = ({ queue, index }: Order) => queue.map((s, k) => `${k === index ? "[" : ""}${s.queued ? "+" : ""}${s.id}${k === index ? "]" : ""}`).join(" ");

const playlist: Order = { queue: list("p1", "p2", "p3", "p4"), index: 0 };

describe("adding songs while a playlist plays", () => {
  it("plays an added song next, ahead of the playlist", () => {
    expect(read(addToQueue(playlist, song("a")))).toBe("[p1] +a p2 p3 p4");
  });
  it("keeps added songs in the order they were added", () => {
    expect(read(addToQueue(addToQueue(playlist, song("a")), song("b")))).toBe("[p1] +a +b p2 p3 p4");
  });
  it("puts Play next ahead of what was added before", () => {
    expect(read(addNext(addToQueue(playlist, song("a")), song("n")))).toBe("[p1] +n +a p2 p3 p4");
  });
  it("adds behind the added songs still waiting while one of them plays", () => {
    const order = addToQueue(addToQueue(playlist, song("a")), song("b"));
    expect(read(addToQueue({ ...order, index: 1 }, song("c")))).toBe("p1 [+a] +b +c p2 p3 p4");
  });
  it("lets a song be added twice", () => {
    expect(read(addToQueue(addToQueue(playlist, song("a")), song("a")))).toBe("[p1] +a +a p2 p3 p4");
  });
});

describe("starting another list", () => {
  it("keeps what was waiting right after the first song", () => {
    const order = addToQueue(addToQueue(playlist, song("a")), song("b"));
    expect(read(startList(order, list("x1", "x2", "x3"), 1))).toBe("x1 [x2] +a +b x3");
  });
  it("forgets added songs that already played", () => {
    const order = { ...addToQueue(playlist, song("a")), index: 2 };
    expect(read(startList(order, list("x1", "x2"), 0))).toBe("[x1] x2");
  });
  it("does not mark the new list's songs as added, even when one came from the queue", () => {
    expect(read(startList(playlist, [song("x1", true), song("x2")], 0))).toBe("[x1] x2");
  });
});

describe("jumping to a song in the queue", () => {
  const order = addToQueue(addToQueue(playlist, song("a")), song("b")); // [p1] +a +b p2 p3 p4
  it("keeps added songs it skips waiting after it", () => {
    expect(read(jump(order, 4))).toBe("p1 p2 [p3] +a +b p4");
  });
  it("counts skipped playlist songs as passed", () => {
    const passed = jump(order, 5);
    expect(read(passed)).toBe("p1 p2 p3 [p4] +a +b");
  });
  it("keeps added songs above an added song it jumps to", () => {
    expect(read(jump(order, 2))).toBe("p1 [+b] +a p2 p3 p4");
  });
  it("only moves the position when going back", () => {
    expect(read(jump({ ...order, index: 4 }, 1))).toBe("p1 [+a] +b p2 p3 p4");
  });
});

describe("dragging songs in the queue", () => {
  const order = addToQueue(addToQueue(playlist, song("a")), song("b")); // [p1] +a +b p2 p3 p4
  it("reorders the added songs", () => {
    expect(read(move(order, 2, 1))).toBe("[p1] +b +a p2 p3 p4");
  });
  it("makes a playlist song dragged among the added ones an added one", () => {
    expect(read(move(order, 4, 1))).toBe("[p1] +p3 +a +b p2 p4");
    expect(read(move(order, 5, 2))).toBe("[p1] +a +p4 +b p2 p3");
  });
  it("makes an added song dragged into the playlist part of it", () => {
    expect(read(move(order, 1, 4))).toBe("[p1] +b p2 p3 a p4");
  });
  it("reorders the playlist without marking anything", () => {
    expect(read(move(playlist, 3, 1))).toBe("[p1] p4 p2 p3");
  });
  it("never moves the song playing or one that played", () => {
    const later = { ...order, index: 2 };
    expect(move(later, 1, 4)).toBe(later);
    expect(move(later, 4, 2)).toBe(later);
    expect(move(order, 1, 9)).toBe(order);
  });
});

describe("shuffling", () => {
  it("keeps added songs first, in order, and mixes the rest", () => {
    const order = addToQueue(addToQueue(playlist, song("a")), song("b"));
    expect(read(shuffleUpcoming(order, (songs) => songs.slice().reverse()))).toBe("[p1] +a +b p4 p3 p2");
  });
});

describe("sections", () => {
  it("groups added songs apart from the list", () => {
    const order = addToQueue(addToQueue(playlist, song("a")), song("b"));
    expect(sections(order.queue.slice(1)).map((s) => [s.queued, s.start, s.songs.map((x) => x.id).join(",")])).toEqual([
      [true, 0, "a,b"], [false, 2, "p2,p3,p4"],
    ]);
  });
  it("has nothing to show for an empty queue", () => {
    expect(sections([])).toEqual([]);
  });
});
