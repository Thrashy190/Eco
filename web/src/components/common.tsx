import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { scrollRoot } from "../lib/media";
import { useSettings } from "../stores/settings";
import { Icon } from "./Icon";

export const Skeleton = ({ rows = 6 }: { rows?: number }) => (
  <div className="skeleton">{Array.from({ length: rows }, (_, i) => <div className="bar" key={i} />)}</div>
);

export const Empty = ({ children }: { children: ReactNode }) => <p className="empty">{children}</p>;

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="block">
      <div className="block-head"><h2>{title}</h2>{action}</div>
      {children}
    </section>
  );
}

export const Welcome = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="welcome"><h2>{title}</h2>{children}</div>
);

export const Shelf = ({ children }: { children: ReactNode }) => <div className="shelf">{children}</div>;

/** Who made the app and where its code lives. noreferrer keeps a private server's address out of GitHub's logs. */
export const Credit = () => (
  <p className="credit">Built by Thrashy · <a href="https://github.com/Thrashy190/eco" target="_blank" rel="noreferrer">View on GitHub</a></p>
);

export function OfflineBanner() {
  const forced = useSettings((s) => s.offlineMode);
  return (
    <div className="banner">
      <Icon name="wifi" size={18} />
      {forced ? "Offline mode is on. Showing what you saved on this device." : "You are offline. Showing what you saved on this device."}
    </div>
  );
}

export function BackButton() {
  const navigate = useNavigate();
  return <button className="back" aria-label="Back" onClick={() => navigate(-1)}><Icon name="back" />Back</button>;
}

export const Pill = ({ icon, children, onClick }: { icon?: Parameters<typeof Icon>[0]["name"]; children: ReactNode; onClick?: () => void }) => (
  <button type="button" className="pill" onClick={onClick}>{icon && <Icon name={icon} size={16} />}{children}</button>
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
  return { visible: hasMore ? items.slice(0, shown) : items, sentinel: hasMore ? <div className="more" ref={marker} /> : null };
}
