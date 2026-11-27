import { describe, expect, it } from "vitest";
import { clockOffset, jamPosition, offBeat } from "./jamclock";

describe("clockOffset", () => {
  it("trusts the quickest answer, made halfway through its trip", () => {
    // The server is 5 s ahead. The slow trip was held up on the way back, which no device can know
    const pings = [
      { sent: 1000, server: 6050, received: 1100 },
      { sent: 2000, server: 7020, received: 2040 },
      { sent: 3000, server: 8010, received: 3900 },
    ];
    expect(clockOffset(pings)).toBe(5000);
  });
  it("is nothing without an answer, and ignores a clock that went back", () => {
    expect(clockOffset([])).toBe(0);
    expect(clockOffset([{ sent: 10, server: 99, received: 5 }])).toBe(0);
  });
});

describe("jamPosition", () => {
  const playing = { entry: "e1", position: 30, at: 100_000, paused: false };
  it("moves on with the server's clock", () => {
    expect(jamPosition(playing, 112_500)).toBe(42.5);
  });
  it("holds still when paused or when nothing plays", () => {
    expect(jamPosition({ ...playing, paused: true }, 999_999)).toBe(30);
    expect(jamPosition({ ...playing, entry: "" }, 999_999)).toBe(30);
  });
  it("never goes before the start, whatever a clock says", () => {
    expect(jamPosition({ ...playing, position: 0 }, 90_000)).toBe(0);
  });
});

describe("offBeat", () => {
  it("lets a little drift be, and jumps past it", () => {
    expect(offBeat(10, 10.2)).toBe(false);
    expect(offBeat(10, 10.5)).toBe(true);
    expect(offBeat(10.5, 10)).toBe(true);
  });
});
