import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isWide } from "../lib/media";
import { cx } from "../lib/ui";
import { closeSheet, useSheet, useToast, type SheetContent } from "../stores/ui";
import { Icon } from "./Icon";

// Where the last press landed: under a mouse, a menu opens right there rather than across the screen
let lastPress: { x: number; y: number } | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", (e) => { lastPress = e.pointerType === "mouse" ? { x: e.clientX, y: e.clientY } : null; }, true);
  window.addEventListener("keydown", () => { lastPress = null; }, true); // opened from the keyboard: the middle of the screen
}

/** A menu: a floating sheet from below on a phone, a window in the middle on a tablet, and beside the pointer under a mouse. */
export function SheetHost() {
  const sheet = useSheet((s) => s.sheet);
  const [shown, setShown] = useState<SheetContent | null>(null);
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  // Before the next frame, or that frame could open the menu first: it then appeared at once with the dimmed page of a
  // phone, which faded away when the menu found out it goes beside the pointer. The whole app seemed to blink.
  useLayoutEffect(() => {
    if (sheet) {
      setShown(sheet);
      const frame = requestAnimationFrame(() => setOpen(true));
      return () => cancelAnimationFrame(frame);
    }
    setOpen(false);
    const timer = setTimeout(() => setShown(null), 180);
    return () => clearTimeout(timer);
  }, [sheet]);

  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeSheet(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown]);

  // Measured before it is painted, and kept inside the window whichever corner the press was in. Reading the size also
  // settles the closed look, which opening animates from. Its offset size ignores the scale of that look.
  useLayoutEffect(() => {
    if (!shown || !panel.current) { setAt(null); return; }
    const { offsetWidth: width, offsetHeight: height } = panel.current;
    if (!lastPress || !isWide()) { setAt(null); return; }
    const margin = 12;
    setAt({
      left: Math.max(margin, Math.min(lastPress.x - width + 24, innerWidth - width - margin)),
      top: Math.max(margin, Math.min(lastPress.y + 8, innerHeight - height - margin)),
    });
  }, [shown]);

  if (!shown) return null;
  return (
    <div className={cx("group/sheet fixed inset-0 z-70 flex items-end justify-center transition-colors duration-200 wide:items-center", open ? "is-open" : "", at ? "" : open ? "bg-black/55" : "bg-black/0")}
      onClick={(e) => { if (e.target === e.currentTarget) closeSheet(); }}>
      <div ref={panel} role="dialog" aria-label={shown.title} style={at ?? undefined}
        className={cx(
          "w-[calc(100%-16px)] max-w-130 max-h-[85dvh] overflow-y-auto mb-[calc(var(--safe-bottom)+8px)] p-2 rounded-[26px] bg-surface shadow-[0_24px_60px_rgb(0_0_0/.5),inset_0_0_0_1px_var(--line)] transition-[transform,opacity] duration-200 ease-snap",
          "wide:w-[min(100%-32px,340px)] wide:max-h-[80vh] wide:mb-0 wide:p-1.5 wide:rounded-[18px]",
          at && "fixed",
          open ? "translate-y-0 wide:opacity-100 wide:scale-100" : "translate-y-[110%] wide:translate-y-2 wide:scale-[.98] wide:opacity-0",
        )}>
        <div className="grid px-4 pt-3.5 pb-3 mb-1 border-b border-line [&>span]:text-muted [&>span]:text-[.88rem] wide:px-3 wide:py-2.5 [&>*]:truncate">
          <b>{shown.title}</b>{shown.subtitle && <span>{shown.subtitle}</span>}
        </div>
        {shown.items.map((item, i) => (
          <button key={i} className={cx("tap flex items-center gap-3.5 w-full px-4 py-3.75 rounded-xl font-semibold text-left active:bg-surface-2 hover:bg-surface-2 wide:px-3 wide:py-2.5 wide:text-[.94rem]", item.danger && "text-danger")}
            onClick={() => { closeSheet(); item.run(); }}>
            {item.icon ? <Icon name={item.icon} size={20} /> : <span className="size-5 flex-none" />}{item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ToastHost() {
  const { message, visible } = useToast();
  return (
    <div id="toast" role="status" className={cx(
      "fixed z-90 left-1/2 top-[calc(var(--safe-top)+12px)] w-max max-w-[min(92vw,460px)] px-4.5 py-2.75 rounded-full bg-text text-bg font-semibold text-[.9rem] shadow-[0_8px_24px_rgb(0_0_0/.35)] pointer-events-none -translate-x-1/2 transition-[transform,opacity] duration-250 ease-snap",
      "wide:top-auto wide:bottom-[calc(var(--safe-bottom)+104px)]",
      // Hidden means out past the notch too: it starts below the safe area, and a fixed percentage left it showing there
      visible ? "translate-y-0 opacity-100" : "-translate-y-[calc(100%+var(--safe-top)+24px)] opacity-0 wide:translate-y-3",
    )}>{message}</div>
  );
}
