// The Settings screen. Every control updates its own state in place (no re-render), so changing a colour
// or a theme is instant and the page does not jump or replay its entrance animations.
import { h, icon, toast, initials, ring } from "./ui.js";
import * as settings from "./settings.js";
import * as offline from "./store.js";
import { signOut, username, eco } from "./api.js";

/** A pill-shaped choice between a few options. */
function segmented(options, key) {
  const group = h("div", { class: "seg", role: "group" });
  const numeric = typeof settings.DEFAULTS[key] === "number"; // "720" from the page back to the number 720
  const paint = () => group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === String(settings.get()[key]))));
  for (const [value, label] of options) {
    group.append(h("button", { type: "button", "data-value": value, onclick: () => { settings.set({ [key]: numeric ? Number(value) : value }); paint(); } }, label));
  }
  paint();
  return group;
}

function toggle(key) {
  const button = h("button", { type: "button", class: "toggle-switch", role: "switch", "aria-checked": String(settings.get()[key]) });
  button.addEventListener("click", () => {
    const on = !settings.get()[key];
    settings.set({ [key]: on });
    button.setAttribute("aria-checked", String(on));
  });
  return button;
}

const setting = (title, description, control, { stack = false } = {}) =>
  h("div", { class: "setting" + (stack ? " stack" : "") }, h("div", { class: "label" }, h("b", {}, title), description ? h("span", {}, description) : null), control);

const group = (title, ...rows) => h("section", {}, h("div", { class: "group-title" }, title), h("div", { class: "group" }, rows));

function swatches() {
  const wrap = h("div", { class: "swatches" });
  const custom = h("input", { type: "color", "aria-label": "Custom colour", value: settings.get().accent });
  const customButton = h("span", { class: "swatch custom", title: "Pick any colour" }, custom);
  const paint = () => {
    const current = settings.get().accent.toLowerCase();
    wrap.querySelectorAll(".swatch:not(.custom)").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.color === current)));
    const isPreset = settings.ACCENTS.some(([, c]) => c === current);
    customButton.setAttribute("aria-pressed", String(!isPreset));
  };
  for (const [name, color] of settings.ACCENTS) {
    wrap.append(h("button", { type: "button", class: "swatch", style: `--c:${color}`, "data-color": color, "aria-label": name, title: name, onclick: () => { settings.set({ accent: color }); custom.value = color; paint(); } }));
  }
  custom.addEventListener("input", () => { settings.set({ accent: custom.value }); paint(); });
  wrap.append(customButton);
  paint();
  return wrap;
}

/** A tiny sample so you can see what a choice does without leaving the screen. */
const preview = () => h("div", { class: "preview", "aria-hidden": "true" },
  h("div", { class: "cover no-cover" }, icon("play", 20)),
  h("div", { class: "text", style: "flex:1;min-width:0;display:grid" }, h("b", {}, "Sample song"), h("span", { style: "color:var(--muted);font-size:.85rem" }, "Sample artist · Album")),
  ring(65, 28),
  h("span", { class: "get" }, icon("download", 16), "Get"));

export function settingsView(root) {
  const user = username();
  const usage = h("span", {}, "Calculating…");
  const library = h("span", {}, "…");

  root.append(
    h("header", { class: "hero compact" }, h("h1", {}, "Settings")),
    h("div", { class: "settings" },
      h("div", { class: "profile-card" },
        h("div", { class: "avatar letters" }, initials(user)),
        h("div", {}, h("h2", {}, user), h("p", {}, "Your settings are saved on this device for this account."))),

      group("Appearance",
        setting("Theme", "Follows your phone unless you choose one", segmented([["system", "Auto"], ["dark", "Dark"], ["light", "Light"], ["black", "Black"]], "theme"), { stack: true }),
        setting("Accent colour", "Buttons, highlights and the active tab", swatches(), { stack: true }),
        preview(),
        setting("Corners", null, segmented([["soft", "Soft"], ["sharp", "Sharp"]], "corners")),
        setting("List size", "Compact fits more songs on screen", segmented([["comfortable", "Comfy"], ["compact", "Compact"]], "density")),
        setting("Colour the player", "Tint the full-screen player with the cover's colour", toggle("tint")),
        setting("Animations", "Reduced only fades; Off keeps everything still", segmented([["full", "Full"], ["reduced", "Less"], ["off", "Off"]], "motion"), { stack: true })),

      group("Playback",
        setting("Count my plays", "Lets “Recently played” and “Most played” work on the home screen", toggle("scrobble"))),

      group("Imports",
        setting("Video quality", "Tallest picture to download when you import a video", segmented([["360", "360p"], ["480", "480p"], ["720", "720p"], ["1080", "1080p"]], "videoQuality"), { stack: true })),

      group("Offline",
        setting("Offline mode", "Use only what is saved on this device, even with a connection", toggle("offlineMode")),
        setting("Saved on this device", null, usage),
        setting("Remove all saved songs", "Frees the space they use", h("button", { type: "button", class: "pill", onclick: async () => {
          const saved = offline.list();
          if (!saved.length) { toast("Nothing is saved on this device"); return; }
          if (!confirm(`Remove ${saved.length} saved songs from this device?`)) return;
          for (const s of saved) await offline.remove(s.id);
          toast("Removed from this device");
          refreshUsage();
        } }, icon("trash", 16), "Remove"))),

      group("About",
        setting("Library", "Songs in your library", library),
        setting("Server", null, h("span", { style: "color:var(--muted)" }, location.host))),

      group("Account",
        setting("Reset appearance", "Back to the original look", h("button", { type: "button", class: "pill", onclick: () => { settings.reset(); toast("Settings reset"); location.reload(); } }, "Reset")),
        setting("Sign out", `Signed in as ${user}`, h("button", { type: "button", class: "pill", onclick: signOut }, "Sign out")))));

  async function refreshUsage() {
    const { used, quota } = await offline.usage();
    usage.textContent = offline.count() ? `${offline.count()} songs · ${offline.megabytes(used)}${quota ? ` of ${offline.megabytes(quota)}` : ""}` : "Nothing saved";
  }
  refreshUsage();
  eco("songs", { limit: 1 }).then((page) => { library.textContent = `${page.total} songs`; }).catch(() => { library.textContent = "—"; });
}
