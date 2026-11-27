// The Eco server the desktop app talks to (lib/desktop.ts). Its own server keeps the choice (desktop/src-tauri/src/config.rs);
// the page asks it through /desktop/server, which needs the window's token.
import { create } from "zustand";
import { signOut } from "../lib/api";
import { bridge, isDesktop, type UpdateStatus } from "../lib/desktop";
import * as offline from "./offline";
import { forgetQueue } from "./saving";
import { toast } from "./ui";

/** The server's address, such as https://eco.example.com/; null until one is chosen. */
export const useServer = create<{ address: string | null }>(() => ({ address: null }));
export const serverAddress = () => useServer.getState().address;

async function call(method: "GET" | "PUT" | "POST", body?: unknown, path = "/desktop/server"): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { "X-Eco-Desktop": bridge()?.token ?? "", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("The app could not reach its own server. Close Eco and open it again");
  }
  const answer = (await response.json().catch(() => ({}))) as { server?: string | null; error?: string };
  if (!response.ok) throw new Error(answer.error || "The app could not save the server");
  return answer.server ?? null;
}

/**
 * A link that leaves the app (the release notes, GitHub) opens in the browser, as a new tab would on the web. A window of
 * this app only ever shows the app, and not every web view hands `target="_blank"` to it, so the page asks its server.
 */
export function openLinksOutside(): void {
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(link instanceof HTMLAnchorElement) || link.origin === location.origin) return;
    event.preventDefault();
    void call("POST", { url: link.href }, "/desktop/open").catch(() => undefined);
  });
}

/**
 * `confirm` and `alert` as the system's own message boxes, and `prompt` too on a Mac (desktop/src-tauri/src/dialogs.rs):
 * WKWebView shows none of them by itself. They still block, as the browser's do, so every `if (!confirm(...)) return`
 * keeps waiting for the answer; the request is synchronous on purpose.
 */
export function nativeDialogs(): void {
  const ask = (kind: string, message: unknown, value = ""): { ok?: boolean; value?: string } => {
    try {
      const request = new XMLHttpRequest();
      request.open("POST", "/desktop/dialog", false);
      request.setRequestHeader("X-Eco-Desktop", bridge()?.token ?? "");
      request.setRequestHeader("Content-Type", "application/json");
      request.send(JSON.stringify({ kind, message: String(message ?? ""), value }));
      return JSON.parse(request.responseText) as { ok?: boolean; value?: string };
    } catch {
      return {}; // no answer is no: nothing goes ahead without a yes
    }
  };
  window.alert = (message?: unknown) => { ask("alert", message); };
  window.confirm = (message?: string) => ask("confirm", message).ok === true;
  if (bridge()?.platform === "macos") {
    window.prompt = (message?: string, value?: string) => {
      const answer = ask("prompt", message, value);
      return answer.ok ? answer.value ?? "" : null;
    };
  }
}

export async function loadServer(): Promise<void> {
  if (!isDesktop) return;
  try { useServer.setState({ address: await call("GET") }); } catch { /* the sign-in asks for one */ }
}

/** Checks that the address is an Eco server and makes it the one this app uses. The error says what is wrong. */
export async function chooseServer(typed: string): Promise<void> {
  useServer.setState({ address: await call("PUT", { server: typed }) });
}

/**
 * Leaving a server for another: saved songs are that server's (their IDs mean nothing to another one), so they go,
 * along with songs still waiting to download, and the person signs in again with the new address.
 */
export async function leaveServer(): Promise<void> {
  forgetQueue();
  signOut();
  await new Promise((resolve) => setTimeout(resolve, 0)); // let the signed-in screens stop their downloads first
  for (const collection of offline.collectionList()) await offline.removeCollection(collection.id);
  for (const song of offline.allSongs()) await offline.remove(song.id);
}

// ---- Updates: the app looks for a newer version, and the page lights its Update button (desktop/src-tauri/src/update.rs) ----

export const useUpdate = create<{ status: UpdateStatus | null }>(() => ({ status: null }));

async function updateCall(method: "GET" | "POST", path: string): Promise<UpdateStatus> {
  const response = await fetch(path, { method, headers: { "X-Eco-Desktop": bridge()?.token ?? "" } });
  const answer = (await response.json().catch(() => ({}))) as UpdateStatus & { error?: string };
  if (!response.ok) throw new Error(answer.error || "The app could not update itself");
  if (typeof answer.can_update !== "boolean") throw new Error("The app did not answer about updates");
  useUpdate.setState({ status: answer });
  return answer;
}

const busy = (status: UpdateStatus | null) => status?.stage === "downloading" || status?.stage === "installing";

/**
 * Follows the app's updates: what it found, and while it installs, how far it is. The app looks by itself every hour;
 * asking it often is cheap, since the answer is in its memory.
 */
export function watchUpdates(): () => void {
  if (!isDesktop) return () => undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const started = Date.now();
  const follow = async () => {
    const status = await updateCall("GET", "/desktop/update").catch(() => null);
    // Often while it installs, and while the app's own first look, at launch, may still be on its way
    const soon = busy(status) ? 500 : status?.stage === "checking" || Date.now() - started < 30_000 ? 3000 : 60_000;
    if (!stopped) timer = setTimeout(() => void follow(), soon);
  };
  void follow();
  return () => { stopped = true; clearTimeout(timer); };
}

/** Looks for a newer version now. */
export async function checkForUpdates(): Promise<UpdateStatus | null> {
  try {
    return await updateCall("POST", "/desktop/update/check");
  } catch (e) {
    toast((e as Error).message);
    return null;
  }
}

/** Installs the newer version after asking: Eco closes and opens again, and on Linux may ask for the password. */
export async function installUpdate(): Promise<void> {
  const status = useUpdate.getState().status;
  if (!status?.available) return;
  const password = bridge()?.platform === "linux" ? " Linux may ask for this computer's password." : "";
  if (!confirm(`Install Eco ${status.available}? You have ${status.current}.\n\nEco closes and opens again, so the music stops for a moment.${password}`)) return;
  try {
    await updateCall("POST", "/desktop/update/install");
    const poll = async () => {
      const now = await updateCall("GET", "/desktop/update").catch(() => null);
      if (busy(now)) setTimeout(() => void poll(), 500);
      else if (now?.error) toast(now.error);
    };
    void poll();
  } catch (e) {
    toast((e as Error).message);
  }
}
