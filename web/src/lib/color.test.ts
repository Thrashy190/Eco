import { describe, expect, it } from "vitest";
import { accentFromCover, contrast, type Rgb } from "./color";

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
