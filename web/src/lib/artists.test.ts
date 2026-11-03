import { describe, expect, it } from "vitest";
import { knownArtists, splitArtists, readableArtists } from "./format";

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
