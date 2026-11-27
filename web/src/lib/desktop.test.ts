import { describe, expect, it } from "vitest";
import { desktopName, releaseNumbers, serverHost, serverIsOlder, updateLook, type UpdateStatus } from "./desktop";

describe("the desktop app", () => {
  it("reads release numbers with or without the v", () => {
    expect(releaseNumbers("v1.12.0")).toEqual([1, 12, 0]);
    expect(releaseNumbers("1.13.2")).toEqual([1, 13, 2]);
    expect(releaseNumbers("dev")).toBeNull();
    expect(releaseNumbers("v1.12.0-3-gabc123")).toBeNull();
  });

  it("warns only when the server is behind the app", () => {
    expect(serverIsOlder("v1.12.0", "1.13.0")).toBe(true);
    expect(serverIsOlder("v1.9.4", "1.10.0")).toBe(true); // numbers, not text: 9 < 10
    expect(serverIsOlder("v1.13.0", "1.13.0")).toBe(false);
    expect(serverIsOlder("v1.14.0", "1.13.0")).toBe(false);
    expect(serverIsOlder("v2.0.0", "1.13.0")).toBe(false);
  });

  it("says nothing when a version is unknown", () => {
    expect(serverIsOlder("dev", "1.13.0")).toBe(false);
    expect(serverIsOlder("v1.12.0", "0.0.0-dev")).toBe(false);
    expect(serverIsOlder("", "")).toBe(false);
  });

  it("names a server by its host, however it was typed", () => {
    expect(serverHost("https://eco.example.com/")).toBe("eco.example.com");
    expect(serverHost("eco.example.com")).toBe("eco.example.com");
    expect(serverHost("  ECO.example.com/#/album/1 ")).toBe("eco.example.com");
    expect(serverHost("http://192.168.1.20:8000")).toBe("192.168.1.20:8000");
  });

  it("names this computer for Connect", () => {
    expect(desktopName("macos")).toBe("Eco on Mac");
    expect(desktopName("linux")).toBe("Eco on Linux");
    expect(desktopName(undefined)).toBe("Eco on this computer");
  });
});

describe("the Update button", () => {
  const status = (change: Partial<UpdateStatus>): UpdateStatus => ({ current: "2.5.0", can_update: true, available: null, stage: "idle", progress: null, error: null, ...change });
  it("stays away from builds made by hand and from browsers", () => {
    expect(updateLook(null)).toBe("hidden");
    expect(updateLook(status({ can_update: false, available: "2.6.0" }))).toBe("hidden");
  });
  it("lights up when a newer version is ready, and shows the install going on", () => {
    expect(updateLook(status({}))).toBe("quiet");
    expect(updateLook(status({ stage: "checking" }))).toBe("quiet");
    expect(updateLook(status({ available: "2.6.0" }))).toBe("ready");
    expect(updateLook(status({ available: "2.6.0", stage: "downloading", progress: 0.4 }))).toBe("busy");
    expect(updateLook(status({ available: "2.6.0", stage: "installing" }))).toBe("busy");
  });
});
