// Pictures in the browser: playlist covers, background pictures and the player's tint.
import type { Rgb } from "./color";

const COVER_SIZE = 640;

/**
 * Turn whatever picture the user chose into a square JPEG. The server stores only JPEGs of a sensible size,
 * and doing the conversion here means a 12 MB phone photo never has to travel to it.
 */
export async function pictureToCover(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => { throw new Error("That file is not a picture this browser can read"); });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = COVER_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the picture");
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, COVER_SIZE, COVER_SIZE);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not prepare the picture"))), "image/jpeg", 0.88);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

const WALLPAPER_SIDE = 2400; // the longest side: sharp on a big screen, and blurred anyway on most
const WALLPAPER_BYTES = 1.9 * 1024 * 1024; // under what the server keeps (userdata.MaxCoverBytes)

/** Turn a photo into a background picture: its own shape, no bigger than needed, a JPEG under what the server keeps. */
export async function pictureToWallpaper(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => { throw new Error("That file is not a picture this browser can read"); });
    let scale = Math.min(1, WALLPAPER_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    for (let attempt = 0; attempt < 6; attempt++) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not prepare the picture");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", attempt < 2 ? 0.86 - attempt * 0.1 : 0.72));
      if (blob && blob.size <= WALLPAPER_BYTES) return blob;
      if (attempt >= 1) scale *= 0.8; // first a lower quality, then smaller
    }
    throw new Error("That picture is too large");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A small copy of a picture, as pixels, for judging how readable text on it is (readableDim). Same-origin pictures only. */
export function pixelsOf(image: HTMLImageElement, side = 24): Rgb[] {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = side;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return [];
    context.drawImage(image, 0, 0, side, side);
    const data = context.getImageData(0, 0, side, side).data;
    const out: Rgb[] = [];
    for (let i = 0; i < data.length; i += 4) out.push([data[i], data[i + 1], data[i + 2]]);
    return out;
  } catch {
    return [];
  }
}

/** Pick the dominant colour of an image, for tinting the player. Same-origin covers only. */
export function dominantColor(image: HTMLImageElement): string | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, 8, 8);
    const data = context.getImageData(0, 0, 8, 8).data;
    let r = 0, g = 0, b = 0, weight = 0;
    for (let i = 0; i < data.length; i += 4) {
      const max = Math.max(data[i], data[i + 1], data[i + 2]), min = Math.min(data[i], data[i + 1], data[i + 2]);
      const w = 1 + (max - min) / 32; // favour saturated pixels over grey
      r += data[i] * w; g += data[i + 1] * w; b += data[i + 2] * w; weight += w;
    }
    return `${Math.round(r / weight)} ${Math.round(g / weight)} ${Math.round(b / weight)}`;
  } catch {
    return null;
  }
}
