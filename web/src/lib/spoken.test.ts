import { describe, expect, it } from "vitest";
import {
  bookPosition, chapterAt, chapterEnd, cleanSpeed, leftAtSpeed, newer, nextChapterStart, previousChapterStart, progressRatio,
  itemState, resumePoint, rewindAfterPause, skipLength, skipTarget, speedLabel, spokenLength, type Chapter,
} from "./spoken";

const chapters: Chapter[] = [{ start: 0, title: "Intro" }, { start: 90, title: "Interview" }, { start: 300, title: "Questions" }];

describe("chapters", () => {
  it("knows which one is playing", () => {
    expect(chapterAt(chapters, 0)).toBe(0);
    expect(chapterAt(chapters, 89.5)).toBe(0);
    expect(chapterAt(chapters, 89.9)).toBe(1); // a jump that lands a hair early is in the chapter it aimed at
    expect(chapterAt(chapters, 1000)).toBe(2);
    expect(chapterAt([], 50)).toBe(-1);
    expect(chapterAt([{ start: 60, title: "Late" }], 10)).toBe(-1);
  });
  it("ends where the next starts, the last at the end of the file", () => {
    expect(chapterEnd(chapters, 0, 600)).toBe(90);
    expect(chapterEnd(chapters, 2, 600)).toBe(600);
  });
  it("goes back like a song's previous: restart, or the one before", () => {
    expect(previousChapterStart(chapters, 120)).toBe(90); // well into Interview: back to its start
    expect(previousChapterStart(chapters, 91)).toBe(0); // only just began: the chapter before
    expect(previousChapterStart(chapters, 1)).toBeNull(); // the first chapter: the previous file
    expect(previousChapterStart([], 40)).toBe(0);
    expect(previousChapterStart([], 2)).toBeNull();
    expect(previousChapterStart([{ start: 60, title: "Late" }], 61)).toBe(0); // before the first mark is a part too
  });
  it("goes forward, and past the last to the next file", () => {
    expect(nextChapterStart(chapters, 10)).toBe(90);
    expect(nextChapterStart(chapters, 400)).toBeNull();
    expect(nextChapterStart([{ start: 60, title: "Late" }], 10)).toBe(60);
  });
});

describe("skips and speed", () => {
  it("never lands before the start or right on the end", () => {
    expect(skipTarget(10, -30, 600)).toBe(0);
    expect(skipTarget(100, 30, 600)).toBe(130);
    expect(skipTarget(590, 30, 600)).toBe(599);
  });
  it("accepts only the offered skip lengths", () => {
    expect(skipLength(15, 30)).toBe(15);
    expect(skipLength(17, 30)).toBe(30);
    expect(skipLength("x", 10)).toBe(10);
  });
  it("keeps the speed in range and in steps", () => {
    expect(cleanSpeed(1.37)).toBe(1.35);
    expect(cleanSpeed(9)).toBe(3);
    expect(cleanSpeed(0.1)).toBe(0.5);
    expect(cleanSpeed("fast")).toBe(1);
    expect(speedLabel(1.25)).toBe("1.25×");
    expect(speedLabel(2)).toBe("2×");
    expect(leftAtSpeed(3600, 1.5)).toBe(2400);
  });
  it("steps back more after a longer pause", () => {
    expect(rewindAfterPause(20_000)).toBe(0);
    expect(rewindAfterPause(5 * 60_000)).toBe(5);
    expect(rewindAfterPause(30 * 60_000)).toBe(15);
    expect(rewindAfterPause(3 * 3600_000)).toBe(30);
    expect(rewindAfterPause(Number.NaN)).toBe(0);
  });
  it("says lengths as people do", () => {
    expect(spokenLength(3 * 3600 + 12 * 60)).toBe("3 h 12 min");
    expect(spokenLength(7200)).toBe("2 h");
    expect(spokenLength(45 * 60 + 20)).toBe("45 min");
    expect(spokenLength(30)).toBe("30 s");
  });
});

describe("progress", () => {
  it("keeps the newer report", () => {
    const phone = { position: 30, at: 1 };
    const computer = { position: 600, at: 2 };
    expect(newer(phone, computer)).toBe(computer);
    expect(newer(computer, phone)).toBe(computer);
    expect(newer(undefined, phone)).toBe(phone);
  });
  it("counts a finished item as whole", () => {
    expect(progressRatio({ position: 0, finished: true, at: 1 }, 100)).toBe(1);
    expect(progressRatio({ position: 25, at: 1 }, 100)).toBe(0.25);
    expect(progressRatio(undefined, 100)).toBe(0);
  });
  it("adds up a book of several files", () => {
    expect(bookPosition([100, 200, 300], { part: 2, position: 50 })).toEqual({ heard: 350, total: 600 });
    expect(bookPosition([100, 200], null)).toEqual({ heard: 0, total: 300 });
  });
});

describe("carrying on", () => {
  const parts = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("starts a book nobody opened at the beginning", () => {
    expect(resumePoint(parts, () => undefined)).toEqual({ index: 0, position: 0 });
    expect(resumePoint([], () => undefined).index).toBe(-1);
  });
  it("goes back to the part heard last", () => {
    const p: Record<string, { position: number; at: number; finished?: boolean }> = { a: { position: 10, at: 5 }, b: { position: 300, at: 9 } };
    expect(resumePoint(parts, (id) => p[id])).toEqual({ index: 1, position: 300 });
  });
  it("moves on past a part just finished", () => {
    const p: Record<string, { position: number; at: number; finished?: boolean }> = { a: { position: 0, finished: true, at: 9 } };
    expect(resumePoint(parts, (id) => p[id])).toEqual({ index: 1, position: 0 });
  });
  it("tells new, started and finished apart", () => {
    expect(itemState(undefined)).toBe("new");
    expect(itemState({ position: 0.2, at: 1 })).toBe("new");
    expect(itemState({ position: 40, at: 1 })).toBe("started");
    expect(itemState({ position: 0, finished: true, at: 1 })).toBe("finished");
  });
});
