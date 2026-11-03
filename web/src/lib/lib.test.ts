import { describe, expect, it } from "vitest";
import { clock, deviceName, initials, isYoutubeLink, plural } from "./format";
import { md5 } from "./md5";

describe("md5", () => {
  // Subsonic signs every request with this: a wrong hash means nobody can sign in
  it("matches the known values", () => {
    expect(md5("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5("sesame" + "c19b2d")).toBe("26719a1196d2a940705a59634eb18eab");
    expect(md5("contraseña")).toBe("4c882dcb24bcb1bc225391a602feca7c");
  });
});

describe("format", () => {
  it("clock survives what the player can hand it", () => {
    expect(clock(65)).toBe("1:05");
    expect(clock(undefined)).toBe("0:00");
    expect(clock(NaN)).toBe("0:00");
    expect(clock(-1)).toBe("0:00");
  });
  it("initials keep non-Latin names", () => {
    expect(initials("Slipknot")).toBe("S");
    expect(initials("Café Tacvba")).toBe("CT");
    expect(initials("Кино")).toBe("К");
    expect(initials("---")).toBe("?");
  });
  it("names a device from its browser", () => {
    expect(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
    expect(deviceName("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36")).toBe("Chrome on Linux");
    expect(deviceName("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(deviceName("Mozilla/5.0 (Windows NT 10.0; rv:130.0) Gecko/20100101 Firefox/130.0")).toBe("Firefox on Windows");
    expect(deviceName("")).toBe("This browser");
  });
  it("plural", () => {
    expect(plural(1, "song")).toBe("1 song");
    expect(plural(2, "song")).toBe("2 songs");
  });
  it("recognises YouTube links only", () => {
    expect(isYoutubeLink("https://youtu.be/abc")).toBe(true);
    expect(isYoutubeLink(" https://music.youtube.com/watch?v=abc ")).toBe(true);
    expect(isYoutubeLink("https://youtube.com.evil.example/watch")).toBe(false);
    expect(isYoutubeLink("slipknot")).toBe(false);
  });
});
