// A look that arrives from the server was saved by another device, maybe by an older or newer version of the app. Only
// what this version understands is applied, value by value: a wrong value left as it was could break the screen.

/** The values each choice may take. Anything else is left out. */
export const CHOICES: Record<string, readonly string[]> = {
  theme: ["system", "dark", "light", "black"],
  density: ["comfortable", "compact"],
  corners: ["soft", "sharp"],
  motion: ["full", "reduced", "off"],
  font: ["rounded", "system", "serif", "mono"],
  textSize: ["small", "normal", "large"],
  libraryView: ["grid", "list"],
  background: ["wash", "photo", "cover"],
  playerStyle: ["cover", "vinyl", "backdrop", "minimal"],
  glass: ["clear", "frosted", "solid"],
  cardSize: ["small", "medium", "large"],
};

/** The range of each number. */
export const RANGES: Record<string, [number, number]> = {
  backgroundBlur: [0, 40],
  backgroundDim: [0, 1],
};

/** Settings that belong to one device and never travel: forcing offline, the deck, and the choice to share the look. */
export const DEVICE_ONLY = ["offlineMode", "nowPanel", "syncLook", "wallpaper"] as const;

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 50 && value.every((v) => typeof v === "string" && v.length <= 60);

/** The part of a saved look this version can apply safely, judged against the defaults' types. */
export function cleanLook<T extends object>(raw: unknown, defaults: T): Partial<T> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(key in defaults) || (DEVICE_ONLY as readonly string[]).includes(key)) continue;
    const fallback = (defaults as Record<string, unknown>)[key];
    if (CHOICES[key]) {
      if (typeof value === "string" && CHOICES[key].includes(value)) out[key] = value;
    } else if (RANGES[key]) {
      if (typeof value === "number" && Number.isFinite(value)) out[key] = Math.min(Math.max(value, RANGES[key][0]), RANGES[key][1]);
    } else if (key === "accent") {
      if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) out[key] = value;
    } else if (typeof fallback === "boolean") {
      if (typeof value === "boolean") out[key] = value;
    } else if (Array.isArray(fallback)) {
      if (isStrings(value)) out[key] = value;
    } else if (fallback && typeof fallback === "object") {
      if (value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every((v) => typeof v === "string" && v.length <= 40)) out[key] = value;
    }
  }
  return out as Partial<T>;
}

/** What is sent to the server: everything but what belongs to this device. */
export function shareable<T extends object>(settings: T): Partial<T> {
  const out = { ...settings } as Record<string, unknown>;
  for (const key of DEVICE_ONLY) delete out[key];
  return out as Partial<T>;
}
