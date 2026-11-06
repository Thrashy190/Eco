import { describe, expect, it } from "vitest";
import { accentFromCover, contrast, readableDim, shownDim, type Ink, type Rgb } from "./color";

const DARK: Rgb = [11, 11, 15];
const BLACK: Rgb = [0, 0, 0];
const LIGHT: Rgb = [246, 246, 249];

describe("accentFromCover", () => {
  it("stays readable on every page, whatever the cover", () => {
    for (const page of [DARK, BLACK, LIGHT]) {
      for (let r = 0; r <= 255; r += 51) for (let g = 0; g <= 255; g += 51) for (let b = 0; b <= 255; b += 51) {
        expect(contrast(accentFromCover([r, g, b], page), page)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  // A dark navy cover used to leave text in the accent colour nearly invisible on the dark theme
  it("lifts a very dark cover on a dark page and keeps its hue", () => {
    const [r, g, b] = accentFromCover([10, 20, 70], DARK);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it("keeps a black and white album grey", () => {
    const [r, g, b] = accentFromCover([120, 120, 120], DARK);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(4);
  });
});

describe("readableDim", () => {
  const dark: Ink = { background: [11, 11, 15], text: [244, 244, 247], muted: [155, 155, 168] };
  const light: Ink = { background: [246, 246, 249], text: [20, 20, 26], muted: [106, 106, 120] };
  const shown = (pixel: Rgb, ink: Ink, dim: number) => pixel.map((c, i) => c + (ink.background[i] - c) * dim) as Rgb;
  const fill = (pixel: Rgb, n = 100) => Array.from({ length: n }, () => pixel);

  it("leaves a picture alone when text already reads on it", () => {
    expect(readableDim(fill([5, 5, 8]), dark)).toBe(0);
    expect(readableDim(fill([250, 250, 250]), light)).toBe(0);
  });
  it("darkens a bright photo until text and muted text both read on it", () => {
    for (const ink of [dark, light]) {
      const sky: Rgb = ink === dark ? [140, 190, 240] : [20, 40, 90];
      const dim = readableDim(fill(sky), ink);
      expect(dim).toBeGreaterThan(0.3);
      expect(contrast(ink.text, shown(sky, ink, dim))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(ink.muted, shown(sky, ink, dim))).toBeGreaterThanOrEqual(3);
    }
  });
  it("lets the hardest tenth of the picture be: a cloud does not darken the whole sky", () => {
    const cloudy = [...fill([30, 40, 70], 95), ...fill([255, 255, 255], 5)];
    expect(readableDim(cloudy, dark)).toBeLessThan(readableDim(fill([255, 255, 255]), dark));
  });
  it("has nothing to do without a picture", () => {
    expect(readableDim([], dark)).toBe(0);
  });
});

describe("shownDim", () => {
  it("never goes below what readability needs, and the person's amount darkens what is left", () => {
    expect(shownDim(0.4, 0)).toBe(0.4);
    expect(shownDim(0.4, 0.5)).toBeCloseTo(0.7);
    expect(shownDim(0, 1)).toBe(0.97);
  });
});
