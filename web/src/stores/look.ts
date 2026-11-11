// The same look on every device of an account. The server keeps the settings this device shares (lib/look.ts) and when
// they were saved; a device takes them when it opens or comes back to the screen, and sends its own after a change.
// A change made offline waits ("dirty") and wins over the server once there is a connection again.
import { deleteWallpaper, getLook, putLook, putWallpaper } from "../lib/api";
import { cleanLook, DEVICE_ONLY, shareable } from "../lib/look";
import { adoptSettings, DEFAULTS, isOnline, onSettingsChanged, settings, settingsUser, setSettings, type Settings } from "./settings";

interface Mark { at: number; dirty: boolean } // when this device last agreed with the server, and whether it has news

const markKey = () => `eco.look.${settingsUser()}`;
function readMark(): Mark {
  try { return { at: 0, dirty: false, ...JSON.parse(localStorage.getItem(markKey()) ?? "{}") }; } catch { return { at: 0, dirty: false }; }
}
const writeMark = (mark: Mark) => { try { localStorage.setItem(markKey(), JSON.stringify(mark)); } catch { /* storage unavailable */ } };

let timer: ReturnType<typeof setTimeout> | undefined;

async function push(): Promise<void> {
  if (!settingsUser() || !settings().syncLook || !isOnline()) return;
  try {
    const { at } = await putLook(shareable(settings()));
    writeMark({ at, dirty: false });
  } catch { /* stays dirty: sent with the next change or the next time the app opens */ }
}

onSettingsChanged((patch) => {
  if (!settingsUser()) return;
  const keys = Object.keys(patch);
  if (keys.includes("syncLook")) {
    // Turned on here: this device's look becomes everyone's. Turned off: nothing more leaves this device
    if (patch.syncLook) { writeMark({ ...readMark(), dirty: true }); void push(); }
    return;
  }
  if (!settings().syncLook || keys.every((key) => key !== "syncLook" && (DEVICE_ONLY as readonly string[]).includes(key))) return;
  writeMark({ ...readMark(), dirty: true });
  clearTimeout(timer);
  timer = setTimeout(() => void push(), 800); // a slider sends one change, not fifty
});

let lastPull = 0;

/** Bring this device up to date with the account's look. Safe to call often: it asks at most every 20 seconds. */
export async function pullLook(force = false): Promise<void> {
  if (!settingsUser() || !isOnline() || (!force && Date.now() - lastPull < 20_000)) return;
  lastPull = Date.now();
  const forUser = settingsUser();
  const remote = await getLook().catch(() => null);
  if (!remote || forUser !== settingsUser()) return;
  // The picture lives on the server whatever this device shows, so its version always comes from there
  if (remote.wallpaper !== settings().wallpaper) adoptSettings({ wallpaper: remote.wallpaper });
  if (!settings().syncLook) return;
  const mark = readMark();
  if (mark.dirty || remote.look === null) { await push(); return; }
  if (remote.at > mark.at) {
    adoptSettings(cleanLook(remote.look, DEFAULTS));
    writeMark({ at: remote.at, dirty: false });
  }
}

/** Keep looking for news while the app is open: whenever it comes back to the screen. Returns how to stop. */
export function watchLook(): () => void {
  void pullLook(true);
  const onShow = () => { if (document.visibilityState === "visible") void pullLook(); };
  document.addEventListener("visibilitychange", onShow);
  window.addEventListener("online", onShow);
  return () => {
    document.removeEventListener("visibilitychange", onShow);
    window.removeEventListener("online", onShow);
  };
}

/** Upload a background picture (already a JPEG, see lib/image.ts) and show it. */
export async function setWallpaper(picture: Blob): Promise<void> {
  const { wallpaper } = await putWallpaper(picture);
  setSettings({ wallpaper, background: "photo" } as Partial<Settings>);
}

/** Remove the background picture, going back to the music's colour. */
export async function removeWallpaper(): Promise<void> {
  await deleteWallpaper();
  setSettings({ wallpaper: 0, ...(settings().background === "photo" ? { background: "wash" as const } : {}) });
}
