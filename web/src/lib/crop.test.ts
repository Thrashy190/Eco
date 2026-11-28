import { describe, expect, it } from "vitest";
import { centred, clampCrop, MAX_ZOOM, sourceSquare, zoomAround } from "./crop";

describe("fitting a picture into a square", () => {
  it("centres a wide picture on its middle square", () => {
    // 2000x1000 in a 200 px frame: scale 0.2, the picture is 400x200 and sits 100 px to the left
    const c = centred(2000, 1000, 200);
    expect(c).toEqual({ zoom: 1, x: -100, y: 0 });
    expect(sourceSquare(c, 2000, 1000, 200)).toEqual({ x: 500, y: 0, side: 1000 });
  });

  it("never leaves an empty edge, whatever the drag", () => {
    expect(clampCrop({ zoom: 1, x: 50, y: -30 }, 2000, 1000, 200)).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(clampCrop({ zoom: 1, x: -900, y: 0 }, 2000, 1000, 200)).toEqual({ zoom: 1, x: -200, y: 0 });
    expect(sourceSquare({ zoom: 1, x: -900, y: 0 }, 2000, 1000, 200)).toEqual({ x: 1000, y: 0, side: 1000 });
  });

  it("keeps the zoom between fitting and the most it allows", () => {
    expect(clampCrop({ zoom: 0.2, x: 0, y: 0 }, 1000, 1000, 200).zoom).toBe(1);
    expect(clampCrop({ zoom: 99, x: 0, y: 0 }, 1000, 1000, 200).zoom).toBe(MAX_ZOOM);
    expect(clampCrop({ zoom: Number.NaN, x: 0, y: 0 }, 1000, 1000, 200).zoom).toBe(1);
  });

  it("zooms around the point under the fingers", () => {
    const start = centred(1000, 1000, 200); // the whole picture, scale 0.2
    const c = zoomAround(start, 1000, 1000, 200, 2, 0, 0); // twice as close, on the top-left corner
    expect(c).toEqual({ zoom: 2, x: 0, y: 0 });
    expect(sourceSquare(c, 1000, 1000, 200)).toEqual({ x: 0, y: 0, side: 500 });
    const middle = zoomAround(start, 1000, 1000, 200, 2);
    expect(sourceSquare(middle, 1000, 1000, 200)).toEqual({ x: 250, y: 250, side: 500 });
  });
});
