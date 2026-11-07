import { describe, expect, it } from "vitest";
import { guessSong } from "./songguess";

describe("guessing a song from its video", () => {
  it("believes YouTube Music", () => {
    expect(guessSong({ title: "Ew", channel: "Joji - Topic", music: { track: "Ew", artists: ["Joji"] } })).toEqual({ title: "Ew", artists: ["Joji"] });
  });
  it("reads Artist - Title and drops what describes the video", () => {
    expect(guessSong({ title: "Joji - Sanctuary (Official Video)", channel: "88rising" })).toEqual({ title: "Sanctuary", artists: ["Joji"] });
    expect(guessSong({ title: "Bad Bunny - Tití Me Preguntó [Letra] | Un Verano Sin Ti", channel: "Lyrics" })).toEqual({ title: "Tití Me Preguntó", artists: ["Bad Bunny"] });
  });
  it("keeps what describes the song", () => {
    expect(guessSong({ title: "Daft Punk - One More Time (Remix) (Audio)", channel: "x" }).title).toBe("One More Time (Remix)");
  });
  it("adds who is featured to the artists", () => {
    expect(guessSong({ title: "Rauw Alejandro - Todo de Ti (feat. Bad Bunny & Chuwi)", channel: "x" })).toEqual({ title: "Todo de Ti", artists: ["Rauw Alejandro", "Bad Bunny", "Chuwi"] });
    expect(guessSong({ title: "Song ft. Someone", channel: "Main Artist" })).toEqual({ title: "Song", artists: ["Main Artist", "Someone"] });
  });
  it("takes the artist from a Topic or VEVO channel when the title does not say", () => {
    expect(guessSong({ title: "Ew", channel: "Joji - Topic" })).toEqual({ title: "Ew", artists: ["Joji"] });
    expect(guessSong({ title: "Hello", channel: "AdeleVEVO" })).toEqual({ title: "Hello", artists: ["Adele"] });
  });
});
