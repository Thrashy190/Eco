// Personal settings: theme, accent colour, density, corners, motion and playback options.
// They are stored per user on this device, so everyone who signs in on a shared phone keeps their own look.

export const DEFAULTS = {
  theme: "system", // system | dark | light | black
  accent: "#7cf0c0",
  tint: true, // tint the full-screen player with the cover's colour
  density: "comfortable", // comfortable | compact
  corners: "soft", // soft | sharp
  motion: "full", // full | reduced | off
  scrobble: true, // tell Navidrome what you play (feeds "Recently played" and "Most played")
  offlineMode: false, // pretend there is no connection: use only what is saved on this device
  videoQuality: 720, // tallest picture to download when importing a video (pixels)
};

export const ACCENTS = [
  ["Mint", "#7cf0c0"], ["Sky", "#6aa8ff"], ["Violet", "#b18cff"], ["Rose", "#ff7eb6"],
  ["Coral", "#ff6b6b"], ["Amber", "#ffb84d"], ["Lime", "#b5e853"],
];

const BACKGROUNDS = { dark: "#0b0b0f", black: "#000000", light: "#f6f6f9" };
let current = { ...DEFAULTS };
let user = "";
const listeners = new Set();

const keyFor = (u) => `eco.settings.${u || "_device"}`;
const read = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } };

export const get = () => current;
/** Whether the app should talk to the server: a connection exists and offline mode is not forced. */
export const online = () => navigator.onLine && !current.offlineMode;
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/** Load the settings of a user (or the device's last ones when nobody is signed in) and apply them. */
export function load(name = "") {
  user = name;
  current = { ...DEFAULTS, ...(read(keyFor(name)) ?? read(keyFor("")) ?? {}) };
  apply();
}

export function set(patch) {
  current = { ...current, ...patch };
  write(keyFor(user), current);
  apply();
  listeners.forEach((fn) => fn(current));
}

export function reset() { set({ ...DEFAULTS }); }

// ---- colour maths ----
const toRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = ([r, g, b]) => `#${[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("")}`;
const mix = (rgb, to, amount) => rgb.map((c, i) => c + (to[i] - c) * amount);
const luminance = ([r, g, b]) => [r, g, b].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);

const scheme = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : null;
const prefersLight = () => Boolean(scheme?.matches);
const effective = () => (current.theme === "system" ? (prefersLight() ? "light" : "dark") : current.theme);

function apply() {
  const root = document.documentElement;
  const theme = effective();
  if (current.theme === "system") delete root.dataset.theme; else root.dataset.theme = current.theme;
  root.dataset.density = current.density;
  root.dataset.corners = current.corners;
  root.dataset.motion = current.motion;

  // A pale accent is unreadable as text on a light background: darken it there
  let accent = toRgb(/^#[0-9a-f]{6}$/i.test(current.accent) ? current.accent : DEFAULTS.accent);
  if (theme === "light" && luminance(accent) > 0.3) accent = mix(accent, [0, 0, 0], 0.38);
  const vars = {
    "--accent": toHex(accent),
    "--accent-ink": luminance(accent) > 0.4 ? "#0b0b0f" : "#ffffff",
    "--glow": accent.map(Math.round).join(" "),
  };
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  const background = BACKGROUNDS[theme === "dark" ? "dark" : theme] ?? BACKGROUNDS.dark;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", background);

  // boot.js replays this before the first paint on the next launch, so the app never flashes the wrong colours
  write("eco.boot", { attrs: { theme: current.theme === "system" ? null : current.theme, density: current.density, corners: current.corners, motion: current.motion }, vars, background });
}

scheme?.addEventListener("change", () => { if (current.theme === "system") apply(); });
