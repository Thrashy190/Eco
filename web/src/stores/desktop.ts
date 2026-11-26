// The Eco server the desktop app talks to (lib/desktop.ts). Its own server keeps the choice (desktop/src-tauri/src/config.rs);
// the page asks it through /desktop/server, which needs the window's token.
import { create } from "zustand";
import { signOut } from "../lib/api";
import { bridge, isDesktop } from "../lib/desktop";
import * as offline from "./offline";
import { forgetQueue } from "./saving";

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
