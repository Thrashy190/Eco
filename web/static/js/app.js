// Entry point: sign-in screen, the shell (tabs + player) and a tiny hash router.
import { h, icon, toast } from "./ui.js";
import * as api from "./api.js";
import * as offline from "./store.js";
import * as downloads from "./downloads.js";
import * as views from "./views.js";
import * as settings from "./settings.js";
import { settingsView } from "./settings-view.js";
import { mount as mountPlayer } from "./nowplaying.js";

const root = document.getElementById("root");
const bootedAt = performance.now();

/** Fade the splash screen away, but never so fast that it just flashes. */
let splashGone = false;
setTimeout(() => hideSplash(), 6000); // failsafe: a startup problem must never leave the splash covering the app
function hideSplash() {
  const splash = document.getElementById("splash");
  if (splashGone || !splash) return;
  splashGone = true;
  setTimeout(() => {
    splash.classList.add("leaving");
    setTimeout(() => splash.remove(), 500);
  }, Math.max(0, 1000 - (performance.now() - bootedAt)));
}

const ROUTES = {
  home: views.home,
  search: views.search,
  library: views.library,
  artist: views.artist,
  album: views.albumView,
  playlist: views.playlistView,
  settings: settingsView,
};
// Which tab stays lit on each screen
const TAB_OF = { home: "home", search: "search", library: "library", artist: "library", album: "library", playlist: "library", settings: "settings" };

let view = null;
let tabs = null;
let cleanup = null;
let navigation = 0;

// ---------------- Sign in ----------------

function showLogin() {
  settings.load(""); // the device's last look
  cleanup?.();
  cleanup = null;
  view = tabs = null;
  document.body.classList.remove("has-player");
  const error = h("p", { class: "error", role: "alert" });
  const submit = h("button", { type: "submit", class: "primary" }, "Sign in");
  const form = h("form", { class: "login", onsubmit: async (e) => {
    e.preventDefault();
    error.textContent = "";
    submit.disabled = true;
    const data = new FormData(form);
    try {
      await api.signIn(data.get("user"), data.get("password"));
      start();
    } catch (err) {
      error.textContent = err.message;
      submit.disabled = false;
    }
  } },
  h("img", { src: "icon.svg", alt: "", width: "72", height: "72" }),
  h("h1", {}, "Eco"),
  h("p", {}, "Your music, wherever you are."),
  h("input", { name: "user", placeholder: "Username", autocomplete: "username", autocapitalize: "none", autocorrect: "off", required: true }),
  h("input", { name: "password", type: "password", placeholder: "Password", autocomplete: "current-password", required: true }),
  submit, error);
  root.replaceChildren(h("div", { class: "login-wrap" }, form));
  hideSplash();
}

// ---------------- Shell ----------------

function start() {
  settings.load(api.username());
  view = h("main", { id: "view" });
  tabs = h("nav", { class: "tabs", "aria-label": "Main" },
    [["home", "Home", "home"], ["search", "Search", "search"], ["library", "Library", "library"], ["settings", "Settings", "sliders"]].map(([name, label, ic]) =>
      h("a", { href: `#/${name}`, "data-tab": name }, icon(ic, 24), h("span", {}, label))));
  root.replaceChildren(view, tabs);
  mountPlayer(root);
  offline.init();
  downloads.poll();
  navigate();
}

async function navigate() {
  if (!api.signedIn() || !view) return;
  const [first, ...params] = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  const name = first in ROUTES ? first : "home"; // no hash, or an unknown one, means home
  const render = ROUTES[name];
  const mine = ++navigation;
  cleanup?.();
  cleanup = null;
  view.replaceChildren();
  view.classList.remove("enter"); void view.offsetWidth; view.classList.add("enter"); // replay the page transition
  window.scrollTo(0, 0);
  for (const a of tabs.querySelectorAll("a")) a.classList.toggle("active", a.dataset.tab === TAB_OF[name]);
  document.title = name === "home" ? "Eco" : `${name[0].toUpperCase()}${name.slice(1)} · Eco`;
  try {
    const result = await render(view, params);
    if (mine !== navigation) { if (typeof result === "function") result(); return; } // the user moved on while it loaded
    cleanup = typeof result === "function" ? result : null;
  } catch (e) {
    if (mine === navigation) view.replaceChildren(h("p", { class: "empty" }, e.message));
  } finally {
    hideSplash();
  }
}

window.addEventListener("hashchange", navigate);
window.addEventListener("online", () => { toast("Back online"); navigate(); });
window.addEventListener("offline", () => { toast("You are offline"); navigate(); });
api.onSignedOut(showLogin);
// Turning offline mode on or off changes what every screen shows
let wasOffline = settings.get().offlineMode;
settings.onChange((now) => { if (now.offlineMode !== wasOffline) { wasOffline = now.offlineMode; navigate(); } });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { /* the app works without it */ });
if (api.signedIn()) start(); else showLogin();
