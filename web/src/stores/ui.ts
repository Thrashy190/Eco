// The toast and the bottom sheet: both are opened from anywhere, including outside React.
import { create } from "zustand";
import type { IconName } from "../components/Icon";

/** What is typed in the search box: the one in the page on a phone, the one in the top bar on a computer. */
export const useSearchText = create<{ text: string }>(() => ({ text: "" }));

export const useToast = create<{ message: string; visible: boolean }>(() => ({ message: "", visible: false }));

let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** Show a short message at the top of the screen. */
export function toast(message: string): void {
  useToast.setState({ message, visible: true });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => useToast.setState({ visible: false }), Math.max(3600, message.length * 70)); // time to read it
}

export interface SheetItem {
  icon?: IconName; // without one the label still lines up with the others
  label: string;
  danger?: boolean;
  run: () => void;
}

export interface SheetContent {
  title: string;
  subtitle?: string;
  items: SheetItem[];
}

export const useSheet = create<{ sheet: SheetContent | null }>(() => ({ sheet: null }));

/** Open the bottom sheet. Falsy items are skipped, so menus can list conditional entries inline. */
export function openSheet(title: string, subtitle: string | undefined, items: (SheetItem | false | null | undefined)[]): void {
  useSheet.setState({ sheet: { title, subtitle, items: items.filter((item): item is SheetItem => Boolean(item)) } });
}
export const closeSheet = () => useSheet.setState({ sheet: null });

/** What a text window asks for: a name for a chapter, a note… With `option`, a box to tick goes with it. */
export interface TextAsk {
  title: string;
  label: string;
  initial?: string;
  multiline?: boolean;
  confirm?: string;
  option?: { label: string; on: boolean };
  maxLength?: number;
}
export interface TextAnswer { text: string; option: boolean }

export const useTextAsk = create<{ ask: TextAsk | null; answer: ((value: TextAnswer | null) => void) | null }>(() => ({ ask: null, answer: null }));

/** Ask for some text in a window. Resolves to what was typed, or null when cancelled. */
export function askText(ask: TextAsk): Promise<TextAnswer | null> {
  useTextAsk.getState().answer?.(null); // only one window at a time
  return new Promise((resolve) => useTextAsk.setState({ ask, answer: resolve }));
}
