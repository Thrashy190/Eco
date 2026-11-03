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
  toastTimer = setTimeout(() => useToast.setState({ visible: false }), 3600);
}

export interface SheetItem {
  icon: IconName;
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
