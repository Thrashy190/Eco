import { describe, expect, it } from "vitest";
import { ago, bucketLabel, change, changeLabel, listened, peakHour, perDay, share, tickIndexes, validRange } from "./stats";

describe("statistics", () => {
  it("writes listening time the way people say it", () => {
    expect(listened(0)).toBe("0 min");
    expect(listened(NaN)).toBe("0 min");
    expect(listened(45)).toBe("45 min");
    expect(listened(120)).toBe("2 h");
    expect(listened(725)).toBe("12 h 5 min");
    expect(listened(72_300)).toBe("1,205 h");
  });

  it("compares with the period before without dividing by zero", () => {
    expect(change(120, 100)).toBe(20);
    expect(change(50, 100)).toBe(-50);
    expect(change(5, 0)).toBeNull();
    expect(change(5, undefined)).toBeNull();
    expect(changeLabel(-8)).toBe("−8% vs before");
    expect(changeLabel(0)).toBe("Same as before");
    expect(share(1, 3)).toBe(33);
    expect(share(1, 0)).toBe(0);
    expect(perDay(90, 0)).toBe(0);
  });

  it("labels the timeline by its step and spreads the ticks", () => {
    expect(bucketLabel("2026-11-02", "day")).toBe("Nov 2");
    expect(bucketLabel("2026-11-02", "week")).toBe("Week of Nov 2");
    expect(bucketLabel("2026-11-01", "month")).toBe("Nov 2026");
    expect(tickIndexes(0)).toEqual([]);
    expect(tickIndexes(4)).toEqual([0, 1, 2, 3]);
    const ticks = tickIndexes(31);
    expect(ticks[0]).toBe(0);
    expect(ticks.at(-1)).toBe(30);
    expect(ticks.length).toBe(6);
  });

  it("finds the busiest hour", () => {
    const hours = Array(24).fill(0);
    expect(peakHour(hours)).toBe("");
    hours[21] = 5;
    hours[9] = 2;
    expect(peakHour(hours)).toBe("9 PM");
    hours[0] = 9;
    expect(peakHour(hours)).toBe("12 AM");
  });

  it("says how long ago, and nothing for no date", () => {
    const now = Date.parse("2026-11-24T12:00:00Z");
    expect(ago("2026-11-24T11:55:00Z", now)).toBe("5 min ago");
    expect(ago("2026-11-23T10:00:00Z", now)).toBe("yesterday");
    expect(ago("0001-01-01T00:00:00Z", now)).toBe("");
  });

  it("only accepts the offered periods", () => {
    expect(validRange("7d")).toBe("7d");
    expect(validRange("forever")).toBe("30d");
  });
});
