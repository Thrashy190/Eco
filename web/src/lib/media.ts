// Which layout the screen gets. Below WIDE it is the phone app; from there on, a page under a floating bar, and from ROOMY
// a deck beside it. The widths must match the breakpoints in styles.css.
import { useSyncExternalStore } from "react";

const query = (text: string) => (typeof matchMedia === "function" ? matchMedia(text) : null);

function useMedia(text: string): boolean {
  return useSyncExternalStore(
    (notify) => { const list = query(text); list?.addEventListener("change", notify); return () => list?.removeEventListener("change", notify); },
    () => query(text)?.matches ?? false,
  );
}

const WIDE = "(min-width: 760px)";
const ROOMY = "(min-width: 1100px)";

export const isWide = () => query(WIDE)?.matches ?? false;
export const useWide = () => useMedia(WIDE);
/** Enough room for the deck beside the page. */
export const useRoomy = () => useMedia(ROOMY);

/** What scrolls: on a big screen the page is a panel, on a phone it is the window. Watchers of "near the end" need it. */
export function scrollRoot(element: Element | null): Element | null {
  const view = element?.closest("#view") ?? null;
  return view && getComputedStyle(view).overflowY !== "visible" ? view : null;
}
