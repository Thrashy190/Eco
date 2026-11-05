import { describe, expect, it } from "vitest";
import { SORTS, sorted, sortOption, type SortKeys } from "./sorting";

interface Item { id: string; keys: SortKeys }
const item = (id: string, keys: SortKeys): Item => ({ id, keys });
const order = (items: Item[], section: string, chosen: string) => sorted(items, sortOption(section, chosen), (i) => i.keys).map((i) => i.id);

describe("sorted", () => {
  it("ignores capitals and accents, and reads numbers as numbers", () => {
    const items = [item("zoe", { name: "zoe" }), item("Ángel", { name: "Ángel" }), item("10", { name: "Track 10" }), item("2", { name: "Track 2" }), item("beta", { name: "Beta" })];
    expect(order(items, "albums", "name")).toEqual(["Ángel", "beta", "2", "10", "zoe"]);
  });
  it("puts what has no value last, whichever way it sorts", () => {
    const items = [item("unknown", {}), item("1999", { year: 1999 }), item("2024", { year: 2024 })];
    expect(order(items, "albums", "newest")).toEqual(["2024", "1999", "unknown"]);
    expect(order(items, "albums", "oldest")).toEqual(["1999", "2024", "unknown"]);
  });
  it("treats a date it could not read as no date", () => {
    const items = [item("bad", { when: Number.NaN }), item("old", { when: 1 }), item("new", { when: 2 })];
    expect(order(items, "albums", "added")).toEqual(["new", "old", "bad"]);
  });
  it("keeps ties as they came, so albums by one artist stay in order", () => {
    const items = [item("a", { artist: "Same" }), item("b", { artist: "Same" }), item("c", { artist: "Same" })];
    expect(order(items, "albums", "artist")).toEqual(["a", "b", "c"]);
  });
  it("leaves the list it was given alone", () => {
    const items = [item("b", { name: "b" }), item("a", { name: "a" })];
    sorted(items, sortOption("albums", "name"), (i) => i.keys);
    expect(items.map((i) => i.id)).toEqual(["b", "a"]);
  });
  it("leaves a list in the order it came when the option has no key", () => {
    const items = [item("newest", { name: "z" }), item("older", { name: "a" })];
    expect(order(items, "offline", "saved")).toEqual(["newest", "older"]);
  });
});

describe("sortOption", () => {
  it("starts on the first order of the section", () => {
    expect(sortOption("songs").id).toBe("added");
  });
  it("falls back when the saved choice no longer exists", () => {
    expect(sortOption("albums", "gone").id).toBe("name");
  });
  it("has no orders for Recent, whose order is the point of it", () => {
    expect("recent" in SORTS).toBe(false);
  });
  it("offers what the server knows for songs", () => {
    expect(SORTS.songs.map((o) => o.id)).toEqual(["added", "title", "artist", "album", "length"]);
  });
});
