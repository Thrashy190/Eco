import { describe, expect, it } from "vitest";
import { remoteSleepEnd, sleepCountdown, sleepLabel, sleepLeft, sleepMinutes } from "./sleep";

describe("sleep timer", () => {
  it("accepts only the offered lengths", () => {
    expect(sleepMinutes(15)).toBe(15);
    expect(sleepMinutes("45")).toBe(45);
    expect(sleepMinutes(60)).toBe(60);
    expect(sleepMinutes(0)).toBe(0);
    expect(sleepMinutes(7)).toBe(0);
    expect(sleepMinutes(-5)).toBe(0);
    expect(sleepMinutes(1e9)).toBe(0);
    expect(sleepMinutes(null)).toBe(0);
    expect(sleepMinutes("soon")).toBe(0);
  });

  it("labels an hour as an hour", () => {
    expect(sleepLabel(5)).toBe("5 minutes");
    expect(sleepLabel(60)).toBe("1 hour");
  });

  it("counts what is left, never below zero", () => {
    expect(sleepLeft(null, 1000)).toBe(0);
    expect(sleepLeft(61_000, 1000)).toBe(60);
    expect(sleepLeft(1500, 1000)).toBe(1); // half a second still shows as one
    expect(sleepLeft(1000, 5000)).toBe(0);
  });

  it("places another device's end on this clock", () => {
    expect(remoteSleepEnd(90, 10_000)).toBe(100_000);
    expect(remoteSleepEnd(0, 10_000)).toBeNull();
    expect(remoteSleepEnd(undefined, 10_000)).toBeNull();
    expect(remoteSleepEnd(90, undefined)).toBeNull();
  });

  it("shows minutes and seconds, and hours when there are any", () => {
    expect(sleepCountdown(0)).toBe("0:00");
    expect(sleepCountdown(59)).toBe("0:59");
    expect(sleepCountdown(14 * 60 + 5)).toBe("14:05");
    expect(sleepCountdown(3600)).toBe("1:00:00");
  });
});
