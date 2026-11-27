// The desktop app (desktop/, docs/desktop.md) shows this same web app in its own window, served by a small server of its
// own that passes /api and /rest on to the Eco server the person chose. What it does differently is decided from here,
// so a browser never sees any of it. No browser storage here, so it can be tested.

/** True in the build for the desktop app (`npm run build:desktop`), never in the one the Eco server sends. */
export const isDesktop = import.meta.env.MODE === "desktop";

export interface Bridge {
  token: string; // proves a request to /desktop/* comes from the app's window
  version: string; // the app's own version, e.g. 1.13.0
  platform: "linux" | "macos" | "windows";
  /** The window is painted on the processor (WebKitGTK with no graphics card to use): the page draws a lighter Eco. */
  lite?: boolean;
}

/** What the window tells the page about itself (`bridge_script` in desktop/src-tauri/src/lib.rs). */
export const bridge = (): Bridge | null => (isDesktop ? ((globalThis as { __ECO_DESKTOP__?: Bridge }).__ECO_DESKTOP__ ?? null) : null);

const SYSTEMS: Record<Bridge["platform"], string> = { linux: "Linux", macos: "Mac", windows: "Windows" };

/** How Connect names this computer until someone renames it. */
export const desktopName = (platform: string | undefined) => `Eco on ${SYSTEMS[platform as Bridge["platform"]] ?? "this computer"}`;

/** What the app says about updates (`Status` in desktop/src-tauri/src/update.rs). */
export interface UpdateStatus {
  current: string;
  can_update: boolean; // false for a build made by hand
  available: string | null; // a newer version ready to install
  stage: "idle" | "checking" | "downloading" | "installing";
  progress: number | null; // 0 to 1 while it downloads
  error: string | null;
}

/** What the Update button shows: nothing, a quiet button to look, a lit one, or the install going on. */
export function updateLook(status: UpdateStatus | null): "hidden" | "quiet" | "ready" | "busy" {
  if (!status?.can_update) return "hidden";
  if (status.stage === "downloading" || status.stage === "installing") return "busy";
  return status.available ? "ready" : "quiet";
}

/** "v1.12.0" or "1.12.0" as three numbers; null for anything else, such as "dev". */
export function releaseNumbers(version: string): number[] | null {
  const parts = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return parts ? parts.slice(1).map(Number) : null;
}

/** Whether the server runs an older Eco than this app, which may then ask it for things it does not have yet. */
export function serverIsOlder(server: string, app: string): boolean {
  const [ours, theirs] = [releaseNumbers(app), releaseNumbers(server)];
  if (!ours || !theirs) return false;
  for (let i = 0; i < 3; i++) if (theirs[i] !== ours[i]) return theirs[i] < ours[i];
  return false;
}

/** A server as people say it: its host, with the port when there is one. What was typed may lack the scheme. */
export function serverHost(address: string): string {
  const text = address.trim();
  try {
    return new URL(text.includes("://") ? text : `https://${text}`).host;
  } catch {
    return text;
  }
}
