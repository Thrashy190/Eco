import { describe, expect, it } from "vitest";
import { cleanLook, DECK_MAX, DECK_MIN, deckWidthFor, shareable } from "./look";

const defaults = {
  theme: "system", accent: "#7cf0c0", tint: true, tabs: ["home", "search"], librarySort: {} as Record<string, string>,
  background: "wash", backgroundBlur: 16, playerStyle: "cover", offlineMode: false, syncLook: true, wallpaper: 0,
};

describe("cleanLook", () => {
  it("keeps what this version understands", () => {
    const look = { theme: "dark", accent: "#FF7EB6", tint: false, tabs: ["library", "home"], librarySort: { albums: "newest" }, background: "photo", backgroundBlur: 8, playerStyle: "vinyl" };
    expect(cleanLook(look, defaults)).toEqual(look);
  });
  it("drops values that would break the screen, one by one", () => {
    expect(cleanLook({ theme: "neon", accent: "red", tint: "yes", tabs: [1, 2], librarySort: { albums: 3 }, playerStyle: "cassette", background: "photo" }, defaults))
      .toEqual({ background: "photo" });
  });
  it("keeps numbers in range", () => {
    expect(cleanLook({ backgroundBlur: 400 }, defaults)).toEqual({ backgroundBlur: 40 });
    expect(cleanLook({ backgroundBlur: -3 }, defaults)).toEqual({ backgroundBlur: 0 });
    expect(cleanLook({ backgroundBlur: Number.NaN }, defaults)).toEqual({});
  });
  it("ignores what belongs to the other device, and settings it does not know", () => {
    expect(cleanLook({ offlineMode: true, syncLook: false, wallpaper: 5, futureThing: 1 }, defaults)).toEqual({});
  });
  it("reads nothing out of something that is not a look", () => {
    for (const raw of [null, "dark", [1], 3]) expect(cleanLook(raw, defaults)).toEqual({});
  });
});

describe("shareable", () => {
  it("leaves out what belongs to this device", () => {
    const out = shareable(defaults);
    expect(out).not.toHaveProperty("offlineMode");
    expect(out).not.toHaveProperty("syncLook");
    expect(out).not.toHaveProperty("wallpaper");
    expect(out.theme).toBe("system");
  });
});

describe("deckWidthFor", () => {
  it("keeps the deck between its limits and leaves the page room", () => {
    expect(deckWidthFor(420, 1600)).toBe(420);
    expect(deckWidthFor(100, 1600)).toBe(DECK_MIN);
    expect(deckWidthFor(2000, 2400)).toBe(DECK_MAX);
    expect(deckWidthFor(600, 1100)).toBe(540); // a narrow window: the page keeps its room
    expect(deckWidthFor(600, 700)).toBe(DECK_MIN); // never thinner than readable
  });
  it("never travels to other devices", () => {
    expect(cleanLook({ deckWidth: 500 }, { deckWidth: 360 })).toEqual({});
  });
});
