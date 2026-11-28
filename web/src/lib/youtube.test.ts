import { describe, expect, it } from "vitest";
import { isPlaylistLink, videoIdOf } from "./youtube";

describe("YouTube links", () => {
  it("finds the video in every kind of link", () => {
    expect(videoIdOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(videoIdOf("https://youtube.com/watch?list=PLabcdefghij&v=dQw4w9WgXcQ&t=10")).toBe("dQw4w9WgXcQ");
    expect(videoIdOf("https://youtu.be/dQw4w9WgXcQ?si=abc")).toBe("dQw4w9WgXcQ");
    expect(videoIdOf("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(videoIdOf("https://www.youtube.com/playlist?list=PLabcdefghij")).toBe("");
    expect(videoIdOf("https://www.youtube.com/watch?v=tooLongToBeAnId")).toBe("");
  });

  it("tells a playlist from a single video", () => {
    expect(isPlaylistLink("https://www.youtube.com/playlist?list=PLabcdefghij")).toBe(true);
    expect(isPlaylistLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghij")).toBe(true);
    expect(isPlaylistLink("https://music.youtube.com/playlist?list=OLAK5uy_abcdefg")).toBe(true);
    expect(isPlaylistLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(false);
    expect(isPlaylistLink("https://evil.example/playlist?list=PLabcdefghij")).toBe(false);
  });
});
