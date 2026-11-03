import { describe, expect, it } from "vitest";
import type { LibraryEntry } from "../lib/types";
import { entryRoute, entrySong, favoritesEntry, libraryRows, songEntry } from "./library";

const entry = (type: LibraryEntry["type"], id: string): LibraryEntry => ({ type, id, name: id });

describe("libraryRows", () => {
  const favorites = favoritesEntry(3);

  it("leads with Favorites, then pins, then recents", () => {
    const rows = libraryRows({ pins: [entry("song", "s1")], recents: [entry("album", "a1")], covers: {} }, favorites);
    expect(rows.map((r) => r.entry.id)).toEqual(["favorites", "s1", "a1"]);
    expect(rows.map((r) => r.pinned)).toEqual([true, true, false]);
  });

  it("lists something both pinned and recent once, as pinned", () => {
    const rows = libraryRows({ pins: [entry("album", "a1")], recents: [entry("album", "a1"), entry("artist", "x")], covers: {} }, favorites);
    expect(rows.map((r) => [r.entry.id, r.pinned])).toEqual([["favorites", true], ["a1", true], ["x", false]]);
  });

  it("does not repeat Favorites when it was opened recently", () => {
    const rows = libraryRows({ pins: [], recents: [favoritesEntry(1)], covers: {} }, favorites);
    expect(rows).toHaveLength(1);
    expect(rows[0].entry.subtitle).toBe("Playlist · 3 songs"); // the fresh count, not the remembered one
  });

  it("shows one row for an album opened both from the library and from the catalogue", () => {
    const fromSpotify: LibraryEntry = { type: "catalog_album", id: "sp", name: "Peace Love Death Metal", subtitle: "Album · Eagles Of Death Metal" };
    const fromLibrary: LibraryEntry = { type: "album", id: "nd", name: "Peace Love Death Metal", subtitle: "Album · Eagles Of Death Metal" };
    const rows = libraryRows({ pins: [fromSpotify], recents: [fromLibrary], covers: {} }, favorites);
    expect(rows.map((r) => r.entry.id)).toEqual(["favorites", "sp"]);
  });

  it("keeps two albums with the same name by different artists", () => {
    const one: LibraryEntry = { type: "album", id: "a", name: "Greatest Hits", subtitle: "Album · Queen" };
    const two: LibraryEntry = { type: "album", id: "b", name: "Greatest Hits", subtitle: "Album · ABBA" };
    expect(libraryRows({ pins: [], recents: [one, two], covers: {} }, favorites)).toHaveLength(3);
  });

  it("keeps apart an album and an artist that share an ID", () => {
    const rows = libraryRows({ pins: [], recents: [entry("album", "same"), entry("artist", "same")], covers: {} }, favorites);
    expect(rows).toHaveLength(3);
  });
});

describe("entries", () => {
  it("a pinned song plays with everything the player needs", () => {
    const song = { id: "s", title: "Walk", artist: "Pantera", artistId: "p", album: "VDOP", albumId: "v", duration: 315, cover: "c" };
    expect(entrySong(songEntry(song))).toEqual(song);
  });
  it("only songs have no page of their own", () => {
    expect(entryRoute(entry("song", "s"))).toBeNull();
    expect(entryRoute(entry("catalog_album", "x"))).toBe("/catalog-album/x");
    expect(entryRoute({ type: "spotify_album", id: "x", name: "Sour", subtitle: "Album · Olivia Rodrigo" })).toBe("/album-lookup?name=Sour&artist=Olivia%20Rodrigo");
    expect(entryRoute(favoritesEntry())).toBe("/playlist/favorites");
  });
});
