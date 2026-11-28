// Fitting a picture into a square cover: where it sits in the frame and how far it is zoomed (components/CoverCropper.tsx).
// Positions are in the frame's pixels; the picture always covers the whole frame, so a cover never has an empty edge.

/** Where the picture's top-left corner is in the frame, and how far past "just covers it" it is zoomed. */
export interface Crop {
  x: number;
  y: number;
  zoom: number;
}

export const MAX_ZOOM = 5;

const between = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** The scale at which the picture's shorter side just fills the frame. */
export const baseScale = (width: number, height: number, frame: number) => frame / Math.min(width, height);

/** Keep the zoom in range and the picture over the whole frame. */
export function clampCrop(c: Crop, width: number, height: number, frame: number): Crop {
  const zoom = between(Number.isFinite(c.zoom) ? c.zoom : 1, 1, MAX_ZOOM);
  const scale = baseScale(width, height, frame) * zoom;
  return {
    zoom,
    x: between(c.x, frame - width * scale, 0),
    y: between(c.y, frame - height * scale, 0),
  };
}

/** The picture centred, at a zoom. */
export function centred(width: number, height: number, frame: number, zoom = 1): Crop {
  const scale = baseScale(width, height, frame) * zoom;
  return clampCrop({ zoom, x: (frame - width * scale) / 2, y: (frame - height * scale) / 2 }, width, height, frame);
}

/** Zoom to `zoom` keeping the point of the frame at (px, py) over the same spot of the picture (a pinch, the wheel). */
export function zoomAround(c: Crop, width: number, height: number, frame: number, zoom: number, px = frame / 2, py = frame / 2): Crop {
  const before = baseScale(width, height, frame) * c.zoom;
  const z = between(zoom, 1, MAX_ZOOM);
  const after = baseScale(width, height, frame) * z;
  const u = (px - c.x) / before;
  const v = (py - c.y) / before;
  return clampCrop({ zoom: z, x: px - u * after, y: py - v * after }, width, height, frame);
}

/** The square of the picture, in its own pixels, that the frame shows. */
export function sourceSquare(c: Crop, width: number, height: number, frame: number): { x: number; y: number; side: number } {
  const { x, y, zoom } = clampCrop(c, width, height, frame);
  const scale = baseScale(width, height, frame) * zoom;
  const side = Math.min(frame / scale, width, height);
  return { x: between(-x / scale, 0, width - side), y: between(-y / scale, 0, height - side), side };
}
