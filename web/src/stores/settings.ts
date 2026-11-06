// Personal settings: how the app looks and what it shows first, and playback options.
// They are stored per user on this device, so everyone who signs in on a shared phone keeps their own look, and, unless
// someone turns it off, on the server too, so all their devices look the same (stores/look.ts).
import { create } from "zustand";
import { accentFromCover, luminance, type Ink, type Rgb } from "../lib/color";
import { DEFAULT_TABS } from "../lib/nav";
import { sortOption } from "../lib/sorting";

export interface Settings {
  theme: "system" | "dark" | "light" | "black";
  accent: string;
  dynamicAccent: boolean; // the accent follows the cover of what is playing
  tint: boolean; // tint the player, and the page on a big screen, with the cover's colour
  density: "comfortable" | "compact";
  corners: "soft" | "sharp";
  motion: "full" | "reduced" | "off";
  scrobble: boolean; // tell Navidrome what you play (feeds "Recently played" and "Most played")
  offlineMode: boolean; // pretend there is no connection: use only what is saved on this device
  font: "rounded" | "system" | "serif" | "mono";
  textSize: "small" | "normal" | "large";
  homeOrder: string[]; // the sections of Home, in the chosen order (see lib/nav.ts)
  homeHidden: string[];
  tabs: string[]; // the tabs on a phone, and the places in the top bar elsewhere (see lib/nav.ts)
  libraryView: "grid" | "list"; // how albums and artists are listed
  librarySort: Record<string, string>; // the chosen order of each section of the library (see lib/sorting.ts)
  nowPanel: boolean; // on a big screen, the deck (what is playing) stays beside the page
  background: "wash" | "photo" | "cover"; // behind everything: the music's colour, your picture, or the cover playing
  backgroundBlur: number; // px, for a picture behind everything
  backgroundDim: number; // 0–1: darkening beyond what keeps text readable (lib/color.ts readableDim)
  backgroundWash: boolean; // the music's colour over the picture too
  wallpaper: number; // when the picture was set on the server, 0 for none: its address changes with it
  playerStyle: "cover" | "vinyl" | "backdrop" | "minimal"; // how the full-screen player and the deck show the song
  glass: "clear" | "frosted" | "solid"; // how much of what is behind the floating bars shows through
  cardSize: "small" | "medium" | "large"; // albums, playlists and artists as cards
  syncLook: boolean; // the same look on every device of the account
}

export const DEFAULTS: Settings = {
  theme: "system", accent: "#7cf0c0", dynamicAccent: false, tint: true, density: "comfortable", corners: "soft", motion: "full", scrobble: true, offlineMode: false,
  font: "rounded", textSize: "normal", homeOrder: [], homeHidden: [], tabs: DEFAULT_TABS, libraryView: "grid", librarySort: {}, nowPanel: true,
  background: "wash", backgroundBlur: 16, backgroundDim: 0.15, backgroundWash: true, wallpaper: 0, playerStyle: "cover", glass: "frosted",
  cardSize: "medium", syncLook: true,
};

export const ACCENTS: [string, string][] = [
  ["Mint", "#7cf0c0"], ["Sky", "#6aa8ff"], ["Violet", "#b18cff"], ["Rose", "#ff7eb6"],
  ["Coral", "#ff6b6b"], ["Amber", "#ffb84d"], ["Lime", "#b5e853"],
];

const BACKGROUNDS = { dark: "#0b0b0f", black: "#000000", light: "#f6f6f9" };
let user = "";
let coverColor: Rgb | null = null; // of what is playing, when there is something and it has a picture

const keyFor = (name: string) => `eco.settings.${name || "_device"}`;
const read = (key: string): Partial<Settings> | null => { try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; } };
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } };

export const useSettings = create<Settings>(() => ({ ...DEFAULTS, ...(read(keyFor("")) ?? {}) }));
export const settings = () => useSettings.getState();

/** Load the settings of a user (or the device's last ones when nobody is signed in) and apply them. */
export function loadSettings(name = ""): void {
  user = name;
  useSettings.setState({ ...DEFAULTS, ...(read(keyFor(name)) ?? read(keyFor("")) ?? {}) }, true);
  apply();
}

/** Someone changed a setting on this device: stores/look.ts shares it with their other devices. */
let changed: ((patch: Partial<Settings>) => void) | null = null;
export const onSettingsChanged = (listener: typeof changed) => { changed = listener; };

export function setSettings(patch: Partial<Settings>): void {
  useSettings.setState(patch);
  write(keyFor(user), settings());
  apply();
  changed?.(patch);
}

/** A look that came from another device (already checked by cleanLook): applied and kept here, but not sent back. */
export function adoptSettings(patch: Partial<Settings>): void {
  useSettings.setState(patch);
  write(keyFor(user), settings());
  apply();
}

/** Whose settings these are: the account signed in, or "" before anyone is. */
export const settingsUser = () => user;

/** The order chosen for a section of the library. */
export const useSort = (section: string) => sortOption(section, useSettings((s) => s.librarySort)[section]);

/** Back to the original look and layout. Offline mode, whether plays are counted, sharing the look and the picture kept on the server are not about looks. */
export const resetSettings = () => setSettings({ ...DEFAULTS, scrobble: settings().scrobble, offlineMode: settings().offlineMode, syncLook: settings().syncLook, wallpaper: settings().wallpaper });

// ---- colour maths ----
const toRgb = (hex: string): Rgb => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (rgb: Rgb) => `#${rgb.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("")}`;
const mix = (rgb: Rgb, to: Rgb, amount: number): Rgb => rgb.map((c, i) => c + (to[i] - c) * amount) as Rgb;

const scheme = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : null;
const effective = (theme: Settings["theme"]) => (theme === "system" ? (scheme?.matches ? "light" : "dark") : theme);

/** The colours text is drawn in on each theme, which a picture behind everything must leave readable (styles.css). */
const INKS: Record<"dark" | "black" | "light", Ink> = {
  dark: { background: [11, 11, 15], text: [244, 244, 247], muted: [155, 155, 168] },
  black: { background: [0, 0, 0], text: [244, 244, 247], muted: [155, 155, 168] },
  light: { background: [246, 246, 249], text: [20, 20, 26], muted: [106, 106, 120] },
};
/** The theme showing now, and its colours. Follows the phone when the theme is "system". */
export const currentInk = (): Ink => INKS[effective(settings().theme)];
const useScheme = create<{ light: boolean }>(() => ({ light: Boolean(scheme?.matches) }));
scheme?.addEventListener("change", () => useScheme.setState({ light: scheme.matches }));
/** The theme showing now, redrawing what uses it when it changes. */
export function useInk(): Ink {
  const theme = useSettings((s) => s.theme);
  const light = useScheme((s) => s.light);
  return INKS[theme === "system" ? (light ? "light" : "dark") : theme];
}

function apply(): void {
  const current = settings();
  const root = document.documentElement;
  const theme = effective(current.theme);
  if (current.theme === "system") delete root.dataset.theme; else root.dataset.theme = current.theme;
  root.dataset.density = current.density;
  root.dataset.corners = current.corners;
  root.dataset.motion = current.motion;
  root.dataset.font = current.font;
  root.dataset.text = current.textSize;
  root.dataset.glass = current.glass;
  root.dataset.cards = current.cardSize;

  // A pale accent is unreadable as text on a light background: darken it there
  let accent = toRgb(/^#[0-9a-f]{6}$/i.test(current.accent) ? current.accent : DEFAULTS.accent);
  if (theme === "light" && luminance(accent) > 0.3) accent = mix(accent, [0, 0, 0], 0.38);
  if (current.dynamicAccent && coverColor) accent = accentFromCover(coverColor, toRgb(BACKGROUNDS[theme]));
  const vars = {
    "--accent": toHex(accent),
    "--accent-ink": luminance(accent) > 0.4 ? "#0b0b0f" : "#ffffff",
    "--glow": accent.map(Math.round).join(" "),
  };
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  const background = BACKGROUNDS[theme];
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", background);

  // boot.js replays this before the first paint on the next launch, so the app never flashes the wrong colours
  write("eco.boot", { attrs: { theme: current.theme === "system" ? null : current.theme, density: current.density, corners: current.corners, motion: current.motion, font: current.font, text: current.textSize, glass: current.glass, cards: current.cardSize }, vars, background });
}

/** The colour of what is playing, as "r g b", or null when nothing with a picture is. Only matters with dynamicAccent on. */
export function setCoverColor(color: string | null): void {
  const next = color ? (color.split(" ").map(Number) as Rgb) : null;
  if (next?.join() === coverColor?.join()) return;
  coverColor = next;
  if (settings().dynamicAccent) apply();
}

scheme?.addEventListener("change", () => { if (settings().theme === "system") apply(); });

// ---- connection ----
const useNetwork = create<{ connected: boolean }>(() => ({ connected: typeof navigator === "undefined" || navigator.onLine }));
export function watchNetwork(onChange: (connected: boolean) => void): () => void {
  const update = () => { useNetwork.setState({ connected: navigator.onLine }); onChange(navigator.onLine); };
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
}

/** Whether the app should talk to the server: a connection exists and offline mode is not forced. */
export const isOnline = () => useNetwork.getState().connected && !settings().offlineMode;
export function useOnline(): boolean {
  const connected = useNetwork((s) => s.connected);
  const forced = useSettings((s) => s.offlineMode);
  return connected && !forced;
}
