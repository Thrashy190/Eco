import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { scrollRoot } from "../lib/media";
import { cx, detail, ui } from "../lib/ui";
import { useSettings } from "../stores/settings";
import { Icon } from "./Icon";

export const Skeleton = ({ rows = 6 }: { rows?: number }) => (
  <div className="grid gap-2.5 px-5 py-2 wide:px-8">
    {Array.from({ length: rows }, (_, i) => <div key={i} className="h-14 rounded-xl bg-[linear-gradient(100deg,var(--surface)_30%,var(--surface-2)_50%,var(--surface)_70%)] bg-size-[300%_100%] animate-shimmer" />)}
  </div>
);

export const Empty = ({ children }: { children: ReactNode }) => <p className={ui.empty}>{children}</p>;

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={ui.block}>
      <div className={ui.blockHead}><h2>{title}</h2>{action}</div>
      {children}
    </section>
  );
}

export const Welcome = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className={ui.welcome}><h2>{title}</h2>{children}</div>
);

/**
 * A row of cards you flick sideways. A mouse cannot flick, so under one the row also gets arrows, shown only when there is
 * more to see in that direction.
 */
export function Shelf({ children }: { children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ before: false, after: false });
  useEffect(() => {
    const element = row.current;
    if (!element) return;
    const measure = () => setRoom({ before: element.scrollLeft > 4, after: element.scrollLeft + element.clientWidth < element.scrollWidth - 4 });
    measure();
    const watcher = new ResizeObserver(measure);
    watcher.observe(element);
    element.addEventListener("scroll", measure, { passive: true });
    return () => { watcher.disconnect(); element.removeEventListener("scroll", measure); };
  }, [children]);
  const move = (by: 1 | -1) => row.current?.scrollBy({ left: by * row.current.clientWidth * 0.8 });
  const arrow = "tap absolute top-[calc(50%-48px)] z-2 hidden size-11 place-items-center rounded-full bg-glass-strong backdrop-blur-xl text-text shadow-[0_8px_24px_rgb(0_0_0/.35),inset_0_0_0_1px_var(--line)] hover:scale-105 can-hover:wide:grid";
  return (
    <div className="relative">
      <div ref={row} className={ui.shelf}>{children}</div>
      {room.before && <button type="button" className={cx(arrow, "left-3")} aria-label="Show earlier" onClick={() => move(-1)}><Icon name="back" size={20} /></button>}
      {room.after && <button type="button" className={cx(arrow, "right-3")} aria-label="Show more" onClick={() => move(1)}><span className="inline-flex -scale-x-100"><Icon name="back" size={20} /></span></button>}
    </div>
  );
}

/**
 * The page of an album, playlist or artist. On a phone everything is one column. On a big page the picture, the title and
 * the buttons stay still in a column of their own while the songs scroll past, so Play is never out of reach.
 */
export function DetailPage({ art, info, actions, children }: { art: ReactNode; info: ReactNode; actions: ReactNode; children: ReactNode }) {
  return (
    <div className="@4xl:grid @4xl:grid-cols-[minmax(240px,300px)_minmax(0,1fr)] @4xl:items-start @4xl:gap-x-8 @4xl:px-8 @4xl:pt-2">
      <div className="@4xl:sticky @4xl:top-0 @4xl:max-h-[calc(100dvh-110px)] @4xl:overflow-y-auto @4xl:no-scrollbar">
        <header className={detail.header}>{art}<div className={detail.info}>{info}</div></header>
        <div className="@4xl:*:px-0">{actions}</div>
      </div>
      <div className="min-w-0 @4xl:-mx-2 @4xl:[&>section:first-child]:mt-0">{children}</div>
    </div>
  );
}

/** Who made the app and where its code lives. noreferrer keeps a private server's address out of GitHub's logs. */
export const Credit = () => (
  <p className="m-0 text-muted text-[.85rem] text-center">Built by Thrashy · <a className="inline-block py-1.5 text-text underline underline-offset-2" href="https://github.com/Thrashy190/eco" target="_blank" rel="noreferrer">View on GitHub</a></p>
);

export function OfflineBanner() {
  const forced = useSettings((s) => s.offlineMode);
  return (
    <div className={ui.banner}>
      <Icon name="wifi" size={18} />
      {forced ? "Offline mode is on. Showing what you saved on this device." : "You are offline. Showing what you saved on this device."}
    </div>
  );
}

export function BackButton() {
  const navigate = useNavigate();
  return <button className={ui.back} aria-label="Back" onClick={() => navigate(-1)}><Icon name="back" />Back</button>;
}

export const Pill = ({ icon, children, onClick }: { icon?: Parameters<typeof Icon>[0]["name"]; children: ReactNode; onClick?: () => void }) => (
  <button type="button" className={ui.pill} onClick={onClick}>{icon && <Icon name={icon} size={16} />}{children}</button>
);

/** Long lists draw a part at a time, so opening 1000 favorites on a phone stays instant. */
export function useIncremental<T>(items: T[], step = 120): { visible: T[]; sentinel: ReactNode } {
  const [shown, setShown] = useState(step);
  const marker = useRef<HTMLDivElement>(null);
  const hasMore = shown < items.length;
  useEffect(() => {
    if (!hasMore || !marker.current) return;
    const watcher = new IntersectionObserver((entries) => { if (entries[0].isIntersecting) setShown((n) => n + step); }, { root: scrollRoot(marker.current), rootMargin: "1200px" });
    watcher.observe(marker.current);
    return () => watcher.disconnect();
  }, [hasMore, step, shown]);
  return { visible: hasMore ? items.slice(0, shown) : items, sentinel: hasMore ? <div className={ui.more} ref={marker} /> : null };
}
