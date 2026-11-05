// Colour maths for the accent. A cover can be any colour; an accent has to stay readable on the page behind it.

export type Rgb = [number, number, number];

const channel = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const luminance = (rgb: Rgb) => 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);

export function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [x, y, z] = [r / 255, g / 255, b / 255];
  const max = Math.max(x, y, z), min = Math.min(x, y, z), delta = max - min, l = (max + min) / 2;
  if (!delta) return [0, 0, l];
  const s = delta / (1 - Math.abs(2 * l - 1));
  const h = max === x ? ((y - z) / delta + 6) % 6 : max === y ? (z - x) / delta + 2 : (x - y) / delta + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255)) as Rgb;
}

/** Text in the accent colour must reach this contrast against the page (WCAG AA for normal text). */
const READABLE = 4.5;

/**
 * The accent a cover's colour gives: the same hue, vivid enough to read as a colour and light or dark enough to read on
 * this page. A nearly grey cover stays nearly grey: a black and white album should not turn the app pink.
 */
export function accentFromCover(cover: Rgb, background: Rgb): Rgb {
  const [h, s, l] = toHsl(cover);
  const saturation = s < 0.12 ? s : Math.max(s, 0.6);
  const onLight = luminance(background) > 0.5;
  let lightness = onLight ? Math.min(Math.max(l, 0.25), 0.42) : Math.min(Math.max(l, 0.62), 0.8);
  let accent = fromHsl(h, saturation, lightness);
  while (contrast(accent, background) < READABLE && lightness > 0.02 && lightness < 0.98) {
    lightness += onLight ? -0.02 : 0.02;
    accent = fromHsl(h, saturation, lightness);
  }
  return accent;
}
