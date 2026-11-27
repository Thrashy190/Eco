import { describe, expect, it } from "vitest";
import { nowPlaying, positionAt, stillPlaying } from "./listening";

describe("nowPlaying", () => {
  const heard = { user: "ana", song: { id: "a", title: "Alpha", artist: "X; Y", duration: 200 }, position: 30, age_ms: 2000 };
  it("counts from when the position was true, on this device's clock", () => {
    const now = nowPlaying(heard, 100_000)!;
    expect(now.song.artist).toBe("X, Y");
    expect(positionAt(now, 100_000)).toBe(32);
    expect(positionAt(now, 110_000)).toBe(42);
  });
  it("stops at the end of the song, and gives up a minute later", () => {
    const now = nowPlaying(heard, 0)!;
    expect(positionAt(now, 500_000)).toBe(200);
    expect(stillPlaying(now, 150_000)).toBe(true);
    expect(stillPlaying(now, 240_000)).toBe(false);
  });
  it("is nothing when no song came", () => {
    expect(nowPlaying({ user: "ana", song: null }, 0)).toBeNull();
  });
  it("keeps imported audio as it is", () => {
    const now = nowPlaying({ user: "ana", song: { id: "m", title: "Episode", artist: "Show", mediaId: "dQw4w9WgXcQ", kind: "podcast" } }, 0)!;
    expect(now.song.mediaId).toBe("dQw4w9WgXcQ");
    expect(stillPlaying(now, 10 ** 9)).toBe(true);
  });
});
