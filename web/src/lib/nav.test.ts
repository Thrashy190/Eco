import { describe, expect, it } from "vitest";
import { activePlace, homeOrder, moved, pageKey, tabsFrom } from "./nav";

describe("tabsFrom", () => {
  const ids = (chosen?: string[]) => tabsFrom(chosen).map((p) => p.id);
  it("starts with the original four", () => {
    expect(ids()).toEqual(["home", "search", "library", "settings"]);
  });
  it("keeps Settings, or nobody could undo hiding it", () => {
    expect(ids(["favorites"])).toEqual(["favorites", "settings"]);
  });
  it("fits a phone and ignores what no longer exists", () => {
    expect(ids(["home", "search", "gone", "library", "albums", "artists", "songs"])).toEqual(["home", "search", "library", "albums", "settings"]);
    expect(ids(["home", "home"])).toEqual(["home", "settings"]);
  });
});

describe("pageKey", () => {
  it("keeps the library on screen when changing section", () => {
    expect(pageKey("/library/albums")).toBe(pageKey("/library"));
    expect(pageKey("/library/songs")).toBe(pageKey("/library/albums"));
  });
  it("tells other pages apart", () => {
    expect(pageKey("/album/1")).not.toBe(pageKey("/album/2"));
    expect(pageKey("/library-old")).toBe("/library-old");
  });
});

describe("activePlace", () => {
  const tabs = tabsFrom(["home", "albums", "library", "settings"]);
  it("prefers the tab that leads exactly here", () => {
    expect(activePlace(tabs, "/library/albums")).toBe("albums");
  });
  it("lights Library for what is inside it", () => {
    expect(activePlace(tabs, "/album/123")).toBe("library");
    expect(activePlace(tabs, "/catalog-album/abc")).toBe("library");
    expect(activePlace(tabs, "/library/songs")).toBe("library");
  });
  it("lights nothing when no tab fits", () => {
    expect(activePlace(tabsFrom(["home"]), "/album/1")).toBeUndefined();
  });
});

describe("homeOrder", () => {
  it("keeps the saved order and adds new sections at the end", () => {
    expect(homeOrder(["mix", "recent"])).toEqual(["mix", "recent", "downloaded", "newest", "frequent"]);
    expect(homeOrder(["gone", "mix"])[0]).toBe("mix");
    expect(homeOrder(undefined)[0]).toBe("recent");
  });
});

describe("moved", () => {
  it("swaps neighbours and stops at the ends", () => {
    expect(moved(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moved(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moved(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});
