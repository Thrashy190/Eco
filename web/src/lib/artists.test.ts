import { describe, expect, it } from "vitest";
import { knownArtists, splitArtists, splitOwn, readableArtists } from "./format";
import type { Song } from "./types";

const known = knownArtists(["Bad Bunny", "Beyoncé", "Tyler, The Creator"]);

describe("splitArtists", () => {
  it("separates artists tagged together", () => {
    expect(splitArtists("Bad Bunny, Chuwi", known)).toEqual(["Bad Bunny", "Chuwi"]);
    expect(splitArtists("Chuwi, Bad Bunny, RaiNao", known)).toEqual(["Chuwi", "Bad Bunny", "RaiNao"]);
  });
  it("leaves a name with a comma in it alone", () => {
    expect(splitArtists("Tyler, The Creator", known)).toEqual(["Tyler, The Creator"]);
  });
  it("ignores case and accents", () => {
    expect(splitArtists("BEYONCE, Someone", known)).toEqual(["BEYONCE", "Someone"]);
  });
  it("recognises artists the library only lists in groups", () => {
    const groups = knownArtists(["Offset, Metro Boomin", "21 Savage, Offset, Metro Boomin"]);
    expect(splitArtists("Offset, Metro Boomin", groups)).toEqual(["Offset", "Metro Boomin"]);
  });
  it("reads tags that separate artists with a semicolon, and always splits them", () => {
    expect(readableArtists("Rare Name; Another One")).toBe("Rare Name, Another One");
    expect(splitArtists("Rare Name, Another One", new Set())).toEqual(["Rare Name", "Another One"]);
    expect(readableArtists("Metallica")).toBe("Metallica");
  });
  it("does not split a single artist", () => {
    expect(splitArtists("Metallica", known)).toEqual(["Metallica"]);
  });
});

describe("splitOwn", () => {
  const song = (id: string, albumId?: string): Song => ({ id, title: id, artist: "MCR-T, Joost", albumId });
  it("puts songs on the artist's own albums first, in the order of the albums, and the rest under Appears on", () => {
    const songs = [song("a1", "album-a"), song("feat", "someone-else"), song("b1", "album-b"), song("a2", "album-a"), song("loose")];
    const { own, elsewhere } = splitOwn(songs, ["album-b", "album-a"]);
    expect(own.map((s) => s.id)).toEqual(["b1", "a1", "a2"]);
    expect(elsewhere.map((s) => s.id)).toEqual(["feat", "loose"]);
  });
  it("leaves everything under Appears on for someone with no album of their own", () => {
    expect(splitOwn([song("feat", "x")], []).elsewhere.map((s) => s.id)).toEqual(["feat"]);
  });
});
