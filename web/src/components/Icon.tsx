import type { ReactElement } from "react";

const HEART = "M12 20.5s-7.5-4.6-9.4-9.7C1.4 7.5 3.4 4.8 6.4 4.8c1.9 0 3.5 1 5.6 3.1 2.1-2.1 3.7-3.1 5.6-3.1 3 0 5 2.7 3.8 6-1.9 5.1-9.4 9.7-9.4 9.7z";
const PIN = "M9 3h6l-.8 6.4 3.3 3.6v2H6.5v-2l3.3-3.6zM12 15v6";

const ICONS = {
  home: <path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.8-3.8" /></>,
  library: <path d="M4 5v14M9 5v14M14.5 6.5l4.5 12.5" />,
  play: <path className="fill-current stroke-none" d="M7 4.6v14.8L19.6 12z" />,
  pause: <path className="fill-current stroke-none" d="M6.5 4h3.8v16H6.5zM13.7 4h3.8v16h-3.8z" />,
  next: <path className="fill-current stroke-none" d="M5 5.2v13.6L15 12zM17 5h2.2v14H17z" />,
  prev: <path className="fill-current stroke-none" d="M19 5.2v13.6L9 12zM7 5H4.8v14H7z" />,
  download: <path d="M12 4v11m0 0 4.2-4.2M12 15l-4.2-4.2M5 20h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  more: <><circle className="fill-current stroke-none" cx="5" cy="12" r="1.7" /><circle className="fill-current stroke-none" cx="12" cy="12" r="1.7" /><circle className="fill-current stroke-none" cx="19" cy="12" r="1.7" /></>,
  down: <path d="m6 9 6 6 6-6" />,
  back: <path d="m15 6-6 6 6 6" />,
  offline: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v8m0 0-3-3m3 3 3-3" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  shuffle: <path d="M3 5h3.3c5.2 0 5.2 14 10.4 14H21m0 0-2.8-2.8M21 19l-2.8 2.8M3 19h3.3c1.5 0 2.7-.8 3.6-2M21 5h-3.3c-1.5 0-2.7.8-3.6 2m6.9-2-2.8-2.8M21 5l-2.8 2.8" />,
  repeat: <path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" />,
  queue: <path d="M4 6h12M4 12h12M4 18h7M17 14.5v6l4.5-3z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <path d="M5 7h14M10 7V4h4v3m-8 0 1 13h10l1-13" />,
  heart: <path d={HEART} />,
  "heart-fill": <path className="fill-current stroke-none" d={HEART} />,
  sliders: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  wifi: <><path d="M2 9a15 15 0 0 1 20 0M5.5 12.7a10 10 0 0 1 13 0M9 16.4a5 5 0 0 1 6 0" /><circle className="fill-current stroke-none" cx="12" cy="20" r="1" /></>,
  pin: <path d={PIN} />,
  "pin-fill": <><path className="fill-current stroke-none" d="M9 3h6l-.8 6.4 3.3 3.6v2H6.5v-2l3.3-3.6z" /><path d="M12 15v6" /></>,
  pencil: <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17zM14.5 7.5l3 3" />,
  image: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4 3.5 2.8L16 13l4 3.5" /></>,
  volume: <><path className="fill-current stroke-none" d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" /></>,
  "volume-off": <><path className="fill-current stroke-none" d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" /><path d="m16 9.5 5 5m0-5-5 5" /></>,
  devices: <><rect x="3" y="5" width="12" height="9" rx="1.5" /><path d="M6 18h6M9 14v4" /><rect x="17" y="8" width="4.5" height="11" rx="1" /></>,
  upload: <path d="M12 16V5m0 0L7.8 9.2M12 5l4.2 4.2M5 20h14" />,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  up: <path d="m6 15 6-6 6 6" />,
  sparkle: <path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.2l-1.8-5.6-5.7-1.8L10.2 9zM19 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />,
  panel: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M15 4.5v15" /></>,
  history: <><path d="M4 12a8 8 0 1 0 2.6-5.9L4 8.5V4m8 4v4.5l3 1.8" /></>,
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof ICONS;

/** An inline SVG icon that inherits the current text colour. */
export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <span className="inline-flex leading-[0]">
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ICONS[name]}
      </svg>
    </span>
  );
}

/** A progress ring. percent < 0 spins forever (waiting); otherwise it fills. */
export function Ring({ percent, size = 30 }: { percent: number; size?: number }) {
  const r = 11;
  const c = 2 * Math.PI * r;
  return (
    <span className="inline-flex">
      <svg viewBox="0 0 28 28" width={size} height={size} aria-hidden="true" className={percent < 0 ? "-rotate-90 animate-turn" : "-rotate-90"}>
        <circle className="fill-none stroke-surface-3 stroke-3" cx="14" cy="14" r={r} />
        <circle className="fill-none stroke-accent stroke-3 [stroke-linecap:round] transition-[stroke-dashoffset] duration-350 ease-in-out" cx="14" cy="14" r={r} strokeDasharray={c} strokeDashoffset={percent < 0 ? c * 0.72 : c * (1 - percent / 100)} />
      </svg>
    </span>
  );
}
