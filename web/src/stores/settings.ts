// Personal settings: how the app looks and what it shows first, and playback options.
// They are stored per user on this device, so everyone who signs in on a shared phone keeps their own look.
import { create } from "zustand";
import { accentFromCover, luminance, type Rgb } from "../lib/color";
import { DEFAULT_TABS } from "../lib/nav";

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
  nowPanel: boolean; // on a big screen, the deck (what is playing) stays beside the page
}

export const DEFAULTS: Settings = {
  theme: "system", accent: "#7cf0c0", dynamicAccent: false, tint: true, density: "comfortable", corners: "soft", motion: "full", scrobble: true, offlineMode: false,
  font: "rounded", textSize: "normal", homeOrder: [], homeHidden: [], tabs: DEFAULT_TABS, libraryView: "grid", nowPanel: true,
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

export function setSettings(patch: Partial<Settings>): void {
  useSettings.setState(patch);
  write(keyFor(user), settings());
  apply();
}

/** Back to the original look and layout. Offline mode and whether plays are counted are not about looks. */
export const resetSettings = () => setSettings({ ...DEFAULTS, scrobble: settings().scrobble, offlineMode: settings().offlineMode });

// ---- colour maths ----
const toRgb = (hex: string): Rgb => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (rgb: Rgb) => `#${rgb.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("")}`;
const mix = (rgb: Rgb, to: Rgb, amount: number): Rgb => rgb.map((c, i) => c + (to[i] - c) * amount) as Rgb;

const scheme = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : null;
const effective = (theme: Settings["theme"]) => (theme === "system" ? (scheme?.matches ? "light" : "dark") : theme);

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
  write("eco.boot", { attrs: { theme: current.theme === "system" ? null : current.theme, density: current.density, corners: current.corners, motion: current.motion, font: current.font, text: current.textSize }, vars, background });
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
