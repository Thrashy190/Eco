import { describe, expect, it } from "vitest";
import { cutShort, retryDelay, saysNotFound, streamProblem } from "./retry";

describe("streamProblem", () => {
  it("accepts audio", () => {
    expect(streamProblem(200, "audio/mp4")).toBeNull();
    expect(streamProblem(200, "application/octet-stream")).toBeNull();
    expect(streamProblem(200, "")).toBeNull();
  });
  // A song deleted from the library answered 200 with this type, and its error text was saved as the song
  it("does not take Navidrome's error message for audio", () => {
    expect(streamProblem(200, "application/json")).toBe("read-body");
  });
  it("knows a song that is gone from a moment's trouble", () => {
    expect(streamProblem(404, "text/plain")).toBe("gone");
    expect(streamProblem(502, "text/html")).toBe("retry");
    expect(streamProblem(200, "text/html; charset=utf-8")).toBe("retry");
  });
});

describe("saysNotFound", () => {
  it("only believes the not found code", () => {
    expect(saysNotFound({ "subsonic-response": { status: "failed", error: { code: 70, message: "not found" } } })).toBe(true);
    expect(saysNotFound({ "subsonic-response": { status: "failed", error: { code: 40, message: "Wrong username or password" } } })).toBe(false);
    expect(saysNotFound(null)).toBe(false);
  });
});

describe("cutShort", () => {
  it("catches a download that stopped early", () => {
    expect(cutShort(10, 100, false)).toBe(true);
    expect(cutShort(0, 0, false)).toBe(true);
  });
  it("trusts a complete or a compressed one", () => {
    expect(cutShort(100, 100, false)).toBe(false);
    expect(cutShort(100, 0, false)).toBe(false);
    expect(cutShort(100, 40, true)).toBe(false);
    expect(cutShort(40, 100, true)).toBe(false);
  });
});

describe("retryDelay", () => {
  it("waits longer each time, up to a limit", () => {
    expect(retryDelay(0)).toBeLessThan(retryDelay(1));
    expect(retryDelay(50)).toBe(retryDelay(2));
  });
});
