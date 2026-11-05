// Tailwind classes more than one screen shares. A phone gets the unprefixed classes; `wide:` is a tablet or a computer,
// `roomy:` a screen with space for the deck beside the page (see lib/media.ts), and `@2xl:` and up look at the width of
// the page itself, which depends on whether the deck is open.

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

const pressable = "tap active:scale-[.97]";
const truncated = "[&>b]:truncate [&>span]:truncate";

export const ui = {
  // ---- Page structure ----
  hero: "rise px-5 pt-5.5 pb-2 max-wide:[background:radial-gradient(120%_90%_at_0%_0%,rgb(var(--glow)/.16),transparent_60%)] [&_h1]:text-[2rem] [&_h1]:font-extrabold [&_h1]:tracking-[-.03em] [&_p]:mt-0.5 [&_p]:min-h-[1.2em] [&_p]:text-muted wide:px-8 wide:pt-4 wide:pb-5 wide:[&_h1]:font-title wide:[&_h1]:text-[clamp(2.6rem,5.2cqi,4.75rem)] wide:[&_h1]:leading-[1.02] wide:[&_h1]:font-bold wide:[&_h1]:tracking-[-.04em] wide:[&_h1]:text-balance wide:[&_p]:mt-2",
  heroCompact: "rise px-5 pt-4 pb-2 max-wide:[background:radial-gradient(120%_90%_at_0%_0%,rgb(var(--glow)/.16),transparent_60%)] [&_h1]:text-[2rem] [&_h1]:font-extrabold [&_h1]:tracking-[-.03em] [&_p]:mt-0.5 [&_p]:min-h-[1.2em] [&_p]:text-muted wide:px-8 wide:pt-2 wide:pb-3 wide:[&_h1]:font-title wide:[&_h1]:text-[clamp(2.2rem,4cqi,3.25rem)] wide:[&_h1]:leading-[1.05] wide:[&_h1]:font-bold wide:[&_h1]:tracking-[-.035em] wide:[&_p]:mt-1",
  block: "rise mt-6.5 nth-of-type-2:[--d:60ms] nth-of-type-3:[--d:120ms] nth-of-type-[n+4]:[--d:180ms] wide:mt-10",
  blockHead: "flex items-center justify-between gap-3 px-5 pb-2.5 [&_h2]:text-[1.15rem] [&_h2]:font-extrabold [&_h2]:tracking-[-.02em] wide:px-8 wide:pb-4 wide:[&_h2]:font-title wide:[&_h2]:text-[1.6rem] wide:[&_h2]:font-semibold wide:[&_h2]:tracking-[-.025em]",
  empty: "text-muted text-center px-6 py-7",
  note: "text-muted px-5 py-3 text-left text-[.9rem] wide:px-8",
  count: "text-muted text-[.85rem] px-5 pt-1 pb-2 wide:px-8",
  welcome: "rise grid gap-2.5 justify-items-center text-center px-7 py-14 [&_h2]:text-[1.4rem] [&_h2]:font-extrabold [&_h2]:tracking-[-.02em] [&_p]:text-muted [&_p]:max-w-[36ch] wide:[&_h2]:font-title wide:[&_h2]:text-[2rem] wide:[&_h2]:font-semibold",
  banner: "flex items-center gap-2.5 mx-4 mt-3 px-3.5 py-3 rounded-card bg-surface-2 text-muted text-[.9rem] wide:mx-8 wide:mt-4",
  actions: "rise flex flex-wrap items-center gap-2.5 px-5 py-3.5 wide:px-8 wide:py-4",
  actionsPlain: "flex flex-wrap items-center gap-2.5 px-3.5 pt-1.5 pb-2.5",
  narrow: "max-w-190",
  more: "h-px",

  // ---- Buttons ----
  primary: `relative overflow-hidden inline-flex items-center gap-2 px-5.5 py-3 rounded-full bg-accent text-accent-ink font-extrabold ${pressable} hover:brightness-110 hover:shadow-[0_8px_24px_rgb(var(--glow)/.3)]`,
  pill: "tap inline-flex items-center gap-1.75 px-3.5 py-2 rounded-full bg-surface-2 font-bold text-[.85rem] whitespace-nowrap active:bg-surface-3 hover:bg-surface-3 data-on:bg-[rgb(var(--glow)/.18)] data-on:text-accent wide:bg-ghost",
  iconButton: "tap size-10 grid place-items-center rounded-full text-muted flex-none active:bg-surface-2 hover:text-text hover:bg-ghost",
  round: "tap size-9 flex-none grid place-items-center rounded-full bg-surface-2 text-text active:scale-[.94] hover:bg-surface-3",
  back: "inline-flex items-center gap-1 px-4 pt-3.5 pb-1 text-muted font-semibold wide:hidden",
  dangerLink: "block mx-auto my-6 p-2.5 text-danger font-semibold",
  get: "tap relative overflow-hidden inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-accent text-accent-ink font-extrabold text-[.85rem] active:scale-[.96] disabled:bg-surface-2 disabled:text-muted disabled:opacity-100",
  getRetry: "tap inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-transparent text-danger font-extrabold text-[.85rem] shadow-[inset_0_0_0_1.5px_var(--danger)] active:scale-[.96]",
  chip: "px-4 py-2.25 rounded-full bg-surface-2 font-bold text-[.9rem] transition-[background-color,color,transform] duration-150 active:scale-95 aria-pressed:bg-accent aria-pressed:text-accent-ink hover:not-aria-pressed:bg-surface-3",
  link: "text-accent cursor-pointer",

  // ---- Pictures. Each one is a whole size: pick one, never two ----
  cover: "size-12 rounded-cover object-cover bg-surface-2 flex-none",
  coverBig: "w-full h-auto aspect-square rounded-card object-cover bg-surface-2 flex-none",
  coverHuge: "w-[min(60vw,220px)] h-auto aspect-square rounded-big object-cover bg-surface-2 flex-none shadow-[0_18px_40px_rgb(0_0_0/.35)] wide:w-[clamp(160px,24cqi,220px)] @4xl:w-full wide:shadow-[0_24px_60px_rgb(0_0_0/.4)]",
  noCover: "grid place-items-center text-muted bg-[linear-gradient(135deg,var(--surface-2),var(--surface-3))]",
  favCover: "grid place-items-center text-white bg-[linear-gradient(135deg,#6a4cff,#c86bff_55%,#ff8fb1)]",
  avatar: "w-full aspect-square rounded-full object-cover bg-surface-2",
  avatarBig: "w-[min(40vw,150px)] flex-none aspect-square rounded-full object-cover bg-surface-2 wide:w-[clamp(150px,22cqi,200px)] @4xl:w-full wide:shadow-[0_24px_60px_rgb(0_0_0/.4)]",
  avatarSmall: "size-12 flex-none aspect-square rounded-full object-cover bg-surface-2 text-[.95rem]",
  letters: "grid place-items-center font-extrabold text-[1.6rem] text-white bg-[linear-gradient(135deg,hsl(var(--h)_55%_42%),hsl(calc(var(--h)+40)_60%_28%))]",

  // ---- Cards ----
  card: "group/card tap flex-none w-35 grid gap-0.5 content-start snap-start active:scale-[.96] [&>b]:truncate [&>b]:text-[.92rem] [&>span:last-child]:truncate [&>span:last-child]:text-muted [&>span:last-child]:text-[.8rem] wide:w-44 wide:[&>b]:mt-1.5 wide:[&>b]:text-[.98rem] wide:[&>b]:font-semibold wide:[&>span:last-child]:text-[.85rem]",
  cardArtist: "group/card tap flex-none w-28 grid gap-0.5 content-start snap-start text-center active:scale-[.96] [&>b]:truncate [&>b]:text-[.92rem] [&>span:last-child]:truncate [&>span:last-child]:text-muted [&>span:last-child]:text-[.8rem] [&>:first-child]:mb-1.5 wide:w-36 wide:[&>b]:font-semibold",
  // A cover inside a card: it rises towards you under a mouse
  cardCover: "mb-1.5 shadow-[0_8px_20px_rgb(0_0_0/.25)] transition-[transform,box-shadow] duration-300 ease-snap can-hover:group-hover/card:-translate-y-1 can-hover:group-hover/card:shadow-[0_18px_36px_rgb(0_0_0/.4)] wide:rounded-big",
  cardArt: "relative block",
  shelf: "stagger flex gap-3.5 overflow-x-auto px-5 pt-0.5 pb-2 snap-x snap-proximity scroll-px-5 no-scrollbar wide:gap-5 wide:px-8 wide:pb-3 wide:scroll-px-8 wide:scroll-smooth",
  grid: "stagger grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-x-3.5 gap-y-4.5 px-5 py-2 *:w-auto wide:grid-cols-[repeat(auto-fill,minmax(164px,1fr))] wide:gap-x-5 wide:gap-y-7 wide:px-8",

  // ---- Rows ----
  rows: "stagger px-2 wide:px-5",
  rowsPlain: "w-full max-w-110 p-0",
  row: "group/row tap flex items-center gap-3 min-h-16 py-2 pr-2 pl-3 rounded-xl cursor-pointer active:bg-surface-2 active:scale-[.985] hover:bg-hover compact:min-h-13 compact:py-1 compact:gap-2.5 compact:[&>[data-art]]:size-9.5 data-playing:[&>[data-art]]:animate-glow-pulse data-playing:[&>[data-art]]:shadow-[0_0_0_2px_var(--accent),0_0_14px_rgb(var(--glow)/.5)] wide:min-h-14 wide:py-1.5",
  rowCompact: "group/row tap flex items-center gap-3 min-h-13.5 py-2 pr-2 pl-1 rounded-xl cursor-pointer active:bg-surface-2 hover:bg-hover",
  rowLink: "flex items-center gap-3 flex-1 min-w-0 text-inherit",
  // Title and details of a row. Only a row marked data-current shows its title in the accent colour
  text: `flex-1 min-w-0 grid ${truncated} [&>b]:font-[650] [&>span]:text-muted [&>span]:text-[.85rem] group-data-current/row:[&>b]:text-accent`,
  time: "text-muted text-[.85rem] tabular-nums wide:min-w-[3em] wide:text-right",
  num: "w-7 flex-none text-center text-muted tabular-nums",
  status: "inline-flex items-center text-accent",
  download: "inline-flex items-center gap-2 flex-none mr-1",
  downloadLabel: "text-muted text-[.8rem] min-w-[3.4em] tabular-nums",
  done: "inline-flex px-2.5 text-accent [&_svg]:animate-pop",
  // Under a mouse this waits for you to point at the row. A finger cannot point, so on a touch screen it is always there
  rowMore: "tap size-10 grid place-items-center rounded-full text-muted flex-none active:bg-surface-2 hover:text-text can-hover:wide:opacity-0 can-hover:wide:group-hover/row:opacity-100 focus-visible:opacity-100",
  colAlbum: "hidden @2xl:block flex-[0_0_26%] min-w-0 truncate text-muted text-[.88rem]",
  inLineAlbum: "@2xl:hidden",
  tick: "flex-none size-7 grid place-items-center rounded-lg shadow-[inset_0_0_0_2px_var(--surface-3)] text-accent-ink transition-[background-color,box-shadow] duration-100 data-on:bg-accent data-on:shadow-none",
  pinMark: "inline-flex align-[-1px] mr-1.25 text-accent",
  discTitle: "px-3 pt-4 pb-1.5 text-muted text-[.8rem] font-bold uppercase tracking-[.08em]",
  selectBar: "sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2.5 px-5 py-2.5 bg-[linear-gradient(var(--page)_82%,transparent)] wide:top-0 wide:mx-5 wide:mb-2 wide:px-3 wide:rounded-full wide:bg-glass-strong wide:backdrop-blur-xl",
  filter: "block w-[calc(100%-32px)] mx-4 my-2 px-4 py-3 rounded-card border border-transparent bg-surface-2 outline-none focus:border-accent wide:w-[calc(100%-64px)] wide:max-w-120 wide:mx-8 wide:bg-ghost",
  segments: "flex gap-2 overflow-x-auto px-4 py-3 no-scrollbar wide:px-8 wide:gap-1 wide:py-2",
  segment: "tap flex-none whitespace-nowrap px-4 py-2 rounded-full bg-surface-2 font-bold text-[.9rem] hover:bg-surface-3 data-on:bg-accent data-on:text-accent-ink [&_small]:ml-1.5 [&_small]:opacity-75 wide:bg-transparent wide:text-muted wide:hover:text-text wide:hover:bg-ghost wide:data-on:bg-text wide:data-on:text-bg",

  // ---- Settings-style groups ----
  group: "grid rounded-[calc(var(--radius)+2px)] bg-surface overflow-hidden shadow-[inset_0_0_0_1px_var(--line)] wide:bg-glass-strong",
  groupTitle: "text-[.75rem] uppercase tracking-[.09em] text-muted px-1.5 pb-2 font-bold",
  setting: "flex items-center justify-between gap-3.5 px-4 py-3.5 min-h-14 [&+&]:border-t [&+&]:border-line",
  settingStack: "flex flex-col items-stretch justify-between gap-3.5 px-4 py-3.5 min-h-14 [&+&]:border-t [&+&]:border-line",
  settingLabel: "grid gap-0.5 min-w-0 [&>b]:font-[650] [&>span]:text-muted [&>span]:text-[.82rem]",
  toggle: "relative flex-none w-12.5 h-7.5 rounded-full bg-surface-3 transition-colors duration-200 aria-checked:bg-accent after:content-[''] after:absolute after:top-0.75 after:left-0.75 after:size-6 after:rounded-full after:bg-white after:shadow-[0_2px_6px_rgb(0_0_0/.3)] after:transition-transform after:duration-200 after:ease-spring aria-checked:after:translate-x-5",
  input: "w-full px-3.5 py-2.75 rounded-card border border-transparent bg-surface-2 outline-none focus:border-accent",
};

/** The tint behind a page's header and the small line under it, wherever a page has one. */
export const detail = {
  header: "rise flex max-sm:flex-col max-sm:items-start items-end gap-4.5 px-5 pt-2 pb-1 [&>:first-child]:max-sm:self-center wide:gap-7 wide:px-8 wide:pb-4 @4xl:flex-col @4xl:items-stretch @4xl:gap-5 @4xl:px-0 @4xl:pt-0",
  info: "min-w-0 grid gap-1 max-sm:w-full [&_h1]:text-[1.7rem] [&_h1]:font-extrabold [&_h1]:tracking-[-.03em] [&_h1]:leading-[1.1] [&_h1]:wrap-break-word [&_p]:text-muted [&_p_a]:text-text [&_p_a]:font-semibold wide:[&_h1]:font-title wide:[&_h1]:font-bold wide:[&_h1]:tracking-[-.035em] wide:[&_h1]:leading-[1.04] wide:[&_h1]:text-balance wide:[&_h1]:text-[clamp(2rem,4.6cqi,3.25rem)] @4xl:[&_h1]:text-[clamp(1.9rem,2.6cqi,2.5rem)]",
};
